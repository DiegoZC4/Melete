const {test}=require('node:test'),assert=require('node:assert/strict');
const mix=require('../template/practice_mix.js'),trace=require('../template/practice_trace.js');
test('relative mix links accept zero, signed pan and omitted controls, but never invalid numeric input',()=>{
  assert.deepEqual(mix.read(new URLSearchParams('myVol=0&otherPan=-90')), {myVol:0,otherPan:-90});
  for(const v of ['NaN','','Infinity','201','-5','0xff'])assert.equal(mix.read({myVol:v}),null);
  const link=mix.address('https://fixture:discard@example.test/practice/?song=seed&part=S2&mode=station&token=private#old',
    {myVol:150,otherVol:50,myPan:90,otherPan:-90},'19-24');
  assert.equal(link,'https://example.test/practice/?song=seed&loop=19-24&myVol=150&otherVol=50&myPan=90&otherPan=-90');
  assert.equal(mix.fromMixer(1,[50,150,50],[-90,90,-90]).uniform,true);
  assert.equal(mix.fromMixer(1,[50,150,30],[-90,90,-90]).uniform,false);
});
test('practice contours replace only observed intervals, with silence distinct from missing input',()=>{
  const f=(start,end,cents)=>({start,end,cents});
  const packed=trace.merge(null,[f(1,2,6031),f(3,4,6100)]);
  const next=trace.merge(packed,[f(1.2,1.3,null),f(1.7,1.8,6005)]);
  assert.deepEqual(trace.unpack(next).map(({start,end,cents})=>[start,end,cents]),[
    [1,1.2,6031],[1.3,1.7,6031],[1.7,1.8,6005],[1.8,2,6031],[3,4,6100]]);
  assert.equal(next.byteLength,5*12);assert.notDeepEqual(trace.key('s',1,0,{id:'a'},'f'),trace.key('s',1,0,{id:'b'},'f'));
  assert.notDeepEqual(trace.key('s',1,0,null,'f'),trace.key('s',1,1,null,'f'));
});
