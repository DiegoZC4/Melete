const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../template/app.js'), 'utf8');
const cycle = app.slice(app.indexOf('  function cancelTakeHearBatch()'), app.indexOf('  function takeOctave('));
const settled = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const gates = new Map(), commits = [], errors = [];
  const tracks = ['a','b','c'].map(id => ({id, prepare: () => new Promise((resolve,reject) => gates.set(id,{resolve,reject}))}));
  const engine = {takeLayers:new Map([['a',{id:'a'}]]), pinnedTakeIds:new Set(),
    updateTakeLayers(add,remove=[]) {
      remove.forEach(id => this.takeLayers.delete(id));
      add.forEach(review => this.takeLayers.set(review.id,review));
      commits.push({add:add.map(r=>r.id),remove:[...remove]});
    }};
  const context = vm.createContext({engine,takeHearBatch:null,takeLayerLoads:new Map(),
    compPanel:{layers:()=>tracks},looseTakes:()=>[],updateTakePreview:()=>{},
    window:{MeleteTakeLoudness:{track:async()=>({gain:2})}},showToast:message=>errors.push(message)});
  vm.runInContext(cycle,context);
  const release = id => gates.get(id).resolve({id,buffer:{}});
  return {context,engine,gates,commits,errors,release};
}

test('Hear all stages every take and its loudness before a single graph commit',async()=>{
  const f=fixture(),pending=f.context.cycleTakeHear('a');
  assert.deepEqual([...f.context.takeLayerLoads.keys()],['b','c']);
  f.release('b'); await settled();
  assert.deepEqual([...f.engine.takeLayers.keys()],['a']);
  assert.equal(f.commits.length,0,'no intermediate mix');
  f.release('c'); await pending;
  assert.deepEqual([...f.engine.takeLayers.keys()],['a','b','c']);
  assert.equal(f.commits.length,1);
  assert.equal(f.engine.takeLayers.get('b').loudness.gain,2);
  assert.equal(f.engine.takeLayers.get('c').loudness.gain,2);
  assert.equal(f.context.takeLayerLoads.size,0);
});

test('cancelling or superseding a pending group never adds late takes',async()=>{
  const f=fixture(),pending=f.context.cycleTakeHear('a');
  f.release('b'); await settled();
  f.context.cancelTakeHearBatch();
  f.release('c'); await pending;
  assert.deepEqual([...f.engine.takeLayers.keys()],['a']);
  assert.equal(f.commits.length,0);
  assert.equal(f.context.takeLayerLoads.size,0);
});

test('one unavailable take does not strand the group; remaining audio commits together',async()=>{
  const f=fixture(),pending=f.context.cycleTakeHear('a');
  f.gates.get('b').reject(new Error('Missing recording'));await settled();
  assert.equal(f.commits.length,0);
  f.release('c');await pending;
  assert.deepEqual([...f.engine.takeLayers.keys()],['a','c']);
  assert.equal(f.commits.length,1);
  assert.deepEqual(f.errors,['Missing recording']);
});

test('bulk engine changes request normalization and playback scheduling once',()=>{
  const begin=app.indexOf('    setTakeReview(review) {'),end=app.indexOf('    stopVoices(',begin);
  const Engine=vm.runInNewContext(`(class {${app.slice(begin,end)}})`,{
    URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},Audio:class{load(){} removeAttribute(){}},
    window:{MeleteTakeMix:{bus:()=>({input:{}})}},takeReverbControl:{value:()=>0},takeVolumeControl:{value:()=>100},
    takeOctave:()=>0,SCHEDULER_LEAD_SECONDS:.03});
  const engine=new Engine(),balanced=[],scheduled=[];
  Object.assign(engine,{takeLayers:new Map(),pinnedTakeIds:new Set(),context:{
    createGain:()=>({gain:{},connect(){},disconnect(){}}),createMediaElementSource:()=>({connect(){},disconnect(){}})},
    balanceTakeLayers(){balanced.push(this.takeLayers.size);},scheduleTakeReview(){scheduled.push(this.takeLayers.size);}});
  engine.updateTakeLayers(['a','b','c'].map(id=>({id,blob:{},loudness:{gain:2}})));
  assert.deepEqual(balanced,[3]);assert.deepEqual(scheduled,[3]);
  engine.updateTakeLayers([],['b','c']);
  assert.deepEqual(balanced,[3,1]);assert.deepEqual(scheduled,[3,1]);
  engine.clearTakeLayers();
  assert.deepEqual(balanced,[3,1,0]);
});
