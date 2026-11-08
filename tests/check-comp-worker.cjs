const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
async function main() {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    const scripts = [];
    for (const name of ['vocal_pitch.js','take_pitch.js','practice_comp.js']) scripts.push(await fs.readFile(path.join(__dirname,'../template',name),'utf8'));
    await page.route('http://127.0.0.1/comp-worker-test', r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body>'+scripts.map(s=>'<script>'+s+'</script>').join('')}));
    await page.goto('http://127.0.0.1/comp-worker-test');
    const result = await page.evaluate(async()=>{
      const P=MeleteTakePitch,C=MeleteComp, seconds=300;
      const notes=Array.from({length:600},(_,i)=>[i*.5,(i+1)*.5,[48+i%8]]);
      const ref={version:1,fingerprint:'worker-benchmark',part:0,line:1,start:0,end:300,
        captureStart:0,leadInSeconds:0,rate:1,seconds,latency:0,notes};
      const descriptor={song:'worker-benchmark',reference:ref};
      function take(id,from,to) {
        const r={...ref,start:from,end:to,captureStart:from,seconds:to-from,
          notes:C.clipNotes(notes,[{from,to}]).map(([a,b,p])=>[a-from,b-from,p])};
        const t={id,song:descriptor.song,number:Number(id),createdAt:Number(id),complete:true,finalized:true,
          frames:(to-from)*8000,sampleRate:8000,pitchReference:r,rate:1,origin:from,replaces:true};
        const frames=Array.from({length:(to-from)*100},(_,i)=>({start:i/100,end:(i+1)/100,cents:(48+Math.floor((from+i/100)*2)%8)*100+20}));
        t.pitchScore=P.scoreFrames(frames,r,r.seconds);t.pitchContour=P.packContour(frames,t);return t;
      }
      const a=take('1',0,300),b=take('2',60,90),sources=new Map([[a.id,a]]);
      const previous=await C.reconcileAsync(descriptor,[],sources);sources.set(b.id,b);
      let paints=0,previousPaint=performance.now(),maxPaintGap=0,active=true;
      const draw=now=>{paints++;maxPaintGap=Math.max(maxPaintGap,now-previousPaint);previousPaint=now;if(active)requestAnimationFrame(draw);};
      requestAnimationFrame(draw);
      const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));
      observer.observe({type:'longtask'});
      const start=performance.now(),updated=await C.reconcileAsync(descriptor,[previous.state],sources);
      const elapsed=performance.now()-start;active=false;
      await new Promise(resolve=>requestAnimationFrame(resolve));observer.disconnect();
      return {elapsedMs:elapsed,paints,maxPaintGapMs:maxPaintGap,maxMainTaskMs:Math.max(0,...tasks),
        segments:updated.score.segmentCount,frames:updated.frames.length,coverage:updated.score.coverage};
    });
    assert.equal(result.segments,3);assert.ok(result.coverage>.99);assert.ok(result.paints>0);
    assert.ok(result.maxMainTaskMs<100,JSON.stringify(result));
    console.log(JSON.stringify(result,null,2));
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
