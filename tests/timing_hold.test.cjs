const test=require('node:test'),assert=require('node:assert/strict');
const mic=require('../template/microphone_check.js'),pitch=require('../template/take_pitch.js'),rec=require('../template/loop_recorder.js');
test('a contradicted calibration stays held on reload, independently per route and without storage',()=>{
  const raw=new Map(),storage=()=>({getItem:k=>raw.get(k),setItem:(k,v)=>raw.set(k,v),removeItem:k=>raw.delete(k)});
  const a=mic.timingHolds(storage),b=mic.timingHolds(storage);
  a.set('R','session');assert.equal(b.get('R'),'session');assert.equal(b.get('other'),null);
  a.set('R',null);b.changed('melete:unverified-route:v1:R');assert.equal(b.get('R'),null);
  const restricted=mic.timingHolds(()=>{throw Error('blocked');});restricted.set('R','mismatch');assert.equal(restricted.get('R'),'mismatch');
});
test('uncertain audio cannot be autoscored, realigned, reported silent for deletion, or rebased after recovery',()=>{
  const ref={timing:{source:'unverified',reason:'wired-delay-changed'}},t={pitchReference:ref,finalized:true,frames:48000,peak:0};
  assert.equal(pitch.scoreFrames([],ref,1),null);
  assert.equal(pitch.recalibrateTake(t,'new-route',{seconds:.082,measuredAt:Date.now()}),null);
  assert.equal(pitch.rebaseTake(t,ref),null);
  assert.equal(rec.silentCandidate(t),false);
});
test('a grade cached by a previous player is removed without changing the take or discarding its contour',()=>{
  const ref={version:pitch.VERSION,timing:{source:'unverified'}},contour={reference:JSON.stringify(ref),data:'original'};
  const t={id:'local',createdAt:10,updatedAt:11,frames:123,finalized:true,pitchReference:ref,pitchContour:contour,pitchScore:{meanAbsCents:250}};
  const repaired=pitch.repairUngraded(t);
  assert.notEqual(repaired.pitchReference.version,pitch.VERSION);
  assert.equal(repaired.pitchScore,undefined);
  assert.deepEqual([repaired.id,repaired.createdAt,repaired.updatedAt,repaired.frames],['local',10,11,123]);
  assert.equal(repaired.pitchContour.reference,JSON.stringify(repaired.pitchReference));
  assert.equal(repaired.pitchContour.data,contour.data);
  assert.equal(pitch.repairUngraded(repaired),repaired);
  for(const other of [{...t,finalized:false},{...t,publication:true},{...t,pitchReference:{version:1}}])
    assert.equal(pitch.repairUngraded(other),other);
});
