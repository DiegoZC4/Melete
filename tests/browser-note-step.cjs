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
  await page.locator('#noteStepToggle').click();
  const tick=()=>page.evaluate(()=>Math.round(__qa.engine.tickAtSeconds(__qa.engine.currentSeconds())));
  const first=await tick(),next=page.locator('[data-note-step="1"]');
  await page.evaluate(()=>{const e=__qa.engine,fn=e.holdNote.bind(e);window.held=0;e.holdNote=(...args)=>{
    window.held++;const voice=fn(...args);return {release(){window.held--;voice.release();}};};});
  await next.click();const second=await tick();assert.ok(second>first);assert.equal(await page.evaluate(()=>held),0);
  const box=await next.boundingBox();assert.ok(box.height>=44);
  await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
  await page.waitForFunction(()=>held===1);await page.mouse.up();
  assert.equal(await tick(),second);assert.equal(await page.evaluate(()=>held),0);
  await page.mouse.down();await page.waitForFunction(()=>held===1);
  await page.mouse.move(box.x+35,box.y+10);await page.mouse.up();
  assert.equal(await tick(),second,'dragging away cancels without moving');
  assert.equal(await page.evaluate(()=>held),0,'cancellation releases the sounding voice');
  await page.locator('body').press('ArrowLeft');assert.equal(await tick(),first);
  await next.press('Enter');assert.equal(await tick(),second);
  await next.focus();await page.keyboard.down('Enter');
  try {await page.waitForFunction(()=>held===1,null,{timeout:2500});}
  catch(e){throw new Error('Key hold did not sustain: '+JSON.stringify(await page.evaluate(()=>({
    focused:document.activeElement?.outerHTML.slice(0,120),pressed:noteStepToggle.getAttribute('aria-pressed'),held,note:parkedNote.textContent
  }))),{cause:e});}
  await page.keyboard.up('Enter');
  assert.equal(await tick(),second,'keyboard hold previews without stepping on release');
  await page.locator('#pitchCapture').click();await page.waitForFunction(()=>parkedCents.textContent.includes('\u00a2'),null,{timeout:12000});
  assert.equal(await page.evaluate(()=>__qa.recording.state),'off');
  assert.equal(await page.evaluate(async()=>(await __qa.takeStore.list(__qa.takeSong)).length),0);
  await page.screenshot({path:path.join(output,`note-step-${mobile?'touch':'desktop'}.png`)});
  await page.locator('#playPause').click();
  await page.waitForFunction(()=>__qa.recording.state==='recording' && __qa.engine.playing);
  assert.ok(!await page.locator('#noteStepBar').isVisible());
  assert.ok(await page.evaluate(t=>Math.abs(__qa.engine.tickAtSeconds(__qa.engine.basePosition)-t)<2,second));
  await page.locator('#playPause').click();await page.waitForFunction(()=>__qa.recording.state==='off');
  return {mobile,first,second,holdReleasedAt:second,timedRecordingStartedAt:second,heldPreview:true,parkedPitch:true,noParkedTake:true,
    backingMuteRestored:true,columnsFit:true};
}
module.exports={run};
