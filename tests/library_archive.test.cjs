const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../tools/local_station/library_archive.js');
const model=require('../template/practice_comp.js');
const empty=()=>({stores:Object.fromEntries(L.names.map(n=>[n,[]])),preferences:{}});
const fixture=id=>{
  const data=empty(), reference={part:1,line:0,fingerprint:'score',rate:1,notes:[[0,1,[60]]],seconds:1};
  const descriptor={song:'song',reference,label:'A1'}, key=model.key(descriptor);
  data.stores.takes=[[id,{id,song:'song',pitchReference:reference,trackSlot:null,number:id==='home'?84:3,
    pitchContour:{pitches:new Float32Array([0,1,6012])},playbackAdvance:.123,frames:3,sampleRate:48000}]];
  data.stores.chunks=[[[id,0],{takeId:id,index:0,pcm:new Int16Array([-32768,0,32767])}]];
  data.stores.comps=[[key,{key,song:'song',descriptor,segments:[{takeId:id,from:0,to:1}],revision:1}]];
  data.stores.counters=[['song',id==='home'?84:3],[['recording-seconds','2026-11-08'],10],
    [['comp-edit-history','song'],{past:[{key,at:id==='home'?1:2,before:{segments:[]},after:{segments:[{takeId:id,from:0,to:1}]}}],future:[],revision:1}]];
  return data;
};
test('library archive round trips exact PCM, typed contours and nonfinite values',async()=>{
  const data=fixture('home');data.stores.counters.push(['special',{nan:NaN,missing:undefined,view:new Uint16Array([42])}]);
  assert.deepEqual(L.unpack(await L.pack(data).arrayBuffer()),data);
  assert.throws(()=>L.unpack(new ArrayBuffer(8)),/Invalid|JSON|Unexpected/);
});
test('metadata diagnostics cannot be mistaken for restorable audio archives',async()=>{
  const data=fixture('home');data.diagnostic=true;data.stores.chunks=[];
  const diagnostic=L.unpack(await L.pack(data).arrayBuffer());
  assert.deepEqual(diagnostic,data);
  assert.throws(()=>L.plan(empty(),diagnostic,'a'.repeat(64)),/not an audio backup/);
  assert.throws(()=>L.plan(diagnostic,fixture('choir'),'a'.repeat(64)),/not an audio backup/);
});
test('merging keeps both comps, remaps only incoming slots, preserves evidence and Undo',()=>{
  const base=fixture('home'), source=fixture('choir'), saved=structuredClone([base,source]);
  source.preferences={'melete:cloud:auto:account':'true','melete:mic':'other'};
  const p=L.plan(base,source,'a'.repeat(64));
  assert.equal(p.adds.takes.length,1);assert.equal(p.adds.comps.length,1);
  const [,take]=p.adds.takes[0], [,comp]=p.adds.comps[0];
  assert.notEqual(comp.key,base.stores.comps[0][0]);assert.equal(model.key(comp.descriptor),comp.key);
  assert.equal(take.trackSlot,comp.descriptor.slot);assert.equal(take.playbackAdvance,.123);
  assert.deepEqual(take.pitchContour,source.stores.takes[0][1].pitchContour);
  assert.deepEqual(p.adds.chunks,source.stores.chunks);
  const history=p.updates.counters.find(([k])=>Array.isArray(k)&&k[0]==='comp-edit-history')[1];
  assert.deepEqual(history.past.map(e=>e.key),[base.stores.comps[0][0],comp.key]);
  assert.equal(p.updates.counters.find(([k])=>Array.isArray(k)&&k[0]==='recording-seconds')[1],20);
  assert.equal(p.updates.counters.find(([k])=>k==='song')[1],84);
  assert.deepEqual(Object.keys(p.preferences),['melete:cloud:local-only:v1']);
  assert.deepEqual(base,saved[0]);assert.deepEqual(source.stores,saved[1].stores);
  const merged=empty();for(const n of L.names){const m=new Map(base.stores[n].map(([k,v])=>[JSON.stringify(k),[k,v]]));
    for(const [k,v] of [...p.adds[n],...p.updates[n]])m.set(JSON.stringify(k),[k,v]);merged.stores[n]=[...m.values()];}
  assert.equal(L.plan(merged,source,'a'.repeat(64)).alreadyMerged,true);
});
test('conflicting source identities fail without changing either library',()=>{
  const base=fixture('home'),source=fixture('home');
  assert.throws(()=>L.plan(base,source,'b'.repeat(64)),/Conflicting takes/);
});
test('imported octaves follow remapped comps without changing audio or destination choices',()=>{
  const base=fixture('home'),source=fixture('choir'),key='melete:take-octaves:song';
  const oldComp=source.stores.comps[0][0];
  base.preferences[key]=JSON.stringify({home:-1,choir:0});
  source.preferences[key]=JSON.stringify({choir:1,[`comp:${oldComp}`]:-1,unknown:1,bad:2});
  source.preferences['melete:mic']='other';
  const original=structuredClone(source),p=L.plan(base,source,'c'.repeat(64));
  assert.deepEqual(JSON.parse(p.preferences[key]),{home:-1,choir:0,[`comp:${p.adds.comps[0][0]}`]:-1});
  assert.deepEqual(p.adds.chunks,source.stores.chunks);
  assert.deepEqual(source,original);
  assert.equal(p.preferences['melete:mic'],undefined);
  source.preferences[key]='invalid';
  assert.equal(L.plan(base,source,'c'.repeat(64)).preferences[key],undefined);
});
test('private track policy survives score revisions but does not affect rehearsal slots',()=>{
  const base=fixture('home'),p=L.plan(base,fixture('choir'),'a'.repeat(64));
  const previous=global.localStorage;global.localStorage={getItem:k=>p.preferences[k]||null};
  try{const cloud=require('../template/comp_cloud.js');
    const comp=base.stores.comps[0][1];assert.ok(cloud.localOnly(comp));
    assert.ok(cloud.localOnly({...comp,descriptor:{...comp.descriptor,reference:{...comp.descriptor.reference,fingerprint:'new'}}}));
    assert.ok(!cloud.localOnly(p.adds.comps[0][1]));
  }finally{if(previous)global.localStorage=previous;else delete global.localStorage;}
});
