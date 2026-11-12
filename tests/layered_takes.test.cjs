const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../template/app.js'), 'utf8');

test('independent take layers survive focus changes and release every source on pause/removal', () => {
  const start = app.indexOf('    setTakeReview(review) {');
  const end = app.indexOf('    stopVoices(', start);
  let serial = 0;
  const removed = [];
  const c = vm.createContext({URL: {createObjectURL: () => String(++serial), revokeObjectURL: id => removed.push(id)},
    Audio: class {load() {} removeAttribute() {}},
    window: {MeleteRecording: {takePlaybackGain: () => 1}, MeleteTakeMix:{bus:()=>({input:{}})}},
    takeReverbControl:{value:()=>0},takeVolumeControl:{value:()=>100},takeOctave: () => 0, SCHEDULER_LEAD_SECONDS: .03});
  const LayerEngine = vm.runInContext(`(class {${app.slice(start, end)}})`, c);
  const engine = new LayerEngine();
  engine.balanceTakeLayers = () => {}; // Audio normalization is tested with real Web Audio separately.
  Object.assign(engine, {context: {createGain: () => ({gain: {}, connect() {}, disconnect() {}}),
    createMediaElementSource: () => ({connect() {}, disconnect() {}})},
    takeLayers: new Map(), pinnedTakeIds: new Set(), takeReview: null, playing: false});
  const take = id => ({id, buffer: {getChannelData: () => new Float32Array(2), sampleRate: 48000}, blob: {}});
  engine.addTakeLayer(take('alto'), true);
  engine.setTakeReview(take('bass'));
  engine.setTakeReview(take('tenor'));
  assert.deepEqual([...engine.takeLayers.keys()], ['alto', 'tenor']);
  assert.equal(removed.length, 1, 'un-pinned previous review is released');
  engine.setTakeReview(null);
  assert.deepEqual([...engine.takeLayers.keys()], ['alto']);
  engine.addTakeLayer(take('soprano'), true);
  let stopped = 0, disconnected = 0;
  for (const layer of engine.takeLayers.values()) layer.source = {stop: () => stopped++, disconnect: () => disconnected++};
  engine.stopTakeReviewAudio();
  assert.equal(stopped, 2); assert.equal(disconnected, 2);
  assert.equal(engine.takeLayers.size, 2, 'pause keeps audibility choices');
  engine.clearTakeLayers();
  assert.equal(engine.takeLayers.size, 0);
  assert.equal(engine.pinnedTakeIds.size, 0);
  assert.equal(removed.length, 4, 'all object URLs are released');
});

test('pitchbar blank-space audition chooses the closest drawn bar, including across a rest', () => {
  const start = app.indexOf('  function barNoteAt('), end = app.indexOf('\n  }', start) + 4;
  const c = vm.createContext({currentScorePartIndex: () => 0, mixerParts:[{source:0},{source:1}]});
  const notes=[[0,0,2,60],[1,4,6,67],[0,20,21,62]];
  vm.runInContext(app.slice(start, end), c);
  assert.equal(c.barNoteAt(notes, 3, 60), null);
  const geometry = {startTick: 0, endTick: 8, tickScale: 10, pitchStep: 5};
  assert.deepEqual({...c.barNoteAt(notes, 3, 60, true, geometry)}, {key: 60, track: 0, channel:0, tick:0,endTick:2});
  assert.deepEqual({...c.barNoteAt(notes, 3, 67, true, geometry)}, {key: 67, track: 1, channel:1, tick:4,endTick:6});
  assert.equal(c.barNoteAt(notes, 3, 62, true, geometry).key, 60, 'another system cannot win the nearest-note query');
});

test('B2-only Pitchbar audition uses exactly the displayed divisi notes', () => {
  const ctx=vm.createContext({currentScorePartIndex:()=>3, visibleChannels:new Set([1]), mixerParts:[
    {source:3,barNotes:[[0,16,55]]}, {source:3,barNotes:[[0,8,43],[8,16,45]]}]});
  for(const name of ['visiblePitchNotes','barNoteAt']) {
    const start=app.indexOf('  function '+name+'(');
    vm.runInContext(app.slice(start,app.indexOf('\n  }',start)+4),ctx);
  }
  const visible=ctx.visiblePitchNotes();
  assert.equal(ctx.barNoteAt(visible,4,55),null,'no B1 hitbox at its hidden pitch');
  assert.equal(ctx.barNoteAt(visible,4,55,true,{startTick:0,endTick:16,tickScale:10,pitchStep:5}).key,43);
  assert.deepEqual([...visible].map(n=>n[0]),[1,1]);
});

test('scheduler look-ahead never cuts the final 28ms from a shifted recording', () => {
  const start=app.indexOf('    scheduleTakeLayer('),end=app.indexOf('    stopVoices(',start);
  const C=vm.runInNewContext(`(class {${app.slice(start,end)}})`);
  const engine=new C();
  engine.playing=true;engine.context={currentTime:9.99};
  engine.takeReviewWindow=lead=>lead ? null : {from:9.99,until:10};
  engine.stopTakeLayerAudio=()=>{throw Error('Stopped before the recorded boundary');};
  engine.scheduleTakeLayer({source:{stretch:true,endTime:10}},.028);
});

test('punch-in immediately silences the prior singer and keeps foreign or anonymous audio out of the pass', () => {
  const start=app.indexOf('    setOverdubTarget('), end=app.indexOf('    stopVoices(',start);
  const Engine=vm.runInNewContext(`(class {${app.slice(start,end)}})`);
  const engine=new Engine(), stopped=[], scheduled=[];
  const previous={id:'previous',singerId:'one'}, target={id:'comp:current',singerId:'two'};
  engine.takeLayers=new Map([[previous.id,previous],[target.id,target]]);
  engine.stopTakeLayerAudio=layer=>stopped.push(layer.id);
  engine.setOverdubTarget('current','two');
  assert.deepEqual(stopped,['previous','comp:current']);
  engine.playing=true;engine.context={currentTime:0};
  engine.takeReviewWindow=(_lead,layer)=>{scheduled.push(layer.id);return null;};
  for(const layer of [previous,target,{id:'anonymous'},{id:'guide',reference:true}])engine.scheduleTakeLayer(layer,0);
  assert.deepEqual(scheduled,['guide']);
});
