const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../template/practice_comp.js');
const {historySources}=require('../template/loop_recorder.js');
function track(id,singer,stage,from,to,note=60,part=0,date=1) {
  const reference={version:1,fingerprint:'score',part,line:null,rate:1,start:0,end:4,seconds:4,
    latency:0,notes:[[0,4,[note]]]};
  const descriptor={song:'autumn',slot:`station:${singer}:${stage}`,station:{id:singer,name:singer,stage},reference};
  const take={id,number:date,createdAt:date,origin:0,frames:400,sampleRate:100,
    pitchReference:reference,analysisFrames:[{start:0,end:4,cents:note*100}],performer:{id:singer,name:singer}};
  const state={...model.empty(descriptor),segments:[{takeId:id,from,to}],processed:[id],firstTakeNumber:date,track:true};
  return {state,sources:new Map([[id,take]])};
}
const singer=t=>t.state.descriptor.station;
test('one comp joins stages and part changes, newest overlap wins and earlier coverage survives',()=>{
  const a=track('a','Singer A','start',0,4),b=track('b','Singer A','scratchpad',1,2,64,1,2);
  const c=track('c','Singer B','scratchpad',0,4,67,1,3), input=new Map([a,b,c].map(t=>[t.state.key,t]));
  const before=JSON.stringify([...input]);
  const {views,owners}=model.singerTracks(input,singer,b.state.key);
  assert.equal(views.size,2);assert.equal(owners.get(a.state.key),b.state.key);
  const combined=views.get(b.state.key);
  assert.deepEqual(combined.state.segments,[{takeId:'a',from:0,to:1},{takeId:'b',from:1,to:2},{takeId:'a',from:2,to:4}]);
  assert.deepEqual(combined.state.descriptor.reference.notes,[[0,1,[60]],[1,2,[64]],[2,4,[60]]]);
  assert.equal(combined.score.meanAbsCents,0);assert.equal(combined.score.completion,1);
  assert.equal(JSON.stringify([...input]),before,'published snapshots and sources stay byte-for-byte equivalent');
});
test('new pickups update the same singer comp and retain other singers and songs',()=>{
  const a=track('a','Singer A','start',0,4),b=track('b','Singer A','scratchpad',1,2,64,1,2);
  const seed=track('seed','Singer A','start',0,4);seed.state.song=seed.state.descriptor.song='seed';seed.state.key=model.key(seed.state.descriptor);
  const tracks=new Map([a,b,seed].map(t=>[t.state.key,t]));
  const first=model.singerTracks(tracks,singer,b.state.key);
  const next={...b,state:{...b.state,segments:[...b.state.segments,{takeId:'c',from:3,to:4}]},sources:new Map(b.sources)};
  next.sources.set('c',{...b.sources.get('b'),id:'c',createdAt:3});tracks.set(b.state.key,next);
  const second=model.singerTracks(tracks,singer,b.state.key);
  assert.equal(second.views.size,2);assert.equal(first.owners.get(a.state.key),second.owners.get(a.state.key));
  assert.deepEqual(second.views.get(b.state.key).state.segments.map(s=>s.takeId),['a','b','a','c']);
});
test('grouped Undo protects overwritten source audio as well as the visible composition',()=>{
  const empty={segments:[],track:false,firstTakeNumber:null};
  const history={past:[{key:'b',before:{segments:[{takeId:'b',from:0,to:4}]},after:empty,group:[
    {key:'a',before:{segments:[{takeId:'a',from:0,to:4}]},after:empty},
    {key:'b',before:{segments:[{takeId:'b',from:0,to:4}]},after:empty}]}],future:[]};
  assert.deepEqual(historySources(history),['a','b']);
});
