const assert = require('node:assert/strict');
const path = require('node:path');

// This instrumentation exists only in isolated QA builds. A quiet synthetic
// input exercises the actual analyser/Pitchy path without recording the user.
const pitchTraceProbe = `pitchResolution: {
  get divisiSpans() { return partDivisi[practicePartIndex]?.spans || []; },
  divisiTargets(tick,cents) { return {line:pitchTraceLaneAt(tick,cents),error:expectedPitchErrorCents(tick,cents),
    pitches:expectedPitchAt(tick).map(n=>n[3]),part:practicePartIndex,chosen:practiceDivisi[practicePartIndex]}; },
  clearPitchTrace, loadPitchTrace, disablePitchCapture, setScoreView,
  traceState() {
    const review=takeReview;
    const frame=review?.frames.find(f=>Number.isFinite(f.cents));
    const tick=frame?engine.tickAtSeconds(review.start+(frame.start+frame.end)/2*review.rate):null;
    return {view:scoreView,busy:notationRenderInFlight,queued:notationRenderQueued,
      visible:[...visibleTracks],review:review&&{track:review.track,line:review.ref.line,tick,cents:frame?.cents},
      target:frame?expectedPitchAt(tick,review.ref.line,review.track):null,
      systems:staffTraceSystems.filter(s=>tick>=s.startTick&&tick<s.endTick).map(s=>({
        start:s.startTick,end:s.endTick,parts:[...(s.measures.get(measureIndexAtTick(tick))?.parts.keys()||[])],
        references:[...s.references.keys()].filter(k=>k.startsWith(review.track+':')),
        point:staffTracePoint(s,tick,frame.cents,review.ref.line,review.track)}))};
  },
  workerActive() { return !!pitchCaptureWorker; },
  seedOldMovingOnset() {
    this.stop();clearPitchTrace();setPracticePart(0);setScoreView('bars');
    const values=[4592,4607,4630,4676,4645,0,4728,0,4722,3505,3500,
      4649,4545,4496,4492,4501,4528,4547,4557,4563,4558,4560];
    const lane=pitchTraceLane(0,{create:true});
    lane.pitches.set(values,20);lane.breaks[29]=1;
    pitchTraceCount=values.filter(Boolean).length;
    const stored={version:3,track:0,lanes:[{line:0,pitches:values,
      octaveRepairs:[[29,3505,4705],[30,3500,4700]],breaks:[]}]};
    localStorage.setItem(pitchTraceKey,JSON.stringify(stored));
    // Adopt the imported cache before unload's ordinary save, just as a
    // startup import does; otherwise this test overwrites its own fixture.
    loadPitchTrace();
    return {values,stored:localStorage.getItem(pitchTraceKey)};
  },
  oldMovingOnsetSnapshot() {
    savePitchTraceNow();
    const lane=pitchTraceLane(0);
    return {values:lane?Array.from(lane.pitches.slice(20,42)):[],split:lane?.breaks[29],
      stored:localStorage.getItem(pitchTraceKey)};
  },
  seedReviewOutlier(tick) {
    const lane=pitchTraceLane(0,{create:true}),bin=pitchTraceBinAtTick(tick);
    const previous=lane.pitches[bin];
    lane.pitches[bin]=10800;
    if(!previous)pitchTraceCount++;
    renderBarScore();
    return {bin,previous,tick};
  },
  reviewRange(tick) {
    const system=barSystems.find(s=>tick>=s.startTick&&tick<s.endTick);
    return system&&{min:system.minPitch,max:system.maxPitch};
  },
  restoreReviewOutlier({bin,previous}) {
    const lane=pitchTraceLane(0);
    if(!previous)pitchTraceCount--;
    lane.pitches[bin]=previous;
    renderBarScore();
  },
  prepareRestRepair() {
    this.stop(); clearLoop(); clearPitchTrace(); engine.setRate(1);
    const order=parts.map((_,i)=>i).sort((a,b)=>(parts[b].short==='B2')-(parts[a].short==='B2'));
    for(const part of order) {
      const ref=takePitchReference({start:0,end:sequence.endTick,rate:1},part,null);
      const guard=ref.restPolicy.guards.find(([a,b])=>a>.4&&b-a>.4);
      if(!guard)continue;
      setPracticePart(part); setScoreView('bars');
      const start=engine.tickAtSeconds(guard[0]+.05),end=engine.tickAtSeconds(guard[1]-.05);
      const note=sequence.notes.find(n=>n[0]===part&&n[2]>end)||sequence.notes.find(n=>n[0]===part);
      const lane=pitchTraceLane(0,{create:true});
      const first=Math.ceil(start/pitchTraceBinTicks()),last=Math.floor(end/pitchTraceBinTicks());
      for(let bin=first;bin<=last;bin++){lane.pitches[bin]=note[3]*100;pitchTraceCount++;}
      const noteBin=pitchTraceBinAtTick((note[1]+note[2])/2);
      lane.pitches[noteBin]=note[3]*100;pitchTraceCount++;
      this.key=note[3];
      api.tickPosition=engine.tickAtSeconds(guard[0]-.4);
      renderPitchTrace();
      return {part:parts[part].short,measure:measureIndexAtTick(start)+1,first,last,noteBin,
        endSeconds:guard[1]+.25,guard,initial:this.restSnapshot({first,last,noteBin})};
    }
    throw new Error('Fixture needs an entrance/release rest guard');
  },
  restSnapshot({first,last,noteBin}) {
    const lane=pitchTraceLane(0);
    return {remaining:lane?[...lane.pitches.slice(first,last+1)].filter(Boolean).length:0,
      note:lane?.pitches[noteBin],edges:(scoreView==='bars'?barSystems:staffTraceSystems).reduce((n,s)=>n+
        [...(s.traceEdges?.keys()||[])].filter(key=>{const [,a,b]=key.split(':').map(Number);
          return a<=last&&b>=first;}).length,0),stored:localStorage.getItem(pitchTraceKey)};
  },
  redrawIncrementally() {
    updatePitchTraceIncrementally(new Map(pitchTraceLaneList().map(([line, lane]) =>
      [line, new Set([...lane.pitches].flatMap((pitch, bin) => pitch ? [bin] : []))])));
  },
  seedHistory(startTick, endTick) {
    const lane=pitchTraceLane(0,{create:true});
    const first=pitchTraceBinAtTick(startTick),last=Math.min(pitchTraceBinAtTick(endTick),first+3500);
    for(let bin=first;bin<last;bin++) {
      const tick=pitchTraceTickAtBin(bin),target=expectedPitchAt(tick)[0];
      if(!target)continue;
      if(!lane.pitches[bin])pitchTraceCount++;
      lane.pitches[bin]=target[3]*100+Math.round(8*Math.sin(bin/9));
    }
    renderPitchTrace();
    return pitchTraceCount;
  },
  seedOctave(offset) {
    clearPitchTrace();
    setPracticePart(0); setScoreView("bars");
    takeState='recording';
    const note=sequence.notes.find(n=>n[0]===0&&n[2]-n[1]>=sequence.division/2);
    const first=pitchTraceBinAtTick(note[1])+1,last=Math.min(pitchTraceBinAtTick(note[2])-1,first+12);
    const lane=pitchTraceLane(0,{create:true});
    for(let bin=first;bin<=last;bin++){lane.pitches[bin]=(note[3]+offset)*100;pitchTraceCount++;}
    this.octaveTarget={first,last,pitch:note[3],offset,tick:pitchTraceTickAtBin(first)};
    updatePitchTraceIncrementally(new Map([[0,new Set(Array.from({length:last-first+1},(_,i)=>first+i))]]));
  },
  octaveSnapshot() {
    const t=this.octaveTarget,s=barSystems.find(s=>t.tick>=s.startTick&&t.tick<s.endTick);
    if(!s)return null;
    const edges=[...s.traceLayer.querySelectorAll('.bar-pitch-trace-edge .bar-pitch-trace')];
    return {min:s.minPitch,max:s.maxPitch,pitch:t.pitch,offset:t.offset,
      raw:pitchTraceLane(0).pitches[t.first],targetY:s.yAtPitch(t.pitch),actualY:s.yAtPitch(t.pitch+t.offset),
      edges:edges.map(e=>({y:Number(e.getAttribute('y1')),color:e.getAttribute('stroke')}))};
  },
  prepare() {
    engine.pauseTransport(); clearLoop(); stopTakePreview(); clearPitchTrace(); engine.setRate(1);
    setPracticePart(0);
    const note = sequence.notes.find(note => note[0] === 0) || sequence.notes[0];
    api.tickPosition = note[1];
    this.key = note[3];
    this.observations = [];
    this.originalReplace = replacePitchTraceWindows;
    const owner = this;
    replacePitchTraceWindows = function(frames) {
      for (const frame of frames) if (frame) owner.observations.push({tick:frame.tick, stride:frame.stride,
        bin:pitchTraceBinAtTick(frame.tick,frame.stride), cents:frame.pitchCents,
        hop:Math.max(pitchCaptureIntervalMs,pitchCaptureCadenceMs)});
      return owner.originalReplace(frames);
    };
  },
  input(gain=.15) {
    pitchCaptureSource.disconnect(pitchCaptureAnalyser);
    const oscillator = pitchCaptureContext.createOscillator(), level = pitchCaptureContext.createGain();
    oscillator.frequency.value = 440 * 2 ** ((this.key-69)/12);
    level.gain.value = gain;
    oscillator.connect(level); level.connect(pitchCaptureAnalyser); oscillator.start();
    this.signal = {oscillator,level};
  },
  stop() {
    engine.pauseTransport(); disablePitchCapture(false);
    this.signal?.oscillator.stop(); this.signal?.oscillator.disconnect(); this.signal?.level.disconnect();
    this.signal = null;
    if (this.originalReplace) replacePitchTraceWindows = this.originalReplace;
    this.originalReplace = null;
  },
  snapshot() {
    return {binTicks:pitchTraceBinTicks(), division:sequence.division, count:pitchTraceCount,
      points:pitchTraceLaneList().flatMap(([line,lane])=>[...lane.pitches].flatMap((cents,bin)=>
        cents ? [{line,bin,cents,split:lane.breaks[bin]}] : [])),
      observations:this.observations || [], cadence:pitchCaptureCadenceMs, interval:pitchCaptureIntervalMs,
      worker:!!pitchCaptureWorker, busyWorker:!!pitchCaptureWorker?.pending,
      stored:localStorage.getItem(pitchTraceKey), state:pitchCaptureState,
      edges:document.querySelectorAll('.bar-pitch-trace g, .score-pitch-trace g').length,
      busy:notationRenderInFlight || notationRenderQueued};
  }
}`;

async function checkPitchTraceResolution(frame, page, {probe='__qa', reload, output, label}={}) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true')
    await frame.locator('#settingsToggle').click();
  await frame.evaluate(name => window[name].pitchResolution.prepare(), probe);
  await frame.evaluate(name => window[name].pitchResolution.setScoreView('standard'), probe);
  await frame.waitForFunction(name => !window[name].pitchResolution.snapshot().busy, probe);
  await frame.locator('#recordAudio').click();
  await frame.locator('#playPause').click();
  await frame.waitForFunction(name => window[name].pitchResolution.snapshot().state === 'recording', probe);
  let captured;
  try {
    await frame.evaluate(name => window[name].pitchResolution.input(), probe);
    await frame.waitForFunction(name => window[name].pitchResolution.observations.length > 5, probe);
    await frame.waitForFunction(name => window[name].recording.takes.some(t=>t.active), probe);
    const activeTake = await frame.evaluate(name => window[name].recording.takes.find(t=>t.active)?.id, probe);
    assert.ok(activeTake, 'Score view starts a real microphone recording');
    assert.equal(await frame.locator('#score .bar-pitch-trace-edge').count(), 0, 'no live or reference traces on notation');
    await frame.locator('#scoreViewToggle').click();
    await frame.locator('#barScore [data-from-bin]').first().waitFor({state:'attached'});
    await frame.locator('#scoreViewToggle').click();
    await page.waitForTimeout(3000);
    captured = await frame.evaluate(name => window[name].pitchResolution.snapshot(), probe);
    assert.equal(captured.binTicks,captured.division/64);
    assert.ok(captured.count>80,`expected denser capture than 15 Hz: ${JSON.stringify({count:captured.count,
      cadence:captured.cadence, interval:captured.interval, frames:captured.observations.length})}`);
    assert.ok(captured.count<=captured.observations.length,'no invented interpolated readings');
    const observed = new Set(captured.observations.map(frame=>`${frame.bin}:${Math.round(frame.cents)}`));
    for(const point of captured.points) assert.ok(observed.has(`${point.bin}:${point.cents}`),'every saved point came from the detector');
    for(const reading of captured.observations) {
      assert.equal(Math.log2(reading.stride)%1,0,'only binary musical subdivisions');
      assert.equal(reading.bin%reading.stride,0,'all observations share the score grid origin');
    }
    assert.ok(captured.observations.some(frame=>frame.stride<=2),'256th or 128th works at ordinary tempo');
    const recordedId=await frame.evaluate(name=>window[name].recording.takes.find(t=>t.active)?.id,probe);
    assert.equal(recordedId,activeTake,'switching Score/Pitchbar twice preserves the uninterrupted take');
    assert.equal(await frame.locator('#score .bar-pitch-trace-edge').count(),0,'notation is still clean after live samples and layout');
    await frame.evaluate(name => window[name].pitchResolution.stop(), probe);
    // Earlier fixtures can already have contours. Wait for this capture's
    // analysis and comp adoption; replaced source takes may then be collected.
    await frame.waitForFunction(({name,id})=>window[name].recording.state==='off'
      &&window[name].recording.takes.some(t=>t.id===id&&t.finalized&&!t.unsaved&&t.pitchContour),{name:probe,id:recordedId});
    await frame.waitForFunction(name=>window[name].tracksSettled(),probe);
    const saved=await frame.evaluate(({name,id})=>window[name].recording.takes.filter(t=>t.id===id)
      .map(t=>({id:t.id,frames:t.frames})),{name:probe,id:recordedId});
    assert.equal(saved.length,1,'the newly recorded source remains in its track');
    const comp=await frame.evaluate(({name,id}) => {
      const q=window[name], state=q.compState;
      return {key:state?.key, includesTake:state?.segments.some(segment=>segment.takeId===id),
        tracked:q.recording.takes.find(t=>t.id===id)?.pitchScore?.trackedSeconds};
    }, {name:probe,id:recordedId});
    assert.ok(comp.includesTake && comp.tracked > 0,'Score recording was saved, scored and incorporated');
    const row=frame.locator(`#compRows [data-comp-key=${JSON.stringify(comp.key)}] .comp-review`);
    assert.equal(await row.getAttribute('aria-pressed'),'false','automatic comp arming is not an explicit request to draw on the staff');
    assert.equal(await frame.locator('#score .bar-pitch-trace-edge').count(),0,'finishing the first take does not expose its trace');
    await row.click();
    assert.equal(await frame.evaluate(name=>window[name].engine.playing,probe),false,'inspecting the saved contour does not start playback');
    for(const view of ['standard','bars']) {
      await frame.evaluate(({name,view})=>window[name].pitchResolution.setScoreView(view),{name:probe,view});
      const surface=view==='bars'?'#barScore':'#score';
      await frame.locator(`${surface} .take-pitch-trace-group[data-selected="true"] .take-pitch-trace-edge`).first().waitFor({state:'attached'});
      if(output) await page.screenshot({path:path.join(output,`pitch-resolution-${label}-${view}.png`)});
    }
    frame = await reload();
    const restored = await frame.evaluate(name=>window[name].pitchResolution.snapshot(),probe);
    assert.equal(restored.state,'off','reload does not turn on the microphone');
    assert.equal(restored.count,0,'the transient live grid is never restored from localStorage');
    await frame.waitForFunction(({name,saved})=>saved.every(s=>window[name].recording.takes.some(t=>t.id===s.id&&t.frames===s.frames&&t.pitchContour)),{name:probe,saved});
    assert.equal(restored.stored,null);
    // The latest track now selects itself after reload. Clicking while its
    // audio finishes loading would toggle that freshly selected track off.
    await frame.waitForFunction(name=>window[name].takeReview,probe);
    assert.equal(await frame.locator('#compRows .comp-review[aria-pressed="true"]').count(),1);
    const octaves=[];
    for(const offset of [-12,12,-11]) {
      await frame.evaluate(({probe,offset})=>window[probe].pitchResolution.seedOctave(offset),{probe,offset});
      await frame.waitForFunction(probe=>!window[probe].busy&&window[probe].pitchResolution.octaveSnapshot()?.edges.length,probe);
      const view=await frame.evaluate(probe=>window[probe].pitchResolution.octaveSnapshot(),probe);
      assert.equal(view.raw,(view.pitch+offset)*100,'raw pitch keeps the sung octave');
      assert.ok(view.min<=view.pitch+offset&&view.max>=view.pitch+offset,'pitchbar expands enough to display the actual register');
      assert.ok(view.edges.every(e=>Math.abs(e.y-view.actualY)<.01),'trace is drawn at actual pitch, not on the target octave');
      assert.ok(Math.abs(view.actualY-view.targetY)>30,'the sung octave remains visibly distinct');
      assert.ok(view.edges.every(e=>offset===-11?e.color!=='rgb(0 255 0)':e.color==='rgb(0 255 0)'), 'octaves are green but a semitone error is not');
      octaves.push(view);
      if(output)await page.screenshot({path:path.join(output,`octave-${label}-${offset}.png`)});
    }
    const oldTrace=await frame.evaluate(name=>window[name].pitchResolution.seedOldMovingOnset(),probe);
    frame=await reload();
    const cleaned=await frame.evaluate(name=>window[name].pitchResolution.oldMovingOnsetSnapshot(),probe);
    assert.equal(cleaned.values.filter(Boolean).length,0,'an old live cache never resurfaces as a second contour');
    assert.equal(cleaned.stored,oldTrace.stored,'ignoring the old cache does not delete user data');
    frame=await reload();
    const repeated=await frame.evaluate(name=>window[name].pitchResolution.oldMovingOnsetSnapshot(),probe);
    assert.deepEqual(repeated,cleaned,'repair is stable across subsequent reloads');
    return {count:captured.count, detectorReadings:captured.observations.length,
      binTicks:captured.binTicks, cadenceMs:captured.cadence, processingIntervalMs:captured.interval,
      subdivisions:[...new Set(captured.observations.map(f=>256/f.stride))].sort((a,b)=>b-a),
      reload:true, views:['standard','bars'], cleanStaffDuringRecording:true, sameTakeAcrossViewSwitches:true, scoredInStaffView:true, octaves,
      savedTakes: saved.length, legacyCacheIgnored:true,
      input:'synthetic oscillator/silence through actual analyser/Pitchy'};
  } finally {
    await frame.evaluate(name=>{const p=window[name].pitchResolution;p.stop();p.clearPitchTrace();},probe);
  }
}
module.exports={pitchTraceProbe,checkPitchTraceResolution};
