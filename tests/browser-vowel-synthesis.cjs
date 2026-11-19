// Run the normal page with synthetic microphone input and measure its digital speaker output.
// Optional VOWEL_QA_URL points at a deployed copy. Neither input nor output uses physical hardware.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(require.resolve('playwright', {paths:[process.env.GUI_QA_NODE_MODULES || __dirname]}));

async function main() {
  let url=process.env.VOWEL_QA_URL, server;
  if (!url) {
    const root=path.join(__dirname,'../vowel-lab');
    server=http.createServer((req,res)=>{
      const file=path.join(root,path.basename(req.url==='/'?'index.html':req.url));
      if (req.method!=='GET' || !fs.existsSync(file)) {res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.css':'text/css','.js':'text/javascript'}[path.extname(file)] || 'text/plain'});
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    url='http://127.0.0.1:'+server.address().port+'/';
  }
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try {
    const context=await browser.newContext({permissions:['microphone'],serviceWorkers:'block'});
    await context.addInitScript(()=>{
      const Native=window.AudioContext;
      const qa=window.previewTest={oscillators:[]};
      // A synthesized vocal-tract filter driven by a glottal pulse train.
      function vowel(ctx,hz) {
        const rate=ctx.sampleRate, buffer=ctx.createBuffer(1,rate,rate);
        let phase=0,glottal=0,peak=0;
        const filters=[[650,70],[1250,90],[2700,140],[3800,190]].map(([f,b])=>{
          const r=Math.exp(-Math.PI*b/rate);
          return {a:2*r*Math.cos(2*Math.PI*f/rate),b:-r*r,y:0,z:0};
        });
        const pcm=buffer.getChannelData(0);
        for(let i=0;i<pcm.length;i++){
          phase+=hz/rate;glottal=.91*glottal+(phase>=1?1:0);phase%=1;
          let x=glottal;
          for(const f of filters){const v=x+f.a*f.y+f.b*f.z;f.z=f.y;f.y=v;x=v;}
          pcm[i]=x;peak=Math.max(peak,Math.abs(x));
        }
        for(let i=0;i<pcm.length;i++)pcm[i]*=.3/peak;
        return buffer;
      }
      window.AudioContext=class extends Native {
        constructor(options={}) {
          super({...options,sinkId:{type:'none'}});
          this.previewOutput=!options.sinkId;
          if(this.previewOutput){qa.output=this;qa.meter=super.createAnalyser();qa.meter.fftSize=4096;qa.meter.smoothingTimeConstant=0;}
        }
        createMediaStreamSource() {
          const input=super.createGain();
          let generator=null;
          qa.sing=hz=>{
            generator?.stop();generator=null;
            if(hz){generator=this.createBufferSource();generator.buffer=vowel(this,hz);generator.loop=true;generator.connect(input);generator.start();}
          };
          return input;
        }
        createGain() {
          const g=super.createGain();
          if(!this.previewOutput)return g;
          const connect=g.connect.bind(g);
          g.connect=(target,...rest)=>{
            if(target===this.destination)connect(qa.meter);
            return connect(target,...rest);
          };
          return g;
        }
        createOscillator() {
          const o=super.createOscillator(), start=o.start.bind(o);
          o.start=(...args)=>{if(this.previewOutput)qa.oscillators.push(o.frequency.value);return start(...args);};
          return o;
        }
      };
      qa.read=()=>{
        if(!qa.meter)return {rms:0,bright:0};
        const a=new Float32Array(qa.meter.fftSize);qa.meter.getFloatTimeDomainData(a);
        const f=new Float32Array(qa.meter.frequencyBinCount);qa.meter.getFloatFrequencyData(f);
        function band(lo,hi) {
          let sum=0;
          for(let i=Math.ceil(lo*a.length/qa.output.sampleRate);i<=Math.floor(hi*a.length/qa.output.sampleRate);i++)sum+=10**(f[i]/10);
          return sum;
        }
        return {rms:Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length),bright:band(1900,2550)/Math.max(1e-15,band(870,1350))};
      };
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(()=>typeof window.previewTest.sing==='function',null,{timeout:30000});
    const chart=page.locator('#chart');
    const position=async(f1,f2)=>chart.evaluate((el,p)=>{
      const b=el.getBoundingClientRect(),q=VowelLab.chartPoint(p);
      return {x:b.x+66+q.x*(b.width-106),y:b.y+24+q.y*(b.height-78)};
    },{f1,f2});
    const front=await position(320,2240),back=await position(700,1120);
    const press=async p=>{await page.mouse.move(p.x,p.y);await page.mouse.down();};
    const audio=(loud)=>page.waitForFunction(loud?()=>previewTest.read().rms>.009:()=>previewTest.read().rms<.0008,null,{timeout:4000});
    const saved=()=>Number(localStorage.getItem('vowel-lab-last-sung-pitch-v1'));
    const pitches=()=>page.evaluate(()=>previewTest.oscillators);

    await page.mouse.click(front.x,front.y);
    await audio(true);
    assert.equal((await pitches())[0],220);
    await audio(false);
    await page.evaluate(()=>previewTest.sing(140));
    await page.waitForFunction(()=>Math.abs(Number(localStorage.getItem('vowel-lab-last-sung-pitch-v1'))-140)<2);
    await page.evaluate(()=>previewTest.sing(0));
    await page.waitForFunction(()=>document.querySelector('#f1').textContent==='—');
    await page.evaluate(()=>{previewTest.oscillators=[];});
    await press(front);await audio(true);
    await page.waitForFunction(()=>previewTest.read().bright>2);
    const first=await page.evaluate(()=>previewTest.read());
    const held=await pitches();
    assert.ok(Math.abs(held[0]-140)<2);
    await page.evaluate(()=>previewTest.sing(196));
    await page.mouse.move(back.x,back.y,{steps:12});
    await page.waitForFunction(()=>previewTest.read().bright<.15);
    const last=await page.evaluate(()=>previewTest.read());
    assert.ok(last.rms>.009 && first.bright/last.bright>20);
    assert.deepEqual(await pitches(),held);
    // Keep singing a different pitch into the mic during the gesture. It must not latch.
    await page.waitForTimeout(1200);
    assert.ok(Math.abs(await page.evaluate(saved)-140)<2);
    await page.mouse.up();await audio(false);
    await page.waitForFunction(()=>Math.abs(Number(localStorage.getItem('vowel-lab-last-sung-pitch-v1'))-196)<2);
    await page.evaluate(()=>previewTest.sing(0));
    await page.reload();
    await chart.waitFor();
    await chart.focus();await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Space');await audio(true);
    assert.ok(Math.abs((await pitches())[0]-196)<2);
    await page.keyboard.up('Space');await audio(false);
    await press(back);await audio(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await audio(false);await page.mouse.up();
    await press(front);await audio(true);
    await page.evaluate(()=>document.querySelector('#chart').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));
    await audio(false);await page.mouse.up();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({url,firstVisitPitch:220,retainedPitch:held[0],retunedAfterRelease:await page.evaluate(saved),frontToBackBandRatio:first.bright/last.bright,shortTap:true,mouseDrag:true,keyboard:true,cancellation:true,pageErrors:errors.length}));
  } finally {await browser.close();server?.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
