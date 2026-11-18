const {test} = require('node:test');
const assert = require('node:assert/strict');
const R = require('../template/take_render.js');
const A = require('../template/comp_audio.js');
const P = require('../template/take_pitch.js');
const point = f => ({x: f.start * 100, y: f.cents, track: 0, error: 1});
test('saved display joins delivery jitter but never an explicit unvoiced interval or long dropout',()=>{
  const frames=[{start:0,end:.01,cents:6000,live:true},{start:.015,end:.025,cents:6001,live:true},
    {start:.03,end:.04,cents:null,live:true},{start:.045,end:.055,cents:6001,live:true},
    {start:.12,end:.13,cents:6001,live:true},{start:.4,end:.41,cents:6001,live:true}];
  const before=JSON.stringify(frames),result=R.tracePaths(frames,0,frames.length,point,()=> 'green');
  assert.equal(result.edges,2);assert.equal(JSON.stringify(frames),before,'scores keep all exact gaps');
});

test('restored contour strokes count toward coverage while cents use measured windows only',()=>{
  const frames=Array.from({length:30},(_,i)=>({start:i*.06,end:i*.06+.02,cents:6000+10*Math.sin(i/3)}));
  const ref={version:1,fingerprint:'jitter',part:0,line:null,start:0,end:8,rate:1,seconds:2,latency:0,notes:[[0,2,[60]]]};
  const take={sampleRate:48000,frames:96000,pitchReference:ref};
  const restored=P.readContour({...take,pitchContour:P.packLiveContour(frames,take)});
  const before=JSON.stringify(restored),score=P.scoreFrames(restored,ref,2);
  assert.equal(R.tracePaths(restored,0,restored.length,point,()=> 'green').edges,29);
  assert.ok(Math.abs(score.measuredSeconds-.6)<1e-8,'only the original observations contribute to cents');
  assert.ok(Math.abs(score.trackedSeconds-1.76)<1e-8,'written time under the plotted stroke counts as tracked');
  assert.equal(JSON.stringify(restored),before);
});

test('shared display rule bounds time and pitch jumps in score seconds',()=>{
  assert.equal(R.connects(0,6000,.25,6400),true);
  assert.equal(R.connects(0,6000,.251,6000),false);
  assert.equal(R.connects(0,6000,.02,6401),false);
  assert.equal(R.connects(0,null,.02,6000),false);
  const frames=[{start:0,end:.02,cents:6000},{start:.2,end:.22,cents:6000}];
  assert.equal(R.tracePaths(frames,0,2,point,()=> 'green',{rate:1}).edges,1);
  assert.equal(R.tracePaths(frames,0,2,point,()=> 'green',{rate:1.5}).edges,0);
  frames[1].cents=6500;
  assert.equal(R.tracePaths(frames,0,2,point,()=> 'green').edges,0);
});

test('hidden or different staff points break continuity even inside the jitter allowance',()=>{
  const frames=Array.from({length:4},(_,i)=>({start:i/20,end:i/20+.01,cents:6000}));
  assert.equal(R.tracePaths(frames,0,4,f=>f===frames[1]?null:point(f),()=> 'green').edges,1);
  assert.equal(R.tracePaths(frames,0,4,f=>({...point(f),track:f===frames[1]?1:0}),()=> 'green').edges,1);
});
test('batched paths retain every pitch sample but never bridge missing detection or a splice', () => {
  const frames = [1, 2, null, 4, 5, 6, 7].map((cents, i) => ({start: i/100, end: (i+1)/100, cents, takeId: i<5?'a':'b'}));
  const before = JSON.stringify(frames), result = R.tracePaths(frames, 0, frames.length, point, ()=>'green');
  assert.equal(result.edges,3);
  assert.deepEqual(result.colors,[['green','M0.000 1.000L1.000 2.000M3.000 4.000L4.000 5.000M5.000 6.000L6.000 7.000']]);
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
