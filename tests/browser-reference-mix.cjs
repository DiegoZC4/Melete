const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {wavBytes}=require('../template/loop_recorder.js');
const {timing}=require('../template/reference_audio.js');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');

async function checkReferenceMix(browser,temporary,output) {
  const project=path.join(temporary,'reference-player'), config=path.join(temporary,'reference.config.json');
  const sequence=JSON.parse(await fs.readFile(path.join(temporary,'player/assets/playback.json'),'utf8'));
  let duration=0;
  sequence.tempos.forEach(([start,bpm],i)=>{duration+=((sequence.tempos[i+1]?.[0]??sequence.endTick)-start)/sequence.division*60/bpm;});
  const sampleRate=12000, pcm=Int16Array.from({length:Math.ceil(duration*sampleRate)},(_,i)=>Math.round(5000*Math.sin(2*Math.PI*440*i/sampleRate)));
  await fs.writeFile(config,JSON.stringify({referenceAudio:{data:Buffer.from(wavBytes(pcm,sampleRate)).toString('base64'),mime:'audio/wav',label:'Synthetic aligned reference',timing:timing(sequence)}}));
  execFileSync(process.env.PYTHON||'python3',[path.resolve(__dirname,'../build_trainer.py'),
    path.join(__dirname,'fixtures/shared-regressions.musicxml'),'--project-dir',project,'--config',config],{stdio:'pipe'});
  const html=(await fs.readFile(path.join(project,'dist/index.html'),'utf8')).replace('engine = new GuideEngine(sequence);',
    'engine = new GuideEngine(sequence);window.__refQA={engine,get state(){return currentPreferenceState();}};');
  const report=[];
  const offlineFile=path.join(temporary,'reference-offline.html');
  await fs.writeFile(offlineFile,html);
  for(const width of [1440,393]) {
    const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600});
    try {
      await expandSettingsFixture(context);
      await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8809/reference-fixture')
        ?route.fulfill({contentType:'text/html',body:html}):route.abort());
      const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(width===1440) {
        await context.unroute('**/*');
        await context.setOffline(true);
        await page.goto(pathToFileURL(offlineFile).href);
      } else await page.goto('http://127.0.0.1:8809/reference-fixture');
      await page.waitForSelector('#playPause:not(:disabled)');
      if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
      if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
      const hear=page.locator('.reference-hear');
      assert.equal(await hear.getAttribute('aria-pressed'),'false');
      assert.equal(await page.evaluate(()=>__refQA.engine.referenceLayers.size),0,'reference is lazy and off by default');
      const before=await page.evaluate(()=>__refQA.state);
      await hear.click();
      await page.waitForFunction(()=>__refQA.engine.referenceLayers.get('reference:original')?.stretchNode);
      assert.equal(await page.evaluate(()=>__refQA.engine.takeLayers.size),0,'reference is not a saved take');
      await page.evaluate(()=>{
        const e=__refQA.engine;e.updateMix(new Set(),[],[]);
        const meter=e.context.createAnalyser();meter.fftSize=8192;e.master.connect(meter);__refQA.meter=meter;
        __refQA.rms=()=>{const a=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);};
        const layer=e.referenceLayers.get('reference:original'), start=layer.stretchNode.start.bind(layer.stretchNode);
        __refQA.starts=[];layer.stretchNode.start=o=>{__refQA.starts.push(o);return start(o);};
      });
      await page.locator('#playPause').click();
      await page.waitForFunction(()=>__refQA.rms()>.02);
      assert.equal(await page.evaluate(()=>__refQA.starts.at(-1).semitones),0);
      await page.evaluate(()=>__refQA.engine.setRate(.75));
      await page.waitForFunction(()=>__refQA.starts.at(-1)?.rate===.75);
      assert.equal(await page.evaluate(()=>__refQA.starts.at(-1).semitones),0,'speed does not transpose the recording');
      await page.evaluate(()=>__refQA.engine.seek(1));
      await page.waitForFunction(()=>Math.abs(__refQA.starts.at(-1)?.input-1)<.15);
      await page.locator('#playPause').click();
      assert.equal(await page.evaluate(()=>__refQA.engine.referenceLayers.get('reference:original').source),null);
      await page.locator('.reference-volume').press('ArrowUp');
      const volume=await page.locator('.reference-volume').getAttribute('data-value');
      await page.locator('.reference-pan').press('ArrowRight');
      const after=await page.evaluate(()=>__refQA.state);
      for(const key of ['audible','visible','volumes','pans','practicePart','scoreView'])assert.deepEqual(after[key],before[key],key);
      await page.reload();await page.waitForSelector('#playPause:not(:disabled)');
      // Score readiness precedes asynchronous reference-audio restoration.
      await page.waitForFunction(()=>__refQA.engine.referenceLayers.size===1
        && document.querySelector('.reference-hear').getAttribute('aria-pressed')==='true');
      assert.equal(await hear.getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.reference-volume').getAttribute('data-value'),volume);
      await page.evaluate(()=>document.dispatchEvent(new Event('melete:deactivate')));
      assert.equal(await page.evaluate(()=>__refQA.engine.referenceLayers.size),0,'switching songs releases reference audio');
      await page.evaluate(()=>document.dispatchEvent(new Event('melete:activate')));
      await page.waitForFunction(()=>__refQA.engine.referenceLayers.size===1);
      await hear.click();assert.equal(await page.evaluate(()=>__refQA.engine.referenceLayers.size),0);
      await page.screenshot({path:path.join(output,`reference-mix-${width}.png`)});
      assert.deepEqual(errors,[]);
      report.push({width,audible:true,independent:true,seeks:true,speedPreservesPitch:true,pause:true,reload:true,deactivation:true});
    } finally {await context.close();}
  }
  return report;
}
module.exports={checkReferenceMix};
