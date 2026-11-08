const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../template/take_cleanup.js');
const rate=16000;
function fixture(){
  let seed=1,filtered=0;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    filtered=.6*filtered+.4*(seed/2**32*2-1);return filtered;};
  const pcm=Int16Array.from({length:rate*3},(_,i)=>{const t=i/rate;
    if(t<1||t>2)return 4000*Math.sin(2*Math.PI*180*t);
    if(t>1.3&&t<1.65)return rand()*5000;
    return 0;
  });
  const frames=Array.from({length:300},(_,i)=>({start:i/100,end:(i+1)/100,cents:i<100||i>=200?6000:null}));
  return {pcm,frames,ref:{latency:0,notes:[[0,1,[60]],[2,3,[60]]]}};
}
test('broadband breath between phrases is muted with fades; source and timing are unchanged',()=>{
  const {pcm,frames,ref}=fixture(),before=pcm.slice();
  const ranges=C.breathRanges(pcm,rate,frames,ref);
  assert.ok(ranges.length,JSON.stringify(ranges));
  assert.deepEqual(pcm,before,'analysis never changes the original');
  const clean=C.apply(pcm.slice(),rate,ranges);
  assert.equal(clean.length,pcm.length);
  assert.deepEqual(clean.subarray(0,rate),pcm.subarray(0,rate));
  assert.deepEqual(clean.subarray(2*rate),pcm.subarray(2*rate));
  const energy=(p,a,b)=>p.subarray(a*rate,b*rate).reduce((s,x)=>s+x*x,0);
  assert.ok(energy(clean,1.32,1.63)<energy(pcm,1.32,1.63)*.04);
});
test('wrong pitches and missing detector evidence cannot be classified as breaths',()=>{
  const {pcm,frames,ref}=fixture();
  assert.deepEqual(C.breathRanges(pcm,rate,[],ref),[]);
  assert.deepEqual(C.breathRanges(pcm,rate,frames.map(f=>({...f,cents:7200})),ref),[]);
});
test('consonants at note attacks and releases remain intact',()=>{
  const {pcm,frames,ref}=fixture();
  for(let i=rate*1.3;i<rate*1.65;i++)pcm[i]=0;
  for(let i=rate*1.92;i<rate*2;i++)pcm[i]=(i%3-1)*4000;
  assert.deepEqual(C.breathRanges(pcm,rate,frames,ref),[]);
});
test('a quick soft inhalation near a release is removed, without changing the notes',()=>{
  const {pcm,frames,ref}=fixture();
  for(let i=rate;i<rate*2;i++)pcm[i]=0;
  let seed=42;
  for(let i=Math.round(rate*1.08);i<rate*1.22;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    pcm[i]=(seed/2**32*2-1)*90;
  }
  const ranges=C.breathRanges(pcm,rate,frames,ref),clean=C.apply(pcm.slice(),rate,ranges);
  assert.ok(ranges.some(([a,b])=>a<1.1&&b>1.2),JSON.stringify(ranges));
  const energy=p=>p.subarray(rate*1.08,rate*1.22).reduce((s,x)=>s+x*x,0);
  assert.ok(energy(clean)<energy(pcm)*.03);
  assert.deepEqual(clean.subarray(0,rate),pcm.subarray(0,rate));
});
test('colored inhalations, long breaths, and latency are handled without flattening sung dynamics',()=>{
  const {pcm,frames,ref}=fixture();
  let seed=71,filtered=0;
  for(let i=rate;i<rate*2;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    filtered=.8*filtered+.2*(seed/2**32*2-1);
    pcm[i]=filtered*5000;
  }
  const ranges=C.breathRanges(pcm,rate,frames,ref);
  assert.ok(ranges.some(([a,b])=>b-a>.75),JSON.stringify(ranges));
  const latency=.2,shifted=new Int16Array(pcm.length+rate*latency);
  shifted.set(pcm,rate*latency);
  const delayed=C.breathRanges(shifted,rate,frames,{...ref,latency});
  assert.equal(delayed.length,ranges.length);
  for(let i=0;i<ranges.length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(delayed[i][j]-ranges[i][j]-latency)<.011);
});
test('an untracked harmonic note and continuous room hiss are not breaths',()=>{
  const frames=Array.from({length:300},(_,i)=>({start:i/100,end:(i+1)/100,cents:null}));
  const ref={notes:[[0,3,[60]]]};
  const pcm=Int16Array.from({length:rate*3},(_,i)=>4000*Math.sin(2*Math.PI*180*i/rate));
  assert.deepEqual(C.breathRanges(pcm,rate,frames,ref),[]);
  let seed=17;
  for(let i=0;i<pcm.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pcm[i]=(seed/2**32*2-1)*1000;}
  assert.deepEqual(C.breathRanges(pcm,rate,frames,ref),[]);
});
