const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Tracker,Contour}=require('../vowel-lab/live_tracker.js');
const rate=48000;

function vowel(pitch,formants,seconds=1){
  const pcm=new Float32Array(Math.round(rate*seconds));
  let phase=0,source=0,peak=0;
  const poles=formants.map((hz,i)=>{
    const r=Math.exp(-Math.PI*[70,90,120,180][i]/rate);
    return {a:2*r*Math.cos(2*Math.PI*hz/rate),b:-r*r,y:0,z:0};
  });
  for(let i=0;i<pcm.length;i++){
    phase+=pitch/rate;
    source=.91*source+(phase>=1?1:0);phase%=1;
    let sample=source;
    for(const p of poles){sample+=p.a*p.y+p.b*p.z;p.z=p.y;p.y=sample;}
    pcm[i]=sample;peak=Math.max(peak,Math.abs(sample));
  }
  return pcm.map(x=>.3*x/peak);
}
function track(pcm){
  const tracker=new Tracker(),rows=[];
  for(let end=2400;end<=pcm.length;end+=800)rows.push({...tracker.process(pcm.subarray(end-2400,end),rate,1000*end/rate),time:end/rate});
  return rows;
}
test('a held measured vowel survives one erroneous pair and follows a real offglide',()=>{
  const c=new Contour(),a={f1:400,f2:2750},b={f1:775,f2:1250};
  for(let t=0;t<400;t+=20)c.push(a,t);
  const outlier=c.push({f1:400,f2:520},400);
  assert.ok(Math.abs(outlier.f2-2750)<1);
  let after;for(let t=420;t<=760;t+=20)after=c.push(b,t);
  assert.ok(Math.abs(after.f1-b.f1)<20 && Math.abs(after.f2-b.f2)<70);
  assert.equal(c.push(null,1100),null);
});
test('absolute formants follow a changing vowel at three sung pitches and clear in rests',()=>{
  for(const pitch of [72,140,220]){
    const audio=new Float32Array(rate*3);
    audio.set(vowel(pitch,[750,1200,2700,3500]),rate/2);
    audio.set(vowel(pitch,[300,2300,3000,3800]),1.5*rate);
    const rows=track(audio),a=rows.find(r=>r.time>=1.2).result,b=rows.find(r=>r.time>=1.8).result;
    assert.ok(Math.abs(a.f1-750)<75 && Math.abs(a.f2-1200)<145);
    assert.ok(Math.abs(b.f1-300)<75 && Math.abs(b.f2-2300)<145);
    assert.ok(rows.filter(r=>r.time>2.6).every(r=>r.result===null));
  }
});
test('noise and clipping clear the dot and high notes carry a resolution flag',()=>{
  const high=track(vowel(440,[750,1200,2700,3500]));
  assert.ok(high.slice(-10).some(f=>f.state==='limited'));
  assert.ok(high.every(f=>!f.result || !('f0' in f.result)));
  const loud=track(new Float32Array(4800).fill(1));assert.ok(loud.every(f=>f.state==='clipping' && !f.result));
  let seed=77;
  const noise=Float32Array.from({length:16000},()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed/2**32-.5)*.03;});
  assert.ok(track(noise).every(r=>r.snr.db<r.snr.thresholdDb && !r.result));
});
