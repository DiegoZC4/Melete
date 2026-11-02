const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Level, Check} = require('../template/microphone_check.js');

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
