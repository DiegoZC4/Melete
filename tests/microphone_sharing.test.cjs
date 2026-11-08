const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
function source(name) {
  const start = app.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}
function fixture() {
  let requests = 0, resolveRequest;
  const constraints = [], notices = [], stops = [], listeners = new Map(), stored = new Map();
  const track = {enabled: false, readyState: 'live', label: 'Test USB mic',
    addEventListener(name, handler) { listeners.set(name, handler); }, stop() { this.readyState = 'ended'; }};
  const stream = {getAudioTracks: () => [track]};
  const audio = {state: 'suspended', addEventListener() {},
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; },
    createAnalyser: () => ({}), createMediaStreamSource: () => ({connect() {}, disconnect() {}})};
  const c = vm.createContext({
    ready:true, conductorMode: false, pitchCaptureState: 'off', takeState: 'off', microphoneRequest: null,
    wantsPitchCapture: false, recordAudio:false, preparingCapture:null, pitchCapturePageActive: true, pitchCaptureNotice: '',
    microphoneDeviceId: '', microphoneStreamDeviceId: '', microphoneCheck: null,
    pitchCaptureContext: null, pitchCaptureStream: null, pitchCaptureSource: null,
    pitchCaptureAnalyser: null, pitchCaptureWorker: null, pitchCaptureBuffer: null, playing: false,
    PITCH_CAPTURE_BUFFER_SIZE: 4096, Float32Array, console,
    navigator: {mediaDevices: {getUserMedia(options) {
      requests++; constraints.push(options); return new Promise(resolve => { resolveRequest = resolve; });
    }}}, document: {hidden: false}, localStorage: {getItem: key => stored.get(key) || null},
    elements: {takeMicrophone: {}},
    engine: {playing: false, context: {async resume() {}, addEventListener() {}}, ensureAudio() {}},
    window: {AudioContext: function() { return audio; }},
    savePreferences() { stored.set('sing', c.wantsPitchCapture); }, updatePitchCaptureAppearance() {},
    showToast(message) { notices.push(message); }, stopPitchSampling() {},
    ensurePitchWorker(){},startPitchSampling(){},beginPitchCapturePass(){},
    startTakeRecording() { stops.push('start'); c.takeState = 'requesting'; return Promise.resolve(); },
    stopTakeRecording(message) { stops.push(message); c.takeState = 'off'; return Promise.resolve(); },
  });
  c.window.navigator = c.navigator;
  c.window.MeleteMicrophoneCheck = require('../template/microphone_check.js');
  for (const name of ['readMicrophoneChoice', 'refreshMicrophoneChoices', 'releaseMicrophoneInput',
    'microphoneFailureMessage', 'syncMicrophoneActivity', 'ensureMicrophoneInput', 'disablePitchCapture',
    'restorePitchCapture', 'armMicrophone','activateCachedPitchCapture','togglePitchCapture']) vm.runInContext(source(name), c);
  return {c, track, audio, constraints, notices, stops, stored, listeners,
    requests: () => requests, permit: (input = stream) => resolveRequest(input)};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Sing meters input while paused without recording or requiring Google login', async () => {
  const f = fixture(); f.c.togglePitchCapture();
  assert.equal(f.stored.get('sing'), true); assert.equal(f.requests(), 1);
  f.permit();await tick();
  assert.equal(f.c.takeState, 'off'); f.c.restorePitchCapture();
  assert.equal(f.requests(), 1, 'restoration reuses the live input');
  f.c.togglePitchCapture(); assert.equal(f.stored.get('sing'), false);
});
test('enabling Sing during playback primes the mic only; disabling finalizes and releases input', async () => {
  const f = fixture(); f.c.engine.playing = true; f.c.togglePitchCapture();
  assert.deepEqual(f.stops, []);
  const pending = f.c.ensureMicrophoneInput(); await tick(); f.permit(); await pending;
  assert.equal(f.track.enabled, true);
  f.c.pitchCaptureState = 'recording'; f.c.takeState = 'recording'; f.c.togglePitchCapture();
  assert.equal(f.stops.length, 1); assert.equal(f.track.readyState, 'ended');
  assert.equal(f.stored.get('sing'), false);
});
test('mic check and capture share one raw selected input request', async () => {
  const f = fixture(); f.stored.set('choir-practice:microphone:v1', 'chosen-device');
  f.c.takeState = 'requesting';
  const a = f.c.ensureMicrophoneInput(), b = f.c.ensureMicrophoneInput();
  await tick(); assert.equal(f.requests(), 1); f.permit(); await a; await b;
  assert.equal(f.constraints[0].audio.deviceId.exact, 'chosen-device');
  for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) assert.equal(f.constraints[0].audio[key].ideal, false);
  assert.notEqual(f.c.pitchCaptureContext, f.c.engine.context); assert.equal(f.track.enabled, true);
});
test('Sing re-enabled during a save waits for the next Play even after the flush', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(); let finish;
    f.c.engine.playing = true; f.c.takeState = 'stopping';
    f.c.takeStopPromise = new Promise(resolve => { finish = resolve; });
    f.c.togglePitchCapture();
    assert.deepEqual(f.stops, [], 'wait for the previous segment to finish saving');
    if (cancel) f.c.togglePitchCapture();
    f.c.takeState = 'off'; finish(); await tick();
    assert.deepEqual(f.stops, []);
  }
});
test('late input after cancellation is released rather than silently listening', async () => {
  const f = fixture(); f.c.takeState = 'requesting';
  const pending = f.c.ensureMicrophoneInput(); await tick();
  f.c.disablePitchCapture(false); f.permit(); await pending;
  assert.equal(f.c.pitchCaptureStream, null); assert.equal(f.track.readyState, 'ended');
});
test('canceling Play during station preparation cannot start an old pass after a singer rearms', async () => {
  for(const cancel of ['space','handoff']) {
    let finish, pauses=0;
    const c=vm.createContext({recordAudio:true,preparingCapture:null,takeState:'off',wantsPitchCapture:true,
      pitchCapturePageActive:true,document:{hidden:false},engine:{playing:false,transportRequest:0,pauseTransport(){pauses++;}},
      compPanel:{prepareStation:()=>new Promise(ok=>finish=ok)},updatePitchCaptureAppearance(){}});
    for(const name of ['startTakeRecording','stopTakeRecording','togglePracticePlayback']) vm.runInContext(source(name),c);
    const started=c.startTakeRecording();assert.ok(c.preparingCapture);
    if(cancel==='space'){c.togglePracticePlayback();assert.equal(pauses,1);assert.equal(c.recordAudio,true);}
    else {await c.stopTakeRecording('',true);assert.equal(c.recordAudio,false);c.recordAudio=true;}
    finish();await started;assert.equal(c.preparingCapture,null);assert.equal(c.takeState,'off');
  }
});
test('a hidden collection frame stays off the microphone until it is shown', () => {
  const f = fixture(), frame = {inert: true, hasAttribute: () => false}, page = {};
  f.c.wantsPitchCapture = true; f.c.referencePlayer = null; f.c.window.frameElement = frame;
  f.c.window.addEventListener = (name, handler) => { page[name] = handler; };
  const listener = app.indexOf('  window.addEventListener("pageshow"');
  vm.runInContext(app.slice(listener, app.indexOf('\n  });', listener) + 6), f.c);
  const initial = app.match(/let pitchCapturePageActive = (.+);/)[1];
  f.c.pitchCapturePageActive = vm.runInContext(initial, f.c);
  assert.equal(f.c.pitchCapturePageActive, false, 'a preloaded frame starts inactive');
  f.c.restorePitchCapture(); // What returning to the tab does.
  page.pageshow(); // Also fires inside the frame, once its score is ready.
  assert.equal(f.c.pitchCapturePageActive, false);
  assert.equal(f.requests(), 0);
  frame.inert = false; page.pageshow();
  assert.equal(f.c.pitchCapturePageActive, true);
  assert.equal(f.requests(), 1, 'the shown song still restores Sing');
  f.c.window.frameElement = null;
  assert.equal(vm.runInContext(initial, f.c), true, 'a standalone page starts active');
});
test('closing a mic check cannot stop the active combined capture', async () => {
  const f = fixture(); f.c.microphoneCheck = {active: true, syncSelector() {}};
  const pending = f.c.ensureMicrophoneInput(); await tick(); f.permit(); await pending;
  f.c.microphoneCheck.active = false; f.c.takeState = 'recording'; f.c.syncMicrophoneActivity();
  assert.equal(f.track.enabled, true); assert.equal(f.track.readyState, 'live');
  f.c.takeState = 'off'; f.c.syncMicrophoneActivity();
  assert.equal(f.track.readyState, 'ended'); assert.equal(f.audio.state, 'suspended');
});
test('device disconnection names the input, stops capture and preserves opt-in', async () => {
  const f = fixture(); f.c.wantsPitchCapture = true; f.c.takeState = 'requesting';
  const pending = f.c.ensureMicrophoneInput(); await tick(); f.permit(); await pending;
  f.c.takeState = 'recording'; f.c.pitchCaptureState = 'recording'; f.listeners.get('ended')();
  assert.match(f.notices.at(-1), /Test USB mic/);
  assert.equal(f.c.pitchCaptureStream, null); assert.equal(f.c.takeState, 'off');
  assert.equal(f.stored.get('sing'), true);
});
test('input errors distinguish permissions, missing hardware and missing audio', () => {
  const {c} = fixture();
  assert.match(c.microphoneFailureMessage({name:'NotAllowedError'}), /Allow access in browser settings/);
  assert.match(c.microphoneFailureMessage({name:'NotFoundError'}), /Choose another input/);
  assert.match(c.microphoneFailureMessage({message:'No microphone samples arrived'}), /No microphone audio/);
});
test('manual segment stop clips the immutable reference and shuts down tracing', async () => {
  for (const ref of [null,{seconds:10,start:42,end:50,captureStart:40,leadInSeconds:2,
    notes:[[2,4,[60]],[4,6,[62]]],chapters:[{measure:2,seconds:2},{measure:3,seconds:4}]}]) {
    let metadata, stopped = false;
    const before = JSON.stringify(ref);
    const c = vm.createContext({wantsPitchCapture:false,recordAudio:true,captureIsAudio:true,practiceWriter:null,takeState:'recording',takeStopPromise:null,takeRequestGeneration:0,
      takeCountIn:null,takeCountHideTimer:0,takeRefreshTimer:0,takeNotice:'',pendingCaptureTrace:null,
      pitchCaptureContext:{currentTime:3.2,sampleRate:100},
      takeCapture:{async stop(){}},takeJournal:{async flush(){},finish(frame,{segment}){
        metadata=segment({start:40,end:50,rate:1,label:'2-5',pitchReference:ref},frame/100);
      }}, window:{clearTimeout(){},clearInterval(){},MeleteTakePitch:require('../template/take_pitch.js')},elements:{takeCountIn:{}},
      engine:{secondsAtTick:t=>t,tickAtSeconds:s=>s,pauseTransport(){}},
      scoreLocationAtTick:String,renderTakePanel(){},scoreNextTake(){},stopPitchSampling(){},updatePitchCaptureAppearance(){},resetPitchTraceGrid(){},refreshTakePitchTrace(){},renderPitchTrace(){},
      disablePitchCapture(announce, options) { stopped = options.preservePreference; },
    });
    vm.runInContext(source('stopTakeRecording'),c); await c.stopTakeRecording('Stopped',true);
    assert.equal(c.takeState,'off'); assert.equal(stopped,true);
    assert.equal(metadata.end,43.2); assert.equal(JSON.stringify(ref),before);
    if(ref) assert.deepEqual(JSON.parse(JSON.stringify(metadata.pitchReference.notes)),[[2,3.2,[60]]]);
    else assert.equal(metadata.pitchReference,null);
  }
});
