const assert=require('node:assert/strict');
async function stereoOutput(page) {
  const result=await page.evaluate(async()=>{
    const e=__qa.engine,ctx=(e.ensureAudio(),e.context);
    const samples=[],probe=ctx.createScriptProcessor(512,2,1);
    probe.onaudioprocess=({inputBuffer})=>{
      samples.push([0,1].map(i=>inputBuffer.getChannelData(i).reduce((m,v)=>Math.max(m,Math.abs(v)),0)));
    };
    e.finalOutput.connect(probe);probe.connect(ctx.destination);
    const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
    try{
      document.querySelector('#openTimingCheck').click();
      document.querySelector('#testPlaybackOutput').click();
      await wait(1500);
      const channels=[],peaks=[0,0];let last=0,leak=0;
      for(const [l,r] of samples){
        peaks[0]=Math.max(peaks[0],l);peaks[1]=Math.max(peaks[1],r);
        leak=Math.max(leak,Math.min(l,r));const side=l>.003?1:r>.003?2:0;
        if(side && side!==last)channels.push(side);last=side;
      }
      document.querySelector('#closeTimingCheck').click();
      const saved=__qa.pitchbar.captureSettingsState(),guide=[];
      try{
        for(const [pan,heard] of [[-100,true],[100,true],[-100,false],[100,false]]){
          e.updateMix(new Set(heard?[0]:[]),[100],[pan],true);
          const {release}=e.holdNote(62,0,{channel:0});
          try{await wait(80);samples.length=0;await wait(160);
            guide.push(samples.reduce(([l,r],v)=>[Math.max(l,v[0]),Math.max(r,v[1])],[0,0]));
          }finally{release();await wait(180);}
        }
      }finally{e.updateMix(new Set(saved.audible.flatMap((on,i)=>on?[i]:[])),saved.volumes,saved.pans,true);}
      return {channels,peaks,leak,guide};
    }finally{e.finalOutput.disconnect(probe);probe.disconnect();probe.onaudioprocess=null;}
  });
  assert.deepEqual(result.channels,[1,2,2]);assert.ok(Math.min(...result.peaks)>.01 && result.leak<.0001);
  result.guide.forEach((pair,i)=>{
    assert.ok(pair[i%2]>.01 && pair[1-i%2]<.0001,`guide preview ${i} with left/right peaks ${pair} must pan at the final output`);
  });
  return result;
}
async function run(context,origin) {
  await context.route('**/station-roster.json',r=>r.fulfill({json:{singers:[{name:'Mix Bass',voice:'Bass'}]}}));
  await context.route('**/melete/api.php*',r=>r.fulfill({json:{}}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  const ready=()=>page.waitForFunction(()=>window.__qa&&!__qa.busy&&document.querySelector('#playPause:not(:disabled)'));
  const settings=async name=>{
    const t=page.locator('#settingsToggle');if((await t.getAttribute('aria-expanded'))!=='true')await t.click();
    const h=page.locator('[data-settings-section="'+name+'"] .settings-section-toggle');
    if(await h.isVisible() && await h.getAttribute('aria-expanded')==='false')await h.click();
  };
  const waitPan=(i,v)=>page.waitForFunction(([i,v])=>Math.abs(__qa.engine.trackStrips[i].panner.pan.value-v)<.015,[i,v]);
  await page.goto(origin+'?mode=station&part=Bass');await ready();await settings('tools');
  const stereo=await stereoOutput(page);
  const before=await page.evaluate(()=>({mix:__qa.pitchbar.captureSettingsState(),t:__qa.engine.currentSeconds()}));
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>window.lastURL=url}});});
  await page.locator('#copyPracticeMix').click();
  const dialog=page.locator('#stationMixDialog'), tabs=dialog.getByRole('tab');
  assert.equal(await tabs.first().getAttribute('aria-selected'),'true');
  await tabs.first().click();assert.equal(await tabs.last().getAttribute('aria-selected'),'true','even tapping selected half toggles');
  assert.ok(!await dialog.getByLabel('My pan',{exact:true}).isVisible());
  await dialog.locator('#stationMixGuide').selectOption('2');await dialog.locator('#stationMixListen').click();
  await page.waitForFunction(()=>__qa.engine.context?.state==='running');
  await waitPan(0,.70);await waitPan(2,0);
  await page.evaluate(()=>{const a=__qa.engine.context.createAnalyser();a.fftSize=512;__qa.engine.master.connect(a);window.mixAudition=a;});
  await page.waitForFunction(()=>{const buf=new Float32Array(512);window.mixAudition.getFloatTimeDomainData(buf);return buf.some(v=>Math.abs(v)>.001);});
  await dialog.getByLabel('Stereo width').press('End');await waitPan(0,1);
  assert.deepEqual(await page.evaluate(()=>[__qa.engine.playing,__qa.engine.currentSeconds(),__qa.recording.state]),[false,before.t,'off']);
  const savedBefore=await page.evaluate(()=>MeletePracticeMix.stationDefault());
  await dialog.locator('#copyChoirMix').click();
  const link=await page.evaluate(()=>window.lastURL);
  assert.equal(link,origin+'?layout=choir&width=100&myVol=150&otherVol=35');
  assert.deepEqual(await page.evaluate(()=>MeletePracticeMix.stationDefault()),savedBefore);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await waitPan(0,before.mix.pans[0]/100);
  assert.deepEqual(await page.evaluate(()=>__qa.pitchbar.captureSettingsState()),before.mix);
  await page.locator('#playPause').click();await page.waitForFunction(()=>__qa.engine.playing);
  await page.locator('#copyPracticeMix').click();await tabs.last().click();await waitPan(0,.70);
  assert.ok(await dialog.locator('#stationMixListen').isDisabled(),'preview follows the running transport');
  await dialog.locator('#closeStationMix').click();await waitPan(0,before.mix.pans[0]/100);
  assert.equal(await page.evaluate(()=>__qa.engine.playing),true);await page.locator('#playPause').click();
  await page.locator('#copyPracticeMix').click();assert.equal(await tabs.first().getAttribute('aria-selected'),'true');
  await tabs.last().click();await dialog.locator('#setStationMix').click();await dialog.locator('#closeStationMix').click();
  await page.reload();await ready();await settings('tools');await page.locator('#copyPracticeMix').click();
  assert.equal(await tabs.last().getAttribute('aria-selected'),'true');await dialog.locator('#closeStationMix').click();
  await settings('practice');await page.locator('#stationSinger').fill('Mix Bass');
  await page.locator('#stationSingerList .station-option').first().click();
  await page.waitForFunction(()=>document.querySelector('[data-pan-index="0"]').dataset.value==='70');
  await settings('tools');await page.locator('#copyPracticeMix').click();await dialog.getByLabel('Stereo width').press('End');
  await dialog.locator('#setStationMix').click();await dialog.locator('#closeStationMix').click();
  await page.waitForFunction(()=>document.querySelector('[data-pan-index="0"]').dataset.value==='100');
  await settings('parts');await page.locator('[data-volume-index="2"]').press('ArrowDown');
  await settings('tools');await page.locator('#copyPracticeMix').click();await tabs.first().click();
  await dialog.locator('#setStationMix').click();await dialog.locator('#closeStationMix').click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-pan-index="0"]').getAttribute('data-value'),'100','personal pan survives a station-default change');
  assert.equal(await page.locator('[data-volume-index="2"]').getAttribute('data-value'),'145','personal guide volume survives too');
  await page.goto(link);await ready();await page.locator('#partChooserOptions button').nth(1).click();
  const pans=()=>page.locator('[data-pan-index]').evaluateAll(nodes=>nodes.map(n=>+n.dataset.value));
  assert.deepEqual(await pans(),[50,0,-50]);await settings('practice');await page.locator('#practicePart').click();
  await page.waitForFunction(()=>document.querySelector('[data-visible-index="2"]').getAttribute('aria-pressed')==='true');
  assert.deepEqual(await pans(),[100,50,0],'retarget the whole choir, not just the old/new guide pair');
  assert.deepEqual(errors,[]);
  return {audio:true,stereo,unchangedTransport:true,defaultSeparate:true,recipientRetarget:true};
}
module.exports={run};
