const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {Channel,candidate} = require('../template/live_pitch.js');
const app = fs.readFileSync(path.join(__dirname,'../template/app.js'),'utf8');

test('pitch worker allows one job, transfers a copy, and retains capture-time metadata',()=>{
  const posts=[], results=[], worker={postMessage:(...args)=>posts.push(args),terminate(){}};
  const channel=new Channel(worker,(...args)=>results.push(args),error=>{throw error;});
  const input=new Float32Array([.1,.2]), metadata={tick:123,seconds:9};
  assert.equal(channel.submit(input,{sampleRate:48000},metadata),true);
  assert.equal(channel.submit(input,{},{}),false,'no stale audio queue');
  assert.notEqual(posts[0][0].input,input);
  assert.equal(posts[0][1][0],posts[0][0].input.buffer);
  worker.onmessage({data:{result:[440,1],cost:4}});
  assert.equal(results[0][1],metadata,'result delivery time never substitutes for capture time');
  assert.equal(input.length,2,'analyser buffer stays usable');
  assert.equal(channel.pending,null);
});

test('late pitch results cannot undo a pause, seek, loop, clear or part change',()=>{
  for(const action of ['pause','seek','loop','clear','part']) {
    const accepted=[], worker={postMessage(){},terminate(){this.closed=true;}};
    const channel=new Channel(worker,result=>accepted.push(result),error=>{throw error;});
    channel.submit(new Float32Array(4),{},{action});
    channel.invalidate();
    assert.equal(channel.submit(new Float32Array(4),{},{}),false,'old in-flight job is not duplicated');
    worker.onmessage({data:{result:[440,1],cost:1}});
    assert.equal(accepted.length,0);
    assert.equal(channel.submit(new Float32Array(4),{},{}),true);
    worker.onmessage({data:{result:[441,1],cost:1}});
    assert.equal(accepted.length,1);
    channel.close(); assert.equal(worker.closed,true);
    worker.onmessage({data:{result:[440,1]}});
    assert.equal(accepted.length,1);
  }
});

test('worker retains the existing octave-evidence retry without changing detector thresholds',()=>{
  const thresholds=[];
  const detector={clarityThreshold:.9,findPitch(){thresholds.push(this.clarityThreshold);return this.clarityThreshold===.9?[880,.95]:[440,.9];}};
  assert.deepEqual(candidate(detector,[],48000,6900,55,1200),[440,.9]);
  assert.deepEqual(thresholds,[.9,.98]);
  assert.equal(detector.clarityThreshold,.9);
  assert.deepEqual(candidate(detector,[],48000,null,55,1200),[880,.95]);
});

function engineFixture() {
  let now=1000;
  const frames=new Map(); let next=1;
  const context=vm.createContext({config:{}, performance:{now:()=>now},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    requestAnimationFrame:cb=>{const id=next++;frames.set(id,cb);return id;},
    cancelAnimationFrame:id=>frames.delete(id)});
  const start=app.indexOf('  class GuideEngine {'),end=app.indexOf('  function createSvgElement(');
  vm.runInContext(app.slice(start,end)+'\nglobalThis.Engine=GuideEngine;',context);
  const engine=new context.Engine({division:960,endTick:96000,tempos:[[0,60]],notes:[]});
  engine.playing=true; engine.basePosition=4; engine.anchorTime=10;
  engine.context={currentTime:12,baseLatency:.01,outputLatency:.02};
  return {engine,frames,setNow:n=>now=n};
}

test('presentation follows speaker timestamps, not FFT latency or delayed callback counts',()=>{
  const {engine,setNow}=engineFixture();
  engine.context.getOutputTimestamp=()=>({contextTime:11.9,performanceTime:990});
  assert.ok(Math.abs(engine.presentationSeconds()-5.91)<1e-8);
  engine.rate=.5;
  assert.ok(Math.abs(engine.presentationSeconds()-4.955)<1e-8);
  setNow(1400); engine.context.currentTime=12.4;
  assert.ok(Math.abs(engine.presentationSeconds()-5.185)<1e-8,'stale stamps fall back, not extrapolate indefinitely');
  engine.context.getOutputTimestamp=()=>({contextTime:0,performanceTime:0});
  assert.ok(Math.abs(engine.presentationSeconds()-5.185)<1e-8,'initial zeros are not a valid timestamp');
  engine.context.getOutputTimestamp=()=>{throw new Error('unsupported');};
  assert.ok(Math.abs(engine.presentationSeconds()-5.185)<1e-8);
  engine.context.currentTime=10;
  assert.equal(engine.presentationSeconds(),4,'startup latency does not move before the seek');
  engine.playing=false; engine.context.currentTime=15;
  assert.equal(engine.presentationSeconds(),4,'pause freezes presentation');
});

test('each visual frame reads the current audio clock and stop cancels the independent RAF',()=>{
  const {engine,frames}=engineFixture(), positions=[];
  engine.pushPosition=seconds=>positions.push(seconds);
  engine.startPresentation(); assert.equal(frames.size,1);
  const paint=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
  paint();
  engine.context.currentTime+=.2; // Simulate a delayed UI callback, not 12 invented frames.
  paint();
  assert.ok(Math.abs(positions[1]-positions[0]-.2)<1e-8);
  engine.startPresentation();assert.equal(frames.size,1,'no duplicate RAF chains');
  engine.stopPresentation();assert.equal(frames.size,0);
});

test('the engraved cursor uses the audio tick even if notation position callbacks are stale',()=>{
  const {engine}=engineFixture(),ticks=[],updates=[];
  engine.api={tickPosition:960,customCursorHandler:{sync:tick=>ticks.push(tick)}};
  engine.output={updatePosition:ms=>updates.push(ms)};
  engine.pushPosition(6.25);
  assert.equal(ticks[0],6000);
  assert.equal(updates[0],6250);
  assert.equal(engine.api.tickPosition,960,'does not seek or advance the independent notation player');
});
