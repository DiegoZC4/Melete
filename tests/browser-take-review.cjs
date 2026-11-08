const assert = require('node:assert/strict');
const path = require('node:path');
const {checkPitchbarResize} = require('./browser-pitchbar-resize.cjs');

async function checkCachedTakeReview(frame, id) {
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  await frame.evaluate(id => {
    // Selection must migrate a stale summary even before background rescoring.
    const qa = window.__qa || window.__probe;
    delete qa.recording.takes.find(take => take.id === id).pitchScore.scoringVersion;
    window.__takeCacheProof = {Worker: window.Worker, analyses: 0};
    window.Worker = class extends window.__takeCacheProof.Worker {
      postMessage(message, ...args) {
        if (message?.wav && message?.reference) window.__takeCacheProof.analyses += 1;
        return super.postMessage(message, ...args);
      }
    };
  }, id);
  const rangeFixture = await frame.evaluate(id => {
    const qa = window.__qa || window.__probe;
    const take = qa.recording.takes.find(take => take.id === id), ref = take.pitchReference;
    const settings = qa.pitchbar.captureSettingsState();
    qa.pitchbar.applySettingsState({...settings, practicePart: ref.part, practiceDivisi: ref.line});
    const origin = qa.engine.secondsAtTick(ref.captureStart ?? ref.start);
    const tick = qa.engine.tickAtSeconds(origin + (ref.notes[0][0] + ref.notes[0][1]) / 2 * ref.rate);
    const point = qa.pitchResolution.seedReviewOutlier(tick);
    return {...point, settings, range: qa.pitchResolution.reviewRange(tick)};
  }, id);
  try {
    const row = frame.locator(`.take-row[data-take-id="${id}"] .take-select`);
    await row.click();
    await frame.waitForFunction(id => (window.__qa || window.__probe).takeReview?.id === id, id);
    const proof = await frame.evaluate(id => {
      const qa = window.__qa || window.__probe;
      const take = qa.recording.takes.find(take => take.id === id);
      const frames = MeleteTakePitch.readContour(take);
      return {analyses: window.__takeCacheProof.analyses, bytes: take.pitchContour.pitches.byteLength,
        frames: frames.length, identical: JSON.stringify(frames) === JSON.stringify(qa.takeReview.frames),
        scoreMatches: JSON.stringify(MeleteTakePitch.scoreFrames(frames, take.pitchReference, take.frames / take.sampleRate))
          === JSON.stringify(take.pitchScore)};
    }, id);
    assert.equal(proof.analyses, 0, 'a saved contour never starts the pitch detector again');
    assert.equal(proof.bytes, proof.frames * 8, 'one full-precision number per frame, no duplicated timestamps');
    assert.equal(proof.identical, true, 'cached review preserves exact pitch frames and gaps');
    assert.equal(proof.scoreMatches, true, 'cached contour reproduces stored statistics exactly');
    const selectedRange = await frame.evaluate(tick =>
      (window.__qa || window.__probe).pitchResolution.reviewRange(tick), rangeFixture.tick);
    assert.ok(selectedRange.max < 108,
      'an inactive raw observation must never expand the saved contour range');
    await row.click();
    assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).takeReview), null);
    assert.deepEqual(await frame.evaluate(tick =>
      (window.__qa || window.__probe).pitchResolution.reviewRange(tick), rangeFixture.tick), rangeFixture.range,
      'deselection does not restore a legacy live contour');
    return proof;
  } finally {
    await frame.evaluate(point => {
      const qa=window.__qa||window.__probe;
      qa.pitchResolution.restoreReviewOutlier(point);
      qa.pitchbar.applySettingsState(point.settings);
    }, rangeFixture);
    await frame.evaluate(() => { window.Worker = window.__takeCacheProof.Worker; delete window.__takeCacheProof; });
  }
}

async function checkTakeReview(frame, page, {output, label}) {
  if (!await frame.evaluate(() => Number.isInteger((window.__qa || window.__probe).savedPractice.practicePart))) {
    await require('./browser-sing.cjs').nextPart(frame);
    await frame.waitForFunction(() => Number.isInteger((window.__qa || window.__probe).savedPractice.practicePart));
  }
  if (await frame.locator('[data-view="bars"]').getAttribute('aria-selected') !== 'true') {
    await frame.locator('#scoreViewToggle').click();
  }
  const fixture = await frame.evaluate(async () => {
    const qa = window.__qa || window.__probe;
    qa.engine.pauseTransport();
    const firstNote = qa.scoreNotes.find(note => note[0] === qa.savedPractice.practicePart);
    const firstBar = Math.max(0, qa.scoreMeasures.findIndex(([start, length]) =>
      firstNote[1] >= start && firstNote[1] < start + length));
    const start = qa.scoreMeasures[firstBar][0], end = qa.scoreMeasures[firstBar + 2][0];
    const ref = qa.pitchReference({start, end, rate: .8});
    const id = crypto.randomUUID(), sr = 48000;
    const gapStart = ref.seconds * .4, gapEnd = ref.seconds * .6;
    const pcm = Int16Array.from({length: Math.round(ref.seconds * sr)}, (_, i) => {
      const time = i / sr;
      if (time >= gapStart && time < gapEnd) return 0;
      return Math.round(400 * Math.sin(2 * Math.PI * 440 * time));
    });
    await qa.takeStore.append({id, song: qa.takeSong, sampleRate: sr, part: 'QA', label: 'Review',
      rate: ref.rate, createdAt: Date.now(), pitchReference: ref}, 0, pcm, {finalized: true, complete: true});
    // A pre-cache take already has valid summary metrics: selection must lazily
    // generate its missing contour once, even though background scoring skips it.
    await qa.takeStore.pitchScore(id, pcm.length, ref, MeleteTakePitch.scoreFrames([], ref, ref.seconds));
    await qa.keepLoose([id]);
    await qa.reloadTakes();
    const digest = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      await (await qa.takeStore.wav(id)).arrayBuffer())));
    window.__takeReviewProof = {digest, audio: await digest(),
      traces: Object.fromEntries(Object.keys(localStorage).filter(key => key.includes('pitch-trace')).map(key => [key, localStorage.getItem(key)]))};
    return {id, gapStart, gapEnd, track: ref.part, start, end};
  });
  // Divisi lines have their own cells, so a part number is not a cell number.
  const pressed = frame.locator('[data-visible-index][aria-pressed="true"]');
  const cell = await pressed.count() === 1 ? await pressed.getAttribute('data-visible-index') : String(fixture.track);
  // Explicit review switches the target part, preserving unrelated controls.
  await frame.evaluate(()=>{
    const q=window.__qa||window.__probe, original=q.takeStore.comps;
    const gate=new Promise(resolve=>{window.__releasePartLoad=()=>{q.takeStore.comps=original;resolve();};});
    q.takeStore.comps=async function(...args){await gate;return original.apply(this,args);};
  });
  // Divisi lines share a part, so step until the part itself changes.
  const moved = track => (window.__qa || window.__probe).savedPractice.practicePart !== track;
  for (let step = 0; step < 16 && !await frame.evaluate(moved, fixture.track); step++) await require('./browser-sing.cjs').nextPart(frame);
  await frame.waitForFunction(moved, fixture.track);
  for (const kind of ['visible', 'audio']) {
    const control = frame.locator(`[data-${kind}-index="${cell}"]`);
    if (await control.getAttribute('aria-pressed') === 'true') await control.click();
    assert.equal(await control.getAttribute('aria-pressed'), 'false', `${label}: hide/mute reviewed part`);
  }
  await frame.evaluate(({start, end}) => {
    const qa = window.__qa || window.__probe, e = qa.engine;
    // Capture uses the control model too, not just the engine's temporary loop.
    qa.pitchbar.applySettingsState({...qa.pitchbar.captureSettingsState(),
      loopStart:qa.scoreMeasures.findIndex(m => m[0] === start),
      loopEnd:qa.scoreMeasures.findIndex(m => m[0] === end) - 1,
      loopStartTick:start,loopEndTick:end});
    e.seek(e.secondsAtTick(start) + .3);
    __takeReviewProof.preferences = qa.savedPractice;
    __takeReviewProof.transport = {position: e.currentSeconds(), rate: e.rate,
      start: e.loopStartSeconds, end: e.loopEndSeconds};
    __takeReviewProof.storage = Object.fromEntries(Object.keys(localStorage)
      .filter(key => !key.includes('pitch-trace')).map(key => [key, localStorage.getItem(key)]));
    qa.pitchResolution.seedHistory(start, end);
    qa.pitchResolution.seedHistory(end, qa.scoreMeasures.at(-1)[0]);
    __takeReviewProof.points = JSON.stringify(qa.pitchResolution.snapshot().points);
  }, fixture);
  const row = frame.locator(`.take-row[data-take-id="${fixture.id}"]`);
  await frame.waitForFunction(() => !(window.__qa || window.__probe).busy);
  await row.locator('.take-select').click();
  await frame.evaluate(()=>window.__releasePartLoad());
  await frame.waitForFunction(id => (window.__qa || window.__probe).takeReview?.id === id, fixture.id);
  await frame.evaluate(async()=>{await (window.__qa||window.__probe).refreshComp();});
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).takeReview?.id),fixture.id,
    'a delayed part load cannot override the explicitly selected take');
  assert.equal(await frame.locator('#takeTimeline').isVisible(),true);
  assert.equal(await frame.locator('#takeTimeline .take-timeline-boundary').count(),0,'continuous take has no comp seams');
  assert.equal(await frame.locator('#takeTimeline .take-timeline-start').count(),1,'recording start is explicit even without comp seams');
  assert.equal(await frame.locator('#takeTimeline .take-timeline-end').count(),1,'recording end is explicit');
  assert.equal(await row.locator('.take-segments').textContent(),'1');
  assert.ok(await frame.locator('.take-timeline-start').getAttribute('data-address'));
  assert.ok(await frame.locator('.take-timeline-end').getAttribute('data-address'));
  assert.equal(await frame.locator('#takeTimeline svg, #takeTimeline canvas').count(),0,'playbar is a simple overview');
  assert.ok(await frame.evaluate(()=>MeleteTakePitch.reviewTimeline((window.__qa||window.__probe).engine.takeReview,
    (window.__qa||window.__probe).engine.duration).missing.length>0),'untracked singing remains explicit in playbar data');
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), false);
  const untouched = await frame.evaluate(() => {
    const qa = window.__qa || window.__probe, e = qa.engine, proof = __takeReviewProof;
    const changed=new Set(['practicePart','lastGuideChannel','practiceDivisi','visible','visibleChannels','audible','practiceMixMode','practiceMixPart','practiceMixUndo']);
    return {preferences: Object.keys(proof.preferences).filter(k=>!changed.has(k)).every(k=>JSON.stringify(qa.savedPractice[k])===JSON.stringify(proof.preferences[k])),
      transport: JSON.stringify({position: e.currentSeconds(), rate: e.rate, start: e.loopStartSeconds, end: e.loopEndSeconds})
        === JSON.stringify(proof.transport),
      storage: qa.savedPractice.practicePart === qa.engine.takeReview.ref.part};
  });
  assert.deepEqual(untouched, {preferences: true, transport: true, storage: true},
    JSON.stringify(await frame.evaluate(() => {
      const state = (window.__qa || window.__probe).savedPractice, before = __takeReviewProof.preferences;
      return Object.fromEntries(Object.keys(state).filter(key => JSON.stringify(state[key]) !== JSON.stringify(before[key]))
        .map(key => [key, {before: before[key], after: state[key]}]));
    })));
  assert.equal(await row.locator('.take-select').getAttribute('aria-pressed'), 'true');
  await frame.waitForFunction(id=>document.querySelector(`.take-pitch-trace-edge[data-take-id="${id}"]`),fixture.id);
  assert.equal(await frame.locator('[data-visible-index][aria-pressed="true"]').count(),1);
  assert.equal(await frame.locator('[data-audio-index][aria-pressed="false"]').count(),1);
  await frame.evaluate(()=>__takeReviewProof.preferences=(window.__qa||window.__probe).savedPractice);
  await row.locator('.take-select').click();
  await require('./browser-sing.cjs').choosePart(frame,Number(cell));
  await frame.waitForFunction(() => !(window.__qa || window.__probe).busy);
  await frame.evaluate(({start,end})=>{
    const qa=window.__qa||window.__probe;
    qa.pitchResolution.seedHistory(start,end);
    qa.pitchResolution.seedHistory(end,qa.scoreMeasures.at(-1)[0]);
    __takeReviewProof.points=JSON.stringify(qa.pitchResolution.snapshot().points);
    __takeReviewProof.preferences=qa.savedPractice;
    __takeReviewProof.traces=Object.fromEntries(Object.keys(localStorage).filter(key=>key.includes('pitch-trace')).map(key=>[key,localStorage.getItem(key)]));
  },fixture);
  const practiceEdges = await frame.locator('#barScore .bar-pitch-trace-edge').count();
  await row.locator('.take-select').click();
  await frame.waitForFunction(id => (window.__qa || window.__probe).takeReview?.id === id, fixture.id);
  if (await frame.locator('[data-view="bars"]').getAttribute('aria-selected') !== 'true') {
    await frame.locator('#scoreViewToggle').click();
  }
  await frame.waitForFunction(id => document.querySelectorAll(`.take-pitch-trace-edge[data-take-id="${id}"]`).length > 0,fixture.id);
  const checkReplacedTrace = async () => {
    const trace = await frame.evaluate(() => {
      const qa = window.__qa || window.__probe, review = qa.engine.takeReview;
      const live = [...document.querySelectorAll('#barScore .bar-pitch-trace-edge:not(.take-pitch-trace-edge),'
        + '#score .bar-pitch-trace-edge:not(.take-pitch-trace-edge)')];
      const step = qa.pitchResolution.snapshot().binTicks;
      return {overlap: live.filter(edge => qa.engine.secondsAtTick(Number(edge.dataset.fromBin) * step) < review.end
        && qa.engine.secondsAtTick(Number(edge.dataset.toBin) * step) > review.start).length,
        outside: live.length, points: qa.pitchResolution.snapshot().points.length,
        preserved: JSON.stringify(qa.pitchResolution.snapshot().points) === __takeReviewProof.points};
    });
    assert.equal(trace.overlap, 0, 'selected take replaces old trace, including untracked gaps');
    assert.equal(trace.outside, 0, 'inactive live traces are hidden throughout the song, not just under the selected take');
    assert.equal(trace.preserved, true, 'hiding the trace does not erase it');
    return trace;
  };
  const replacement = await checkReplacedTrace();
  const resizing = await checkPitchbarResize(frame, page);
  await frame.evaluate(() => (window.__qa || window.__probe).pitchResolution.redrawIncrementally());
  await checkReplacedTrace();
  assert.equal(await frame.locator(`[data-visible-index="${cell}"]`).getAttribute('aria-pressed'), 'true',
    `${label}: explicitly show reviewed staff before notation`);
  await frame.locator('#scoreViewToggle').click();
  try { await frame.waitForFunction(id => document.querySelectorAll(`#score .take-pitch-trace-edge[data-take-id="${id}"]`).length > 0,fixture.id); }
  catch(error) {
    await page.screenshot({path:path.join(output,`take-review-standard-failure-${label}.png`)});
    const state=await frame.evaluate(()=>(window.__qa||window.__probe).pitchResolution.traceState());
    throw new Error(`${label}: ${error.message}: ${JSON.stringify(state)}`);
  }
  await checkReplacedTrace();
  await frame.locator('#scoreViewToggle').click();
  try { await frame.waitForFunction(id => document.querySelectorAll(`#barScore .take-pitch-trace-edge[data-take-id="${id}"]`).length > 0,fixture.id); }
  catch(error) {
    await page.screenshot({path:path.join(output,`take-review-failure-${label}.png`)});
    const state=await frame.evaluate(()=>{
      const q=window.__qa||window.__probe;
      return {busy:q.busy,view:document.querySelector('#scoreViewToggle [aria-selected="true"]')?.dataset.view,
        systems:document.querySelectorAll('#barScore svg').length,review:q.takeReview&&{id:q.takeReview.id,frames:q.takeReview.frames.length,first:q.takeReview.frames.slice(0,3)},
        trace:document.querySelector('#barScore .bar-pitch-trace-layer')?.outerHTML.slice(0,1000)};
    });
    throw new Error(`${label}: ${error.message}: ${JSON.stringify(state)}`);
  }
  const trace = await frame.evaluate(({gapStart, gapEnd}) => {
    const qa = window.__qa || window.__probe;
    return {frames: qa.takeReview.frames.length, gaps: qa.takeReview.frames.filter(frame => frame.cents === null).length,
      edges: [...document.querySelectorAll(`#barScore .take-pitch-trace-edge[data-take-id="${qa.takeReview.id}"]`)].reduce((n,e)=>n+(e.getAttribute('d').match(/M/g)||[]).length,0),
      possibleEdges:qa.takeReview.frames.filter((f,i,frames)=>i&&Number.isFinite(f.cents)&&Number.isFinite(frames[i-1].cents)
        &&f.start-frames[i-1].end<1e-6).length,
      additionalTrack: qa.engine.takeReview.track, rate: qa.engine.rate};
  }, fixture);
  assert.ok(trace.frames > 10 && trace.gaps > 0);
  assert.ok(trace.edges>0&&trace.edges<=trace.possibleEdges,'batched subpaths do not invent edges across detection gaps');
  assert.equal(trace.rate, await frame.evaluate(() => __takeReviewProof.transport.rate), 'selection never changes practice speed');
  await page.screenshot({path: path.join(output, `take-review-${label}.png`)});
  await frame.locator('#playPause').click();
  await frame.waitForFunction(() => {
    const engine = (window.__qa || window.__probe).engine;
    return engine.playing && engine.takeReviewSource;
  });
  const synth = await frame.evaluate(() => {
    const qa = window.__qa || window.__probe, e = qa.engine;
    const note = {...e.notes.find(note => note.track === e.takeReview.track),
      start: e.currentSeconds(), end: e.currentSeconds() + .3};
    delete note.segments;
    const count = e.scheduled.size;
    e.scheduleNote(note, note.start, .01);
    return {duplicate: e.scheduled.size > count, others: e.scheduled.size};
  });
  assert.equal(synth.duplicate, true, 'selecting a take does not suppress any synth part');
  assert.ok(synth.others > 0, 'other voices continue with the recorded singer');
  const stretched = await frame.evaluate(async cell => {
    const e = (window.__qa || window.__probe).engine, review = e.takeReview;
    const analyser = e.context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    review.gain.connect(analyser);
    try {
      await new Promise(resolve => setTimeout(resolve, 650));
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(spectrum);
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      let peak = 1;
      for (let i = 2; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
      return {media: Boolean(e.takeReviewSource?.media), pitchPreserved: review.audio.preservesPitch,
        rate: review.audio.playbackRate, expected: e.rate / review.rate,
        frequency: peak * e.context.sampleRate / analyser.fftSize, level: spectrum[peak],
        rms: Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length),
        gain: review.gain.gain.value, partMuted: e.trackStrips[cell].gain.gain.value < .001};
    } finally { review.gain.disconnect(analyser); analyser.disconnect(); }
  }, Number(cell));
  assert.equal(stretched.media, true);
  assert.equal(stretched.pitchPreserved, true);
  assert.equal(stretched.rate, stretched.expected);
  assert.ok(Math.abs(stretched.frequency - 440) < 12, JSON.stringify(stretched));
  assert.ok(stretched.rms > .05 && stretched.rms < .4 && stretched.partMuted,
    `quiet take is boosted while its synth part stays muted: ${JSON.stringify(stretched)}`);
  assert.ok(stretched.gain > 1);
  await frame.locator('#settingsToggle').click();
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), true);
  await frame.locator('#playPause').click();
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.takeReviewSource), null);
  await frame.evaluate(() => {
    const e = (window.__qa || window.__probe).engine;
    e.seek(e.takeReview.start + .5);
  });
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), false);
  await frame.locator('#playPause').click();
  await frame.waitForFunction(() => (window.__qa || window.__probe).engine.takeReviewSource);
  await frame.evaluate(() => {
    const e = (window.__qa || window.__probe).engine;
    e.seek(e.takeReview.end - .03);
  });
  await frame.waitForFunction(() => {
    const e = (window.__qa || window.__probe).engine;
    return e.currentSeconds() < e.takeReview.start + .5 && e.takeReviewSource;
  });
  // Clicking the selected row removes only that track, while practice continues.
  await frame.locator('#settingsToggle').click();
  await row.locator('.take-select').click();
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), true);
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.takeReviewSource), null);
  assert.equal(await row.locator('.take-select').getAttribute('aria-pressed'), 'false');
  assert.equal(await frame.locator('#barScore .bar-pitch-trace-edge:not(.take-pitch-trace-edge)').count(), practiceEdges,
    'deselect never restores an inactive live contour');
  const position = await frame.evaluate(() => (window.__qa || window.__probe).engine.currentSeconds());
  await row.locator('.take-select').click();
  await frame.waitForFunction(id => (window.__qa || window.__probe).takeReview?.id === id, fixture.id);
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), true);
  assert.ok(await frame.evaluate(position => (window.__qa || window.__probe).engine.currentSeconds() >= position, position),
    'adding the take during playback does not restart the phrase');
  const independent = await frame.evaluate(async () => {
    const q = window.__qa || window.__probe, e = q.engine, id = e.takeReview.id;
    // Selecting refreshes the comp panel. If that refresh read this speed, it would clear the review.
    await q.refreshComp();
    e.setRate(e.takeReview.rate);
    const matchingSpeed = e.takeReview?.id === id && !e.takeReviewSource?.media;
    e.seek(e.takeReview.start + .5);
    // The review can lose its gain connection mid-sample, so measure a node that stays connected.
    const sample = async () => {
      const analyser = e.context.createAnalyser(), gain = e.takeReview.gain; analyser.fftSize = 2048;
      gain.connect(analyser);
      await new Promise(resolve => setTimeout(resolve, 160));
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      analyser.disconnect();
      try { gain.disconnect(analyser); } catch { return null; }
      return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    };
    let matchingRms = await sample();
    for (let attempt = 0; attempt < 3 && matchingRms === null; attempt++) matchingRms = await sample();
    e.setLoop(null, null);
    e.seek(e.takeReview.end + .2);
    const outside = e.currentSeconds() > e.takeReview.end && !e.takeReviewSource && e.takeReview.id === id;
    e.setRate(__takeReviewProof.transport.rate);
    e.setLoop(e.takeReview.ref.start, e.takeReview.ref.end);
    return {matchingSpeed, matchingRms, outside};
  });
  assert.equal(independent.matchingSpeed, true);
  assert.equal(independent.outside, true);
  assert.ok(independent.matchingRms > .05 && independent.matchingRms < .4,
    `matching-speed playback outputs the normalized microphone, not just a scheduled node: ${JSON.stringify(independent)}`);
  await frame.locator('#exitTakeReview').click();
  assert.equal(await frame.locator('#takeTimeline').isVisible(),false);
  assert.equal(await frame.locator('#takeTimeline span').count(),0);
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.playing), true);
  await frame.evaluate(() => (window.__qa || window.__probe).engine.pauseTransport());
  const preserved = await frame.evaluate(async () => {
    const qa = window.__qa || window.__probe, proof = window.__takeReviewProof;
    const state = qa.savedPractice;
    const keys = ['practicePart', 'practiceDivisi', 'tempo', 'visible', 'audible', 'volumes', 'pans', 'loopStart', 'loopEnd', 'loopStartTick', 'loopEndTick'];
    const result = {noReview: !qa.takeReview, paused: !qa.engine.playing,
      sameAudio: JSON.stringify(await proof.digest()) === JSON.stringify(proof.audio),
      samePreferences: keys.every(key => JSON.stringify(state[key]) === JSON.stringify(proof.preferences[key])),
      sameTrace: Object.entries(proof.traces).every(([key, value]) => localStorage.getItem(key) === value)};
    delete window.__takeReviewProof;
    return result;
  });
  assert.deepEqual(preserved, {noReview: true, paused: true, sameAudio: true, samePreferences: true, sameTrace: true});
  await frame.evaluate(() => (window.__qa || window.__probe).reloadTakes());
  const cached = await checkCachedTakeReview(frame, fixture.id);
  await row.locator('.take-select').click();
  await frame.waitForFunction(id => (window.__qa || window.__probe).takeReview?.id === id, fixture.id);
  const singWasOn = await frame.evaluate(() => (window.__qa || window.__probe).savedPractice.sing);
  if (!singWasOn) await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(() => document.getElementById('pitchCapture').dataset.state === 'waiting');
  if(await frame.locator('#recordAudio').getAttribute('aria-pressed')!=='true') await frame.locator('#recordAudio').click();
  await frame.locator('#playPause').click();
  try {
    await frame.waitForFunction(id => {
      const qa = window.__qa || window.__probe;
      return qa.takeReview?.id === id && qa.engine.takeLayers.has(id) && qa.recording.pitch === 'recording' && qa.pitchResolution.workerActive();
    }, fixture.id);
  } catch (error) {
    const detail = await frame.evaluate(() => {
      const q = window.__qa || window.__probe;
      return {state:q.recording.state,pitch:q.recording.pitch,notice:q.recording.notice,
        captureError:q.captureError,worker:q.pitchResolution.workerActive(),review:q.takeReview?.id,
        playing:q.engine.playing,position:q.engine.currentSeconds(),sing:q.savedPractice.sing};
    });
    throw new Error(`${error.message}: ${JSON.stringify(detail)}`);
  }
  await row.locator('.take-hear').click();
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).recording.pitch), 'recording',
    'muting an overdub layer does not interrupt Sing');
  assert.equal(await frame.locator('#takeTimeline').isVisible(),true,'recording and Hear changes retain the selected review');
  await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(id => {
    const q=window.__qa||window.__probe;
    return !q.busy && !document.querySelector('#score').hidden && q.recording.state==='recording' && q.takeReview?.id===id;
  },fixture.id);
  assert.equal(await frame.locator('#score .bar-pitch-trace-edge').count(),0,'even a previously selected take stays off the staff during an overdub');
  await frame.locator('#playPause').click();
  if (!singWasOn) await frame.locator('#pitchCapture').click();
  await frame.locator('#scoreViewToggle').click();
  return {id: fixture.id, trace, replacement, resizing, untouched, stretched, independent, preserved,
    deselectContinuesPlayback: true, singContinues: true, sharedTransport: true, looped: true, cached};
}

module.exports = {checkTakeReview, checkCachedTakeReview};
