const {test}=require('node:test'), assert=require('node:assert/strict');
const {fit,fitHistorical}=require('../tools/local_station/alignment.cjs');
const notes=Array.from({length:24},(_,i)=>[i*.25,(i+1)*.25,[[60,64,62,69,59][i%5]]]);
function signal(delay,other=delay){return notes.flatMap(([a,b,[p]],i)=>Array.from({length:25},(_,j)=>{
  const d=i<12?delay:other;return {start:a+d+j*.01,end:a+d+(j+1)*.01,cents:p*100+9};
})).sort((a,b)=>a.start-b.start);}
test('global search recovers early, late and on-time pitches; the baseline is retained',()=>{
  for (const ms of [-73,0,104]){const r=fit(signal(ms/1000),notes,125);assert.equal(r.advanceMs,ms);assert.ok(Math.abs(r.fittedCommonMean-9)<1e-5);}
});
test('a held pitch, no voice, inconsistent shifts and range edges are not calibration evidence',()=>{
  assert.equal(fit(signal(0),[[0,6,[60]]],125).status,'insufficient transitions');
  assert.equal(fit([],notes,125).advanceMs,0);
  assert.notEqual(fit(signal(.01,.11),notes,125).status,'consistent fit');
  assert.equal(fit(signal(.17),notes,125).status,'at search bound');
});

test('one supported pitch change returns its best listening offset but labels the evidence sparse',()=>{
  const one=[[0,1,[60]],[1,2,[67]]];
  const frames=one.flatMap(([a,,[p]])=>Array.from({length:100},(_,j)=>({start:a+.13+j/100,end:a+.13+(j+1)/100,cents:p*100})));
  const r=fit(frames,one,200);
  assert.equal(r.advanceMs,130);assert.equal(r.status,'sparse evidence');
});

test('different offsets are applied before a comp splice, once to both PCM and pitch',()=>{
  const {splice}=require('../template/comp_audio.js'), {framesFor}=require('../template/practice_comp.js');
  const segs=[{takeId:'a',from:0,to:1},{takeId:'b',from:1,to:2}], sr=1000;
  const out=new Float32Array(2000), sources=new Map();
  for(const [id,origin,advance,target] of [['a',0,.075,.4],['b',1,.150,.35]]){
    const refLatency=.06, pcm=new Float32Array(1200);pcm[Math.round((target+advance+refLatency)*sr)]=.75;
    splice(out,pcm,segs.filter(s=>s.takeId===id),origin,advance+refLatency,sr);
    sources.set(id,{origin,playbackAdvance:advance,analysisFrames:[{start:target+advance,end:target+advance+.02,cents:5000}]});
  }
  assert.deepEqual(Array.from(out).flatMap((v,i)=>v?[i]:[]),[400,1350]);
  assert.deepEqual(framesFor(segs,sources).map(f=>Math.round(f.start*sr)),[400,1350]);
});
function evidence(limit,peak){
  const gridMs=Array.from({length:2*limit+1},(_,i)=>i-limit),curve=gridMs.map(t=>Math.exp(-(((t-peak)/24)**2)/2));
  return {usable:true,strong:true,count:30,gridMs,curve,splitCurves:[curve,curve],peakMs:peak,halvesMs:[peak,peak],foldsMs:[peak,peak]};
}
test('same-pitch lyric attacks can supply timing on their own; uninformative noise cannot',()=>{
  const wave=evidence(180,118);
  assert.equal(fit(signal(0),[[0,6,[60]]],180,wave).advanceMs,118);
  assert.equal(fit(signal(0),[[0,6,[60]]],180,{...wave,usable:false}).advanceMs,0);
  const a=fit(signal(.113),notes,180,wave);
  assert.equal(a.basis,'pitch + lyric attacks');assert.ok(a.advanceMs>=113 && a.advanceMs<=118);
});
test('neighboring attacks cannot invert the fit; going beyond the cap requires opt-in and corroboration',()=>{
  const n=Array.from({length:20},(_,i)=>[i,i+1,[[60,64,62,69,59][i%5]]]);
  const frames=n.flatMap(([a,b,[p]])=>Array.from({length:80},(_,i)=>({start:a+.315+i/80,end:a+.315+(i+1)/80,cents:p*100})));
  const wide={...evidence(500,344),peaks:[[344,1],[-150,.38]]},w={...evidence(250,-150),wider:wide};
  const capped=fitHistorical(frames,n,250,w);
  assert.equal(capped.advanceMs,250);assert.equal(capped.onset.neighborRejected,true);
  const candidate=fitHistorical(frames,n,250,w,true);
  assert.equal(candidate.extended,true);assert.ok(candidate.advanceMs>=315 && candidate.advanceMs<=344);
  assert.equal(fitHistorical(frames,n,250,{...w,wider:{...wide,strong:false}},true).advanceMs,250);
});
