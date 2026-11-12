const assert=require('node:assert/strict');
async function settings(f,section) {
  if(await f.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await f.locator('#settingsToggle').click();
  const h=f.locator('[data-settings-section="'+section+'"] .settings-section-toggle');
  if(await h.isVisible() && await h.getAttribute('aria-expanded')==='false') await h.click();
}
async function run(context,origin,mobile) {
  const page=await context.newPage(),url=origin+'?myVol=150&otherVol=50&myPan=90&otherPan=-90';
  const wait=()=>page.waitForSelector('#playPause:not(:disabled)',{state:'attached'});
  const transport=()=>mobile?page.locator('#playPause').click():page.keyboard.press('Space');
  const countPcm=()=>page.evaluate(()=>{window.pcmStarts=0;const orig=MeleteRecording.PcmCapture.create;
    MeleteRecording.PcmCapture.create=function(...args){pcmStarts++;return orig.apply(this,args);};});
  const storage=()=>page.evaluate(async()=>{
    const db=await new MeleteRecording.TakeStore().open(),tx=db.transaction(['takes','chunks','counters']);
    const get=r=>new Promise(ok=>r.onsuccess=()=>ok(r.result));
    const [audio,chunks,counters]=await Promise.all([get(tx.objectStore('takes').count()),get(tx.objectStore('chunks').count()),get(tx.objectStore('counters').getAllKeys())]);
    return {audio,chunks,traces:counters.filter(k=>Array.isArray(k)&&k[0]==='practice-contour:1').length};
  });
  try {
    await page.goto(url);await wait();await page.locator('#partChooserOptions button').nth(1).click();
    await settings(page,'practice');
    const guide=page.locator('#practicePart'),seen=page.locator('[data-visible-index]'),vol=i=>page.locator('[data-volume-index="'+i+'"]');
    assert.equal(await vol(1).getAttribute('data-value'),'150');assert.equal(await vol(0).getAttribute('data-value'),'50');
    assert.equal(await page.locator('[data-pan-index="1"]').getAttribute('data-value'),'90');
    const copy=()=>page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value;}}});});
    await settings(page,'tools');await copy();await page.locator('#copyPracticeMix').click();assert.equal(await page.evaluate(()=>window.copied),url);
    await settings(page,'parts');await vol(1).press('ArrowDown');
    await page.reload();await wait();assert.ok(!await page.locator('#partChooser').isVisible());assert.equal(await vol(1).getAttribute('data-value'),'145');
    await settings(page,'parts');await seen.nth(0).click();await settings(page,'practice');
    assert.ok(await guide.evaluate(el=>el.classList.contains('is-mixed')));await guide.click();
    assert.equal(await page.locator('[data-visible-index][aria-pressed=true]').count(),1);
    assert.equal(await seen.nth(1).getAttribute('aria-pressed'),'true');await guide.click();
    await page.waitForFunction(()=>document.querySelector('[data-visible-index="2"]').getAttribute('aria-pressed')==='true');
    assert.equal(await vol(2).getAttribute('data-value'),'145');assert.equal(await vol(1).getAttribute('data-value'),'50');
    await page.goto(origin+'?part=Soprano&myVol=150&otherVol=50&myPan=90&otherPan=-90');await wait();
    assert.ok(!await page.locator('#partChooser').isVisible());await settings(page,'practice');
    await countPcm();const sing=page.locator('#pitchCapture');
    assert.equal(await page.locator('#recordAudio').count(),0);
    await page.evaluate(()=>__qa.pitchResolution.prepare());
    const before=await storage();
    await sing.click();assert.equal(await sing.getAttribute('data-state'),'armed');
    assert.deepEqual(await storage(),before);assert.equal(await page.evaluate(()=>window.pcmStarts),0);
    await transport();await page.waitForFunction(()=>__qa.recording.state==='recording');
    await page.evaluate(()=>__qa.pitchResolution.input());await page.waitForFunction(()=>__qa.pitchResolution.snapshot().count>=8);
    await page.waitForFunction(()=>__qa.recording.takes.some(t=>t.active && t.seconds>1.2));
    await transport();await page.waitForFunction(()=>__qa.recording.state==='off' && __qa.recording.takes.some(t=>t.pitchScore));
    const result=await storage();assert.ok(result.audio>0 && result.chunks>0);assert.equal(result.traces,0);
    assert.equal(await sing.getAttribute('aria-pressed'),'true');
    await page.reload();await wait();await settings(page,'practice');await countPcm();
    assert.equal(await sing.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>__qa.engine.playing),false);
    await sing.click();
    const audioSnapshot=()=>page.evaluate(()=>__qa.recording.takes.map(t=>[t.id,t.frames]));
    await page.evaluate(()=>__qa.engine.seek(.2));await transport();
    for(let pass=0;pass<2;pass++){
      await sing.click();await page.waitForFunction(()=>__qa.recording.takes.some(t=>t.active && t.seconds>.4));
      await sing.click();await page.waitForFunction(()=>__qa.recording.state==='off');
      const snap=await audioSnapshot(),t=await page.evaluate(()=>__qa.engine.currentSeconds());
      await page.waitForFunction(s=>__qa.engine.playing && __qa.engine.currentSeconds()>s+.18,t);
      assert.deepEqual(await audioSnapshot(),snap,'guide-only playback writes no audio');
    }
    assert.equal(await page.evaluate(()=>window.pcmStarts),2);await transport();
    assert.equal((await storage()).traces,0);
    await settings(page,'parts');await vol(2).press('ArrowDown');await settings(page,'tools');await copy();
    await page.locator('#copyPracticeMix').click();await page.locator('#shareMixDialog').waitFor({state:'visible'});
    await page.locator('#shareBacking [name=volume]').fill('65');await page.locator('#shareMixDialog button[type=submit]').click();
    assert.equal(new URL(await page.evaluate(()=>window.copied)).searchParams.get('otherVol'),'65');
    return {mobile,relative:true,recordedAudioAndPitch:result,punches:2,offWritesNothing:true};
  } finally {await page.close();}
}
module.exports={run};
