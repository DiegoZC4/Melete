const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
test('browser pitch probe compiles before launching a browser', () => {
  new vm.Script(`({${require('./browser-pitch-resolution.cjs').pitchTraceProbe}})`);
});
test('pausing a different score version cannot delete a trace that was not loaded', () => {
  const saved=JSON.stringify({fingerprint:'old-score',version:3,lanes:[]});
  const values=new Map([['trace',saved]]);
  const c=vm.createContext({pitchTraceCount:0,pitchTraceLoaded:true,pitchTraceKey:'trace',pitchTraceSaveTimer:0,
    clearTimeout(){},pitchTraceFingerprint:()=> 'current-score',showToast(){throw new Error('unexpected error');},
    localStorage:{getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key)}});
  vm.runInContext(source('savePitchTraceNow'),c);
  c.savePitchTraceNow();
  assert.equal(values.get('trace'),saved);
  values.set('trace',JSON.stringify({fingerprint:'current-score'}));
  c.savePitchTraceNow();
  assert.equal(values.has('trace'),false,'silence may still erase the currently loaded trace');
  values.set('trace',JSON.stringify({fingerprint:'current-score',malformed:true}));
  c.pitchTraceLoaded=false;
  c.savePitchTraceNow();
  assert.equal(values.has('trace'),true,'a failed restore must not be confused with intentional silence');
});
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}
function fixture({division=960, bpm=84, rate=1}={}) {
  const c = vm.createContext({
    sequence: {division, endTick: division * 16},
    engine: {tempoSegments: [{tick:0, bpm}], rate, secondsAtTick: tick => tick / division * 60 / bpm},
    PITCH_TRACE_BINS_PER_QUARTER:64, PITCH_CAPTURE_INTERVAL_MS:10,
    PITCH_CAPTURE_FALLBACK_INTERVAL_MS:100, PITCH_CAPTURE_BUFFER_SIZE:4096,
    PITCH_CAPTURE_MIN_FREQUENCY:55, PITCH_CAPTURE_MAX_FREQUENCY:1200, pitchLastAcceptedCents:null,
    PITCH_TRACE_STORAGE_VERSION:3,
    pitchTraceLanes: new Map(), pitchTraceCount:0, pitchCaptureTimer:0,
    pitchCaptureIntervalMs:10, pitchCaptureCadenceMs:10, pitchCapturePreviousAudioTime:null,
    pitchCapturePreviousTick:null, pitchCapturePreviousSeconds:null, pitchCaptureWasSilent:true, pitchCaptureMisses:0,
    pitchCaptureUnvoicedFrame:null, pitchOctaveHistory:[],
    window:{MeleteVocalPitch:require('../template/vocal_pitch.js')},
    pitchTraceLaneAt:()=>0, pitchPendingEvidence:null, PITCH_CONFIDENCE_THRESHOLD:.8,
    pitchRestState:()=> 'sing',
    queuePitchTracePaint:()=>{}, schedulePitchTraceSave:()=>{}, pitchCaptureWorker:null,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)), Uint8Array, Uint16Array, btoa, atob,
  });
  for (const name of ['pitchTraceBinTicks', 'pitchTraceBinCount', 'pitchTraceBinAtTick', 'pitchTraceStrideAt',
    'pitchTraceLane', 'resetPitchTraceGrid', 'nextOccupiedPitchBin',
    'bytesToBase64', 'base64ToBytes', 'packedPitchTraceBreaks', 'unpackPitchTraceBreaks',
    'readPitchTraceLane', 'loadPitchTraceV3', 'loadPitchTraceV2', 'migratePitchTraceV1',
    'replacePitchTraceWindows', 'repairLivePitchOctaves', 'clearSilentRestTrace', 'pitchInputIsLive',
    'pitchFrequencyIsValid', 'centsForFrequency', 'resetPitchEvidence', 'acceptPitchEvidence', 'evaluatePitchEvidence',
    'beginPitchCapturePass', 'capturePitchSample', 'acceptPitchSample', 'runPitchSampling']) {
    vm.runInContext(source(name), c);
  }
  return c;
}
function packed(c, {binTicks=c.sequence.division/16, line=0, points=[[1,6900,1],[3,6910,0]]}={}) {
  const length = Math.ceil(c.sequence.endTick/binTicks)+1;
  const pitches = new Uint16Array(length), breaks = new Uint8Array(length);
  for(const [bin,cents,split] of points) { pitches[bin]=cents; breaks[bin]=split; }
  return {binTicks, length, lanes:[{line, pitches:c.bytesToBase64(new Uint8Array(pitches.buffer)),
    breaks:c.bytesToBase64(c.packedPitchTraceBreaks(breaks))}]};
}
test('verified old-contour repairs reload and retain raw values until those bins are re-sung', () => {
  const c = fixture({bpm:60}), vocal = require('../template/vocal_pitch.js');
  const values = [4592,4607,4630,4676,4645,0,4728,0,4722,3505,3500,
    4649,4545,4496,4492,4501,4528,4547,4557,4563,4558,4560];
  const stored = packed(c, {binTicks:15, points:values.map((p,i)=>[i,p,i===9?1:0])});
  stored.lanes[0].octaveRepairs=[[9,3505,4705],[10,3500,4700]];
  assert.equal(c.loadPitchTraceV3(stored),true);
  const lane = c.pitchTraceLane(0);
  assert.equal(lane.pitches[9],4705); assert.equal(lane.pitches[10],4700);
  assert.equal(lane.breaks[9],1); assert.equal(lane.pitches[5],0);
  const raw = vocal.rawPitchGrid(lane.pitches,lane.rawOctaves);
  assert.deepEqual(Array.from(raw.slice(0,values.length)),values,'reloading never destroys original observations');
  c.replacePitchTraceWindows([{tick:135,startTick:135,endTick:135,stride:1,pitchCents:4705}]);
  assert.equal(vocal.rawPitchGrid(lane.pitches,lane.rawOctaves)[9],4705,'a new matching pitch is not mistaken for the old correction');
  c.pitchRestState=()=> 'rest';c.clearSilentRestTrace({startTick:150,endTick:150,tick:150});
  assert.equal(vocal.rawPitchGrid(lane.pitches,lane.rawOctaves)[10],0,'silence never restores the removed observation');
});
test('unknown legacy timing is never guessed, and verified repairs load before engine creation', () => {
  const c=fixture({bpm:60}),engine=c.engine;
  const values=[...Array(6).fill(4700),3505,3500,...Array(6).fill(4700)];
  const stored=packed(c,{binTicks:15,points:values.map((p,i)=>[i,p,0])});
  c.engine=null;
  assert.equal(c.loadPitchTraceV3(stored),true);
  assert.equal(c.pitchTraceCount,values.length);
  assert.equal(c.pitchTraceLane(0).pitches[6],3505);
  stored.lanes[0].octaveRepairs=[[6,3505,4705],[7,3500,4700]];
  assert.equal(c.loadPitchTraceV3(stored),true);
  assert.equal(c.pitchTraceLane(0).pitches[6],4705);
  assert.equal(c.pitchTraceLane(0).rawOctaves.get(6).before,3505);
  c.engine=engine;
});
test('a newly captured trace may later be intentionally erased even if no trace existed at startup', () => {
  const c=fixture({bpm:60}),values=new Map();
  Object.assign(c,{pitchTraceLoaded:false,pitchTraceSaveTimer:0,pitchTraceKey:'trace',
    clearTimeout(){},pitchTraceFingerprint:()=> 'score',showToast(){throw new Error('unexpected error');},
    pitchTraceLaneList:()=>[...c.pitchTraceLanes],
    localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
  vm.runInContext(source('savePitchTraceNow'),c);
  c.replacePitchTraceWindows([{tick:15,startTick:15,endTick:15,stride:1,pitchCents:4705}]);
  c.savePitchTraceNow();
  assert.equal(c.pitchTraceLoaded,true);assert.ok(values.get('trace'));
  c.resetPitchTraceGrid();c.savePitchTraceNow();
  assert.equal(values.has('trace'),false);
});
test('live moving-onset repair matches the exact old m15 grid without filling dropouts', () => {
  const c=fixture({bpm:60});
  const values=[4592,4607,4630,4676,4645,null,4728,null,4722,3505,3500,
    4649,4545,4496,4492,4501,4528,4547,4557,4563,4558,4560];
  values.forEach((cents,i)=>{
    const frame={tick:i*15,startTick:i*15,endTick:i*15,stride:1,
      pitchSeconds:i/64,pitchCents:cents};
    if(cents!==null)c.replacePitchTraceWindows([frame]);
    c.repairLivePitchOctaves([frame]);
  });
  const lane=c.pitchTraceLane(0);
  assert.equal(lane.pitches[9],4705);assert.equal(lane.pitches[10],4700);
  assert.equal(lane.pitches[5],0);assert.equal(lane.pitches[7],0);
  assert.equal(c.pitchTraceCount,values.filter(Number.isFinite).length);
});
test('256th grid keeps exact binary subdivisions even below 64 PPQ', () => {
  for(const division of [24,48,100,480,960]) {
    const c=fixture({division});
    assert.equal(c.pitchTraceBinTicks(), division/64);
    assert.equal(c.pitchTraceBinCount(),1025);
    assert.equal(c.pitchTraceBinAtTick(division/4),16,'sixteenth has sixteen finest slots');
    assert.equal(c.pitchTraceBinAtTick(division/64*5.4,2),6,'coarse grid never changes its origin');
  }
});
test('resolution rounds duration UP to a power of two, respecting tempo and playback speed', () => {
  const c=fixture();
  const base=60000/84/64;
  assert.equal(c.pitchTraceStrideAt(0,10),1);
  assert.equal(c.pitchTraceStrideAt(0,base),1);
  assert.equal(c.pitchTraceStrideAt(0,base+.001),2);
  assert.equal(c.pitchTraceStrideAt(0,30),4);
  assert.equal(c.pitchTraceStrideAt(0,100),16);
  c.engine.tempoSegments.push({tick:960,bpm:126});
  assert.equal(c.pitchTraceStrideAt(959,10),1);
  assert.equal(c.pitchTraceStrideAt(960,10),2);
  c.engine.rate=.5;
  assert.equal(c.pitchTraceStrideAt(960,10),1);
  c.engine.rate=1.5;
  assert.equal(c.pitchTraceStrideAt(960,10),4);
  for(const hop of [10,11,15,32,66,100,300]) {
    const stride=c.pitchTraceStrideAt(960,hop);
    const ms=60000/126/1.5/64*stride;
    assert.equal(Math.log2(stride)%1,0);
    assert.ok(ms>=hop && (stride===1 || ms/2<hop));
  }
});
test('coarse captures store real readings only; silence and other lanes preserve old work', () => {
  const c=fixture();
  const frames=[1,5,9].map(bin=>({tick:bin*15,startTick:bin*15-1,endTick:bin*15+1,
    stride:4,pitchCents:6900,breakBefore:bin===1}));
  c.replacePitchTraceWindows(frames);
  const lane=c.pitchTraceLane(0);
  assert.deepEqual([...lane.pitches].flatMap((p,i)=>p?[i]:[]),[0,4,8]);
  assert.equal(c.pitchTraceCount,3);
  c.replacePitchTraceWindows([null,{tick:30,pitchCents:NaN}]);
  assert.equal(c.pitchTraceCount,3);
  c.pitchTraceLaneAt=()=>1;
  c.replacePitchTraceWindows([{...frames[0],pitchCents:6500}]);
  assert.equal(c.pitchTraceCount,4);
  assert.equal(lane.pitches[0],6900);
  c.pitchTraceLaneAt=()=>0;
  c.replacePitchTraceWindows([{...frames[0],pitchCents:6905}]);
  assert.equal(c.pitchTraceCount,4);
  assert.equal(lane.pitches[0],6905);
});
test('observed silence erases old rest points, but not neighboring notes or other lanes', () => {
  const c=fixture();
  c.pitchRestState=tick=>tick>=960&&tick<1920?'rest':'sing';
  c.playing=true; c.engine.playing=true; c.pitchCaptureEnabled=()=>true;
  const track={readyState:'live',enabled:true,muted:false};
  c.pitchCaptureStream={getAudioTracks:()=>[track]};
  c.pitchCaptureAnalyser={context:{state:'running'}};
  const lane=c.pitchTraceLane(0,{create:true}),other=c.pitchTraceLane(1,{create:true});
  for(let bin=63;bin<=129;bin++) {lane.pitches[bin]=5000;other.pitches[bin]=6000;c.pitchTraceCount+=2;}
  let paints=0,saves=0;
  c.queuePitchTracePaint=()=>paints++;c.schedulePitchTraceSave=()=>saves++;
  const frame={tick:1440,startTick:945,endTick:1935,stride:1};
  c.acceptPitchSample([0,0],{frame,seconds:1},1);
  assert.equal([...lane.pitches].filter(Boolean).length,3,'one beat clears including its start, not the next entrance');
  assert.ok(lane.pitches[63]&&lane.pitches[128]&&lane.pitches[129]);
  assert.equal([...other.pitches].filter(Boolean).length,67,'other divisi stays intact');
  assert.equal(c.pitchTraceCount,70);
  assert.equal(lane.breaks[128],1,'the surviving trace cannot bridge the erased passage');
  assert.equal(paints,1); assert.equal(saves,1,'erasure is painted and persisted');
  c.acceptPitchSample([0,0],{frame,seconds:2},1);
  assert.equal(paints,1,'unchanged silence does not repaint or resave');
});
test('pending pitch evidence, pause and missing microphone input cannot erase a rest', () => {
  const c=fixture();
  c.pitchRestState=()=> 'rest'; c.playing=true; c.engine.playing=true;c.pitchCaptureEnabled=()=>true;
  const track={readyState:'live',enabled:true,muted:false};
  c.pitchCaptureStream={getAudioTracks:()=>[track]};
  c.pitchCaptureAnalyser={context:{state:'running'}};
  const frame={tick:960,startTick:945,endTick:975,stride:1};
  c.replacePitchTraceWindows([{...frame,pitchCents:5000}]);
  c.acceptPitchSample([440,1],{frame,seconds:1},1);
  assert.equal(c.pitchTraceCount,1,'a pitch awaiting confirmation is not silence');
  for(const state of [{muted:true},{enabled:false},{readyState:'ended'}]) {
    Object.assign(track,{readyState:'live',enabled:true,muted:false},state);
    c.acceptPitchSample([0,0],{frame,seconds:2},1);
    assert.equal(c.pitchTraceCount,1);
  }
  Object.assign(track,{readyState:'live',enabled:true,muted:false});
  c.pitchCaptureAnalyser.context.state='suspended';
  c.acceptPitchSample([0,0],{frame,seconds:3},1);
  assert.equal(c.pitchTraceCount,1);
  c.pitchCaptureAnalyser.context.state='running'; c.playing=false;
  c.acceptPitchSample([0,0],{frame,seconds:4},1);
  assert.equal(c.pitchTraceCount,1);
  c.playing=true; c.pitchRestState=()=> 'sing';
  c.acceptPitchSample([0,0],{frame,seconds:5},1);
  assert.equal(c.pitchTraceCount,1,'a detection miss during a sung note preserves old work');
});
test('live octave islands revise only the recent trace after confirmation, without delaying samples', () => {
  for (const interruption of [null, 'silence', 'pause', 'gap']) {
    const c = fixture();
    c.playing = true; c.engine.playing = true; c.pitchCaptureEnabled = () => true;
    c.pitchCaptureStream = {getAudioTracks: () => [{readyState:'live', enabled:true, muted:false}]};
    c.pitchCaptureAnalyser = {context:{state:'running', sampleRate:48000}};
    // Also test that a false octave assigned to another divisi lane is removed.
    c.pitchTraceLaneAt = (_tick, cents) => cents > 6200 ? 1 : 0;
    const values = [...Array(10).fill(5700), ...Array(3).fill(6900), ...Array(10).fill(5700)];
    for (let i = 0; i < values.length; i++) {
      const frame = {tick:i*15, startTick:i*15-1, endTick:i*15+1, stride:1};
      if (i === 13 && interruption === 'silence') c.acceptPitchSample([0,0], {frame, seconds:.125}, 1);
      if (i === 13 && interruption === 'pause') c.beginPitchCapturePass();
      const seconds = i*.01 + (i >= 13 && interruption === 'gap' ? 1 : 0);
      c.acceptPitchSample([440*2**((values[i]-6900)/1200),1], {frame,seconds}, 1);
      if (i === 12) assert.equal(c.pitchTraceLane(1).pitches[12], 6900, 'new samples paint immediately');
    }
    const upper = c.pitchTraceLane(1), lower = c.pitchTraceLane(0);
    assert.equal([...upper.pitches].filter(Boolean).length, ['pause','gap'].includes(interruption) ? 3 : 0, interruption || 'bounded repair');
    if (!interruption) {
      assert.ok([10,11,12,13].every(i => lower.pitches[i] === 5700 && !lower.breaks[i]));
      assert.equal(c.pitchTraceCount, 23, 'repairs do not invent or duplicate observations');
    }
  }
});
test('live repairs the m4 dropout-edge spikes without painting the gap or reconnecting its strokes', () => {
  const c = fixture();
  c.playing = true; c.engine.playing = true; c.pitchCaptureEnabled = () => true;
  c.pitchCaptureStream = {getAudioTracks: () => [{readyState:'live',enabled:true,muted:false}]};
  c.pitchCaptureAnalyser = {context:{state:'running',sampleRate:48000}};
  const values = [...Array(10).fill(5700), 6900, 5700, ...Array(20).fill(null), 6900, 6900, ...Array(10).fill(5700)];
  const frameAt = i => ({tick:i*15,startTick:i*15-1,endTick:i*15+1,stride:1,pitchSeconds:i*.01});
  values.forEach((cents,i) => {
    const frame = {...frameAt(i),pitchCents:cents,breakBefore:i===32};
    if (cents === null) c.acceptPitchSample([0,0],{frame,seconds:i*.01},1);
    else {c.replacePitchTraceWindows([frame]); c.repairLivePitchOctaves([frame]);}
  });
  const lane = c.pitchTraceLane(0);
  assert.equal(c.pitchTraceCount,values.filter(Number.isFinite).length);
  assert.ok([10,32,33].every(i=>lane.pitches[i]===5700));
  assert.ok([...lane.pitches.slice(12,32)].every(p=>p===0));
  assert.equal(lane.breaks[32],1,'the corrected point after silence still begins a separate stroke');
});
test('delayed octave repair cannot resurrect a rest observation already erased by silence', () => {
  const c = fixture();
  const values = [...Array(10).fill(5700),6900,5700,...Array(20).fill(null),6900,6900,...Array(10).fill(5700)];
  values.forEach((cents,i)=>{
    const frame={tick:i*15,startTick:i*15-1,endTick:i*15+1,stride:1,pitchSeconds:i*.01,pitchCents:cents};
    if(cents!==null)c.replacePitchTraceWindows([frame]);
    if(i===12){c.pitchRestState=()=> 'rest';c.clearSilentRestTrace({startTick:150,endTick:150,tick:150});}
    c.repairLivePitchOctaves([frame]);
  });
  assert.equal(c.pitchTraceLane(0).pitches[10],0,'an erased point stays erased');
});
test('clearing a trace discards pending octave evidence so it cannot restore cleared points', () => {
  const c = fixture();
  const frames = Array.from({length:13}, (_,i) => ({tick:i*15,startTick:i*15-1,endTick:i*15+1,
    stride:1,pitchSeconds:i*.01,pitchCents:i<10?5700:6900}));
  c.replacePitchTraceWindows(frames); c.repairLivePitchOctaves(frames);
  assert.ok(c.pitchOctaveHistory.length);
  c.resetPitchTraceGrid();
  assert.equal(c.pitchOctaveHistory.length,0);
  const after = Array.from({length:6}, (_,j) => ({tick:(13+j)*15,startTick:(13+j)*15-1,endTick:(13+j)*15+1,
    stride:1,pitchSeconds:(13+j)*.01,pitchCents:5700}));
  c.replacePitchTraceWindows(after); c.repairLivePitchOctaves(after);
  assert.equal(c.pitchTraceCount,6);
  assert.equal(c.pitchTraceLane(0).pitches[12],0);
});
test('overlapping silent windows clear callback jitter, but never bridge an input gap or pending pitch', () => {
  for(const interruption of [null,'gap','pitch','mute','seek']) {
    const c=fixture();
    c.pitchRestState=()=> 'rest';c.playing=true;c.engine.playing=true;c.pitchCaptureEnabled=()=>true;
    const track={readyState:'live',enabled:true,muted:false};
    c.pitchCaptureStream={getAudioTracks:()=>[track]};
    c.pitchCaptureAnalyser={context:{state:'running',sampleRate:48000}};
    const lane=c.pitchTraceLane(0,{create:true});
    lane.pitches[65]=5000;lane.pitches[66]=5000;c.pitchTraceCount=2;
    c.acceptPitchSample([0,0],{frame:{tick:970,startTick:966,endTick:974},seconds:1},1);
    if(interruption==='pitch') c.acceptPitchSample([440,1],{frame:{tick:980,startTick:978,endTick:982},seconds:1.01},1);
    if(interruption==='mute') {
      track.muted=true;
      c.acceptPitchSample([0,0],{frame:{tick:980,startTick:978,endTick:982},seconds:1.01},1);
      track.muted=false;
    }
    if(interruption==='seek') c.beginPitchCapturePass();
    c.acceptPitchSample([0,0],{frame:{tick:1000,startTick:996,endTick:1004},seconds:interruption==='gap'?1.5:1.03},1);
    assert.equal(c.pitchTraceCount,interruption?2:0,interruption||'continuous silence fills observed callback gaps');
  }
});
test('old 64th contours migrate sparsely with independent lanes and stroke breaks intact', () => {
  const c=fixture();
  const saved=packed(c);
  saved.lanes.push(packed(c,{line:1,points:[[2,6500,1]]}).lanes[0]);
  assert.equal(c.loadPitchTraceV3(saved),true);
  assert.equal(c.pitchTraceCount,3);
  assert.deepEqual([...c.pitchTraceLanes.get(0).pitches].flatMap((p,i)=>p?[i]:[]),[4,12]);
  assert.equal(c.pitchTraceLanes.get(0).breaks[4],1);
  assert.equal(c.pitchTraceLanes.get(0).breaks[12],0);
  assert.equal(c.pitchTraceLanes.get(1).pitches[8],6500);
  assert.equal(c.pitchTraceLanes.get(1).breaks[8],1);
  const coarse=packed(c,{binTicks:Math.round(c.sequence.division/16)});
  assert.equal(c.loadPitchTraceV2({...coarse,...coarse.lanes[0]}),true);
  assert.equal(c.pitchTraceCount,2);
  assert.equal(c.pitchTraceLanes.size,1);
  // Previously rounded PPQ grids migrate too, without pretending to add data.
  const odd=fixture({division:100});
  assert.equal(odd.loadPitchTraceV3(packed(odd,{binTicks:6})),true);
  assert.equal(odd.pitchTraceCount,2);
  assert.equal(odd.pitchTraceLanes.get(0).pitches[4],6900);
});
test('new grid round-trips without changes; malformed later lanes are not partially adopted', () => {
  const c=fixture();
  const saved=packed(c,{binTicks:15});
  assert.equal(c.loadPitchTraceV3(saved),true);
  const original=c.pitchTraceLanes.get(0);
  assert.deepEqual([...original.pitches].flatMap((p,i)=>p?[i]:[]),[1,3]);
  const bad=packed(c);
  bad.lanes.push({line:1,pitches:'',breaks:''});
  assert.equal(c.loadPitchTraceV3(bad),false);
  assert.equal(c.pitchTraceLanes.get(0),original);
  assert.equal(c.pitchTraceCount,2);
  for(const invalid of [{binTicks:0},{binTicks:NaN},{length:999},{binTicks:7.5},
    {lanes:[saved.lanes[0],saved.lanes[0]]}]) {
    assert.equal(c.loadPitchTraceV3({...saved,...invalid}),false);
    assert.equal(c.pitchTraceLanes.get(0),original);
  }
});
test('capture skips unchanged audio, follows genuine cadence, and resets on seek', () => {
  const c=fixture({division:48});
  let analyses=0;
  const frames=[];
  const input={sampleRate:48000,currentTime:1,state:'running'};
  c.pitchCaptureEnabled=()=>true; c.playing=true; c.takeReview=null;
  Object.assign(c.engine,{playing:true,context:{currentTime:1},duration:30,
    currentSeconds:()=>input.currentTime, tickAtSeconds:s=>s*48*84/60});
  c.pitchCaptureAnalyser={context:input,getFloatTimeDomainData:()=>{analyses++;}};
  c.pitchCaptureWorker={invalidate(){},submit(_input,_options,metadata){c.acceptPitchSample([440,1],metadata,1);}};
  c.pitchCaptureBuffer=new Float32Array(4096);
  c.pitchCaptureStream={getAudioTracks:()=>[{readyState:'live',enabled:true,muted:false}]};
  c.evaluatePitchEvidence=(_f,_q,_s,frame)=>{frames.push(frame); return {accepted:false};};
  c.capturePitchSample(); c.capturePitchSample();
  assert.equal(analyses,1,'a repeated FFT buffer is not a new observation');
  input.currentTime+=.001; c.capturePitchSample();
  assert.equal(analyses,1,'wait for at least a new audio render quantum');
  input.currentTime+=.009; c.capturePitchSample();
  assert.equal(analyses,2);
  assert.equal(frames[1].stride,1);
  assert.notEqual(frames[1].tick%1,0,'do not round away sub-tick precision');
  for(let i=0;i<15;i++) {input.currentTime+=.04; c.capturePitchSample();}
  assert.equal(frames.at(-1).stride,4,'slower delivered callbacks coarsen the grid');
  c.engine.currentSeconds=()=>.1;
  input.currentTime+=.01; c.capturePitchSample();
  assert.equal(frames.at(-1).stride,1,'seek starts a fresh capture pass');
  assert.equal(c.pitchCaptureCadenceMs,10);
});
test('sampling backs off under real processing load and gradually recovers', () => {
  const c=fixture();
  let cost=1,time=0,scheduled;
  c.playing=true; c.pitchCaptureEnabled=()=>true;
  c.performance={now:()=>time};
  c.capturePitchSample=()=>{time+=cost;};
  c.window={setTimeout:(_callback,ms)=>{scheduled=ms;return 42;}};
  c.runPitchSampling();
  assert.equal(c.pitchCaptureIntervalMs,10);
  assert.equal(scheduled,9);
  cost=30; c.runPitchSampling();
  assert.equal(c.pitchCaptureIntervalMs,60);
  assert.equal(scheduled,30);
  cost=100; c.runPitchSampling();
  assert.equal(c.pitchCaptureIntervalMs,100);
  assert.equal(scheduled,4,'do not spin without yielding under overload');
  cost=1;
  for(let i=0;i<30;i++)c.runPitchSampling();
  assert.equal(c.pitchCaptureIntervalMs,10);
});
