const test=require('node:test'), assert=require('node:assert/strict');
const {makeEstimator,hzToBark,chartPoint,strokes,referenceExample,referenceRegion}=require('../template/vowel_matching.js');
const {vowels,vowelPCM}=require('./vowel-fixture.cjs');

test('known Zwicker–Terhardt Bark values and coordinates on the fixed formant axes',()=>{
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,actual+' vs '+expected);
  for (const [hz,bark] of [[0,0],[175,1.720817648],[500,4.736466582],[1000,8.510531511],
    [1250,9.974113041],[2000,13.104056343],[3500,16.496129041]]) near(hzToBark(hz),bark);
  assert.deepEqual(chartPoint({f1:175,f2:3500}),{x:0,y:0});
  assert.deepEqual(chartPoint({f1:1250,f2:500}),{x:1,y:1});
  for (const [f1,f2,x,y] of [[500,1500,.450418575,.365387253],[700,1800,.346977410,.565303095],
    [300,2350,.201427027,.145271297],[780,1250,.554609116,.638950617],[350,830,.777011780,.201924558]]) {
    const point=chartPoint({f1,f2});
    near(point.x,x); near(point.y,y);
  }
});

test('identical measured formants stay at the same coordinates an octave apart',()=>{
  const estimate=makeEstimator(), formants=[700,1800], rate=48000;
  const points=[100,200].map(fundamental=>{
    const wave=vowelPCM(formants,fundamental,rate,.24);
    const measured=estimate(wave.subarray(6200-4096,6200),rate);
    assert.deepEqual(measured,{f1:700,f2:1800});
    return chartPoint(measured);
  });
  assert.deepEqual(points[0],points[1]);
  const frames=Array.from({length:12},(_,i)=>({t:i*75, f1:700, f2:1800}));
  const reference=pitch=>referenceExample(frames.map(frame=>({...frame,f0:pitch})));
  assert.deepEqual(reference(100),reference(200));
  assert.deepEqual(reference(200).runs[0][0],{f1:700,f2:1800,t:0});
});

test('resonances and chart orientation follow the vowel at several equal pitches and input rates',()=>{
  const estimate=makeEstimator();
  for(const rate of [44100,48000,96000]) for(const pitch of [98,123,165,190]) {
    const points={};
    for(const [vowel,target] of Object.entries(vowels)) {
      const result=estimate(vowelPCM(target,pitch,rate).slice(-4096),rate);
      assert.ok(result,vowel+' at '+pitch+' Hz and '+rate+' samples/s');
      assert.ok(Math.abs(result.f1-target[0])<=90 && Math.abs(result.f2-target[1])<=105,JSON.stringify(result));
      points[vowel]=chartPoint(result);
    }
    assert.ok(points.ee.x<points.ah.x && points.ah.x<points.oo.x);
    assert.ok(points.ee.y<points.ah.y && points.oo.y<points.ah.y);
  }
});

test('silence, low levels, noisy consonants and sparsely excited resonances produce gaps',()=>{
  const estimate=makeEstimator(), rate=48000, length=4096;
  const wave=vowelPCM(vowels.ah,123,rate).slice(-length);
  let state=41861,last=0;
  const fricative=Float32Array.from({length},()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const n=state/2**32-0.5, out=.25*(n-last);last=n;return out;
  });
  const inputs=[new Float32Array(length),wave.map(v=>v*.002),fricative,
    Float32Array.from({length},(_,i)=>.14*Math.sin(2*Math.PI*125*i/rate)+.07*Math.sin(2*Math.PI*250*i/rate))];
  for(const pitch of [349,392,523,698]) for(const target of Object.values(vowels))
    inputs.push(vowelPCM(target,pitch,rate).slice(-length));
  for(const input of inputs) assert.equal(estimate(input,rate),null);
});

const frames=(pairs,start=0)=>pairs.map((pair,i)=>pair ? {t:start+75*i,f1:pair[0],f2:pair[1]} : {t:start+75*i});
test('a held middle defines the guide; its moving closure and timing survive, and gaps never connect',()=>{
  const held=Array(16).fill(vowels.ah), closure=[[650,1180],[540,1050],[420,940],vowels.oo];
  const trace=frames([null,[500,1500],...held,...closure,null,null,vowels.ee,vowels.ee]);
  const ref=referenceExample(trace);
  assert.deepEqual(ref.middle,{f1:780,f2:1250});
  assert.equal(ref.runs.length,2);
  assert.equal(ref.runs[0][0].t,0);
  assert.equal(ref.runs[0].at(-1).f2,vowels.oo[1]);
  assert.equal(ref.runs[1][0].t-ref.runs[0].at(-1).t,225);
  assert.equal(strokes([{t:0,f1:310,f2:2280},{t:500,f1:315,f2:2280}]).length,2);
  const region=referenceRegion([ref]);
  assert.ok(region.low1<780 && region.high1>780 && region.low2<1250 && region.high2>1250);
  const next=referenceExample(frames(Array(15).fill([820,1350])));
  assert.ok(referenceRegion([ref,next]).high2>1350);
  assert.equal(referenceRegion([]),null);
});
test('short, interrupted or continuously unstable demonstrations cannot be pinned as a steady guide',()=>{
  for(const pairs of [[],Array(12).fill(null),Array(3).fill(vowels.ee),
    Array.from({length:16},(_,i)=> i%4===0 ? null : vowels.oo),
    Array.from({length:16},(_,i)=> i%2 ? vowels.oo : vowels.ee)]) {
    assert.equal(referenceExample(frames(pairs)),null);
  }
});
