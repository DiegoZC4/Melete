// Run the same unmodified multi-song player, transport and storage code in each engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {readCollection} = require('./collection-fixture.cjs');
const {enableSing} = require('./browser-sing.cjs');
const {wavBytes} = require('../template/loop_recorder.js');
const pw = require(require.resolve('playwright', {paths:[process.env.GUI_QA_NODE_MODULES || __dirname]}));
const origin = 'http://127.0.0.1:8809';
const row = '#compRows .take-row:not(.is-new) .take-hear:not(:disabled)';

function fixture(dir,config) {
  const xml = fs.readFileSync(path.join(__dirname,'fixtures/shared-regressions.musicxml'),'utf8');
  const songs = ['First song','Second song'].map((name,i) => {
    const file = path.join(dir,'score-'+i+'.musicxml');
    fs.writeFileSync(file,xml.replace('Shared regression score',name)); return file;
  });
  const project = path.join(dir,'build');
  const options=[];
  if(config){const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(config));options.push('--config',file);}
  execFileSync(process.env.PYTHON || 'python3',[path.join(__dirname,'../build_trainer.py'),...songs,'--project-dir',project,...options]);
  return path.join(project,'dist/index.html');
}

function audioRig({synthetic,hz}) {
  const devices=window.MeleteMicrophoneCheck?.mediaDevicesFor(window) || navigator.mediaDevices;
  if(synthetic && devices && devices.getUserMedia.name!=='syntheticMicrophone') {
    const syntheticMicrophone = async () => {
      const ctx=new AudioContext(), osc=ctx.createOscillator(), gain=ctx.createGain(), sink=ctx.createMediaStreamDestination();
      osc.frequency.value=hz; gain.gain.value=.12; osc.connect(gain).connect(sink); osc.start(); await ctx.resume();
      return sink.stream;
    };
    Object.defineProperty(devices,'getUserMedia',{value:syntheticMicrophone,configurable:true});
  }
  if(window.qaOutputPeak) return;
  const connect = AudioNode.prototype.connect;
  const outputs = new Map();
  window.qaOutputPeak = () => {
    let peak=0;
    for (const meter of outputs.values()) {
      const samples=new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(samples);
      for (const value of samples) peak=Math.max(peak,Math.abs(value));
    }
    return peak;
  };
  // Observe the real final mix before a silent output. Never play our test tones in the room.
  AudioNode.prototype.connect = function(dest,...args) {
    if (this.context instanceof AudioContext && dest===this.context.destination) {
      if (!outputs.has(this.context)) {
        const meter=this.context.createAnalyser(), mute=this.context.createGain();
        meter.fftSize=2048; mute.gain.value=0;
        connect.call(meter,mute); connect.call(mute,dest); outputs.set(this.context,meter);
      }
      connect.call(this,outputs.get(this.context),...args); return dest;
    }
    return connect.call(this,dest,...args);
  };
}

async function active(page,song) {
  const element=page.locator('iframe[aria-hidden="false"]').filter({visible:true}).first();
  await page.waitForFunction(title=>document.querySelector('iframe[aria-hidden="false"]')?.title===title,song.title+' practice score');
  const frame=await (await element.elementHandle()).contentFrame();
  await frame.locator('#playPause:not(:disabled)').waitFor({state:'visible'});
  return frame;
}
async function section(frame,name) {
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  const head=frame.locator('[data-settings-section="'+name+'"] .settings-section-toggle');
  if (await head.isVisible() && await head.getAttribute('aria-expanded')==='false') await head.click();
}
async function seek(frame,ms) {
  await frame.locator('#seek').evaluate((el,value)=>{
    el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  },ms);
}
async function stored(frame) {
  return frame.evaluate(async () => {
    const store=new MeleteRecording.TakeStore();
    try {
      const takes=(await store.usage()).filter(t=>t.finalized && t.frames);
      if (!takes.length) return null;
      const take=takes[0], data=await (await store.wav(take.id)).arrayBuffer();
      const pcm=new Int16Array(data,44); let sum=0,peak=0;
      for(const v of pcm){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
      const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      const voiced=(MeleteTakePitch.readContour(take)||[]).filter(f=>Number.isFinite(f.cents)).length;
      return {id:take.id,frames:take.frames,rate:take.sampleRate,peak,rms:Math.sqrt(sum/pcm.length),
        trackedSeconds:take.pitchScore?.trackedSeconds || 0,
        voiced,contourHash:voiced?await digest(take.pitchContour.pitches):null,hash:await digest(data)};
    } finally {(await store.open()).close();}
  });
}
async function level(frame,ms) {
  await seek(frame,ms);
  await frame.locator('#playPause').click();
  try {
    await frame.waitForFunction(at=>+document.querySelector('#seek').value>at+200,ms);
    return await frame.evaluate(async()=>{
      let peak=0;
      for(let i=0;i<18;i++){peak=Math.max(peak,window.qaOutputPeak());await new Promise(r=>setTimeout(r,35));}
      return peak;
    });
  } finally {await frame.locator('#playPause').click();}
}
async function checkInputErrors(frame,start,tablet) {
  await section(frame,'practice');
  const sing=frame.locator('#pitchCapture');
  const state=s=>frame.locator('#microphoneCheck[data-state="'+s+'"]').waitFor({state:'attached'});
  await frame.evaluate(tablet=>{
    const devices=MeleteMicrophoneCheck.mediaDevicesFor(window),keys=['getUserMedia','enumerateDevices'];
    const descriptors=keys.map(k=>Object.getOwnPropertyDescriptor(devices,k)),enumerate=devices.enumerateDevices.bind(devices);
    if(tablet){Object.defineProperty(navigator,'platform',{configurable:true,value:'MacIntel'});
      Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});}
    const test=window.qaBadInput={denied:true,requests:0,contexts:[],restore(){if(tablet){delete navigator.platform;delete navigator.maxTouchPoints;}keys.forEach((k,i)=>{
      if(descriptors[i])Object.defineProperty(devices,k,descriptors[i]);else delete devices[k];});}};
    Object.defineProperty(devices,'enumerateDevices',{configurable:true,value:async()=>[...await enumerate(),
      {kind:'audioinput',deviceId:'qa-recovery-mic',label:'USB Audio'}, {kind:'audioinput',deviceId:'qa-ipad-mic',label:'iPad Microphone'}]});
    Object.defineProperty(devices,'getUserMedia',{configurable:true,value:async constraints=>{
      test.requests++;test.chosen=constraints.audio.deviceId?.exact;
      if(test.denied)throw new DOMException('Test permission denied','NotAllowedError');
      const ctx=new AudioContext(),out=ctx.createMediaStreamDestination(),osc=ctx.createOscillator();test.contexts.push(ctx);
      // Firefox may optimize a zero-gain source out of the graph (no frames at all).
      // Deliver real frames below -90 dBFS to test the separate live-but-silent case.
      const built=test.chosen==='qa-ipad-mic';
      const gain=test.gain=ctx.createGain();gain.gain.value=built ? .1 : .00002;osc.connect(gain).connect(out);osc.start();
      Object.defineProperty(out.stream.getAudioTracks()[0],'label',{configurable:true,value:built?'iPad Microphone':' USB Audio'});
      await ctx.resume();return out.stream;
    }});
  },tablet);
  try {
    await enableSing(frame);await state('error');
    assert.match(await frame.locator('#checkMicrophone').getAttribute('title'),/Microphone blocked/i);
    const requests=await frame.evaluate(()=>qaBadInput.requests);
    await section(frame,'takes');await frame.locator('#checkMicrophone').click();
    const dialog=frame.locator('#micRecoveryDialog');
    assert.equal(await dialog.isVisible(),true);
    assert.match(await frame.locator('#micRecoveryState').innerText(),/access blocked/i);
    assert.equal(await frame.evaluate(()=>qaBadInput.requests),requests,'inspecting must not prompt');
    assert.ok(await frame.evaluate(()=>MeleteMicrophoneCheck.deviceEvents(localStorage).some(e=>e.event==='input-error' && e.code==='NotAllowedError')));
    await frame.locator('#micRecoveryDevice').selectOption('qa-recovery-mic');
    assert.equal(await frame.evaluate(()=>qaBadInput.requests),requests,'browsing available inputs does not open them');
    await frame.evaluate(()=>{qaBadInput.denied=false;});
    await frame.locator('#micRecoveryRetry').click();await state('silent');
    assert.equal(await frame.evaluate(()=>qaBadInput.requests),requests+1,'one explicit retry, one request');
    assert.equal(await frame.evaluate(()=>qaBadInput.chosen),'qa-recovery-mic','retry must actually use the staged alternate input');
    assert.match(await frame.locator('#micRecoveryAdvice').innerText(),/splitter/);
    if(tablet){
      assert.equal(await frame.locator('#micRecoveryRoute').innerText(),'Active input: USB Audio');
      await frame.locator('#micRecoveryBuiltin').click();await state('signal');
      assert.equal(await frame.locator('#micRecoveryRoute').innerText(),'Active input: iPad Microphone');
      assert.equal(await frame.evaluate(()=>localStorage.getItem('choir-practice:microphone:v1:ipad')),'qa-ipad-mic');
      assert.equal(await frame.locator('#playPause').getAttribute('aria-label'),'Play score','changing input must not start a take');
    }
    await dialog.getByRole('button',{name:'Close microphone settings'}).click();
    if(tablet){
      await frame.locator('#takeMicrophone').selectOption('');await state('silent');
      assert.equal(await frame.locator('#takeMicrophone option:checked').textContent(),'Default: USB Audio');
      assert.equal(await frame.evaluate(()=>localStorage.getItem('choir-practice:microphone:v1:ipad')),null,'returning to default clears the pin');
    }
    assert.match(await frame.locator('#microphoneCheck').innerText(),/No signal/i);
    const warning=frame.locator('#micSignalWarning');
    assert.equal(await warning.isVisible(),false,'silence while armed is fine');
    await seek(frame,start);await frame.locator('#settingsToggle').click();
    await frame.locator('#playPause').click();
    await warning.waitFor({state:'visible',timeout:12000});
    assert.equal(await frame.locator('#settingsToggle').getAttribute('aria-expanded'),'false');
    await frame.locator('#micSignalAction').click();assert.equal(await dialog.isVisible(),true);
    assert.equal(await frame.locator('#micRecoveryRetry').isDisabled(),true);
    assert.equal(await frame.locator('#micRecoveryDevice').isDisabled(),true);
    if(tablet)assert.equal(await frame.locator('#micRecoveryBuiltin').isDisabled(),true,'never move a live recording onto another mic');
    await frame.evaluate(()=>{qaBadInput.gain.gain.value=.1;});await state('signal');
    assert.match(await frame.locator('#micRecoveryState').innerText(),/Input detected/);
    await dialog.getByRole('button',{name:'Close microphone settings'}).click();
    await warning.waitFor({state:'hidden'});
    assert.equal(await sing.getAttribute('data-state'),'recording','recovery must not interrupt the pass');
    await frame.locator('#playPause').click();await section(frame,'practice');
  } finally {
    if(await sing.getAttribute('aria-pressed')==='true')await sing.click();
    await frame.evaluate(async()=>{qaBadInput.restore();await Promise.all(qaBadInput.contexts.map(c=>c.close()));delete window.qaBadInput;});
  }
}
async function check(browser,engine,html,songs,viewport,songIndex) {
  const target=songs[songIndex], other=songs[1-songIndex], data=JSON.parse(target.html.match(/<script id="playback-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const part=data.parts.find(p=>p.short==='B2') || data.parts[1], note=data.notes.find(n=>n[0]===part.index);
  const start=Math.round(data.tempos.reduce((ms,[tick,bpm],i,tempos)=>
    ms+Math.max(0,Math.min(note[1],tempos[i+1]?.[0]??note[1])-tick)*60000/(bpm*data.division),0));
  const ctx=await browser.newContext({viewport,hasTouch:viewport.width<600});
  const errors=[], blocked=[],diagnostics=[];
  let stage='load',frame;
  try {
    const rig={synthetic:engine==='webkit',hz:440*2**(((note?.[3]??60)-69)/12)};
    await ctx.addInitScript(audioRig,rig);
    // Serve the actual file unchanged at a secure-context loopback origin. Never contact a real cloud account.
    await ctx.route(/^https?:/,route=>{
      if(route.request().resourceType()==='document' && new URL(route.request().url()).pathname==='/compat-player')
        return route.fulfill({contentType:'text/html',body:html});
      if(route.request().method()!=='GET') blocked.push(route.request().method());
      return route.abort();
    });
    const page=await ctx.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && diagnostics.length<12)diagnostics.push(m.text());});
    await page.goto(origin+'/compat-player?song='+target.id+'&view=pitchbar&part='+part.short,{waitUntil:'commit'});
    frame=await active(page,target);
    await frame.locator('#barScore:not([hidden]) svg').first().waitFor({state:'visible'});
    stage='switch songs';
    await frame.locator('#songToggle').click();frame=await active(page,other);
    await frame.locator('#songToggle').click();frame=await active(page,target);
    await section(frame,'display');
    await frame.locator('#scoreViewToggle').click();await frame.locator('#score:not([hidden]) .at-surface-svg').first().waitFor({state:'attached'});
    await frame.locator('#scoreViewToggle').click();
    stage='arm and record';
    await frame.evaluate(audioRig,rig);
    if(engine==='webkit') assert.equal(await frame.evaluate(()=>
      MeleteMicrophoneCheck.mediaDevicesFor(window)?.getUserMedia.name),'syntheticMicrophone',
      'do not request a physical mic in WebKit');
    await section(frame,'practice');
    const loop=frame.locator('#loopToggle');
    if(await loop.getAttribute('aria-pressed')==='true') await loop.click();
    await seek(frame,start); await enableSing(frame); await frame.locator('#playPause').click();
    await frame.locator('#pitchCapture[data-state="recording"]').waitFor({state:'attached'});
    await frame.waitForFunction(at=>+document.querySelector('#seek').value>at+2600,start);
    await frame.locator('#playPause').click();await section(frame,'takes');
    await frame.locator(row).first().waitFor({state:'attached'});
    const before=await stored(frame);
    assert.ok(before && before.frames/before.rate>=1.5 && before.rms>20,'expected non-silent microphone PCM: '+JSON.stringify(before));
    assert.ok(before.trackedSeconds>.1 && before.voiced>=5 && before.contourHash,'no usable sung pitch in saved take: '+JSON.stringify(before));
    stage='reload local take';
    await section(frame,'practice');await frame.locator('#pitchCapture').click();
    await page.reload({waitUntil:'commit'});frame=await active(page,target);
    await frame.evaluate(audioRig,rig);
    await section(frame,'takes');
    const hear=frame.locator(row).first();await hear.waitFor({state:'visible'});
    assert.deepEqual(await stored(frame),before,'PCM checksum, sample count, and take identity survive reload');
    stage='replay without MIDI';
    await section(frame,'parts');
    for(const ctl of await frame.locator('[data-audio-index]').all())
      if(await ctl.getAttribute('aria-pressed')==='true') await ctl.click();
    assert.equal(await frame.locator('#metronome').getAttribute('data-value'),'0');
    await section(frame,'takes');
    if(await hear.getAttribute('aria-pressed')==='true') await hear.click();
    await frame.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='false',row);
    const silent=await level(frame,start+300);
    await hear.click();await frame.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='true',row);
    const audible=await level(frame,start+300);
    assert.ok(silent<.0001 && audible>.001,'expected mute vs audible take: '+JSON.stringify({silent,audible}));
    stage='download take';
    const downloadPromise=page.waitForEvent('download');
    await frame.locator('#compRows .take-row:not(.is-new) .take-download:not(:disabled)').first().click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/\.wav$/i);
    const pcm=fs.readFileSync(await download.path());
    assert.equal(pcm.toString('ascii',0,4),'RIFF');
    assert.equal(pcm.toString('ascii',8,12),'WAVE');
    assert.ok(pcm.length>44 && pcm.subarray(44).some(v=>v!==0),'non-silent WAV download');
    const testBadInput=songIndex===1;
    if(testBadInput){stage='denied and flat microphone recovery';await checkInputErrors(frame,start,viewport.width<600);}
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    console.log(JSON.stringify({engine,version:browser.version(),viewport,recorded:target.title,
      part:await frame.locator('#compRows .take-row:not(.is-new) .take-part').first().textContent(),
      mic:engine==='webkit'?'synthetic Web Audio':'browser fake capture',seconds:+(before.frames/before.rate).toFixed(2),
      persistedPCM:true,trackedSeconds:+before.trackedSeconds.toFixed(2),silentPeak:silent,replayPeak:+audible.toFixed(4),
      downloadBytes:pcm.length,checkedInputFailureRecovery:testBadInput}));
  } catch(e) {
    const state=await frame?.evaluate(()=>({play:document.querySelector('#playPause')?.ariaLabel,
      mic:document.querySelector('#pitchCapture')?.outerHTML.slice(0,350),seek:document.querySelector('#seek')?.value,
      rows:document.querySelector('#compRows')?.innerText,status:document.querySelector('#takeStatus')?.textContent})).catch(()=>null);
    throw new Error(engine+' '+stage+' '+JSON.stringify({state,errors,diagnostics})+'\n'+e.stack);
  } finally {await ctx.close();}
}
async function run(){
  const arg=process.argv[2]||'firefox', engines=arg==='all'?['firefox','webkit','chromium']:[arg];
  assert.ok(engines.every(name=>['firefox','webkit','chromium'].includes(name)));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'melete-browser-compat-'));
  try {
    const html=fs.readFileSync(process.argv[3]||fixture(tmp),'utf8'),songs=readCollection(html).songs;
    const wave=path.join(tmp,'sustained.wav');
    if(engines.includes('chromium'))fs.writeFileSync(wave,Buffer.from(wavBytes(
      Int16Array.from({length:48000*5},(_,i)=>Math.round(4000*Math.sin(2*Math.PI*220*i/48000))),48000)));
    for(const engine of engines){
      const options=engine==='firefox'?{firefoxUserPrefs:{'media.navigator.streams.fake':true,'media.navigator.permission.disabled':true,
        'media.navigator.audio.fake_frequency':220,'media.autoplay.default':0,'media.autoplay.block-webaudio':false}}:
        engine==='chromium'?{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--mute-audio',
          '--use-file-for-fake-audio-capture='+wave]}:{};
      const browser=await pw[engine].launch(options);
      try {for(const viewport of [{width:1440,height:900},{width:390,height:844}])
        for(const index of [1,0]) await check(browser,engine,html,songs,viewport,index);}
      finally {await browser.close();}
    }
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
}
module.exports = {fixture, audioRig, active, section, seek, stored, level};
if (require.main===module) run().catch(e=>{console.error(e);process.exitCode=1;});
