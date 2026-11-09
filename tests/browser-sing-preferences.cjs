const assert = require('node:assert/strict');

const singPreferenceProbe = `singPreferences: {
  snapshot() { return {
    wanted: wantsPitchCapture(), state: pitchCaptureState, preferences: currentPreferenceState(),
    saved: JSON.parse(localStorage.getItem(preferenceKey)), help: settingsHelpEnabled,
    input: pitchCaptureStream?.getAudioTracks()[0]?.enabled || false,
    hasStream: !!pitchCaptureStream, audioState: pitchCaptureContext?.state,
    worker: !!pitchCaptureWorker, playing, takeState,
    scoring: takeScoring?.id, failures: [...takeScoreFailures],
  }; },
},`;

async function checkSingPreferences(frame, page, {reload, probe = '__qa'} = {}) {
  const snapshot = () => frame.evaluate(probe => window[probe].singPreferences.snapshot(), probe);
  const armed = () => frame.waitForFunction(probe => {
    const state = window[probe].singPreferences.snapshot();
    return state.state === 'armed' && state.takeState === 'off' && state.input && state.worker;
  }, probe);
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  await require('./browser-sing.cjs').choosePart(frame);
  await frame.waitForFunction(probe=>window[probe].compDescriptor,probe);
  if (await frame.locator('#pitchCapture').getAttribute('aria-pressed') === 'true') await frame.locator('#pitchCapture').click();
  await frame.locator('#loopStart').press('Delete');
  await frame.waitForFunction(probe=>!window[probe].engine.hasLoop(),probe);
  if (await frame.locator('#settingsHelp').getAttribute('aria-pressed') !== 'true') await frame.locator('#settingsHelp').click();
  await frame.locator('#pitchCapture').click();
  await armed();
  const before = await snapshot();
  assert.equal(before.saved.sing, true);
  assert.equal(before.help, true);
  assert.equal(before.takeState, 'off');

  frame = await reload();
  await armed();
  const restored = await snapshot();
  assert.equal(await frame.locator('#pitchCapture').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(restored.preferences, before.preferences, 'all preferences survive actual pagehide and reload');
  assert.deepEqual(restored.saved, before.saved, 'startup writes cannot erase restored Sing');
  assert.equal(restored.help, true);
  assert.equal(restored.input, true);
  assert.equal(restored.worker, true);
  assert.equal(restored.playing, false, 'restoring Sing never autoplays');
  assert.equal(restored.takeState, 'off', 'restoring Sing never starts an audio take');

  // Start inside written singing, not a real song's instrumental introduction.
  await frame.evaluate(probe => {
    const q = window[probe], ref = q.compDescriptor.reference;
    q.api.tickPosition = q.engine.tickAtSeconds(ref.notes[Math.floor(ref.notes.length / 3)][0] * ref.rate);
  }, probe);
  await frame.locator('#recordAudio').click();
  assert.equal((await snapshot()).playing,false,'arming audio is not Play');
  await frame.locator('#playPause').click();
  await frame.waitForFunction(probe => {
    const state = window[probe].singPreferences.snapshot();
    const take = window[probe].recording.takes.find(t => t.active);
    return state.playing && state.state === 'recording' && state.takeState === 'recording'
      && state.audioState === 'running' && take?.seconds > (take.leadInSeconds || 0) + 1.2;
  }, probe);
  const savedId = await frame.evaluate(probe => window[probe].recording.takes.find(t=>t.active).id, probe);
  await frame.locator('#settingsToggle').click();
  await frame.locator('#playPause').click();
  await armed();
  try { await frame.waitForFunction(({probe,id})=>window[probe].recording.takes.find(t=>t.id===id)?.pitchScore, {probe,id:savedId}); }
  catch (error) {
    console.error('Sing scoring state', await snapshot(), await frame.evaluate(probe=>window[probe].recording,probe)); throw error;
  }
  assert.equal((await snapshot()).input, true, 'Sing continues metering while paused');
  assert.equal((await snapshot()).saved.sing, true, 'Pause retains Sing intent');
  assert.equal(await frame.locator('#recordAudio').getAttribute('aria-pressed'),'true','Pause keeps the same singer ready to overdub');
  assert.equal(await frame.evaluate(({probe,id})=>window[probe].recording.takes.find(t=>t.id===id)?.complete, {probe,id:savedId}), true);
  try { await frame.waitForFunction(({probe,id})=>window[probe].compState?.segments.some(s=>s.takeId===id), {probe,id:savedId}); }
  catch (error) {
    console.error('Sing comp state', await frame.evaluate(probe=>{
      const q=window[probe];return {comp:q.compState,takes:q.recording.takes};
    },probe)); throw error;
  }
  await frame.locator('#playPause').click();
  await frame.waitForFunction(probe=>window[probe].recording.state==='recording',probe);
  assert.equal(await frame.locator('#takeCountIn').isVisible(),false,'resume has no count-in');
  await frame.locator('#playPause').click();
  await armed();
  await frame.locator('#settingsToggle').click();

  const loop = await frame.evaluate(probe => {
    const q=window[probe], state=q.pitchbar.captureSettingsState(), measure=q.scoreMeasures[0];
    q.pitchbar.applySettingsState({...state,loopStart:0,loopEnd:0,loopStartTick:null,loopEndTick:null});
    const tick=measure[0]+measure[1]*.45;
    q.api.tickPosition=tick;
    return {tick,start:measure[0],end:measure[0]+measure[1]};
  },probe);
  await frame.waitForFunction(probe=>!window[probe].busy,probe);
  await frame.locator('#playPause').click();
  await frame.waitForFunction(probe=>window[probe].recording.state==='recording',probe);
  const initial = await frame.evaluate(probe=>window[probe].countIn,probe);
  assert.ok(Math.abs(initial.spec.initial.start-loop.tick)<3,'an ordinary loop starts at the chosen interior playhead');
  assert.equal(initial.spec.initial.leadInSeconds,0);
  assert.equal(initial.startTime,undefined,'ordinary loops never create count-in clicks');
  assert.equal(initial.visible,false);
  await frame.waitForFunction(({probe,start})=>{
    const q=window[probe], take=q.recording.takes.find(t=>t.active);
    return take?.start===start && take.seconds>.15;
  },{probe,start:loop.start});
  assert.equal(await frame.locator('#takeCountIn').isVisible(),false,'a repeat has no count-in');
  assert.equal(await frame.evaluate(probe=>window[probe].engine.tickAtSeconds(window[probe].engine.loopEndSeconds),probe),loop.end);
  await frame.locator('#playPause').click();
  await armed();
  for (const side of ['before','after']) {
    const chosen = await frame.evaluate(({probe,side}) => {
      const q=window[probe], state=q.pitchbar.captureSettingsState(), measure=q.scoreMeasures[1];
      q.pitchbar.applySettingsState({...state,loopStart:1,loopEnd:1,loopStartTick:null,loopEndTick:null});
      const seconds=side==='before' ? q.engine.secondsAtTick(measure[0])-.123
        : q.engine.secondsAtTick(measure[0]+measure[1])+.137;
      q.api.tickPosition=q.engine.tickAtSeconds(seconds);
      return {seconds,tick:q.engine.tickAtSeconds(seconds)};
    },{probe,side});
    await frame.waitForFunction(probe=>!window[probe].busy,probe);
    await frame.locator('#playPause').click();
    await frame.waitForFunction(probe=>window[probe].recording.state==='recording',probe);
    const start=await frame.evaluate(probe=>({spec:window[probe].countIn.spec,position:window[probe].engine.basePosition}),probe);
    assert.ok(Math.abs(start.spec.initial.start-chosen.tick)<3,`${side}-loop capture preserves the playhead`);
    assert.ok(Math.abs(start.position-chosen.seconds)<.003,`${side}-loop guide starts at the same position`);
    assert.equal(start.spec.initial.leadInSeconds,0);
    assert.equal(start.spec.mode,side==='before'?'loop':'segment');
    await frame.waitForFunction(({probe,seconds})=>window[probe].engine.currentSeconds()>seconds+.2,{probe,seconds:chosen.seconds});
    await frame.locator('#playPause').click();
    await armed();
  }
  await frame.locator('#loopStart').press('Delete');
  await frame.waitForFunction(probe=>!window[probe].engine.hasLoop(),probe);

  await frame.evaluate(() => document.dispatchEvent(new CustomEvent('melete:deactivate')));
  const inactive = await snapshot();
  assert.equal(await frame.locator('#recordAudio').getAttribute('aria-pressed'),'false','audio consent never transfers to the next song');
  assert.equal(inactive.state, 'off');
  assert.equal(inactive.input, false);
  assert.equal(inactive.worker, false);
  assert.equal(inactive.wanted, true);
  assert.equal(inactive.saved.sing, true);
  await frame.evaluate(() => document.dispatchEvent(new CustomEvent('melete:activate')));
  await armed();
  assert.equal((await snapshot()).input, true, 'returning to an active Sing session resumes input metering');

  await frame.locator('#pitchCapture').click();
  await frame.locator('#settingsHelp').click();
  const disabled = await snapshot();
  assert.equal(disabled.saved.sing, false);
  assert.equal(disabled.saved.help, false);
  frame = await reload();
  const off = await snapshot();
  assert.equal(off.wanted, false);
  assert.equal(off.state, 'off');
  assert.equal(off.input, false);
  assert.equal(off.hasStream, false, 'explicitly disabled Sing does not acquire input on reload');
  assert.equal(off.help, false);
  return {restored: restored.preferences, playbackWithRestoredMic: true,
    suspensionPreservesChoice: true, explicitOffPersists: true, noAutomaticTakes: true,
    anonymousAudioSaved:true, collapsedSettingsStillScore:true, compUpdated:true, pauseResumeRecords:true,
    noCountIn:true,interiorLoopEntrance:true,manualStartsOutsideLoop:true,wholeMeasureRepeats:true};
}

module.exports = {singPreferenceProbe, checkSingPreferences};
