const assert=require('node:assert/strict'),test=require('node:test');
const {SilentPassWarning}=require('../template/microphone_check.js');

test('quiet rooms, rests and suspended tabs do not count as failed singing',()=>{
  const w=new SilentPassWarning(), at=(t,recording,expected,state='silent')=>w.sample(t,recording,expected,state);
  for(let t=0;t<5000;t+=100)assert.equal(at(t,false,true),false);
  for(let t=5000;t<10000;t+=100)assert.equal(at(t,true,false),false);
  for(let t=10000;t<11200;t+=100)assert.equal(at(t,true,true),false);
  assert.equal(at(60000,true,true),false);
  assert.equal(at(65000,true,false),false);
  for(let t=66000;t<=67100;t+=100)assert.equal(at(t,true,true,'muted'),false);
  assert.equal(at(67200,true,true,'muted'),true);
  assert.equal(at(67300,true,true,'quiet'),false);
  assert.equal(at(67400,true,true),false);
  assert.equal(at(67500,false,true),false);
});
