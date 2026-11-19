const test = require('node:test');
const assert = require('node:assert/strict');
const {chartPoint, chartFormants} = require('../vowel-lab/analysis.js');
const {harmonicLevels} = require('../vowel-lab/synthesis.js');

test('pointer coordinates invert the measured chart including Bark axes and their limits', () => {
  assert.deepEqual(chartFormants({x:0,y:0}), {f1:175,f2:3500});
  assert.deepEqual(chartFormants({x:3,y:2}), {f1:1250,f2:500});
  for (const f1 of [175,250,400,800,1100,1250]) {
    for (const f2 of [500,880,1400,2300,3500]) {
      const result=chartFormants(chartPoint({f1,f2}));
      assert.ok(Math.abs(result.f1-f1)<.001 && Math.abs(result.f2-f2)<.001);
    }
  }
});

test('the voice weights harmonics near the selected resonances at different pitches', () => {
  for (const pitch of [100,140,220]) {
    const count=Math.floor(6000/pitch);
    for (const formants of [{f1:400,f2:2400},{f1:700,f2:1250}]) {
      const levels=harmonicLevels(pitch,formants,count);
      function peak(low,high) {
        const harmonics=levels.map((amplitude,i)=>({amplitude,hz:(i+1)*pitch})).filter(p=>p.hz>=low && p.hz<=high);
        return harmonics.sort((a,b)=>b.amplitude-a.amplitude)[0].hz;
      }
      assert.ok(levels.every(a=>a>0 && Number.isFinite(a)));
      assert.ok(levels.reduce((a,b)=>a+b,0)<=.25001);
      assert.ok(Math.abs(peak(formants.f1-200,formants.f1+200)-formants.f1)<=pitch);
      assert.ok(Math.abs(peak(formants.f2-250,formants.f2+250)-formants.f2)<=pitch);
    }
  }
});
