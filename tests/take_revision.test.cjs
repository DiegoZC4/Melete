const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../template/take_pitch.js');
const C = require('../template/practice_comp.js');
const R = require('../template/loop_recorder.js');

const ref = {version:1,fingerprint:'before',part:7,line:null,start:0,end:3840,captureStart:0,
  leadInSeconds:0,rate:1,seconds:4,latency:0,chapters:[{measure:1,seconds:0}],notes:[[0,4,[41]]]};
function fixture() {
  const take = {id:'take84',song:'seed',number:84,part:'B2',origin:0,sampleRate:8000,frames:32000,
    complete:true,finalized:true,createdAt:1,pitchReference:structuredClone(ref)};
  const frames = Array.from({length:400},(_,i)=>({start:i/100,end:(i+1)/100,cents:i===50?null:4310}));
  take.pitchContour=P.packContour(frames,take); take.pitchScore=P.scoreFrames(frames,ref,4);
  return take;
}
test('score corrections regrade old observations while preserving raw pitch, gaps, audio metadata and original reference',()=>{
  const take=fixture(), before=structuredClone(take), current={...ref,fingerprint:'corrected',notes:[[0,4,[43]]]};
  const revised=P.rebaseTake(take,current,10);
  assert.ok(Math.abs(revised.pitchScore.meanAbsCents-10)<1e-9);
  assert.equal(revised.pitchScore.coverage,take.pitchScore.coverage);
  assert.deepEqual(revised.pitchContour.pitches,take.pitchContour.pitches);
  assert.equal(P.readContour(revised)[50].cents,null);
  assert.deepEqual(revised.originalPitchReference,ref);
  assert.deepEqual(revised.originalPitchScore,take.pitchScore);
  assert.equal(revised.frames,take.frames); assert.equal(revised.sampleRate,take.sampleRate);
  assert.deepEqual(take,before); assert.equal(P.rebaseTake(revised,current),revised);
  assert.deepEqual(P.rebaseTake(revised,{...current,fingerprint:'next'},20).originalPitchReference,ref);
  assert.equal(P.rebaseTake(revised,ref),null,'an old open page cannot roll a corrected reference back');
});
test('automatic regrading refuses moved bars, changed tempo, other parts and concurrent or deleted recordings',()=>{
  const take=fixture();
  for(const patch of [{seconds:5},{rate:.8},{part:6},{line:0},{captureStart:1},{latency:.1},
    {chapters:[{measure:2,seconds:0}]},{chapters:[{measure:1,seconds:.1}]}]) {
    assert.equal(P.rebaseTake(take,{...ref,...patch}),null);
  }
  for(const patch of [{active:true},{unsaved:true},{finalized:false},{deleteAfter:1}]) {
    assert.equal(P.rebaseTake({...take,...patch},{...ref,fingerprint:'next'}),null);
  }
  const missing={...take}; delete missing.pitchContour;
  const revised=P.rebaseTake(missing,{...ref,fingerprint:'next'});
  assert.equal(revised.pitchScore,undefined,'an uncached recording is queued for real scoring, not given invented metrics');
});
test('reference write is guarded and never opens the audio chunk store',async()=>{
  const take=fixture(), target={...ref,fingerprint:'corrected',notes:[[0,4,[43]]]};
  let record=structuredClone(take),puts=0;
  const store=new R.TakeStore(null);
  store.transaction=async(names,mode,action)=>{
    assert.deepEqual(names,['takes']); assert.equal(mode,'readwrite');
    return new Promise(resolve=>action({objectStore:()=>({get:()=>{
      const r={};queueMicrotask(()=>r.onsuccess({target:{result:structuredClone(record)}}));return r;
    },put:r=>{record=r;puts++;}})},resolve));
  };
  const revised=await store.rebaseReference(take,target);
  assert.ok(Math.abs(revised.pitchScore.meanAbsCents-10)<1e-9);assert.equal(puts,1);
  assert.equal(await store.rebaseReference(take,target),null,'stale reference cannot overwrite a new one');
  assert.equal(puts,1);
});
test('track adoption carries selections, removal/undo state and keeps historical revisions',()=>{
  const old=fixture(), oldTarget={song:'seed',reference:ref};
  const newer={...ref,fingerprint:'corrected',notes:[[0,4,[43]]]};
  const target={song:'seed',reference:newer},take=P.rebaseTake(old,newer);
  const sources=new Map([[take.id,take]]);
  const state={...C.offer(C.empty(oldTarget),old,new Map([[old.id,old]])),track:true,updatedAt:5};
  const before=structuredClone(state),adopted=C.adoptRevision([state],target,sources,C.empty(target));
  assert.deepEqual(adopted.segments,state.segments);assert.equal(adopted.track,true);
  assert.equal(adopted.revisionOf,state.key);assert.equal(C.validate(adopted,sources),true);
  assert.deepEqual(state,before);
  const removed=C.remove(state,100);
  const retained=C.adoptRevision([removed],target,sources);
  assert.equal(retained.freshAt,100);
  assert.deepEqual(C.undo(retained).segments,state.segments);
  const explicit=C.remove(C.empty(target),200);
  assert.equal(C.adoptRevision([state],target,sources,explicit),explicit);
});
test('boundary labels use actual measure/beat fractions and exclusive ends, with numeric sorting',()=>{
  const measures=Array.from({length:25},(_,i)=>[i*6720,6720,7,4]);
  assert.equal(P.measureAddress(23*6720+2.5*960,measures,960),'24.3.5');
  assert.equal(P.measureAddress(23*6720+2.1*960,measures,960),'24.3.1');
  assert.equal(P.measureAddress(23*6720+2*960,measures,960),'24.3');
  assert.equal(P.measureAddress(23*6720,measures,960),'24');
  assert.equal(P.measureAddress(25*6720,measures,960),'26');
  assert.equal(P.measureAddress(-960,measures,960),'Count-in');
  assert.equal(P.measureAddress(null,measures,960),'\u2014');
  assert.equal(P.measureAddress(2.5*480,[[0,2880,6,8]],960),'1.3.5','written eighth is the beat in 6/8');
  assert.deepEqual(P.takeBounds({start:0,end:10,pitchReference:{captureStart:2,end:9}}),{start:2,end:9});
  const takes=[{number:2,start:10,end:20},{number:1,start:2,end:30},{number:3}];
  assert.deepEqual([...takes].sort((a,b)=>P.compareTakes(a,b,{column:'start'})).map(t=>t.number),[1,2,3]);
  assert.deepEqual([...takes].sort((a,b)=>P.compareTakes(a,b,{column:'end',direction:'descending'})).map(t=>t.number),[1,2,3]);
});
