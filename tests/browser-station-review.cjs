const assert = require('node:assert/strict');
const path = require('node:path');
const {seed, pick} = require('./browser-station.cjs');

const roster = {singers:[{name:'Review Source',voice:'S1'}, {name:'Review Other',voice:'A1'}, {name:'Review Target',voice:'B2'}]};

async function checkStationReview(page, frame, {output, label}) {
  await frame.waitForFunction(() => (window.__qa || window.__probe) && document.querySelector('#playPause:not(:disabled)'));
  await frame.evaluate(() => { window.__qa ||= window.__probe; });
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const section=frame.locator('[data-settings-section="takes"] .settings-section-toggle');
  if(await section.isVisible() && await section.getAttribute('aria-expanded')!=='true') await section.click();
  await pick(frame,'Review Source');
  const sourcePart=await frame.evaluate(()=>__qa.compDescriptor.reference.part);
  await seed(frame,15);
  await pick(frame,'Review Other');
  await seed(frame,20);
  await pick(frame,'Review Target');
  await seed(frame,25);
  await frame.evaluate(()=>{
    const q=__qa.pitchbar,s=q.captureSettingsState();
    s.metronome=60;s.takeVolume=80;s.takeReverb=15;
    q.applySettingsState(s);
  });
  const before=await frame.evaluate(async()=>({
    descriptor:__qa.compDescriptor, key:__qa.compState.key,
    settings:__qa.pitchbar.captureSettingsState(), takes:(await __qa.takeStore.list(__qa.takeSong)).map(t=>t.id)
  }));
  assert.notEqual(before.descriptor.reference.part,sourcePart,'fixture has different source and recording parts');
  if(await frame.locator('[data-view="bars"]').getAttribute('aria-selected')!=='true') await frame.locator('[data-view="bars"]').click();
  await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(()=>document.querySelector('#pitchCapture').dataset.state==='armed');
  const source=frame.locator('#compRows .comp-row').filter({has:frame.locator('.take-singer',{hasText:'Review Source'})}).filter({has:frame.locator('.comp-review:not(:disabled)')}).first();
  await source.locator('.take-number').click();
  await frame.waitForFunction(part=>__qa.takeReview?.track===part,sourcePart);
  await frame.waitForFunction(()=>document.querySelector('.take-pitch-trace-group'));
  const review=await frame.evaluate(()=>({
    part:__qa.pitchbar.captureSettingsState().practicePart, key:__qa.compState.key,
    reference:__qa.compDescriptor.reference, faded:practicePart.classList.contains('is-mixed'),
    singer:stationSinger.value, heard:__qa.engine.takeLayers.has(__qa.takeReview.id),
    sing:pitchCapture.getAttribute('aria-pressed'), title:practicePart.title,settings:__qa.pitchbar.captureSettingsState()
  }));
  assert.equal(review.part,sourcePart);
  assert.equal(review.key,before.key);
  assert.equal(review.reference.part,before.descriptor.reference.part);
  assert.equal(review.reference.line,before.descriptor.reference.line);
  assert.equal(review.singer,'Review Target');
  assert.equal(review.faded,true);
  assert.equal(review.sing,'true');
  assert.equal(review.heard,true);
  assert.match(review.title,/Return to Review Target/);
  const sourceChannel=review.settings.visibleChannels.findIndex(Boolean);
  assert.deepEqual(review.settings.audible,review.settings.audible.map((_,i)=>i!==sourceChannel),'review mutes only the take part, not the selected singer');
  assert.ok(review.settings.pans.every(v=>v===0),'review is centered, not the hard-panned recording guide');
  assert.equal(review.settings.metronome,0);
  assert.equal(review.settings.takeVolume,100);
  assert.equal(review.settings.takeReverb,0);
  const otherChannel=review.settings.audible.findIndex(Boolean);
  // Change the real controls, then switch recordings and return to this review mix.
  await frame.locator(`[data-volume-index="${otherChannel}"]`).press('ArrowUp');
  await frame.evaluate(()=>{const q=__qa.pitchbar,s=q.captureSettingsState();s.audible.fill(false);q.applySettingsState(s);});
  const custom=await frame.evaluate(()=>__qa.pitchbar.captureSettingsState());
  const other=frame.locator('#compRows .comp-row').filter({has:frame.locator('.take-singer',{hasText:'Review Other'})}).filter({has:frame.locator('.comp-review:not(:disabled)')}).first();
  await other.locator('.take-number').click();
  await frame.waitForFunction(part=>__qa.takeReview?.track!==part,sourcePart);
  assert.ok(await frame.evaluate(()=>__qa.pitchbar.captureSettingsState().audible.every(on=>!on)),'muting the MIDI backing follows review across parts');
  await source.locator('.take-number').click();
  await frame.waitForFunction(part=>__qa.takeReview?.track===part,sourcePart);
  assert.deepEqual(await frame.evaluate(()=>__qa.pitchbar.captureSettingsState().volumes),custom.volumes,'review changes survive switching takes');
  const saved=await frame.evaluate(()=>JSON.parse(localStorage.getItem(`melete:station-mix:${__qa.takeSong}:singer:review-target`)));
  for(const key of ['audible','volumes','pans','metronome','takeVolume','takeReverb'])
    assert.deepEqual(saved[key],before.settings[key],key+' review adjustment does not overwrite recording profile');
  await page.screenshot({path:path.join(output,`station-review-${label}.png`)});
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__qa.engine.playing && __qa.engine.currentSeconds()>.3);
  assert.equal(await frame.evaluate(()=>__qa.recording.state),'off','review playback cannot record into the selected singer');
  assert.deepEqual(await frame.evaluate(async()=> (await __qa.takeStore.list(__qa.takeSong)).map(t=>t.id)),before.takes);
  await frame.locator('#playPause').click();
  await frame.locator('#practicePart').click();
  await frame.waitForFunction(()=>!practicePart.classList.contains('is-mixed'));
  const resumed=await frame.evaluate(()=>({
    settings:__qa.pitchbar.captureSettingsState(), key:__qa.compState.key,
    singer:stationSinger.value, sing:pitchCapture.getAttribute('aria-pressed')
  }));
  assert.equal(resumed.key,before.key);
  assert.equal(resumed.singer,'Review Target');
  assert.equal(resumed.sing,'true');
  for(const key of ['visibleChannels','audible','volumes','pans','practicePart','practiceDivisi','tempo','metronome','takeVolume','takeReverb'])
    assert.deepEqual(resumed.settings[key],before.settings[key],key+' restored with one click');
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__qa.recording.state==='recording');
  const captured=await frame.evaluate(()=>{
    const take=__qa.recording.takes.find(t=>t.active);
    return {singer:take.station.id,part:take.pitchReference.part,line:take.pitchReference.line};
  });
  assert.equal(captured.singer,'review-target');
  assert.equal(captured.part,before.descriptor.reference.part);
  assert.equal(captured.line,before.descriptor.reference.line);
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__qa.recording.state==='off');
  await frame.locator('#pitchCapture').click();
  return {review:{part:review.part,recordingPart:review.reference.part,recordingLine:review.reference.line,
      faded:review.faded,singer:review.singer,heard:review.heard,sing:review.sing,title:review.title},
    resumed:{singer:resumed.singer,part:resumed.settings.practicePart},
    recordingTarget:captured, playbackOnlyWhileReviewing:true, restoredMix:true,independentReviewMix:true,
    sourcePart,reviewVolumes:custom.volumes,recordingSettings:before.settings};
}

async function checkOrdinaryReviewMix(frame) {
  const {choosePart}=require('./browser-sing.cjs');
  await frame.waitForFunction(()=>window.__qa && document.querySelector('#playPause:not(:disabled)'));
  if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserDismiss').click();
  await choosePart(frame,0);
  await frame.evaluate(()=>__qa.refreshComp());
  await seed(frame,10);
  const before=await frame.evaluate(()=>{
    const q=__qa.pitchbar,s=q.captureSettingsState(),i=s.visibleChannels.findIndex(Boolean);
    s.audible=s.audible.map(()=>true);s.volumes=s.volumes.map((_,n)=>n===i?175:45);
    s.pans=s.pans.map((_,n)=>n===i?100:-70);s.metronome=40;
    q.applySettingsState(s);return s;
  });
  await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(()=>document.querySelector('#pitchCapture').dataset.state==='armed');
  const row=frame.locator('#compRows .comp-row').filter({has:frame.locator('.comp-review:not(:disabled)')}).first();
  if(await row.locator('.comp-review').getAttribute('aria-pressed')==='true')await row.locator('.take-number').click();
  await row.locator('.take-number').click();
  await frame.waitForFunction(()=>__qa.takeReview && practicePart.classList.contains('is-mixed'));
  const reviewing=await frame.evaluate(()=>__qa.pitchbar.captureSettingsState());
  assert.equal(reviewing.audible[0],false);
  assert.ok(reviewing.pans.every(v=>v===0));
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__qa.recording.state==='recording');
  const recording=await frame.evaluate(()=>__qa.pitchbar.captureSettingsState());
  for(const key of ['audible','volumes','pans','metronome'])assert.deepEqual(recording[key],before[key],key+' restored before ordinary overdub');
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__qa.recording.state==='off');
  await frame.locator('#pitchCapture').click();
  return {independentReview:true,armedOverdubRestoresRecording:true};
}

module.exports={roster,checkStationReview,checkOrdinaryReviewMix};
