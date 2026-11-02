const {test}=require('node:test');
const assert=require('node:assert/strict');
const reference=require('../template/reference_audio.js');

test('reference alignment is invariant to metadata key order and corrected pitches, not changed timing',()=>{
  const sequence={division:960,endTick:3840,tempos:[[0,80]],measures:[[0,3840,4,4]],notes:[[0,0,960,60]]};
  const source={data:'YWJj',timing:{tempos:sequence.tempos,measures:sequence.measures,endTick:3840,division:960}};
  assert.equal(reference.valid(source,sequence),true);
  assert.equal(reference.valid(source,{...sequence,notes:[[0,0,960,61]]}),true);
  for(const edit of [{division:480},{endTick:7680},{tempos:[[0,84]]},{measures:[[0,2880,3,4]]}]) {
    assert.equal(reference.valid(source,{...sequence,...edit}),false);
  }
  assert.equal(reference.valid({},sequence),false);
});
