const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Level, Check, mediaDevicesFor} = require('../template/microphone_check.js');

test('only marked same-origin collection players use the host microphone API', () => {
  const local = {}, host = {};
  const view = {origin:'https://practice.test', navigator:{mediaDevices:local}};
  view.parent = view;
  assert.equal(mediaDevicesFor(view), local);
  view.parent = {origin:view.origin, navigator:{mediaDevices:host}};
  view.frameElement = {hasAttribute:name=>name==='data-melete-collection-player'};
  assert.equal(mediaDevicesFor(view), host);
  view.parent.origin = 'https://other.test';
  assert.equal(mediaDevicesFor(view), local);
  view.parent.origin = view.origin;
  view.frameElement = {hasAttribute:()=>false};
  assert.equal(mediaDevicesFor(view), local);
  Object.defineProperty(view, 'frameElement', {get(){throw new Error('Cross-origin access');}});
  assert.equal(mediaDevicesFor(view), local);
});

const tone = amplitude => Float32Array.from({length:2048}, (_,i) => amplitude * Math.sin(2*Math.PI*i/64));
test('microphone meter measures raw input independently of expected score pitch', () => {
  const result = new Level().sample(tone(.1), 100);
  assert.equal(result.state,'signal');
  assert.ok(Math.abs(result.db - -23.0103)<.001);
  assert.ok(result.percent>60 && result.percent<65);
});
test('silence, quiet input, DC offsets and muted input do not claim a healthy signal', () => {
  assert.equal(new Level().sample(tone(0),100).state,'listening');
  assert.equal(new Level().sample(tone(0),1500).state,'silent');
  assert.equal(new Level().sample(tone(.003),1500).state,'quiet');
  assert.equal(new Level().sample(new Float32Array(2048).fill(.1),1500).state,'silent');
  assert.equal(new Level().sample(tone(.5),1500,{muted:true}).state,'muted');
});
test('brief clipping is held visibly then clears; ordinary pauses clear signal', () => {
  const level = new Level();
  assert.equal(level.sample(tone(1),100).state,'clipping');
  assert.equal(level.sample(tone(.1),800).state,'clipping');
  assert.equal(level.sample(tone(.1),1200).state,'signal');
  assert.equal(level.sample(tone(0),2500).state,'silent');
});
test('invalid sample values cannot break the level meter', () => {
  const result = new Level().sample([NaN,Infinity,-Infinity],2000);
  assert.equal(result.state,'silent');
  assert.equal(result.db,-60);
});

function fixture({inline = false} = {}) {
  const element = () => ({textContent:'',style:{},dataset:{},handlers:{},
    addEventListener(k, fn){this.handlers[k]=fn;}, setAttribute(k,v){this[k]=v;}});
  const fields = Object.fromEntries(['select','[role=status]','[role=meter]','.mic-check-fill','output',
    '.mic-check-device','.mic-check-retry','.mic-check-close'].map(s=>[s,element()]));
  const dialog = {...element(),open:!inline,querySelector:s=>inline && ['select','.mic-check-device','.mic-check-retry','.mic-check-close'].includes(s)?null:fields[s],close(){this.open=false;this.handlers.close();}};
  const connections = new Set();
  let resolve, rejects, releases=0, chosen, requests=0, locked=false;
  const source = {connect:a=>connections.add(a),disconnect:a=>connections.delete(a)};
  const track = {readyState:'live',label:'Test input'};
  const context = {state:'running',createAnalyser:()=>({getFloatTimeDomainData:b=>b.set(tone(.1))})};
  const trigger=element();
  const check = new Check({dialog,trigger,inline,select:inline?fields.select:undefined,busy:()=>locked,
    acquire:()=>{requests++;return new Promise((a,b)=>{resolve=a;rejects=b;});},release:()=>{releases++;},
    choose:id=>{chosen=id;},failureMessage:e=>e.message});
  return {check,dialog,trigger,fields,connections,source,context,track,lock:value=>{locked=value;},requests:()=>requests,
    permit:()=>resolve({source,context,track}),deny:()=>rejects(new Error('Permission denied')),
    releases:()=>releases,chosen:()=>chosen};
}
test('closing while permission is pending cannot start a meter or retain microphone ownership', async () => {
  const f=fixture(), pending=f.check.start();
  assert.equal(f.check.active,true);
  f.check.close(); f.permit(); await pending;
  assert.equal(f.check.active,false);
  assert.equal(f.connections.size,0);
});
test('mic check has its own analyser and disconnects only that branch', async () => {
  const f=fixture(), shared={}; f.connections.add(shared);
  try {
    const pending=f.check.start(); f.permit(); await pending;
    assert.equal(f.dialog.dataset.state,'signal');
    assert.equal(f.fields['.mic-check-device'].textContent,'Test input');
    assert.equal(f.connections.size,2);
  } finally {f.check.close();}
  assert.deepEqual([...f.connections],[shared]);
});
test('permission failure offers retry without recording or turning on Sing', async () => {
  const f=fixture(), pending=f.check.start(); f.deny(); await pending;
  assert.equal(f.check.active,false);
  assert.equal(f.dialog.dataset.state,'error');
  assert.equal(f.fields['.mic-check-retry'].hidden,false);
  assert.equal(f.fields.select.disabled,false,'failed acquisition must leave device choice available');
  const retry=f.check.start(); f.permit(); await retry;
  assert.equal(f.dialog.dataset.state,'signal'); f.check.close();
});
test('device list refreshes before acquisition and remains usable after an unavailable device',async()=>{
  const f=fixture();let refreshes=0;
  f.check.refresh=async()=>{refreshes++;};
  const pending=f.check.start();await Promise.resolve();f.deny();await pending;
  assert.equal(refreshes,2);assert.equal(f.fields.select.disabled,false);
  f.check.close();
});
test('disconnect and interrupted audio release check ownership and show an error', async () => {
  for (const kind of ['track','context']) {
    const f=fixture(),pending=f.check.start();
    if(kind==='track') f.track.readyState='ended'; else f.context.state='suspended';
    f.permit(); await pending;
    assert.equal(f.dialog.dataset.state,'error');
    assert.equal(f.check.active,false);
    assert.equal(f.connections.size,0);
  }
});
test('device switching preserves the new choice while cleanup syncs the old selector', async () => {
  const f=fixture(); f.fields.select.value='new-input';
  f.check.release=()=>{f.fields.select.value='old-input';};
  f.fields.select.handlers.change();
  assert.equal(f.chosen(),'new-input');
  f.check.close(); f.permit();
});

test('inline meter stays visible and idle until clicked, and toggles without a dialog', async () => {
  const f=fixture({inline:true});
  assert.equal(f.dialog.dataset.state,'idle');
  assert.equal(f.requests(),0);
  assert.equal(f.fields.output.textContent,'');
  f.trigger.handlers.click();
  assert.equal(f.dialog.dataset.state,'requesting');
  assert.equal(f.trigger['aria-pressed'],'true');
  f.permit();await Promise.resolve();
  assert.equal(f.dialog.dataset.state,'signal');
  assert.equal(f.dialog.open,false);
  assert.match(f.trigger.title,/Test input; Input detected; Stop microphone check/);
  f.trigger.handlers.click();
  assert.equal(f.dialog.dataset.state,'idle');
  assert.equal(f.trigger['aria-pressed'],'false');
  assert.equal(f.connections.size,0);
});

test('inline device selector can change idle preferences without opening the microphone', async () => {
  const f=fixture({inline:true});
  f.fields.select.value='usb';
  f.check.syncSelector(f.fields.select);
  assert.equal(f.fields.select.value,'usb');
  f.fields.select.handlers.change();
  assert.equal(f.chosen(),'usb');
  assert.equal(f.requests(),0);
  const pending=f.check.start();f.permit();await pending;
  f.fields.select.value='built-in';f.fields.select.handlers.change();
  assert.equal(f.chosen(),'built-in');assert.equal(f.requests(),2);
  f.permit();await Promise.resolve();f.check.close();
});

test('inline failure keeps full guidance in the tooltip and retries in place', async () => {
  const f=fixture({inline:true});
  const pending=f.check.start();f.deny();await pending;
  assert.equal(f.fields['[role=status]'].textContent,'Input unavailable');
  assert.match(f.trigger.title,/Permission denied; Retry microphone check/);
  assert.equal(f.fields.select.disabled,false);
  f.trigger.handlers.click();f.permit();await Promise.resolve();
  assert.equal(f.dialog.dataset.state,'signal');f.check.close();
});

test('inline recording monitor cannot be toggled or change input while capture owns it', async () => {
  const f=fixture({inline:true});f.lock(true);
  f.trigger.handlers.click();assert.equal(f.requests(),0);
  const pending=f.check.start();f.permit();await pending;
  assert.equal(f.fields.select.disabled,true);
  assert.match(f.trigger.title,/Recording input/);
  f.trigger.handlers.click();assert.equal(f.check.active,true);
  f.fields.select.value='another';f.fields.select.handlers.change();
  assert.equal(f.chosen(),undefined);
  f.check.close();assert.equal(f.dialog.dataset.state,'idle');
});

test('cancelling an inline permission request leaves the selector usable and no meter connected', async () => {
  const f=fixture({inline:true});const pending=f.check.start();
  f.trigger.handlers.click();f.permit();await pending;
  assert.equal(f.dialog.dataset.state,'idle');
  assert.equal(f.fields.select.disabled,false);
  assert.equal(f.connections.size,0);
});
test('three quiet chirps recover an acoustic delay and reject silence or inconsistent detections', () => {
  const {timingChirp, measuredLatency}=require('../template/microphone_check.js');
  const rate=48000, starts=[.08,.8,1.52], chirp=timingChirp(rate), length=Math.ceil(2.3*rate);
  let seed=17;
  const capture=delays=>{
    const samples=Float32Array.from({length},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return .001*(seed/2**32-.5);});
    delays.forEach((delay,i)=>{if(delay===null)return;const first=Math.round((starts[i]+delay)*rate);
      chirp.forEach((v,j)=>{samples[first+j]+=.7*v;});}); return samples;
  };
  assert.ok(Math.abs(measuredLatency(capture([.137,.137,.137]),rate,starts)-.137)<.002);
  assert.equal(measuredLatency(capture([.137,null,.137]),rate,starts),.137);
  assert.equal(measuredLatency(capture([null,null,null]),rate,starts),null);
  assert.equal(measuredLatency(capture([.1,.19,.28]),rate,starts),null);
  const {calibration,freshCalibration}=require('../template/microphone_check.js');
  const result=calibration(capture([.135,.136,.14]),rate,starts,1000);
  assert.ok(Math.abs(result.seconds-.136)<.001 && result.spreadMs===5);
  assert.equal(freshCalibration(result,1001),result);
  assert.equal(freshCalibration(result,1000+12*3600000),null);
  assert.equal(freshCalibration(result,999),null);
  assert.equal(calibration(capture([.135,null,.135]),rate,starts),null);
  assert.equal(calibration(capture([.135,.136,.175]),rate,starts),null);
});
test('a wired adapter cannot borrow the selected built-in microphone identity or calibration',()=>{
  const {inputRoute,verifyInputRoute}=require('../template/microphone_check.js');
  const names=['iPad Microphone','USB Audio'],devices=names.map((label,i)=>({kind:'audioinput',deviceId:'in'+i,label}));
  const track=(i,label)=>({label,getSettings:()=>({deviceId:i})});
  for(const tr of [track('in1',names[1]),track('in1',names[0]),track('in0',names[1])]){
    assert.throws(()=>verifyInputRoute(devices,'in0',tr),{name:'InputRouteMismatchError'});
    assert.equal(inputRoute(devices,'in0',tr).id,'');
  }
  for(const tr of [track('',names[0]),track('in0',names[0])]){
    assert.equal(verifyInputRoute(devices,'in0',tr).verified,true);
    assert.equal(verifyInputRoute(devices,'in0',tr).id,'in0');
  }
  assert.equal(verifyInputRoute(devices,'',track('in1',names[1])).id,'in1');
  assert.equal(verifyInputRoute([], '',track('','')).verified,false);
});
test('only the installed wired iPad uses a separate warmup; the audio session category is never forced',()=>{
  const {wiredTabletSetup}=require('../template/microphone_check.js'), session=Object.freeze({type:'auto'});
  const builtin='tablet', input={kind:'audioinput',deviceId:builtin,label:'iPad Microphone'};
  const devices=[input,{kind:'audiooutput',deviceId:'default',label:'Default - USB Audio'}];
  const view={navigator:{standalone:true,audioSession:session}};
  assert.equal(wiredTabletSetup(view,devices,'some-other-input'),false);
  assert.equal(wiredTabletSetup(view,devices,builtin),true);
  view.navigator.standalone=false;assert.equal(wiredTabletSetup(view,devices,builtin),false);
  view.navigator.standalone=true;devices[1].label='Bluetooth';assert.equal(wiredTabletSetup(view,devices,builtin),false);
});
test('the fourth late iPad return is captured; unrelated peaks, ambiguous echoes, and a late outlier cannot calibrate',()=>{
  const {timingChirp,timingPlan:p,chirpReadings,fitChirps}=require('../template/microphone_check.js');
  const rate=16000, starts=p.offsets.map(t=>t-p.offsets[0]-.015);
  // Also exercise a mic worklet that started 15 ms after the first scheduled probe.
  const capture=(kind,delays)=>{
    const data=new Float32Array(Math.ceil((starts.at(-1)+p.tail)*rate));
    for(const [i,delay] of delays.entries()){
      if(delay===null)continue;
      const at=Math.round((starts[i]+delay)*rate),chirp=timingChirp(rate,p.directions[i]);
      if(kind==='click'){data[at]=.126;continue;}
      for(let j=0;j<chirp.length;j++){data[at+j]+=chirp[j];if(kind==='echo')data[at+j+rate*.04]+=chirp[j];}
    }
    return data;
  };
  const read=(data,max=p.maxDelay)=>chirpReadings(data,rate,starts,p.directions,max);
  for(const dt of [.082,.866,1.49]){
    const pcm=capture('direct',[dt,dt+.001,dt,dt+.001]), r=read(pcm), fit=fitChirps(r);
    assert.ok(r.every(v=>v.accepted&&v.audible)&&Math.abs(fit.seconds-dt)<.002);
    assert.ok(Math.abs(fit.residualMs)<=2);
    if(dt>.55)assert.equal(fitChirps(read(pcm,.55)),null);
  }
  const echo=read(capture('echo',Array(4).fill(.866)));
  assert.ok(echo.every(x=>x.audible&&!x.accepted));assert.equal(fitChirps(echo),null);
  assert.equal(fitChirps(read(capture('direct',[.866,.866,.866,.92]))),null);
  assert.equal(fitChirps(read(capture('direct',[.866,.866,.866,null]))),null);
  assert.ok(read(capture('click',Array(4).fill(.866))).every(x=>!x.audible));
});
test('wired codes independently identify four weak returns without favoring an 82 ms lag',()=>{
  const {wiredCodes:code,wiredTimingPlan:p,fitChirps}=require('../template/microphone_check.js');
  const rate=16000, test=(delay,{echo=false,missing=-1,swapped=false}={})=>{
    let random=9242;
    const pcm=Float32Array.from({length:Math.ceil((p.offsets.at(-1)+p.tail)*rate)},(_,i)=>{
      random=(Math.imul(random,1664525)+1013904223)>>>0;
      return .00008*(random/2**32-.5)+.00009*Math.sin(i*2*Math.PI*327/rate);
    });
    for(let i=0;i<4;i++){
      const a=code.signal(rate,swapped?(i+1)%4:i);
      assert.ok(a.every(x=>Math.abs(x)<=.086));
      if(i===missing)continue;
      const d=Math.round((p.offsets[i]+delay[i])*rate);
      for(let j=0;j<a.length;j++){
        const x=(a[j]+(a[j-1]||0))*.0007;pcm[d+j]+=x;
        if(echo)pcm[d+Math.round(rate*.067)+j]+=x;
      }
    }
    return p.offsets.map((t,i)=>code.read(pcm,rate,t,i,p.maxDelay));
  };
  for(const dt of [.081,.313,.822,1.485]){
    const rows=test([dt,dt+.002,dt,dt-.002]);
    assert.ok(rows.every(r=>r.accepted));assert.ok(Math.abs(fitChirps(rows).seconds-dt)<.002);
  }
  for(const opt of [{echo:true},{missing:3},{swapped:true}])assert.equal(fitChirps(test(Array(4).fill(.82),opt)),null);
  assert.equal(fitChirps(test([.082,.08,.082,.132])),null);
  assert.equal(code.read(new Float32Array(8),rate,0,1).accepted,false);
});
test('consistent slow physical returns justify one fresh route, not a two-chirp calibration',()=>{
  const {bufferedReturns,fitChirps}=require('../template/microphone_check.js');
  const rows=(...ms)=>ms.map(n=>({accepted:n!==null,seconds:(n||0)/1000}));
  assert.ok(bufferedReturns(rows(816,804,null,805)));
  assert.ok(bufferedReturns(rows(null,null,781,770)));
  for(const ms of [[null,null,null,766],[77,76,null,null],[80,804,null,805],[610,910,null,null]])
    assert.equal(bufferedReturns(rows(...ms)),false);
  assert.equal(fitChirps(rows(null,null,781,770)),null);
});
test('a delayed transport callback cannot shift the recorded audio or the detector frame',()=>{
  const {passClock,sampleScoreTime}=require('../template/microphone_check.js');
  for(const speed of [.75,1,1.25])for(const delay of [0,.027,.180]){
    const sr=48000,clock=passClock(12+delay,90+delay,90,3,3,speed,sr,.137);
    assert.equal(clock.frame,12*sr);
    for(const realError of [-.075,0,.075]){
      const center=12+.4+realError+.137;
      const live=sampleScoreTime(clock,center+.042,.042);
      const saved=clock.position+((center*sr-clock.frame)/sr-clock.latency)*speed;
      assert.ok(Math.abs(live-saved)<1e-9);
      assert.ok(Math.abs(live-(3+(.4+realError)*speed))<1e-9);
    }
  }
});
