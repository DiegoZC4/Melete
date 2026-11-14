const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../template/native_station.js'),'utf8');
function fixture({station=true,origin='http://127.0.0.1:18746',injected=true}={}) {
  const context={top:{location:{origin}}, MeleteStation:{requested:()=>station},
    addEventListener(){},crypto:{randomUUID:()=> 'fixture'},performance:{now:()=>1000},
    Float32Array,Set,Map,Promise,EventTarget,ArrayBuffer,Uint8Array,DataView,TextDecoder,AbortSignal,setTimeout,clearTimeout};
  if(injected)context.top.MeleteNativeStationConfig={origin,token:'fixture-only'};
  vm.runInNewContext(source,context);
  const engine={basePosition:0,rate:1,playing:false};
  return {bridge:context.MeleteNativeStation.create(engine),engine,context};
}
test('native audio is opt-in local station only; generic, public, and mobile stay on Web Audio',()=>{
  assert.ok(fixture().bridge);
  for(const opts of [{station:false},{injected:false},{origin:'https://diegozc.com'},
    {origin:'https://chordus-local.diegozc.com:38809'}])assert.equal(fixture(opts).bridge,null);
});
test('delayed HTTP status cannot move the native presentation clock backwards',()=>{
  const {bridge:b}=fixture();
  b.acceptState({session:'s',frame:4800,events:[{sequence:4}],playing:true,position:1,rate:1,outputLatency:.034,callbackAge:0});
  b.acceptState({session:'s',frame:4320,events:[{sequence:3}],playing:true,position:.99});
  assert.equal(b.state.frame,4800);
  assert.equal(b.position(false),1);
  assert.equal(b.position(true),.966);
  b.acceptState({session:'s',frame:4800,events:[{sequence:3}],playing:false,position:.99});
  assert.equal(b.state.playing,true);
});
test('native microphone reports raw PCM and never calls getUserMedia',async()=>{
  const {bridge:b}=fixture();
  b.open=async()=>{};
  b.state={session:'s',input:'Fixture'};
  const mic=await b.microphone(),settings=mic.stream.getAudioTracks()[0].getSettings();
  assert.equal(settings.sampleRate,48000);
  for(const k of ['echoCancellation','noiseSuppression','autoGainControl'])assert.equal(settings[k],false);
  assert.equal(typeof mic.source.nativeCapture,'function');
});
test('asset upload preserves channel order and frame-domain origin',async()=>{
  const {bridge:b}=fixture();b.state={session:'s'};const requests=[];
  b.request=async(...args)=>requests.push(args);
  await b.upload('fixture',{length:3,numberOfChannels:2,sampleRate:24000,
    getChannelData:c=>Float32Array.from(c?[4,5,6]:[1,2,3])},{origin:-2,offset:1,gain:.5});
  const [route,pcm,headers]=requests[0],meta=JSON.parse(headers['X-Melete-Asset']);
  assert.equal(route,'asset');assert.deepEqual([...pcm],[1,2.5,1.5,3]);
  assert.equal(meta.descriptor.origin,-2);assert.equal(meta.descriptor.frames,2);
});
test('pan drag coalesces updates without pausing or opening the native transport',async()=>{
  const {bridge:b,engine}=fixture();
  b.state={session:'s'};engine.metronomeVolume=.5;
  const calls=[];
  b.control=async(kind,values)=>{calls.push([kind,values]);await new Promise(r=>setTimeout(r,5));};
  const pending=[];
  for(let i=0;i<200;i++)pending.push(b.mix(new Set([0]),[150,50],[i%100,-100]));
  await Promise.all(pending);
  assert.ok(calls.length<=2,'only first and latest drag states need sending');
  assert.ok(calls.every(([kind])=>kind==='mix'));
  assert.deepEqual(calls.at(-1)[1].pans,[.99,-1]);
  assert.equal(b.state.session,'s');
});
test('native Hear toggles reuse rendered PCM per recording instead of mastering a full mix again',async()=>{
  const {bridge:b,engine:e,context:c}=fixture();b.state={session:'s'};
  let renders=0,uploads=0;
  c.MeleteTakeMix={renderAudio:async()=>{renders++;return {buffer:{},offset:0};}};
  c.MeleteTakeLoudness={mix:()=>({gain:.5})};
  b.upload=async key=>{uploads++;return key;};
  const a={id:'a',loudnessKey:'recording-a-v1',buffer:{},start:0,end:10,loudness:{gain:2}},d={...a,id:'b',loudnessKey:'recording-b-v1',buffer:{}};
  e.takeLayers=new Map([['a',a],['b',d]]);e.referenceLayers=new Map();e.duration=10;
  await b.layers();assert.equal(renders,2);assert.equal(uploads,2);
  e.takeLayers.delete('a');await b.layers();
  e.takeLayers.set('a',a);await b.layers();
  assert.equal(renders,2);assert.equal(uploads,2);
  assert.equal(Object.keys(b.assets).length,2);
  a.buffer={};await b.layers();assert.equal(renders,2,'re-decoding unchanged audio preserves the native cache');
  a.octave=1;await b.layers();assert.equal(renders,3,'changing octave invalidates only that recording');
});
