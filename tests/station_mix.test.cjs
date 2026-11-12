const {test}=require('node:test'),assert=require('node:assert/strict');
const mix=require('../template/practice_mix.js'),station=require('../template/station.js');
const names=['S1','S2','A1','A2','T1','T2','B1','B2','Guest'];
const ch=names.map((short,source)=>({short,source,line:null})), roles=[{part:1,soloist:8}];
test('choir pan measures seat distance from the listener, not track index or sounding note',()=>{
  const layout={layout:'choir',width:70,myVol:155,otherVol:45};
  assert.deepEqual(mix.project(ch,3,layout,roles),{pans:[30,20,10,0,-10,-20,-30,-40,20],volumes:[45,45,45,155,45,45,45,45,45]});
  assert.deepEqual(mix.project(ch,7,layout,roles).pans,[70,60,50,40,30,20,10,0,60]);
  assert.deepEqual(mix.project(ch,8,layout,roles).pans,mix.project(ch,1,layout,roles).pans);
  assert.deepEqual(mix.seatOrder([ch[7],ch[0],ch[8],ch[1]],roles),[2,0,1,1]);
  assert.ok(mix.project(ch,1,{layout:'choir',width:0},roles).pans.every(n=>n===0));
  assert.deepEqual(mix.project([{name:'Soprano'},{name:'Bass'},{name:'Piano'}],0,{layout:'choir',width:100}).pans,[0,-100,0]);
  assert.deepEqual(mix.project([{name:'Upper'},{name:'Middle'},{name:'Lower'}],2,{layout:'choir',width:100}).pans,[100,50,0]);
  assert.deepEqual(mix.project([ch[0]],0,{layout:'choir'}).pans,[0]);
  const trio=[ch[0],ch[2],ch[7]];
  assert.deepEqual(mix.project(trio,1,{layout:'choir',width:5}).pans,[5,0,-5]);
});
test('choir links share a relative layout and passage without station or identity data',()=>{
  const fields=new URLSearchParams('Layout=CHOIR&Width=68&myVol=145&otherVol=0&myPan=90');
  assert.deepEqual(mix.read(fields),{layout:'choir',width:70,myVol:145,otherVol:0});
  assert.equal(mix.read({layout:'choir',width:105}),null);
  assert.equal(mix.read({layout:'custom'}),null);
  const url=mix.address('http://localhost:8809/?song=seed&mode=station&part=B2&token=secret#secret',mix.read(fields),'19-24','https://host.test/choir/');
  assert.equal(url,'https://host.test/choir/?song=seed&loop=19-24&layout=choir&width=70&myVol=145&otherVol=0');
  assert.deepEqual(mix.read(new URL(url).searchParams),mix.read(fields));
  assert.equal(mix.read({layout:'choir'}).width,70);assert.throws(()=>mix.address('file:///test.html',fields));
});
test('only unmodified singer profiles follow a changed station default',()=>{
  const before=station.guideMix(ch,4),preset={layout:'choir',width:100,myVol:90,otherVol:45};
  assert.ok(station.followsOldDefault(before,ch,4,preset,roles));
  assert.ok(!station.followsOldDefault({...before,volumes:before.volumes.map((v,i)=>v+(i===2?5:0))},ch,4,preset,roles));
  assert.ok(!station.followsOldDefault({...before,audible:ch.map(()=>false)},ch,4,preset,roles));
  const owned={...station.guideMix(ch,4,preset,roles),guidePreset:preset};
  assert.ok(!station.followsOldDefault(owned,ch,4,preset,roles));
  assert.ok(station.followsOldDefault(owned,ch,4,mix.factory,roles));
});
test('review starts centered with the inspected MIDI channel muted, independent of recording',()=>{
  const record=station.guideMix(ch,7),review=mix.reviewProfile(ch,3);
  assert.equal(record.pans[7],100);
  assert.ok(record.audible.every(Boolean));
  assert.deepEqual(review.audible,ch.map((_,i)=>i!==3));
  assert.ok(review.pans.every(v=>v===0));
  assert.ok(review.volumes.every(v=>v===35));
  assert.equal(review.metronome,0);
  assert.equal(review.takeVolume,100);
  assert.notEqual(mix.reviewKey('autumn',ch,3),mix.reviewKey('seed',ch,3));
  assert.notEqual(mix.reviewKey('seed',ch,3),mix.reviewKey('seed',ch,4));
  assert.notEqual(mix.reviewKey('seed',ch,3),mix.reviewKey('seed',ch.toReversed(),3));
});
test('review profiles preserve custom audio settings without visibility, recording targets or microphone consent',()=>{
  const saved={...mix.reviewProfile(ch,3),sing:true,practicePart:7,visible:ch.map(()=>false),
    metronome:70,takeVolume:85,takeReverb:20,reference:{enabled:true},tempo:60};
  saved.pans[0]=-75;saved.audible[3]=true;saved.volumes[3]=65;
  const restored=mix.reviewProfile(ch,3,saved);
  assert.equal(restored.audible[3],true);
  assert.equal(restored.pans[0],-75);
  assert.equal(restored.metronome,70);
  assert.equal(restored.takeVolume,85);
  assert.equal(restored.takeReverb,20);
  for(const field of ['sing','practicePart','visible','tempo'])assert.ok(!(field in restored));
  restored.reference.enabled=false;restored.volumes[3]=100;
  assert.equal(saved.reference.enabled,true);assert.equal(saved.volumes[3],65);
  for(const corrupt of [{...saved,pans:[0]},{...saved,volumes:ch.map(()=>NaN)}, {...saved,audible:ch.map(()=>1)}])
    assert.deepEqual(mix.reviewProfile(ch,3,corrupt),mix.reviewProfile(ch,3));
  assert.equal(mix.reviewProfile(ch,3,{...saved,metronome:Infinity}).metronome,0);
});
