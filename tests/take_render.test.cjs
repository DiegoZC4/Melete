const {test} = require('node:test');
const assert = require('node:assert/strict');
const R = require('../template/take_render.js');
const A = require('../template/comp_audio.js');
const P = require('../template/take_pitch.js');
const point = f => ({x: f.start * 100, y: f.cents, track: 0, error: 1});
test('ten-cent increments keep progressing in both hue and perceived color distance',()=>{
  const dot=(u,v)=>u.reduce((sum,n,i)=>sum+n*v[i],0);
  function lab(ink) {
    const rgb=(ink.startsWith('#')?ink.slice(1).match(/../g).map(s=>parseInt(s,16)):ink.match(/\d+/g).map(Number))
      .map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const lms=[[.412221,.536333,.051446],[.211903,.680700,.107397],[.088302,.281719,.629979]].map(row=>Math.cbrt(dot(row,rgb)));
    return [[.210454,.793618,-.004072],[1.977998,-2.428592,.450594],[.025904,.782772,-.808676]].map(row=>dot(row,lms));
  }
  let prev=lab(R.color(10));
  for(let e=20;e<=100;e+=10) {
    const v=lab(R.color(e)), distance=Math.hypot(...v.map((n,i)=>n-prev[i]));
    assert.ok(distance>=.05 && distance<=.073,'a ten-cent interval must not collapse or leap: '+e+' / '+distance);
    assert.ok(v[0]<prev[0] && Math.atan2(v[2],v[1])<Math.atan2(prev[2],prev[1]));
    prev=v;
  }
});
test('an edge follows signed error, not just its last grade or the two absolute errors',()=>{
  const a={cents:5900,error:-100,tick:0,x:0,y:5}, b={cents:6100,error:100,tick:100,x:60,y:-5};
  const stops=R.edgeStops(a,b,R.color);
  assert.deepEqual(stops[0],[0,R.color(100)]);assert.deepEqual(stops.at(-1),[1,R.color(100)]);
  for(const e of [10,25,50,77,88])
    for(const sign of [-1,1])assert.ok(stops.some(([t,c])=>Math.abs(t-(100+sign*e)/200)<1e-8 && c===R.color(e)));
  const above=R.edgeStops({...a,cents:6100,error:100},{...b,cents:6300,error:300},R.color);
  assert.ok(above.every(s=>s[1]===R.color(100)),'a sustained error beyond a semitone stays red');
});
test('rest, count-in and written target changes stay at their score times, not halfway between samples',()=>{
  const changing=R.edgeStops({cents:6100,error:100,tick:0},{cents:6300,error:100,tick:1},R.color);
  assert.ok(changing.every(v=>v[1]===R.color(100)),'two wrong notes must not invent a green crossing at a chord change');
  for(const prior of [0,null,'preparation']) {
    const a={cents:6000,error:prior,tick:0,x:0,y:0},b={...a,tick:100,x:80,error:-100};
    const s=R.edgeStops(a,b,R.color,t=>t<73?prior:-100);
    const jump=s.findIndex((v,i)=>i&&s[i-1][0]===v[0]&&s[i-1][1]!==v[1]);
    if(prior===null){assert.ok(s.every(v=>v[1]===R.color(100)));continue;}
    assert.ok(jump>0 && Math.abs(s[jump][0]-.73)<.001);
    assert.deepEqual([...new Set(s.map(v=>v[1]))],[R.color(prior),R.color(-100)]);
  }
});
test('five minutes of a changing sung contour do not allocate a paint server or a stop per frame',()=>{
  const fs=Array.from({length:30000},(_,i)=>({start:i/100,end:(i+1)/100,cents:6040+30*Math.sin(i/15)}));
  const r=R.tracePaths(fs,0,fs.length,f=>({x:f.start*65,y:-(f.cents-6000)*.055,track:0,error:f.cents-6000}),R.color);
  let nodes=0;
  const svg=()=>({append(){nodes++;}});
  for(const {x1,y1,x2,y2,stops} of r.ramps)R.svgPaint(svg(),svg,x1,y1,x2,y2,stops);
  assert.ok(r.ramps.length<500 && nodes<12000,JSON.stringify({paints:r.ramps.length,nodes}));
  assert.equal(r.edges,29999);
});
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
