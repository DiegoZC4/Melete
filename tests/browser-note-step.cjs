const assert=require('node:assert/strict');
const path=require('node:path');
const {choosePart}=require('./browser-sing.cjs');
async function run(page,mobile,output){
  const state=()=>page.evaluate(()=>__qa.pitchbar.captureSettingsState());
  if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
  await choosePart(page,0);
  await page.evaluate(()=>{const q=__qa.pitchbar,s=q.captureSettingsState();
    s.audible=[true,false,true];s.volumes=[175,40,40];s.pans=[75,-50,-50];q.applySettingsState(s);});
  await choosePart(page,1);
  assert.deepEqual((await state()).volumes,[40,175,40]);assert.deepEqual((await state()).pans,[-50,75,-50]);
  assert.deepEqual((await state()).audible,[true,true,true]);
  await choosePart(page,0);assert.deepEqual((await state()).audible,[true,false,true]);
  for(const section of ['practice','takes']){
    const head=page.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
    if(await head.isVisible() && await head.getAttribute('aria-expanded')==='false')await head.click();
  }
  assert.equal(await page.locator('#undoComp').isVisible(),mobile);
  assert.equal(await page.locator('#redoComp').isVisible(),mobile);
  assert.ok(await page.locator('.comp-columns #downloadMix').isDisabled());
  assert.ok(await page.locator('#takeReviewTable').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'default columns fit');
  await page.waitForFunction(()=>!__qa.busy);
  assert.equal(await page.locator('#noteStepToggle, #noteStepBar, [data-note-step]').count(),0);
  const tick=()=>page.evaluate(()=>Math.round(__qa.engine.tickAtSeconds(__qa.engine.currentSeconds())));
  await page.evaluate(()=>{
    document.activeElement?.blur();
    const engine=__qa.engine, hold=engine.holdNote.bind(engine);
    window.previewVoices=0;
    engine.holdNote=(...args)=>{
      const voice=hold(...args);
      window.previewVoices++;
      return {release(){window.previewVoices--;window.previewReleaseStack=new Error().stack;voice.release();}};
    };
  });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(()=>previewVoices>0);
  const first=await tick();
  await page.waitForTimeout(350);
  assert.ok(await page.evaluate(()=>previewVoices>0),await page.evaluate(()=>window.previewReleaseStack || 'held arrow ended early'));
  await page.keyboard.down('ArrowRight');
  assert.equal(await tick(),first,'key repeat must not advance');
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction(()=>previewVoices===0);
  await page.keyboard.press('ArrowRight');
  const second=await tick();assert.ok(second>first);
  await page.keyboard.press('ArrowLeft');assert.equal(await tick(),first);
  await page.locator('#pitchCapture').click();
  assert.equal(await page.evaluate(()=>__qa.recording.state),'off');
  assert.equal(await page.evaluate(async()=>(await __qa.takeStore.list(__qa.takeSong)).length),0);
  await page.screenshot({path:path.join(output,`note-step-${mobile?'touch':'desktop'}.png`)});
  await page.locator('#playPause').click();
  await page.waitForFunction(()=>__qa.recording.state==='recording' && __qa.engine.playing);
  const pass=await page.evaluate(()=>__qa.recording.takes.find(t=>t.active)?.id);
  assert.ok(pass,'capture has a live take');
  await page.locator('body').press('ArrowRight');
  assert.ok(await page.evaluate(id=>__qa.engine.playing && __qa.recording.state==='recording' && __qa.recording.takes.some(t=>t.id===id && t.active),pass),
    'an arrow during capture leaves the same take running');
  await page.locator('#playPause').click();await page.waitForFunction(()=>__qa.recording.state==='off');
  return {mobile,first,second,heldPreview:true,recordingContinued:true,backingMuteRestored:true,columnsFit:true};
}
module.exports={run};
