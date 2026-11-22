// Integration check against a deployment with the two reference maps and audio sprites.
// Set VOWEL_QA_URL to the directory URL. No physical microphone or speaker is used.
const assert = require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES || __dirname]}));

async function verify(browser, entry, mobile) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},
    isMobile:mobile,hasTouch:mobile});
  try {
    await context.addInitScript(()=>{
      if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Test without mic','NotAllowedError');};
      const fillText=CanvasRenderingContext2D.prototype.fillText;
      let labelLayer;window.overviewLabels=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,...args) {
        if(!this.canvas.isConnected){
          if(labelLayer!==this.canvas){labelLayer=this.canvas;window.overviewLabels=[];}
          window.overviewLabels.push(text);
        }
        return fillText.call(this,text,...args);
      };
      window.excerpts=[];
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(when,offset,duration) {
        const play={offset,duration,ended:false,signal:false};
        const pcm=this.buffer.getChannelData(0), rate=this.buffer.sampleRate;
        play.signal=pcm.subarray(Math.round(offset*rate),Math.round((offset+duration)*rate)).some(x=>Math.abs(x)>.001);
        window.excerpts.push(play);this.addEventListener('ended',()=>{play.ended=true;});
        return start.apply(this,arguments);
      };
    });
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(entry);
    await page.waitForFunction(()=>document.querySelectorAll('#map-key button').length===11);
    assert.ok(await page.evaluate(()=>window.isSecureContext));
    const family=id=>page.locator('[data-family="'+id+'"]');
    const focus=page.locator('#map-focus');
    const symbols=()=>focus.locator('.map-reading').evaluateAll(nodes=>nodes.map(n=>n.dataset.vowel));
    const lyric=(word,vowel)=>page.locator('.lyric-syllable[data-vowels="'+vowel+'"]').filter({hasText:word}).first();
    async function press(control) {if(mobile)await control.tap();else await control.click();}
    assert.equal(await page.locator('#song-map').inputValue(),'autumn');
    assert.equal(await page.locator('#map-part').inputValue(),'A');
    assert.equal(await family('R').textContent(),'Ö');
    await page.waitForFunction(()=>window.overviewLabels.length>0);
    const labels=await page.evaluate(()=>window.overviewLabels);
    const keys=await page.locator('#map-key button').allTextContents();
    assert.equal(new Set(labels).size,labels.length);
    assert.ok(labels.every(t=>keys.includes(t)) && labels.length<=11);
    await press(family('AY'));
    assert.deepEqual(await symbols(),['e>ɪ','e>ø']);
    await press(lyric(/^air/i,'e>ø'));
    assert.deepEqual(await symbols(),['e>ø']);
    await press(lyric(/^earth/i,'ø'));
    assert.deepEqual(await symbols(),['ø']);
    await press(page.locator('#map-all'));
    assert.equal(await page.locator('.vowel-key[aria-pressed=true]').count(),0);
    await page.locator('#song-map').selectOption('the-seed');
    await page.waitForFunction(()=>document.querySelector('[data-family=R]')?.textContent==='ER');
    assert.equal(await family('R').getAttribute('data-evidence'),'none');
    await press(lyric(/^ground/i,'a>ʊ'));
    assert.deepEqual(await symbols(),['a>ʊ']);
    await press(lyric(/^fire/i,'a>ɪ(>ɹ)'));
    assert.deepEqual(await symbols(),['a>ɪ(>ɹ)']);
    await page.locator('#map-part').selectOption('T2');
    await press(family('OO'));
    assert.deepEqual(await symbols(),['u','ʊ']);
    await press(lyric(/^could/i,'ʊ'));
    assert.deepEqual(await symbols(),['ʊ']);
    const expected=await page.evaluate(async()=>{
      const song=await (await fetch('the-seed-vowel-map.json?v=1')).json();
      return {clip:song.audio,interval:song.vowels['ʊ'].examples[0].audio};
    });
    const playing=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+expected.clip) && r.ok());
    await press(focus.locator('.map-example').first());
    await playing;
    await page.waitForFunction(([start,end])=>window.excerpts.some(e=>e.ended && e.signal
      && Math.abs(e.offset-start)<.0001 && Math.abs(e.duration-(end-start))<.0001),expected.interval,{timeout:5000});
    const previous=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('vowel-examples.wav')).length);
    await press(focus.locator('.map-example').first());
    await page.waitForFunction(()=>window.excerpts.length===2);
    assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('vowel-examples.wav')).length),previous,'Do not re-fetch audio on repeat');
    await page.locator('#map-part').selectOption('S2');
    await press(lyric(/^blue/i,'u'));assert.deepEqual(await symbols(),['u']);
    await press(lyric(/^roots/i,'u/ʊ'));assert.deepEqual(await symbols(),['u','ʊ']);
    await press(lyric(/^earth/i,'ɝ'));assert.deepEqual(await symbols(),['ɝ']);
    await press(page.locator('#map-method summary'));
    await page.locator('#map-borrow').check();
    await page.waitForFunction(()=>document.querySelector('[data-family="Short A"]').dataset.evidence==='borrowed');
    assert.equal(await family('R').getAttribute('data-evidence'),'none');
    assert.equal(await focus.locator('.map-example').count(),0,'Never use rounded Ö recordings for English ER');
    await press(family('R'));assert.deepEqual(await symbols(),['ɝ','ɚ']);
    assert.equal(await page.locator('#map-lyrics .lyric-neutral button').count(),0);
    assert.ok(await page.locator('#map-lyrics .lyric-neutral').count()>0);
    assert.match(await page.locator('#map-count').textContent(),/^11 rehearsal groups/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Unexpected whole-page horizontal overflow');
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
}
async function run(url,mobileEntry) {
  const entry=new URL('?song=autumn&part=A',url).href;
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome',headless:true,args:['--mute-audio']});
  try {await verify(browser,entry,false);await verify(browser,mobileEntry||entry,true);}
  finally {await browser.close();}
  console.log('Passed: desktop and touch, both song inventories, exact syllable audio, alternate and missing sounds, one label per key, phone layout.');
}
if(require.main===module)run(process.env.VOWEL_QA_URL).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
