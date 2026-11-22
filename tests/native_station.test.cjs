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
  const engine={basePosition:0,rate:1,playing:false,overdubRevision:0};
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
  let releases=0;
  b.releaseWhenIdle=()=>{releases++;};
  mic.stream.getAudioTracks()[0].enabled=false;
  mic.stream.getAudioTracks()[0].enabled=false;
  assert.equal(releases,1,'parking the authorized mic gives the system output back');
});
test('idle release protects armed capture, playback, held notes and a reopened session',async()=>{
  const {bridge,engine,context}=fixture();
  let scheduled,closed=0;
  context.setTimeout=fn=>{scheduled=fn;return 1;};
  bridge.close=async()=>{closed++;};
  bridge.state={session:'first',playing:false};
  const tick=()=>{bridge.releaseWhenIdle();scheduled();};
  engine.playing=true;tick();engine.playing=false;
  bridge.inputEnabled=true;tick();bridge.inputEnabled=false;
  bridge.state.playing=true;tick();bridge.state.playing=false;
  bridge.heldPreviews=1;tick();bridge.heldPreviews=0;
  bridge.listeners.add('capture');tick();bridge.listeners.clear();
  bridge.preparing=Promise.resolve();tick();bridge.preparing=null;
  bridge.releaseWhenIdle();bridge.state={session:'next',playing:false};scheduled();
  assert.equal(closed,0);
  bridge.control=async kind=>{assert.equal(kind,'pause');return {stopFrame:480};};
  assert.equal((await bridge.pause()).stopFrame,480);
  scheduled();assert.equal(closed,1);
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
  e.canMonitorTake=()=>true;
  await b.layers();assert.equal(renders,2);assert.equal(uploads,2);
  e.takeLayers.delete('a');await b.layers();
  e.takeLayers.set('a',a);await b.layers();
  assert.equal(renders,2);assert.equal(uploads,2);
  assert.equal(Object.keys(b.assets).length,2);
  a.buffer={};await b.layers();assert.equal(renders,2,'re-decoding unchanged audio preserves the native cache');
  a.octave=1;await b.layers();assert.equal(renders,3,'changing octave invalidates only that recording');
});

test('individual Hear changes the active native assets during playback without stopping or seeking',async()=>{
  const {bridge:b,engine:e,context:c}=fixture();
  const app=fs.readFileSync(require.resolve('../template/app.js'),'utf8');
  const start=app.indexOf('    setTakeReview(review) {'),end=app.indexOf('    stopVoices(',start);
  const node=()=>({gain:{},connect(){return this;},disconnect(){}});
  const Engine=vm.runInNewContext(`(class {${app.slice(start,end)}})`,{
    URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},Audio:class{load(){} removeAttribute(){}},
    window:{MeleteTakeMix:{bus:()=>({input:{}})}},takeReverbControl:{value:()=>0},takeVolumeControl:{value:()=>100},
    compPanel:{recordingLayers:()=>['comp:old-alias','raw-take']},takeOctave:()=>0,SCHEDULER_LEAD_SECONDS:.03});
  Object.setPrototypeOf(e,Engine.prototype);
  Object.assign(e,{native:b,playing:true,basePosition:17,duration:40,takeLayers:new Map(),referenceLayers:new Map(),
    pinnedTakeIds:new Set(),context:{createGain:node,createMediaElementSource:node},
    stopTakeLayerAudio(){},balanceTakeLayers(){this.takeBalanceJob=Promise.resolve();}});
  b.state={session:'same-session',playing:true,position:17};b.open=async()=>{};b.releaseWhenIdle=()=>{};
  b.prepareMedia=async()=>b.layers();
  const changes=[];let renders=0;
  b.control=async(kind,value)=>{assert.equal(kind,'assets','no pause, play or seek to apply a Hear toggle');changes.push({...value.assets});};
  c.MeleteTakeMix={renderAudio:async()=>{renders++;return {buffer:{},offset:0};}};
  c.MeleteTakeLoudness={mix:()=>({gain:1})};b.upload=async key=>key;
  const settle=async()=>{await new Promise(r=>setImmediate(r));await b.preparing;};
  const review=()=>({id:'take',buffer:{},blob:{},start:0,end:40,loudnessKey:'same-recording',loudness:{gain:1}});
  e.addTakeLayer(review(),true);await settle();assert.ok(changes.at(-1)['recording:0']);
  e.removeTakeLayer('take');await settle();assert.deepEqual(changes.at(-1),{});
  e.addTakeLayer(review(),true);await settle();assert.ok(changes.at(-1)['recording:0']);
  assert.equal(renders,1,'cached audio returns immediately without another render');
  assert.equal(changes.length,3);assert.equal(e.playing,true);assert.equal(e.basePosition,17);
  e.referenceLayers.set('ref',{...review(),id:'ref',loudnessKey:'guide-reference'});
  e.addTakeLayer({...review(),id:'other',loudnessKey:'second-recording'},true);
  await settle();assert.ok(changes.at(-1)['recording:1']);
  const reference=changes.at(-1)['reference:0'];
  assert.ok(reference);
  e.clearTakeLayers();await settle();
  assert.deepEqual(changes.at(-1),{'reference:0':reference});
  assert.equal(e.pinnedTakeIds.size,0);
  assert.equal(b.state.session,'same-session');assert.equal(b.state.playing,true);
  const row=(id,extra={})=>({...review(),id,loudnessKey:id,...extra});
  const target=row('comp:visible',{compLayers:['comp:old-alias']}), raw=row('raw-take'), dub=row('same-part-dub');
  const temporary=row('temporary-review');
  e.updateTakeLayers([target,raw,dub]);e.setTakeReview(temporary);await settle();
  const pins=[...e.pinnedTakeIds];e.setOverdubTarget('writing-key');await settle();
  assert.deepEqual([target,raw,dub,temporary].map(layer=>e.canMonitorTake(layer)),[false,false,true,false]);
  assert.equal(Object.keys(changes.at(-1)).filter(k=>k.startsWith('recording:')).length,1);
  e.setOverdubTarget(null);await settle();
  assert.equal(Object.keys(changes.at(-1)).filter(k=>k.startsWith('recording:')).length,4);
  assert.deepEqual([...e.pinnedTakeIds],pins,'punching in and out does not edit Hear buttons');
});

test('punch-in waits for an already warming native asset list to be replaced',async()=>{
  const {bridge:b,engine:e}=fixture();let release;const events=[];
  b.open=async()=>{};b.releaseWhenIdle=()=>{};b.mix=async()=>{};b.recordingLabel=()=> 'fixture';
  b.prepareMedia=async()=>{const rev=e.overdubRevision;
    if(rev===0)await new Promise(r=>{release=r;});
    b.assets=rev===0?{target:'old',dub:'keep'}:{dub:'keep'};};
  b.control=async(kind,params)=>{events.push([kind,params]);return {playing:true,recording:true,frame:4000,position:1};};
  const warming=b.prepare();await new Promise(r=>setImmediate(r));
  e.overdubRevision++;const punching=b.punchIn();release();await Promise.all([warming,punching]);
  assert.deepEqual(events.map(e=>e[0]),['assets','assets','punchIn']);
  assert.deepEqual({...events[1][1].assets},{dub:'keep'});
});
