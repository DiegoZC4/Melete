const {test}=require('node:test');
const assert=require('node:assert/strict');
const {finishCapture}=require('../template/loop_recorder.js');
test('native stop drains the microphone tail before finalizing and flushing',async()=>{
  const events=[];
  const error=await finishCapture({pause:async()=>({stopFrame:100}),frame:()=>99,
    capture:{stop:async()=>events.push('drained')},finish:n=>events.push(n),flush:async()=>events.push('saved')});
  assert.equal(error,undefined);
  assert.deepEqual(events,['drained',100,'saved']);
});
test('expired native connection still finalizes and saves every delivered frame',async()=>{
  const events=[],error=new Error('Native session expired');
  const result=await finishCapture({pause:async()=>{throw error;},frame:()=>80,
    capture:{stop:async()=>{throw error;}},finish:n=>events.push(n),flush:async()=>events.push('saved')});
  assert.equal(result,error);
  assert.deepEqual(events,[80,'saved']);
});
test('browser capture errors also cannot skip the persistence flush',async()=>{
  let saved=false;
  await finishCapture({capture:{stop:async()=>{throw Error('device disconnected');}},flush:async()=>{saved=true;}});
  assert.ok(saved);
});
test('a storage failure is not reported as a successful save',async()=>{
  await assert.rejects(finishCapture({flush:async()=>{throw Error('quota');}}),/quota/);
});
