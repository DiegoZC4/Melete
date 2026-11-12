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
test('old pitch-only practice remains readable, but no writer can create new traces',()=>{
  assert.deepEqual(trace.unpack(new Int32Array([1200,1300,6005])),[{start:1.2,end:1.3,cents:6005,live:true}]);
  assert.equal(trace.writer,undefined);
  assert.notDeepEqual(trace.key('s',1,0,{id:'a'},'f'),trace.key('s',1,0,{id:'b'},'f'));
  assert.notDeepEqual(trace.key('s',1,0,null,'f'),trace.key('s',1,1,null,'f'));
});
