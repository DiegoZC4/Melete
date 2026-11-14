const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../template/take_loudness.js');
const meter=require('../vendor/bravoh-loudness/dist/index.cjs');
const sine=(amplitude,seconds=2,hz=440)=>Float32Array.from({length:Math.round(seconds*48000)},(_,i)=>amplitude*Math.sin(i*2*Math.PI*hz/48000));
test('quiet recordings reach the fixed stereo target; level differences normalize without changing dynamics',()=>{
  const quiet=sine(.01), loud=sine(.08), copy=quiet.slice();
  const a=L.plan(L.analyze([quiet],48000),{dualMono:true}),b=L.plan(L.analyze([loud],48000),{dualMono:true});
  assert.ok(a.gain>15);assert.ok(Math.abs(a.gain/b.gain-8)<1e-5);
  assert.equal(a.outputLufs,-14);assert.deepEqual(quiet,copy);
  const out=quiet.map(x=>x*a.gain);
  assert.ok(Math.abs(L.analyze([out,out],48000).integratedLufs+14)<.01);
});
test('correlated doubles and uncorrelated layers get one safe whole-mix gain',()=>{
  const a=sine(.03), b=sine(.1,2,370);
  const gain=x=>L.plan(L.analyze([x],48000),{dualMono:true}).gain;
  const ga=gain(a),gb=gain(b);
  for(const mixed of [a.map(x=>2*x*ga),a.map((x,i)=>x*ga+b[i]*gb)]){
    const plan=L.plan(L.analyze([mixed,mixed],48000));
    const output=mixed.map(x=>x*plan.gain), measured=L.analyze([output,output],48000);
    assert.ok(Math.abs(measured.integratedLufs+14)<.01);
    assert.ok(measured.truePeakDbtp<=-2+.01);
  }
});
test('crest-factor headroom takes priority over LUFS; silence and near-noise are not boosted',()=>{
  const plan=L.plan({integratedLufs:-35,truePeakDbtp:-1});
  assert.equal(plan.gainDb,-1);assert.equal(plan.peakLimited,true);
  assert.equal(L.plan(L.analyze([new Float32Array(48000)],48000)).gain,1);
  assert.equal(L.plan({integratedLufs:-65,truePeakDbtp:-50}).gain,1);
  assert.equal(L.plan({integratedLufs:-55,truePeakDbtp:-50}).gainDb,30);
});
test('loudness meter matches the BS.1770 1kHz -23 LUFS stereo reference',()=>{
  const a=sine(10**(-23/20),3,1000);
  assert.ok(Math.abs(L.analyze([a,a],48000).integratedLufs+23)<.1);
  const wave=meter.encodeWav([a],48000);
  const decoded=meter.decodeWav(wave);
  assert.equal(decoded.sampleRateHz,48000);
});
test('Hear balances from cached loudness and peak metrics without rendering audio',()=>{
  const p=L.plan({integratedLufs:-30,truePeakDbtp:-20},{dualMono:true});
  const one=L.mix([p]),eight=L.mix(Array(8).fill(p));
  assert.equal(one.gain,1);
  assert.ok(eight.gain<one.gain);
  const worstPeak=8*10**(p.truePeakDbtp/20)*p.gain*eight.gain;
  assert.ok(worstPeak<=10**(L.CEILING/20)+1e-9);
  assert.equal(L.mix([]).gain,1);
  assert.ok(L.mix([p],{reverb:100}).gain<=one.gain);
});
