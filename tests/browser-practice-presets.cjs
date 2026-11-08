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
    await countPcm();
    await page.evaluate(()=>__qa.pitchResolution.prepare());
    await page.locator('#pitchCapture').click();await transport();
    await page.waitForFunction(()=>__qa.recording.state==='recording');await page.evaluate(()=>__qa.pitchResolution.input());
    await page.waitForFunction(()=>__qa.pitchResolution.snapshot().count>=8);
    await transport();await page.waitForFunction(()=>!!document.querySelector('[data-trace-id]'));
    assert.deepEqual(await storage(),{audio:0,chunks:0,traces:1});assert.equal(await page.evaluate(()=>window.pcmStarts),0);
    await page.reload();await wait();await settings(page,'takes');
    const row=page.locator('[data-trace-id]');await row.waitFor({state:'attached'});
    assert.ok(Number(await row.locator('.comp-tracked').innerText())>0);
    await row.locator('.comp-review').click();
    await page.waitForFunction(()=>document.querySelector('.take-pitch-trace-group[data-take-id^="trace:"]'));
    assert.ok(await row.locator('.take-hear').isDisabled());
    await settings(page,'practice');
    const rec=page.locator('#recordAudio'),pos=await page.evaluate(()=>__qa.engine.currentSeconds());
    await countPcm();await rec.click();
    assert.equal(await rec.getAttribute('data-state'),'armed');
    assert.deepEqual(await page.evaluate(()=>[__qa.engine.playing,__qa.recording.state,__qa.engine.currentSeconds(),window.pcmStarts]),[false,'off',pos,0]);
    assert.deepEqual(await storage(),{audio:0,chunks:0,traces:1});
    await page.reload();await wait();
    assert.equal(await rec.getAttribute('aria-pressed'),'false','reload never restores audio consent');
    assert.equal(await page.locator('#pitchCapture').getAttribute('aria-pressed'),'true');
    await settings(page,'practice');await countPcm();await rec.click();await transport();
    await page.waitForFunction(()=>__qa.recording.takes.some(t=>t.active&&t.seconds>1.2));
    assert.equal(await rec.getAttribute('data-state'),'recording');await transport();
    await page.waitForFunction(()=>__qa.recording.state==='off');
    const result=await storage();assert.ok(result.audio>0 && result.chunks>0 && result.traces===1);
    assert.equal(await rec.getAttribute('data-state'),'armed');
    await page.evaluate(()=>__qa.engine.seek(.2));await transport();
    await page.waitForFunction(()=>__qa.recording.takes.some(t=>t.active&&t.seconds>1.15));
    assert.equal(await page.evaluate(()=>window.pcmStarts),2,'Space starts a second overdub without rearming');
    const mid=await page.evaluate(()=>__qa.engine.currentSeconds());await rec.click();
    await page.waitForFunction(()=>__qa.recording.state==='recording' && !__qa.recording.takes.some(t=>t.active));
    assert.ok(await page.evaluate(t=>__qa.engine.playing&&__qa.engine.currentSeconds()>=t,mid));
    await rec.click();const afterArm=await page.evaluate(()=>__qa.engine.currentSeconds());
    await page.waitForFunction(t=>__qa.engine.currentSeconds()>t+.25,afterArm);
    assert.equal(await page.evaluate(()=>window.pcmStarts),2,'arming during a pitch-only pass cannot start PCM');
    assert.equal(await rec.getAttribute('data-state'),'armed');await transport();
    await page.waitForFunction(()=>__qa.recording.state==='off');
    await rec.click();assert.equal(await rec.getAttribute('data-state'),'off');
    await page.waitForFunction(()=>__qa.tracksSettled(),null,{polling:250});
    const audioSnapshot=()=>page.evaluate(async()=>({
      sources:__qa.recording.takes.map(t=>[t.id,t.frames]),
      tracks:(await __qa.takeStore.comps(__qa.takeSong)).map(t=>[t.key,t.segments])
    }));
    const existingAudio=await audioSnapshot();assert.ok(existingAudio.sources.length);
    await page.evaluate(()=>__qa.engine.seek(.2));await transport();
    await page.waitForFunction(()=>__qa.recording.state==='recording'&&__qa.engine.currentSeconds()>.75);
    await transport();await page.waitForFunction(()=>__qa.recording.state==='off');
    assert.deepEqual(await audioSnapshot(),existingAudio,'pitch-only overdubs never replace existing audio or edit the comp');
    const beforeDelete=await storage();
    await settings(page,'takes');await row.locator('.take-delete').click();await row.locator('.take-delete').click();
    await row.waitFor({state:'detached'});
    const afterDelete=await storage();assert.equal(afterDelete.audio,beforeDelete.audio);assert.equal(afterDelete.traces,0);
    await settings(page,'parts');await vol(2).press('ArrowDown');await settings(page,'tools');await copy();
    await page.locator('#copyPracticeMix').click();await page.locator('#shareMixDialog').waitFor({state:'visible'});
    await page.locator('#shareBacking [name=volume]').fill('65');await page.locator('#shareMixDialog button[type=submit]').click();
    assert.equal(new URL(await page.evaluate(()=>window.copied)).searchParams.get('otherVol'),'65');
    await page.evaluate(()=>{const store=__qa.takeStore,original=store.transaction.bind(store);
      store.transaction=(names,mode,fn)=>names.length===1&&names[0]==='counters'&&mode==='readwrite'
        ?Promise.reject(new DOMException('Trace test quota','QuotaExceededError')):original(names,mode,fn);
      __qa.engine.seek(.2);
    });
    await page.locator('#playPause').click();
    await page.waitForFunction(()=>__qa.recording.state==='off' && __qa.recording.notice.includes('last saved point'));
    assert.equal((await storage()).audio,afterDelete.audio);
    return {mobile,copy:true,relative:true,nonuniformBacking:true,refreshKeepsEdits:true,pitchOnly:{audio:0,chunks:0,traces:1},explicitAudio:result,
      armDoesNotPlay:true,spaceRepeatsOverdub:true,noAudioUntilNextPlay:true,disarmDuringPassStopsPcm:true,
      pitchOnlyLeavesCompIntact:true,deletingTraceKeepsAudio:true,pitchQuotaStopsWithoutAudio:true};
  } finally {await page.close();}
}
module.exports={run};
