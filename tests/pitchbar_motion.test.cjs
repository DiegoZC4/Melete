const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');

function fixture() {
  let now = 10000, frameLag = 0;
  const animations = [], systems = [0, 4000, 8000].map(startTick => ({
    startTick, endTick:startTick+4000, xAtTick:tick=>34+(tick-startTick)/10,
    cursor:{style:{}, animate(frames, options) {
      const animation = {frames,options,canceled:false,cancel(){this.canceled=true;}};
      animations.push(animation); return animation;
    }},
  }));
  const clock = {playing:true,anchorTime:1,basePosition:0,rate:1,duration:12,loopEndSeconds:null,
    secondsAtTick:tick=>tick/1000,tickAtSeconds:seconds=>seconds*1000,tempoSegments:[],
    hasLoop(){return this.loopEndSeconds!==null;},withinLoop:s=>s>=0&&s<8};
  const ctx = vm.createContext({engine:clock,barSystems:systems,barPlayheadMotion:null,
    activeBarSystemIndex:-1,scoreView:'bars',performance:{now:()=>now},
    document:{timeline:{get currentTime(){return now-frameLag;}}}});
  vm.runInContext(app.slice(app.indexOf('  function stopBarPlayheadMotion()'),
    app.indexOf('  function pitchCaptureSupported()')),ctx);
  return {ctx,clock,systems,animations,setNow:n=>now=n,setFrameLag:n=>frameLag=n};
}

test('pitchbar animates future rows from one audio anchor instead of chasing RAF samples',()=>{
  const {ctx,animations,setNow}=fixture();
  ctx.updateBarPlayhead(1000);
  assert.equal(animations.length,3);
  assert.equal(animations[0].startTime,10000);
  assert.equal(animations[0].options.duration,3000);
  assert.equal(animations[1].startTime,13000,'next row starts even if JS stalls at its boundary');
  assert.equal(animations[0].options.fill,'backwards','current row stays visible during the pending first frame');
  assert.equal(animations[1].options.fill,'none','future rows are not visible early');
  for(const delay of [16,80,500,3100]) {
    setNow(10000+delay);ctx.updateBarPlayhead(1000+delay);
    assert.equal(animations.length,3,'no per-frame restarts or stale-position easing');
  }
});

test('late frame callbacks synchronize the existing compositor phase to fresh audio time',()=>{
  const {ctx,animations,setNow,setFrameLag}=fixture();
  setFrameLag(8);ctx.updateBarPlayhead(1000);
  assert.equal(animations[0].startTime,9992);
  const original=[...animations];
  for(const [i,lag] of [8,10,12,14,16,18,20,22,8,15].entries()){
    const elapsed=(i+1)*19;
    setNow(10000+elapsed);setFrameLag(lag);ctx.updateBarPlayhead(1000+elapsed);
    assert.equal(animations.length,3,'phase correction does not recreate animations');
    assert.ok(original.every(a=>!a.canceled));
    const renderedSeconds=1+(10000+elapsed-lag-animations[0].startTime)/1000;
    assert.ok(Math.abs(renderedSeconds-(1+elapsed/1000))<1e-9);
    assert.equal(animations[1].startTime-animations[0].startTime,3000,
      'future row remains on the same clock');
  }
});

test('pause, seek, rate, loop and output-clock discontinuities cancel old animations',()=>{
  for(const change of ['pause','seek','rate','loop','device','view']) {
    const {ctx,clock,animations,setNow}=fixture();ctx.updateBarPlayhead(1000);
    const old=[...animations];
    if(change==='pause')clock.playing=false;
    if(change==='seek'){clock.basePosition=2;clock.anchorTime=2;}
    if(change==='rate')clock.rate=.5;
    if(change==='loop')clock.loopEndSeconds=8;
    if(change==='device')setNow(10500);
    if(change==='view')ctx.scoreView='standard';
    ctx.updateBarPlayhead(1000);
    assert.ok(old.every(a=>a.canceled),change);
    if(change==='pause')assert.equal(ctx.barSystems[0].cursor.style.opacity,'1');
    if(change==='loop')assert.equal(animations.length-old.length,2,'never animate beyond loop end');
    if(change==='rate')assert.equal(animations[3].options.duration,6000);
  }
});

test('tempo changes use seconds for keyframe offsets and ticks for geometric placement',()=>{
  const {ctx}=fixture();
  const system={xAtTick:t=>t};
  const clock={tempoSegments:[{seconds:2}],tickAtSeconds:s=>s<2?s*1000:2000+(s-2)*2000};
  const frames=ctx.barPlayheadKeyframes(system,clock,1,3);
  assert.deepEqual(Array.from(frames,f=>f.offset),[0,.5,1]);
  assert.deepEqual(Array.from(frames,f=>f.transform),[
    'translate3d(999px, 0, 0)','translate3d(1999px, 0, 0)','translate3d(3999px, 0, 0)']);
});

test('static fallback hides the old row and preserves the note left-edge alignment',()=>{
  const {ctx,systems}=fixture();systems.forEach(s=>delete s.cursor.animate);
  ctx.updateBarPlayhead(0);assert.equal(systems[0].cursor.style.transform,'translate3d(33px, 0, 0)');
  ctx.updateBarPlayhead(4000);assert.equal(systems[0].cursor.style.opacity,'0');
  assert.equal(systems[1].cursor.style.opacity,'1');
});
