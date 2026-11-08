const {test}=require('node:test'),assert=require('node:assert/strict');
const controls=require('../template/take_controls.js'),pitch=require('../template/take_pitch.js');
const score = (coverage,mean,median,within=1) => ({expectedSeconds:10,trackedSeconds:10*coverage,
  coverage,meanAbsCents:mean,medianAbsCents:median,within50CentsSeconds:10*coverage*within});
test('comp arrows follow numeric direction but color follows each metric\'s goal',()=>{
  const better=controls.metricDeltas(score(.7,30,20,.8),score(.8,20,10,.9));
  assert.deepEqual(Object.keys(better),['tracked','mean','median','within']);
  for(const name of ['tracked','within']){assert.equal(better[name].direction,'up');assert.equal(better[name].improved,true);}
  for(const name of ['mean','median']){assert.equal(better[name].direction,'down');assert.equal(better[name].improved,true);}
  assert.match(better.mean.description,/improved by 10\.000 cents \(30\.000 to 20\.000\)/);
  assert.match(better.tracked.description,/percentage points/);
  const worse=controls.metricDeltas(score(.8,20,10,.9),score(.7,30,20,.8));
  for(const name of Object.keys(worse)){assert.equal(worse[name].improved,false);assert.notEqual(worse[name].direction,better[name].direction);}
});
test('missing scores, floating-point noise and unchanged metrics have no arrows',()=>{
  const a=score(.8,10,5,.9);
  assert.deepEqual(controls.metricDeltas(a,a),{});
  assert.deepEqual(controls.metricDeltas(null,a),{});
  assert.deepEqual(controls.metricDeltas(a,score(.80000001,10.0000001,4.99999999,.90000001)),{});
  const empty=score(0,null,null,0);
  assert.deepEqual(Object.keys(controls.metricDeltas(empty,a)),['tracked']);
  assert.deepEqual(Object.keys(controls.metricDeltas(a,empty)),['tracked']);
});
test('tradeoffs get independent directions without coloring segment count or missing metrics',()=>{
  const changes=controls.metricDeltas(score(.8,30,10,.9),score(.7,20,15,.9));
  assert.deepEqual(Object.keys(changes),['tracked','mean','median']);
  assert.equal(changes.tracked.improved,false);assert.equal(changes.mean.improved,true);assert.equal(changes.median.improved,false);
});
test('parts sort by SATB then division, with soloist immediately after its normal part',()=>{
  const names=['B2','S2 solo','T1','Alto 2','Soprano 1','S2','A1','T2','Bass 1'];
  assert.deepEqual(names.sort(pitch.compareParts),['Soprano 1','S2','S2 solo','A1','Alto 2','T1','T2','Bass 1','B2']);
  const rows=names.map(part=>({part}));
  assert.deepEqual(rows.reverse().sort((a,b)=>pitch.compareTakes(a,b,{column:'part',direction:'ascending'})).map(t=>t.part),names);
});
test('date presentation can omit common year and redundant modification date without losing time',()=>{
  const t=new Date(2026,10,2,15,4).getTime();
  assert.match(controls.formatDate(t),/26/);
  assert.doesNotMatch(controls.formatDate(t,{omitYear:true}),/2026|\/26/);
  assert.equal(controls.formatDate(t,{timeOnly:true}),'15:04');
  assert.equal(controls.formatDate(null),'\u2014');
});
test('track dates derive from retained audio and last edit, not unrelated takes or re-render times',()=>{
  const sources=new Map([['a',{createdAt:100,updatedAt:120}],['b',{createdAt:200,updatedAt:220}],['c',{createdAt:10,updatedAt:999}]]);
  assert.deepEqual(controls.trackDates({segments:[{takeId:'a'},{takeId:'b'}],editedAt:250,updatedAt:900},sources),{createdAt:100,updatedAt:250});
  assert.deepEqual(controls.dates({createdAt:10}),{created:10,modified:10});
});
test('creation and modification columns sort dates even when a recording has no pitch metrics',()=>{
  const takes=[{id:1,createdAt:100,updatedAt:300},{id:2,createdAt:200,updatedAt:220},{id:3}];
  for(const [column,expected] of [['created',[2,1,3]],['modified',[1,2,3]]]){
    assert.deepEqual([...takes].sort((a,b)=>pitch.compareTakes(a,b,{column,direction:'descending'})).map(t=>t.id),expected);
  }
});
