const {test} = require('node:test');
const assert = require('node:assert/strict');
const R = require('../template/take_render.js');
const A = require('../template/comp_audio.js');
const point = f => ({x: f.start * 100, y: f.cents, track: 0, error: 1});
test('batched paths retain every pitch sample but never bridge missing detection or a splice', () => {
  const frames = [1, 2, null, 4, 5, 6, 7].map((cents, i) => ({start: i, end: i+1, cents, takeId: i<5?'a':'b'}));
  const before = JSON.stringify(frames), result = R.tracePaths(frames, 0, frames.length, point, ()=>'green');
  assert.equal(result.edges,3);
  assert.deepEqual(result.colors,[['green','M0.000 1.000L100.000 2.000M300.000 4.000L400.000 5.000M500.000 6.000L600.000 7.000']]);
  assert.equal(result.halo, result.colors[0][1]);
  assert.equal(JSON.stringify(frames),before);
});
test('full 5-minute contour has bounded DOM paths, preserves 29999 edges and supports range lookup', () => {
  const frames = Array.from({length:30000},(_,i)=>({start:i/100,end:(i+1)/100,cents:6000+20*Math.sin(i)}));
  const result = R.tracePaths(frames,0,frames.length,point, f=>String(Math.round(f)));
  assert.equal(result.edges,29999); assert.equal(result.colors.length,1);
  assert.deepEqual(R.frameRange(frames,100,110),[10000,11000]);
  assert.equal((result.halo.match(/M/g)||[]).length,29999);
});
test('worker splices preserve timing, latency, original samples and 3ms fade semantics', () => {
  const rate=8000,input=Float32Array.from({length:1000},(_,i)=>Math.sin(i/5));
  const segments=[{from:.03,to:.06},{from:.07,to:.072}];
  const expected=new Float32Array(800),actual=new Float32Array(800),before=input.slice();
  for(const s of segments){
    const begin=Math.round(s.from*rate),end=Math.round(s.to*rate),offset=Math.round((s.from-.02+.005)*rate),edge=Math.round(.003*rate);
    for(let i=begin;i<end;i++)expected[i]=input[offset+i-begin]*Math.min(1,(i-begin)/edge,(end-1-i)/edge);
  }
  A.splice(actual,input,segments,.02,.005,rate);
  assert.deepEqual(actual,expected); assert.deepEqual(input,before);
});
