const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'template/app.js'), 'utf8');
const guide = app.slice(app.indexOf('  class GuideEngine {'), app.indexOf('  function createSvgElement('));
const plain = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

class Param {
  value = 1;
  events = [];
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exp', value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setTargetAtTime(value, time, constant) { this.events.push(['target', value, time, constant]); }
}
class Node {
  frequency = new Param(); detune = new Param(); gain = new Param(); Q = new Param();
  starts = []; stops = [];
  connect(destination) { return destination; }
  setPeriodicWave() {}
  addEventListener() {}
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
}
class Audio {
  currentTime = 10;
  state = 'running';
  nodes = [];
  create(kind) { const node = new Node(); node.kind = kind; this.nodes.push(node); return node; }
  createOscillator() { return this.create('oscillator'); }
  createGain() { return this.create('gain'); }
  createBiquadFilter() { return this.create('filter'); }
}
const data = {
  division:960, endTick:3840, tempos:[[0,60]], measures:[[0,3840,4,4]], parts:[{}],
  notes:[[0,0,960,60,60],[0,960,1920,62,85],[0,1920,2880,64,80],[0,2880,3840,65,80]],
  legato:[[0,1,2]],
};
function engine(sequence = data, config = {}) {
  const c = vm.createContext({config, parts:sequence.parts, clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),
    savedOutput:()=>'',window: {clearInterval() {}, setInterval() { return 1; }, MeleteStation:{requested:()=>config.station===true}, MeleteRecording: require('../template/loop_recorder.js')},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance: {now: () => 1000},
    SCHEDULER_INTERVAL_MS:40, SCHEDULER_LEAD_SECONDS:.028, SCHEDULER_HORIZON_SECONDS:.34,
    showToast: message => assert.fail(message)});
  vm.runInContext(guide + '\nglobalThis.Engine = GuideEngine;', c);
  const e = new c.Engine(sequence);
  e.context = new Audio(); e.master = new Node(); e.wave = {};
  return e;
}

test('lead-in is seekable without a count-in mode and metronome clicks never sweep in pitch', () => {
  for(const beats of [3,4]) {
    const e=engine(data,{recordingCountInBeats:beats});
    assert.equal(e.leadInTicks,-beats*960);
    assert.deepEqual(plain(e.clicks.filter(c=>c.time<0).map(c=>c.time)),Array.from({length:beats},(_,i)=>i-beats));
    e.seek(-beats-.5);
    assert.equal(e.currentSeconds(),-beats);
    e.metronomeVolume=1;
    for(const downbeat of [false,true]) {
      e.scheduleClick({time:-beats,downbeat},-beats,.028);
      const oscillator=e.context.nodes.at(-2),envelope=e.context.nodes.at(-1);
      assert.equal(oscillator.type,'triangle');
      assert.equal(oscillator.frequency.value,downbeat?1320:880);
      assert.deepEqual(oscillator.frequency.events,[],'fixed pitch, not a chirp');
      near(oscillator.stops[0]-oscillator.starts[0],.05);
      assert.equal(envelope.gain.events[1][1],.16);
    }
  }
});

test('configured grouping sounds a high click on each group without changing quarter timing',()=>{
  const e=engine({...data,measures:[[0,6720,7,4],[6720,5760,6,4],[12480,8640,9,4],[21120,2880,3,4]]},
    {beatGroups:{"7/4":[3,4],"6/4":[3,3],"9/4":[3,3,3]}});
  e.metronomeVolume=1;
  const clicks=e.clicks.filter(c=>c.tick>=0);
  assert.deepEqual(plain(clicks.map(c=>c.tick/960)),Array.from({length:25},(_,i)=>i));
  for(const c of clicks) e.scheduleClick(c,c.time,.028);
  assert.deepEqual(e.context.nodes.filter(n=>n.kind==='oscillator').map(n=>n.frequency.value),
    [...'HllHlllHllHllHllHllHllHll'].map(k=>k==='H'?1320:880));
  const truncated=e.buildMetronomeEvents([[0,1920,7,4]]).filter(c=>c.tick>=0);
  assert.deepEqual(plain(truncated.map(c=>c.tick)),[0,960]);
});

test('count-in and barline clicks are booked once on the transport clock, before slow record listeners', async()=>{
  for(const beats of [3,4])for(const at of [-beats,0,4.001,4.24]){
    const e=engine({...data,endTick:7680,measures:[[0,3840,4,4],[3840,3840,4,4]]},{recordingCountInBeats:beats});
    e.metronomeVolume=1;e.seek(at);
    const clicks=()=>e.context.nodes.filter(n=>n.type==='triangle');
    e.onTransportChange=kind=>{if(kind==='play')e.context.currentTime+=.085;};
    await e.play();e.update();e.update();
    if(at===4.24)assert.equal(clicks().length,0,'a mid-beat start waits for the next real beat');
    else {
      assert.equal(clicks().length,1,`exactly one opening pulse at ${at}`);
      assert.equal(clicks()[0].frequency.value,1320);
      near(clicks()[0].starts[0],10);
    }
    e.pause();
    if(clicks().length)assert.equal(clicks()[0].stops.length,1,'an already-started click keeps its natural release');
  }
  const e=engine({...data,endTick:7680,measures:[[0,3840,4,4],[3840,3840,4,4]]});
  e.loopStartSeconds=1;e.loopEndSeconds=4;e.basePosition=1;e.metronomeVolume=1;
  await e.play();
  e.context.currentTime=12.89;e.update();
  assert.equal(e.context.nodes.filter(n=>n.type==='triangle' && n.starts[0]>=13).length,0,'no click beyond exclusive loop end');
  e.onTransportChange=kind=>{if(kind==='loop')e.context.currentTime+=.09;};
  e.context.currentTime=13;e.update();e.update();
  assert.equal(e.context.nodes.filter(n=>n.type==='triangle' && n.starts[0]===13).length,1);
  e.metronomeVolume=0;e.seek(4);
  assert.equal(e.scheduledClicks.size,0,'muted metronome stays silent');
  e.metronomeVolume=1;e.seek(2.8);
  const pending=e.context.nodes.filter(n=>n.type==='triangle').at(-1);
  assert.ok(pending.starts[0]>e.context.currentTime);
  e.pause();assert.equal(pending.stops.length,2,'a queued click cannot leak through a pause');
});

test('MusicXML slurs survive MIDI extraction, including ties and independent divisi', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'melete-slurs-'));
  try {
    const playback = path.join(directory, 'playback.json'), metadata = path.join(directory, 'metadata.json');
    execFileSync(process.execPath, [path.join(root, 'extract_score.mjs'),
      '--score',path.join(__dirname,'fixtures/slurs.musicxml'),'--playback',playback,'--metadata',metadata]);
    const p = JSON.parse(fs.readFileSync(playback)), m = JSON.parse(fs.readFileSync(metadata));
    const chains = p.legato.map(chain=>chain.map(index=>p.notes[index]));
    assert.deepEqual(chains.map(chain=>chain.map(n=>n[3])), [[60,62,64],[62,64],[60,62],[64,65],[60,60]]);
    assert.equal(chains[0][1][2] - chains[0][1][1], 1920, 'tie remains one sustained event');
    assert.equal(chains[1][0][1], 5760, 'rest breaks the phrase');
    assert.ok(chains.flat().every(n=>n[3]>=60), 'unslurred second voice remains separate');
    assert.equal(m.counts.legato, 5);
    assert.deepEqual(m.warnings, []);
  } finally { fs.rmSync(directory, {recursive:true,force:true}); }
});

test('joining slurs preserves every note, and rejects malformed or disconnected chains', () => {
  const e = engine();
  assert.equal(e.notes.length, 2);
  assert.equal(e.notes[0].segments.length, 3);
  assert.deepEqual(plain(e.notes.flatMap(n=>n.segments||[n]).map(n=>n.key)), [60,62,64,65]);
  for (const legato of [[[0,0]], [[0,9]], [[0,2]], [[2,1]], [[0,1],[0,1]]]) {
    const notes = engine({...data,legato}).notes.flatMap(n=>n.segments||[n]);
    assert.equal(notes.length, 4, JSON.stringify(legato));
  }
  const e2 = engine({...data,notes:[[0,0,960,60,60],[1,960,1920,62,85]],legato:[[0,1]]});
  assert.ok(e2.notes.every(n=>!n.segments), 'never connect different singers');
});

test('canceling from a play listener cannot schedule a slur or leave an idle transport timer', async () => {
  const e = engine();
  e.basePosition = 1;
  e.onTransportChange = kind => { if (kind === 'play') e.pauseTransport(); };
  await e.play();
  assert.equal(e.playing, false);
  assert.equal(e.timer, 0);
  assert.equal(e.scheduled.size, 0);
});

for (const rate of [.5,1,1.5,2]) test(`one continuous oscillator with 3 ms on-time glides at ${rate}x`, () => {
  const e = engine(); e.rate = rate;
  e.scheduleNote(e.notes[0], 0, .028);
  assert.equal(e.scheduled.size, 1);
  assert.equal(e.context.nodes.filter(n=>n.kind==='oscillator').length, 2, 'one carrier plus vibrato for whole phrase');
  const voice = [...e.scheduled][0];
  const changes = voice.oscillator.frequency.events.filter(event=>event[0]==='exp');
  assert.equal(changes.length, 2);
  for (const [i,change] of changes.entries()) {
    near(change[2], 10+(i+1)/rate);
    near(change[1], 440 * 2 ** ((data.notes[i+1][3]-69)/12));
    const anchor = voice.oscillator.frequency.events.find(event=>event[0]==='set' && Math.abs(event[2]-(change[2]-.003))<1e-9);
    assert.ok(anchor, 'glide duration is 3 ms, not scaled with practice speed');
  }
  assert.equal(voice.envelope.gain.events.filter(e=>e[0]==='set'&&e[1]===.0001).length, 1);
  assert.equal(voice.envelope.gain.events.filter(e=>e[0]==='exp').length, 2, 'one attack and one release');
  assert.ok(voice.envelope.gain.events.filter(e=>e[0]==='linear').every(e=>e[1]>.01), 'dynamics stay above zero between notes');
  near(voice.oscillator.stops[0], 10+3/rate+.01);
});

test('written tempo changes position the glide at the performed onset', () => {
  const e = engine({...data,tempos:[[0,60],[960,120]]});
  e.scheduleNote(e.notes[0], 0, .028);
  assert.deepEqual(plain([...e.scheduled][0].oscillator.frequency.events.filter(e=>e[0]==='exp').map(e=>e[2])), [11,11.5]);
});

test('seeking to every slurred onset sounds that note exactly once, never its predecessor', () => {
  for (const position of [0,1,2,2.0000001]) for (const carryHeldNotes of [false,true]) {
    const e = engine(); e.playing = true; e.basePosition = position; e.anchorTime = 10;
    e.resetScheduler(.028, {carryHeldNotes});
    assert.equal(e.scheduled.size,1);
    near([...e.scheduled][0].oscillator.frequency.events[0][1],440*2**((data.notes[Math.floor(position)][3]-69)/12));
    e.scheduleAhead();
    assert.equal(e.scheduled.size,1,'next scheduler pass cannot restart the phrase');
  }
});

test('loop ends clip the phrase and omit later glides; restart sounds the new first note', () => {
  const e = engine(); e.loopStartSeconds = 1; e.loopEndSeconds = 1.5;
  e.scheduleNote(e.notes[0], 1, .028);
  const voice = [...e.scheduled][0];
  near(voice.oscillator.frequency.events[0][1],440*2**((62-69)/12));
  assert.equal(voice.oscillator.frequency.events.filter(e=>e[0]==='exp').length,0);
  near(voice.oscillator.stops[0],10.51);
});

test('separate syllables still articulate separately without changing held-note start policy', () => {
  const e = engine({...data,legato:[]});
  assert.equal(e.notes.length,4);
  e.playing=true; e.basePosition=.5; e.anchorTime=10;
  e.resetScheduler();
  assert.equal(e.scheduled.size,0);
  e.resetScheduler(.028,{carryHeldNotes:true});
  assert.equal(e.scheduled.size,1);
  const station=engine({...data,legato:[]},{station:true});
  station.playing=true;station.basePosition=.5;station.anchorTime=10;station.resetScheduler();
  assert.equal(station.scheduled.size,1,'an ordinary held note at the rehearsal cursor sounds without recording');
  station.scheduleAhead();assert.equal(station.scheduled.size,1,'no duplicate attack');
});

test('shared transport waits for slow audio activation without consuming the first note', async () => {
  const e = engine();
  let wake, calls = 0, playback;
  const pending = new Promise(resolve => { wake = resolve; });
  e.context.state = 'suspended';
  e.context.resume = async () => { calls++; await pending; e.context.state = 'running'; };
  let starts = 0;
  e.api = {play() { starts++; playback = e.play(); }, pause() {}};
  const starting = e.startTransport();
  assert.equal(calls, 1);
  assert.equal(starts, 0);
  e.context.currentTime += 4;
  assert.equal(e.currentSeconds(), 0);
  assert.equal(e.scheduled.size, 0);
  wake(); await starting; await playback;
  assert.equal(starts, 1);
  assert.equal(e.scheduled.size, 1);
  near([...e.scheduled][0].oscillator.starts[0], 14);
  e.pauseTransport();
});

test('canceling cold startup cannot start playback after audio finally wakes', async () => {
  const e = engine();
  let wake, starts = 0;
  const pending = new Promise(resolve => { wake = resolve; });
  e.context.state = 'suspended';
  e.context.resume = async () => { await pending; e.context.state = 'running'; };
  e.api = {play() { starts++; }, pause() {}};
  const starting = e.startTransport();
  e.pauseTransport(); wake(); await starting;
  assert.equal(starts, 0);
  assert.equal(e.playing, false);
  assert.equal(e.scheduled.size, 0);
});

test('a first recording entrance can precede or follow the loop start; repeats return to the downbeat', async () => {
  for (const entry of [.5, 1.5]) {
    const e = engine();
    e.loopStartSeconds = 1; e.loopEndSeconds = 3;
    e.basePosition = entry;
    let playback;
    const transitions = [];
    e.onTransportChange = kind => transitions.push([kind, e.basePosition]);
    e.api = {play() { playback = e.play(); }, pause() {}};
    await e.startTransport({allowLoopLeadIn: entry < 1});
    await playback;
    assert.equal(e.basePosition, entry);
    assert.equal(e.allowLoopLeadIn, false, 'lead-in is one-shot, never a permanent playback mode');
    e.context.currentTime += 1;
    e.update();
    e.context.currentTime += 3 - entry;
    e.update();
    assert.equal(e.basePosition, 1);
    assert.deepEqual(transitions, [['play', entry], ['loop', 1]]);
    assert.equal(e.loopStartSeconds, 1);
    assert.equal(e.loopEndSeconds, 3);
    e.pauseTransport();
    e.seek(.5);
    await e.startTransport(); await playback;
    assert.equal(e.basePosition, 1, 'ordinary playback still starts inside the loop');
    e.pauseTransport();
  }
});

test('canceling a pending pickup start cannot leak the lead-in exception into later playback', async () => {
  const e = engine();
  e.loopStartSeconds = 1; e.loopEndSeconds = 3; e.basePosition = .5;
  let wake, playback, starts = 0;
  e.context.state = 'suspended';
  e.context.resume = async () => { await new Promise(resolve => { wake = resolve; }); e.context.state = 'running'; };
  e.api = {play() { starts++; playback = e.play(); }, pause() {}};
  const starting = e.startTransport({allowLoopLeadIn: true});
  e.pauseTransport(); wake(); await starting;
  assert.equal(starts, 0);
  assert.equal(e.allowLoopLeadIn, false);
  await e.startTransport(); await playback;
  assert.equal(e.basePosition, 1);
  e.pauseTransport();
});

test('recording lead-in carries held harmony and runs continuously into the entrance', async () => {
  const e = engine({...data, legato: []});
  e.loopStartSeconds = 1; e.loopEndSeconds = 3;
  let playback;
  e.api = {play() { playback = e.play(); }, pause() {}};
  await e.startTransport({allowLoopLeadIn: true, recordingLeadIn: .5}); await playback;
  assert.equal(e.basePosition, .5);
  assert.equal(e.scheduled.size, 1, 'the note already held at the count-in start must sound');
  const anchor = e.anchorTime;
  e.context.currentTime += .5; e.update();
  assert.equal(e.currentSeconds(), 1);
  assert.equal(e.anchorTime, anchor, 'no transport restart at the entry');
  assert.equal(e.recordingLeadIn, null);
  e.pauseTransport();
});

test('explicit recording starts preserve fractional positions before, inside, and after a loop', async () => {
  for (const position of [.37,1.25,3.25]) {
    const e=engine();
    e.loopStartSeconds=1;e.loopEndSeconds=3;
    let playback;
    const transitions=[];
    e.onTransportChange=kind=>transitions.push(kind);
    e.api={play(){playback=e.play();},pause(){}};
    await e.startTransport({allowLoopLeadIn:true,recordingLeadIn:position});await playback;
    assert.equal(e.basePosition,position);
    assert.equal(e.loopArmed,position>=1&&position<3);
    if(position>3){
      assert.equal(e.scheduled.size,1,'the accompaniment after the loop remains audible');
      near([...e.scheduled][0].oscillator.stops[0],e.context.currentTime+4-position+.01);
      e.context.currentTime+=.55;e.update();
      assert.equal(e.nextNoteIndex,e.notes.length,'the final written note is scheduled');
      assert.deepEqual(transitions,['play'],'a post-loop recording never wraps backward');
    } else if(position<1) {
      assert.equal(e.playbackEndSeconds(),3,'manual preparation still obeys the upcoming loop end');
    } else {
      e.context.currentTime+=.2;e.update();
      assert.ok(Math.abs(e.currentSeconds()-(position+.2))<1e-9);
    }
    e.pauseTransport();
  }
});

test('a selected take uses song end after the loop, not a stale loop cutoff', () => {
  const e=engine();
  e.loopStartSeconds=1;e.loopEndSeconds=3;e.basePosition=3.25;e.loopArmed=false;
  e.takeReview={start:0,end:4,rate:1,latency:0,buffer:{duration:4}};
  const window=e.takeReviewWindow();
  assert.ok(window && window.from===3.25 && window.until===4);
});

test('counting before score zero cannot play the opening notes early', async () => {
  const e = engine();
  e.loopStartSeconds = 0; e.loopEndSeconds = 3;
  let playback;
  e.api = {play() { playback = e.play(); }, pause() {}};
  await e.startTransport({allowLoopLeadIn: true, recordingLeadIn: -2}); await playback;
  assert.equal(e.currentSeconds(), -2);
  assert.equal(e.presentationSeconds(), -2);
  assert.equal(e.scheduled.size, 0);
  e.context.currentTime += 1.8; e.update();
  const starts = [...e.scheduled].map(voice => voice.oscillator.starts[0]);
  assert.deepEqual(starts, [12], 'opening note is scheduled exactly two seconds after preparation begins');
  e.context.currentTime = 12; e.update();
  assert.equal(e.currentSeconds(), 0);
  e.pauseTransport();
});

test('every generic onset survives seek rounding at multiple rates, paused or running', async () => {
  for (const legato of [data.legato, []]) for (const rate of [.5,1,1.5]) {
    for (const running of [false,true]) for (const onset of [0,1,2,3]) for (const drift of [0,.0000005]) {
      const e = engine({...data, legato}); e.rate = rate;
      if (running) await e.play();
      e.seek(onset + drift);
      if (!running) await e.play();
      assert.equal(e.scheduled.size, 1, `${rate}x, onset ${onset}, drift ${drift}, running ${running}`);
      near([...e.scheduled][0].oscillator.frequency.events[0][1], 440*2**((data.notes[onset][3]-69)/12));
      e.scheduleAhead();
      assert.equal(e.scheduled.size, 1, 'no duplicate after the next scheduler pass');
      e.pause();
    }
  }
});
