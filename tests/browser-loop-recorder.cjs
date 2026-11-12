const {toggleRecording, startRecording, stopRecording, deleteUnused} = require('./browser-sing.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {checkLocalTakeFailures} = require('./browser-local-takes.cjs');

const recordingProbe = `
  get compDescriptor() { return compDescriptor(); },
  get compState() { return compPanel?.state(); },
  refreshComp() { return compPanel?.refresh({force:true}); },
  invalidateCompAudio() { compPanel?.invalidate(); },
  // Older takes the armed track already considered stay outside it.
  async keepLoose(ids) {
    config.audition = {...config.audition, enabled:true};
    await compPanel.refresh({force:true, active: takeState !== 'off'});
    const state = compPanel.state();
    if (state) await takeStore.saveComp({...state, processed: [...new Set([...state.processed, ...ids])]});
  },
  // True once no recording is waiting to be offered or deleted.
  async tracksSettled() {
    await compPanel?.refresh({force:true, active: takeState !== 'off'});
    const comps = await takeStore.comps(takeSongKey()), takes = allTakes();
    const historyIds = MeleteRecording.historySources(await takeStore.compHistory(takeSongKey()));
    return (config.audition?.enabled || MeleteComp.discardable(comps, takes, historyIds).length === 0)
      && takes.every(take => compPanel.loose(take) || historyIds.includes(take.id)
        || comps.some(state => state.processed.includes(take.id) || MeleteComp.protectedIds(state).includes(take.id)));
  },
  get takeStore() { return takeStore; },
  cleanedTakeBlob(take) { return takeBlob(take); },
  async forgetCompFixtures(keys) {
    return takeStore.transaction(['comps','counters'], 'readwrite', (tx,done)=>{
      const ids = new Set();
      for (const key of keys) tx.objectStore('comps').get(key).onsuccess=event=>{
        for(const segment of event.target.result?.segments||[])ids.add(segment.takeId);
        tx.objectStore('comps').delete(key);
      };
      const historyKey=['comp-edit-history',takeSongKey()];
      tx.objectStore('counters').get(historyKey).onsuccess=event=>{
        const history=event.target.result;
        if(history){
          for(const list of ['past','future'])history[list]=history[list].filter(edit=>{
            if(!keys.includes(edit.key))return true;
            for(const segment of [...edit.before.segments,...edit.after.segments])ids.add(segment.takeId);
            return false;
          });
          history.revision++;tx.objectStore('counters').put(history,historyKey);
        }
        done([...ids]);
      };
    });
  },
  get takeSong() { return takeSongKey(); },
  reloadTakes() { return loadTakeLibrary(); },
  pitchReference(spec, part, line) { return takePitchReference(spec, part, line); },
  get takeReview() { return takeReview && {id: takeReview.id, start: takeReview.start, end: takeReview.end,
    frames: takeReview.frames, track: takeReview.track, duration: takeReview.buffer?.duration}; },
  get pendingCaptureTrace() { return pendingCaptureTrace; },
  get savedPractice() { return currentPreferenceState(); },
  enableAudition(recordingEntrances) {
    if (recordingEntrances) config.audition = {enabled:true,recordingEntrances};
    else config.audition = {...config.audition, enabled:true};
  },
  get auditionEnabled() { return Boolean(config.audition?.enabled); },
  get scoreMeasures() { return sequence.measures; },
  get scoreNotes() { return sequence.notes; },
  auditionNote(x,y,nearest=false) { return standardNoteAtClientPoint(x,y,nearest); },
  auditionChord(x,y) { return standardChordTargetAtClientPoint(x,y); },
  get reviewBounds() { return playbackCursorBounds(); },
  get otherSongBytes() { return takeOtherBytes; },
  set otherSongBytes(bytes) { takeOtherBytes = bytes; renderTakePanel(); },
  get countIn() { return {beat: elements.takeCountIn.dataset.beat, visible: !elements.takeCountIn.hidden,
    startTime: takeCountIn?.startTime, endTime: takeCountIn?.endTime,
    now: engine.context?.currentTime, spec: takeState !== 'off' && takeJournal ? takeJournal.spec : recordingLoopSpec(),
    captureStartDelay: takeJournal?.buffer.current && takeCountIn ? takeJournal.buffer.current.start / pitchCaptureContext.sampleRate
      - pitchCaptureContext.currentTime + engine.context.currentTime - takeCountIn.endTime : null,
    cursor: playbackCursorBounds()}; },
  get recording() {
    if (!window.__captureGapHistory) {
      window.__captureGapHistory = [];
      const write = MeleteRecording.TakeBuffer.prototype.write;
      MeleteRecording.TakeBuffer.prototype.write = function(take, frame, samples) {
        const previous = take.gap; write.call(this, take, frame, samples);
        if (!previous && take.gap) window.__captureGapHistory.push({start:take.start,frame,...take.firstGap});
      };
    }
    return {state: takeState, notice: takeNotice, part: takeJournal?.spec.part,
    ready: takeLibraryReady, capacity: takeJournal?.buffer.passFrames || 0,
    sampleRate: takeJournal?.buffer.sampleRate || allTakes()[0]?.sampleRate || 0,
    takes: allTakes().sort((a, b) => a.createdAt - b.createdAt || (a.number || 0) - (b.number || 0))
      .map(take=>({...take, ...(take.gap ? {captureGaps:window.__captureGapHistory} : {})})),
    bytes: takeJournal?.buffer.takes.reduce((n, take) => n + take.pcm.byteLength, 0) || 0,
    microphone: pitchCaptureStream?.getAudioTracks()[0]?.enabled || false,
    gaps: window.__captureGapHistory, pitch: pitchCaptureState}; },
`;

async function checkLoopRecorder(page, origin, settled, {mobile, output, temporary}) {
  const enableAudition = () => page.evaluate(() => {
    const spec=__qa.countIn.spec;
    __qa.enableAudition([{loop:spec.label,parts:{[spec.part]:'1'}}]);
  });
  await page.goto(origin + '?loop=1-1.3');
  await settled();
  await page.waitForFunction(() => __qa.engine.hasLoop() && __qa.recording.ready);
  if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserDismiss').click();
  assert.equal((await page.evaluate(() => __qa.recording)).state, 'off', 'URL never arms audio recording');
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await require('./browser-sing.cjs').choosePart(page);
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await enableAudition();
  assert.equal(await page.locator('#takePanel').isVisible(), true);
  await page.waitForFunction(() => document.querySelector('#takeMicrophone option[value]:not([value=""])'));
  const inputId = await page.locator('#takeMicrophone option').evaluateAll(options => options.find(option => option.value)?.value);
  await page.locator('#takeMicrophone').selectOption(inputId);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.microphoneRequests = [];
    navigator.mediaDevices.getUserMedia = constraints => {
      microphoneRequests.push(constraints);
      return original(constraints);
    };
  });
  assert.equal((await page.evaluate(() => __qa.recording)).pitch, 'off', 'choosing an input does not activate Sing');
  assert.equal(await page.evaluate(() => microphoneRequests.length), 0, 'choosing an input never records');
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'counting' && __qa.countIn.visible);
  assert.equal(await page.evaluate(() => __qa.engine.playing), true, 'guide transport runs through the count-in');
  await page.waitForFunction(() => __qa.recording.takes[0]?.seconds > .15);
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, 1, 'count-in belongs to the first take');
  assert.equal(await page.evaluate(() => microphoneRequests[0].audio.deviceId.exact), inputId);
  assert.equal(await page.locator('#takeMicrophone').isDisabled(), true, 'input cannot change mid-take');
  await page.screenshot({path: path.join(output, `count-in-${mobile ? 'mobile' : 'desktop'}.png`)});
  const cue = await page.locator('#takeCountIn').boundingBox(), viewportBefore = page.viewportSize();
  assert.ok(cue.x >= 0 && cue.y >= 0 && cue.x + cue.width <= viewportBefore.width && cue.y + cue.height <= viewportBefore.height);
  try { await page.waitForFunction(() => __qa.recording.state === 'recording'); }
  catch (error) {
    console.error('Recorder start failure:', await page.evaluate(() => ({...__qa.recording, captureError: __qa.captureError,
      status: document.getElementById('takeStatus').textContent, secure: isSecureContext})));
    throw error;
  }
  assert.equal(await page.locator('#settingsToggle').evaluate(button => button.classList.contains('has-recording')), true);
  const counted = await page.evaluate(() => __qa.countIn);
  assert.ok(counted.now >= counted.endTime && Number.isFinite(counted.captureStartDelay)
    && Math.abs(counted.captureStartDelay + counted.spec.initial.leadInSeconds) < .03,
    `microphone frames start with the first count, before the entrance: ${JSON.stringify(counted)}`);
  await page.waitForFunction(() => __qa.recording.takes.length >= 6 && __qa.recording.takes.at(-1)?.seconds > 1.05);
  await page.waitForFunction(() => __qa.recording.state === 'recording'
    && __qa.recording.takes.some(take => take.complete && take.pitchScore), null, {timeout: 60000});
  const passes = (await page.evaluate(() => __qa.recording)).takes.length;
  assert.ok(passes >= 6, 'no three-take limit while looping');
  // Later passes replace the first, so keep its audio for the checks below.
  const complete = await page.evaluate(() => __qa.recording.takes[0]);
  assert.equal(complete.complete, true);
  const wav = Buffer.from(await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), complete.id));
  // Stop early in a pass, so it is still the short unfinished one when Stop lands.
  await page.waitForFunction(() => {
    const take = __qa.recording.takes.at(-1);
    return take && !take.complete && take.seconds < .4;
  }, null, {polling: 16});
  const tail = await page.evaluate(() => __qa.recording.takes.at(-1));
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off');
  const result = await page.evaluate(() => __qa.recording);
  assert.ok(result.takes.every(take => take.complete), JSON.stringify(result));
  assert.ok(!result.takes.some(take => take.id === tail.id), `Stop discards the short last pass: ${JSON.stringify({
    tail: {id: tail.id, number: tail.number, seconds: tail.seconds, active: tail.active, complete: tail.complete},
    takes: result.takes.map(({id, number, seconds, complete}) => ({id, number, seconds, complete}))})}`);
  assert.equal(result.notice, '', 'unfinished loops are discarded without a status explanation');
  assert.equal(await page.evaluate(id => __qa.takeStore.transaction(['chunks'], 'readonly', (tx, done) => {
    tx.objectStore('chunks').index('takeId').count(id).onsuccess = event => done(event.target.result);
  }), tail.id), 0, 'ignored checkpoints do not leave audio chunks behind');
  assert.ok(result.takes.every(take => !take.unsaved));
  assert.ok(result.bytes <= result.capacity * 3 * 2);
  assert.equal(result.bytes, 0, 'saved takes do not retain PCM arrays in RAM');
  assert.equal(result.microphone, false, 'only recorder owned input, so Stop disables it');
  assert.equal(result.pitch, 'off', 'Sing-off stops pitch capture too');
  assert.ok(result.takes.every(take => take.pitchReference?.fingerprint && take.pitchReference.notes.length),
    'real microphone capture snapshots the selected part and performed timing');
  for (const take of result.takes) {
    assert.equal(take.captureProfile?.policy, 'unprocessed');
    for (const key of ['echoCancellation','noiseSuppression','autoGainControl'])
      assert.equal(take.captureProfile[key], false, `Chrome actually disabled ${key}`);
    assert.ok(take.captureProfile.sampleRate > 0);
  }
  await page.waitForFunction(() => __qa.recording.takes.every(take => take.pitchScore), null, {timeout: 60000});
  // Each pass replaced the previous one; bounded history protects recent passes.
  await page.waitForFunction(() => __qa.tracksSettled(), null, {timeout: 30000, polling: 250});
  const kept = (await page.evaluate(() => __qa.recording)).takes;
  const keptWav = Buffer.from(await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), kept[0].id));
  const protectedAfterStop = await page.evaluate(async () => [
    ...(await __qa.takeStore.comps(__qa.takeSong)).flatMap(MeleteComp.protectedIds),
    ...MeleteRecording.historySources(await __qa.takeStore.compHistory(__qa.takeSong))]);
  // Another pass can finish while its predecessor's WAV is being read above.
  assert.ok(kept.length && kept.length <= result.takes.length && kept.every(take =>
    result.takes.some(completed=>completed.id===take.id) && protectedAfterStop.includes(take.id)),
    JSON.stringify({passes, kept: kept.map(({id, number}) => ({id, number})), protectedAfterStop}));
  assert.ok(kept.some(take => take.id === complete.id), 'recent replaced passes survive for multilevel Undo');
  assert.equal(await page.locator('#takeLoose').isVisible(), false, 'no loose takes after a loop recording');
  assert.equal(await page.locator('#compRows > .comp-row.is-armed').count(), 1);
  assert.equal(await page.locator('#takeMicrophone').isEnabled(), true);
  assert.equal(await page.locator('#settingsToggle').evaluate(button => button.classList.contains('has-recording')), false);
  const reviewButton=page.locator('#compRows > .comp-row.is-armed .comp-review');
  if(await reviewButton.getAttribute('aria-pressed')!=='true')await reviewButton.click();
  await page.waitForFunction(() => __qa.takeReview);
  assert.equal(await page.evaluate(() => __qa.engine.playing), false, 'selection loads without auto-playing');
  await page.locator('#playPause').click();
  await page.waitForFunction(() => __qa.engine.playing && __qa.engine.takeReviewSource);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => __qa.engine.playing), false, 'Space pauses recording and accompaniment together');
  await page.locator('#exitTakeReview').click();
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), result.sampleRate);
  assert.equal(wav.readUInt32LE(40), complete.length * 2);
  const amplitude = frequency => {
    let re = 0, im = 0;
    for (let i = 0; i < complete.length; i++) {
      const sample = wav.readInt16LE(44 + i * 2) / 32768;
      const angle = 2 * Math.PI * frequency * i / result.sampleRate;
      re += sample * Math.cos(angle); im += sample * Math.sin(angle);
    }
    return 2 * Math.hypot(re, im) / complete.length;
  };
  const micAmplitude = amplitude(997), guideAmplitude = amplitude(523.251);
  assert.ok(micAmplitude > .05, `microphone signal present (${micAmplitude})`);
  assert.ok(guideAmplitude < .005, `score output not mixed into file (${guideAmplitude})`);
  assert.ok(complete.seconds > counted.spec.seconds + counted.spec.initial.leadInSeconds - .05);
  const countFrames = Math.floor(counted.spec.initial.leadInSeconds * result.sampleRate);
  let countEnergy = 0;
  for (let i = 0; i < countFrames; i++) countEnergy += (wav.readInt16LE(44 + i * 2) / 32768) ** 2;
  assert.ok(Math.sqrt(countEnergy / countFrames) > .05, 'download retains actual microphone audio during the count-in');
  assert.ok(complete.pitchReference.notes[0][0] >= counted.spec.initial.leadInSeconds,
    'preparation is retained in audio but not graded as the audition');
  await page.screenshot({path: path.join(output, `loop-recorder-${mobile ? 'mobile' : 'desktop'}.png`)});
  if (!mobile) {
    const clearance = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return {status: box('#takeStatus').bottom, storage: box('#takeStorage').top,
        list: box('.take-review').bottom};
    });
    assert.ok(clearance.status <= clearance.storage + 1, JSON.stringify(clearance));
  }
  await page.locator('#takePanel').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#takePanel').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
  const panelAboveReturn = await page.evaluate(() => {
    const panel = document.getElementById('takePanel');
    const control = document.getElementById('playbackReturn');
    const style = control.getAttribute('style'), classes = control.className;
    const box = panel.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    try {
      control.classList.add('is-visible');
      control.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 20}px;right:auto;bottom:auto;transform:none;opacity:1;visibility:visible`;
      return panel.contains(document.elementFromPoint(x, y));
    } finally {
      if (style === null) control.removeAttribute('style'); else control.setAttribute('style', style);
      control.className = classes;
    }
  });
  assert.equal(panelAboveReturn, true, 'floating score controls cannot cover take review');

  assert.equal(await page.locator('.take-star, #takeFavorites').count(), 0);
  await page.reload(); await settled();
  await enableAudition();
  await page.waitForFunction(() => __qa.recording.ready);
  const restored = await page.evaluate(() => __qa.recording);
  assert.equal(restored.takes.length, kept.length);
  assert.ok(!restored.takes.some(take => take.id === tail.id), 'ignored tail stays gone after reload');
  assert.equal(restored.bytes, 0, 'restoring a library loads metadata, not every audio file');
  assert.equal(restored.state, 'off');
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await page.waitForFunction(id => document.getElementById('takeMicrophone').value === id, inputId);
  const restoredAudio = await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), kept[0].id);
  assert.deepEqual(Buffer.from(restoredAudio), keptWav, 'reloaded WAV is byte-identical');
  // Seed one take outside the track to exercise the loose list and its deletion.
  const unwanted = await page.evaluate(async () => {
    const id = crypto.randomUUID(), pcm = Int16Array.from({length: 8000}, (_, i) => Math.round(3000 * Math.sin(i / 5)));
    await __qa.takeStore.append({id, song: __qa.takeSong, createdAt: Date.now(), sampleRate: 8000, part: 'Test',
      label: 'loose fixture', start: 0, end: 1, rate: 1, peak: .1}, 0, pcm, {finalized: true, complete: true});
    await __qa.reloadTakes();
    return __qa.recording.takes.find(take => take.id === id);
  });
  await page.locator('#takeLoose').waitFor({state: 'visible'});
  assert.match(await page.locator('#takeLooseMessage').innerText(), /^Audition takes/);
  assert.equal(await page.getByRole('button', {name: `Delete take ${unwanted.number}`, exact: true}).isEnabled(), true);
  // Individual downloads remain; the redundant archive button is removed.
  assert.equal(await page.locator('#downloadTakes').count(),0);
  await page.screenshot({path: path.join(output, `take-actions-${mobile ? 'mobile' : 'desktop'}.png`)});
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, kept.length + 1);
  const storage = page.locator('#takeStorage');
  assert.match(await storage.innerText(), /^\d+ MB$/);
  assert.match(await storage.getAttribute('title'), /^Recordings across this site's songs\. This song: \d+ takes? · /);
  const monitor = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const frame = box('#microphoneCheck'), status = box('#checkMicrophone [role=status]');
    const today = box('#recordingToday'), stored = box('#takeStorage');
    return {inside: [status, today, stored].every(r => r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom),
      apart: today.right <= stored.left && status.bottom <= today.top + 1,
      fourRows: box('.take-controls').height <= 4 * 24 + 3 * 3 + .5,
      list: document.querySelector('.take-review').contains(document.querySelector('#takeStorage'))};
  });
  assert.deepEqual(monitor, {inside: true, apart: true, fourRows: true, list: false}, JSON.stringify(monitor));
  // The size is information, never a warning: a large library only reads in GB.
  const sizeLook = () => storage.evaluate(el => [el, el.querySelector('output')].map(node => getComputedStyle(node).color).join());
  const ordinaryLook = await sizeLook(), otherSongBytes = await page.evaluate(() => __qa.otherSongBytes);
  await page.evaluate(() => { __qa.otherSongBytes = 1.3 * 1024 ** 3; });
  assert.equal(await storage.innerText(), '1.3 GB');
  assert.equal(await sizeLook(), ordinaryLook);
  await page.screenshot({path: path.join(output, `take-storage-large-${mobile ? 'mobile' : 'desktop'}.png`)});
  await page.evaluate(bytes => { __qa.otherSongBytes = bytes; }, otherSongBytes);
  assert.equal(await page.locator('#takeDeletePrompt').count(),0);
  await page.locator('#deleteLooseTakes').click();
  assert.match(await page.locator('#deleteLooseTakes').getAttribute('class'),/is-delete-armed/);
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, kept.length + 1);
  const unwantedWav = await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), unwanted.id);
  await page.getByRole('button', {name: `Delete take ${unwanted.number}`, exact: true}).click();
  await page.locator('.take-delete.is-delete-armed').click();
  await page.waitForFunction(id => !__qa.recording.takes.some(take => take.id === id), unwanted.id);
  await page.reload(); await settled();
  await enableAudition();
  await page.waitForFunction(() => __qa.recording.ready);
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  assert.equal(await page.locator('#takeUndo').isVisible(), true, 'Undo survives reload within the grace period');
  await page.locator('#undoTakeDelete').click();
  await page.waitForFunction(id => __qa.recording.takes.some(take => take.id === id), unwanted.id);
  assert.deepEqual(await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), unwanted.id), unwantedWav);
  await page.getByRole('button', {name: `Delete take ${unwanted.number}`, exact: true}).click();
  await page.locator('.take-delete.is-delete-armed').click();
  await page.waitForFunction(id => !__qa.recording.takes.some(take => take.id === id), unwanted.id);
  await page.waitForFunction(async id => !(await __qa.takeStore.usage()).some(take => take.id === id), unwanted.id, {timeout: 15000});
  await page.locator('#takeUndo').waitFor({state: 'hidden'});
  assert.equal(await page.locator('#takeLoose').isVisible(), false, 'track sources are never offered for deletion');

  // Toggling Sing off leaves the transport running; turning it back on punches in.
  await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'recording');
  await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await page.locator('#pitchCapture').click();
  await page.waitForFunction(() => __qa.recording.state === 'off');
  assert.equal((await page.evaluate(() => __qa.recording)).microphone, false, 'Sing off releases capture');
  assert.equal(await page.evaluate(() => __qa.engine.playing), true, 'Sing off does not interrupt listening');
  await page.locator('#pitchCapture').click();
  await page.waitForFunction(() => __qa.recording.pitch === 'recording');
  assert.equal(await page.evaluate(() => __qa.recording.state),'recording');
  await page.keyboard.press('Space');await page.waitForFunction(()=>!__qa.engine.playing);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __qa.recording.pitch === 'recording');
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off');
  assert.equal((await page.evaluate(() => __qa.recording)).microphone, false);

  // Space also silently discards a nearly complete pass.
  await page.waitForFunction(() => __qa.tracksSettled(), null, {timeout: 30000, polling: 250});
  const beforeNearEnd = (await page.evaluate(() => __qa.recording)).takes.length;
  await toggleRecording(page);
  const stopping = await page.waitForFunction(() => {
    const take = __qa.recording.takes.find(take => take.active), spec = __qa.countIn.spec.initial;
    if (__qa.recording.state !== 'recording' || !take
      || take.seconds < spec.leadInSeconds + .92 * (spec.seconds - spec.leadInSeconds)) return false;
    // Stop within this frame; a protocol round trip can cross the loop boundary.
    document.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', code: 'Space', bubbles: true, cancelable: true}));
    return {id: take.id, seconds: take.seconds, end: spec.seconds};
  });
  const stoppedAt = await stopping.jsonValue();
  await stopping.dispose();
  assert.ok(stoppedAt.seconds < stoppedAt.end, `test must stop before a full pass: ${JSON.stringify(stoppedAt)}`);
  await page.waitForFunction(() => __qa.recording.state === 'off');
  const nearEnd = (await page.evaluate(() => __qa.recording)).takes;
  const recoveredGap = nearEnd.find(take=>take.id===stoppedAt.id);
  assert.ok(!recoveredGap || (recoveredGap.gap && !recoveredGap.complete && !recoveredGap.unsaved),
    'ordinary stubs are discarded; genuine missing audio remains recoverable');
  assert.equal(nearEnd.length, beforeNearEnd + Number(Boolean(recoveredGap)), JSON.stringify({stoppedAt,
    nearEnd:nearEnd.map(({id,seconds,gap,complete})=>({id,seconds,gap,complete})),
    gaps:await page.evaluate(()=>__qa.recording.gaps)}));

  // Transport edits discard ordinary interrupted takes rather than splicing.
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  // Count-in stubs are discarded for every intentional transport change.
  for (const action of ['space', 'stop', 'rate']) {
    await page.waitForFunction(() => __qa.tracksSettled(), null, {timeout: 30000, polling: 250});
    const beforeCancel = (await page.evaluate(() => __qa.recording)).takes.map(take => take.id);
    await toggleRecording(page);
    await page.waitForFunction(() => __qa.recording.state === 'counting' && __qa.countIn.visible);
    await page.waitForFunction(() => __qa.recording.takes.at(-1)?.seconds > .15);
    const interrupted = await page.evaluate(() => __qa.recording.takes.find(take => take.active)?.id);
    assert.ok(interrupted, 'cancel an active count-in attempt');
    if (action === 'space') await page.keyboard.press('Space');
    else if (action === 'stop') await toggleRecording(page);
    else await page.evaluate(() => __qa.api.playbackSpeed = .8);
    await page.waitForFunction(() => __qa.recording.state === 'off');
    await page.waitForTimeout(2100);
    const canceled = await page.evaluate(() => __qa.recording.takes);
    const recovered = canceled.filter(take => !beforeCancel.includes(take.id));
    const gaps = await page.evaluate(() => __qa.recording.gaps);
    assert.deepEqual(canceled.filter(take => beforeCancel.includes(take.id)).map(take => take.id), beforeCancel,
      'transport changes preserve previously saved takes');
    assert.ok(recovered.length === 0 || (recovered.length === 1 && recovered[0].id === interrupted
      && recovered[0].gap && !recovered[0].complete && !recovered[0].unsaved && gaps.length > 0), JSON.stringify({action,beforeCancel,
      takes:canceled.map(({id,seconds,gap,complete,unsaved})=>({id,seconds,gap,complete,unsaved})),
      gaps}));
    assert.equal(await page.evaluate(() => __qa.engine.playing || __qa.countIn.visible), false);
  }
  for (const operation of ['rate', 'seek', 'loop']) {
    await toggleRecording(page);
    await page.waitForFunction(() => __qa.recording.state === 'recording');
    await page.waitForFunction(() => __qa.recording.takes.at(-1)?.seconds > .12);
    await page.evaluate(operation => {
      if (operation === 'rate') __qa.api.playbackSpeed = .9;
      if (operation === 'seek') __qa.engine.seek(__qa.engine.loopEndSeconds + .2);
      if (operation === 'loop') __qa.engine.setLoop(0, 960);
    }, operation);
    await page.waitForFunction(() => __qa.recording.state === 'off');
    const stoppedTakes = (await page.evaluate(() => __qa.recording)).takes;
    assert.ok(stoppedTakes.every(take => take.complete || (take.gap && !take.unsaved)), JSON.stringify({operation,
      gaps:await page.evaluate(()=>__qa.recording.gaps),
      incomplete: stoppedTakes.filter(take => !take.complete).map(({id, seconds, frames, gap, error, unsaved}) =>
        ({id, seconds, frames, gap, error, unsaved}))}));
    assert.equal(await page.evaluate(() => __qa.engine.playing), false);
  }
  // Every real take can be protected by comp/Undo after rest-aware selection.
  // Seed a disposable, explicitly ineligible take so cleanup isn't luck-based.
  const unusedId = await page.evaluate(async () => {
    const id=crypto.randomUUID();
    await __qa.takeStore.append({id,song:__qa.takeSong,createdAt:Date.now(),sampleRate:8000,
      seconds:.01,part:'Test',label:'cleanup fixture',start:0,end:1,rate:1,peak:0},0,new Int16Array(80),
      {finalized:true,complete:false,gap:true});
    await __qa.reloadTakes();
    return id;
  });
  await deleteUnused(page);
  await page.keyboard.press('Escape');
  assert.ok((await page.evaluate(() => __qa.recording)).takes.some(t=>t.id===unusedId),'cancel keeps the unused take');
  const retained = await page.evaluate(async () => [
    ...(await __qa.takeStore.comps(__qa.takeSong)).flatMap(MeleteComp.protectedIds),
    ...MeleteRecording.historySources(await __qa.takeStore.compHistory(__qa.takeSong))]);
  await deleteUnused(page);
  await page.locator('#deleteLooseTakes.is-delete-armed').click();
  await page.waitForFunction(ids => __qa.recording.takes.every(take => ids.includes(take.id)), retained);
  assert.ok(!(await page.evaluate(() => __qa.recording)).takes.some(t=>t.id===unusedId),'confirmation removes the unused take');
  await page.reload(); await settled();
  await page.waitForFunction(() => __qa.recording.ready);
  assert.equal((await page.evaluate(() => __qa.recording)).state, 'off');
  assert.ok((await page.evaluate(() => __qa.recording)).takes.every(take => retained.includes(take.id)), 'cleanup keeps only protected sources');
  // Remove this disposable fixture's comp before the independent failure tests.
  await page.evaluate(async () => {
    const ids = __qa.recording.takes.map(take => take.id);
    await __qa.forgetCompFixtures((await __qa.takeStore.comps(__qa.takeSong)).map(s=>s.key));
    await __qa.takeStore.deleteTakes(__qa.takeSong, ids);
    await __qa.reloadTakes();
  });
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#pitchCapture').getAttribute('aria-pressed') === 'true') await page.locator('#pitchCapture').click();
  await page.waitForFunction(() => !__qa.recording.microphone);
  // A disabled but granted track can legitimately be reused until this page closes.
  // Exercise a genuinely fresh permission request, not an already-authorized stream.
  await page.reload();await settled();await enableAudition();
  await page.waitForFunction(()=>__qa.recording.ready && !__qa.recording.microphone);
  await page.evaluate(() => {
    window.realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denial', 'NotAllowedError'); };
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off'
    && __qa.recording.notice === 'Microphone blocked. Allow access in browser settings, then try again.');
  assert.equal(await page.evaluate(() => __qa.engine.playing), false);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
      window.grantLateMicrophone = async () => resolve(await realGetUserMedia(constraints));
    });
  });
  await toggleRecording(page);
  await page.waitForFunction(() => Boolean(window.grantLateMicrophone));
  await toggleRecording(page);
  await page.evaluate(() => grantLateMicrophone());
  await page.waitForFunction(() => __qa.recording.state === 'off');
  assert.equal((await page.evaluate(() => __qa.recording)).microphone, false, 'late permission cannot restart a canceled take');
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, 0);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = realGetUserMedia; });
  await page.locator('#settingsToggle').click();
  const localStorage = await checkLocalTakeFailures(page, origin, settled, {mobile, output, temporary});
  return {retained: kept.map(({number, complete}) => ({number, complete})), passes, micAmplitude, guideAmplitude,
    boundedBytes: result.bytes, wavBytes: wav.length, combinedMicrophoneLifecycle: true, transportEdits: 3,
    deniedPermission: true, canceledPermission: true, singleSingToggle: true, selectedInputPersisted: true,
    reloadExactAudio: true, noFavorites: true, incompleteTailDiscarded: true, scoringDuringRecording: true,
    allTakesZip: true, deletionUndo: true, storageWarning: true, localStorage};
}

module.exports = {recordingProbe, checkLoopRecorder};
