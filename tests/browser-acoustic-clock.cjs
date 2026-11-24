const assert = require('node:assert/strict');
const {stabilizeFakeMedia} = require('./browser-fake-media.cjs');

// Isolated browser only. Smoke-test a real cross-context MediaStream, then
// use a sample-timed cable for absolute latency checks across page reloads.
async function checkAcousticClock(context, origin) {
  const page=await context.newPage();
  try {
    await stabilizeFakeMedia(page, {virtualOutput:true});
    await page.goto(origin);await page.waitForFunction(()=>window.__qa?.engine && !__qa.busy);
    if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
    if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
    function installCable(){
      const create=MeleteRecording.PcmCapture.create.bind(MeleteRecording.PcmCapture);
      window.cable={delay:.06};
      const check=MeleteMicrophoneCheck.freshCalibration;
      MeleteMicrophoneCheck.freshCalibration=function(saved,now,profile){
        const result=check(saved,now,profile);
        if(!result&&profile)cable.lastRejectedProfile={saved:saved?.profile,observed:profile};
        return result;
      };
      MeleteRecording.PcmCapture.create=async(mic,_source,onSamples,onError)=>{
        const out=__qa.engine.context, delay=out.createDelay(1);
        const silent=out.createConstantSource();silent.offset.value=0;silent.connect(delay);silent.start();
        delay.delayTime.value=cable.delay;
        const connected=!cable.disconnected;
        const gate=out.createGain();gate.connect(delay);
        if(cable.cold){gate.gain.setValueAtTime(0,out.currentTime);gate.gain.setValueAtTime(1,out.currentTime+.62);}
        if(connected)__qa.engine.finalOutput.connect(gate);
        // A fresh MediaStream adds a variable number of 10-ms FIFO blocks. It
        // cannot stand in for a cable with identical latency after a reload.
        const bus=cable.realStream ? out.createMediaStreamDestination() : null;
        if(bus)delay.connect(bus);
        const source=bus?mic.createMediaStreamSource(bus.stream):delay;
        if(!bus && out.sampleRate!==mic.sampleRate)throw Error('Virtual cable needs identical input/output sample rates');
        // Model a distinct input clock epoch on the deterministic cable. The
        // player must translate it; assuming identical clocks is 431 ms wrong.
        const offset=Math.round(.431*mic.sampleRate);
        if(!bus)Object.defineProperty(mic,'currentTime',{configurable:true,get:()=>out.currentTime+offset/mic.sampleRate});
        const capture=await create(bus?mic:out,source,bus?onSamples:(frame,pcm)=>onSamples(frame+offset,pcm),onError);
        const stop=capture.stop.bind(capture);
        capture.stop=async()=>{await stop();if(connected)__qa.engine.finalOutput.disconnect(gate);gate.disconnect();
          silent.stop();silent.disconnect();delay.disconnect();source.disconnect();bus?.stream.getTracks().forEach(t=>t.stop());};
        return capture;
      };
    }
    await page.evaluate(installCable);
    await page.locator('#openTimingCheck').click();
    // Chrome's fake "default" is deliberately unrelated to the two named endpoints.
    await page.evaluate(()=>{cable.realStream=true;});
    await page.locator('#measureTiming').click();
    await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled);
    assert.match(await page.locator('#timingCheckStatus').innerText(),/This tab only/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('melete:last-timing-route')),null);
    await page.evaluate(()=>{cable.realStream=false;});
    await page.locator('#playbackDevice').selectOption({label:'Fake Audio Output 1'});
    await page.waitForFunction(()=>document.getElementById('playbackDeviceStatus').textContent.includes('selected'));
    await page.locator('#closeTimingCheck').click();
    await page.locator('#takeMicrophone').selectOption({label:'Fake Audio Input 1'});
    await page.locator('#openTimingCheck').click();
    const results=[];
    for(const delay of [.06,.175,null,.856]){
      await page.evaluate(d=>Object.assign(cable,{delay:d||0,disconnected:d===null,cold:d===.06}),delay);
      await page.locator('#measureTiming').click();
      await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled && !document.getElementById('timingCheckStatus').textContent.startsWith('Measuring'));
      const result=await page.evaluate(()=>{
        const text=document.getElementById('timingCheckStatus').textContent;
        const key=Object.keys(localStorage).find(k=>k.startsWith('melete:roundtrip:'));
        const e=MeleteMicrophoneCheck.deviceEvents(localStorage).filter(e=>e.event.startsWith('calibration')).at(-1);
        return {text,saved:key && JSON.parse(localStorage.getItem(key)),event:e};
      });
      if(delay!==null && delay<.55){
        assert.ok(result.text.includes('Saved for this audio setup') && Math.abs(result.saved?.residualMs)<=12,result.text);
        const graphDelay=await page.evaluate(()=>__qa.engine.guideLookaheadSeconds);
        assert.ok(Math.abs(result.saved.seconds-delay-graphDelay)<=.016,'known cable plus guide graph delay: '+result.text);
      }
      else if(delay===null){assert.match(result.text,/0 of 4 chirps/);assert.match(result.text,/Still using the measured/);
        assert.deepEqual(result.saved,results.at(-1).saved,'weak input must not replace the last valid correction');
        assert.equal(result.event.inputPeak,'silence');assert.ok(Number.isFinite(result.event.outputDbfs));}
      else {assert.match(result.text,/long delay for this session only/);
        assert.equal(result.event.heard,4);assert.ok(Math.abs(result.event.delayMs-868)<16);
        assert.deepEqual(result.saved,results[1].saved,'a long buffered session must not replace another session calibration');}
      results.push(result);
    }
    const deltaMs=(results[1].saved.seconds-results[0].saved.seconds)*1000;
    assert.ok(Math.abs(deltaMs-115)<20,`known 115 ms change: ${JSON.stringify(results)}`);
    await page.locator('#closeTimingCheck').click();
    await page.evaluate(()=>{
      const key=localStorage.getItem('melete:last-timing-route'), r=JSON.parse(localStorage.getItem(key));
      r.measuredAt-=60*86400000;localStorage.setItem(key,JSON.stringify(r));
    });
    await page.reload();await page.waitForFunction(()=>window.__qa?.engine && !__qa.busy);
    if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
    await page.evaluate(installCable);
    await page.locator('#openTimingCheck').click();
    assert.match(await page.locator('#timingCheckStatus').innerText(),/Last measurement|Measured \d/);
    await page.locator('#closeTimingCheck').click();
    await require('./browser-sing.cjs').choosePart(page,0);
    await page.evaluate(()=>{
      const e=__qa.engine;e.seek(0);e.setLoop(null,null);
      cable.delay=.175;cable.disconnected=false;e.scheduleNote=()=>{};e.metronomeVolume=0;
      const listener=e.onTransportChange;
      e.onTransportChange=function(kind){
        if(kind==='play'){
          const score=[.25,.78,1.27], errors=[-.060,0,.070];
          score.forEach((time,i)=>{
            const pat=MeleteMicrophoneCheck.timingChirp(e.context.sampleRate,i!==1), buf=e.context.createBuffer(1,pat.length,e.context.sampleRate);
            buf.copyToChannel(pat,0);const n=e.context.createBufferSource();n.buffer=buf;
            n.connect(e.master);n.start(e.anchorTime+time+errors[i]);n.onended=()=>n.disconnect();
          });
        }
        return listener?.call(this,kind);
      };
    });
    await require('./browser-sing.cjs').startRecording(page);
    await page.waitForFunction(()=>__qa.recording.state==='recording' && __qa.engine.currentSeconds()>2.15);
    await page.locator('#playPause').click();
    await page.waitForFunction(()=>__qa.recording.state==='off' && __qa.recording.takes.some(t=>t.finalized));
    const take=await page.evaluate(async()=>{
      const t=__qa.recording.takes.find(t=>t.finalized), blob=await __qa.takeStore.wav(t.id);
      const pcm=Float32Array.from(new Int16Array(await blob.arrayBuffer(),44),n=>n/32768);
      const search=[.25,.78,1.27].map(s=>s-.10);
      const readings=MeleteMicrophoneCheck.chirpReadings(pcm,t.sampleRate,search,[true,false,true]);
      return {timing:t.pitchReference.timing, residualsMs:readings.map(r=>r.accepted?Math.round(1000*(r.seconds-.10-t.pitchReference.latency)):null)};
    });
    assert.equal(take.timing.source,'acoustic',JSON.stringify(await page.evaluate(()=>({
      rejection:cable.lastRejectedProfile,selectedInput:document.getElementById('takeMicrophone').selectedOptions[0]?.text,
      selectedOutput:document.getElementById('playbackDevice').selectedOptions[0]?.text
    }))));
    assert.equal(take.timing.seconds,results[1].saved.seconds);
    [-60,0,70].forEach((v,i)=>assert.ok(take.residualsMs[i]!==null && Math.abs(take.residualsMs[i]-v)<=16,JSON.stringify(take)));
    assert.ok(Date.now()-take.timing.measuredAt>=60*86400000,'reloaded take really used the two-month-old correction');
    if(await page.locator('#pitchCapture').getAttribute('aria-pressed')==='true')await page.locator('#pitchCapture').click();
    await page.evaluate(()=>{
      const create=MeleteRecording.PcmCapture.create;
      cable.reopenCount=0;MeleteMicrophoneCheck.wiredTabletSetup=()=>true;
      MeleteRecording.PcmCapture.create=(...args)=>{
        const k=cable.reopenCount++;
        cable.delay=k===0?.81:.07;cable.disconnected=!!cable.failRetry&&k===1;return create(...args);
      };
    });
    await page.locator('#openTimingCheck').click();await page.locator('#measureTiming').click();
    await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled,null,{timeout:45000});
    const recovery=await page.evaluate(()=>({starts:cable.reopenCount,text:document.getElementById('timingCheckStatus').textContent,
      events:MeleteMicrophoneCheck.deviceEvents(localStorage).filter(e=>e.event.startsWith('calibration')).slice(-2).map(e=>[e.event,e.chirpsMs])}));
    assert.equal(recovery.starts,2);assert.deepEqual(recovery.events.map(e=>e[0]),['calibration-reopening','calibration']);
    assert.ok(recovery.events[0][1].every(t=>t>790) && recovery.events[1][1].every(t=>t>60 && t<110));
    assert.match(recovery.text,/Earlier takes were not retimed/);
    const good=await page.evaluate(()=>localStorage.getItem(localStorage.getItem('melete:last-timing-route')));
    await page.evaluate(()=>Object.assign(cable,{reopenCount:0,failRetry:true}));
    await page.locator('#measureTiming').click();
    await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled,null,{timeout:45000});
    assert.match(await page.locator('#timingCheckStatus').innerText(),/Previous timing is not in use/);
    assert.equal(await page.evaluate(()=>localStorage.getItem(localStorage.getItem('melete:last-timing-route'))),good);
    await page.locator('#closeTimingCheck').click();
    await page.evaluate(()=>{__qa.engine.seek(0);});
    await require('./browser-sing.cjs').startRecording(page);
    await page.waitForFunction(()=>__qa.recording.state==='recording'&&__qa.engine.currentSeconds()>2);
    await page.locator('#playPause').click();
    await page.waitForFunction(()=>__qa.recording.state==='off' && __qa.recording.takes.some(t=>t.finalized&&t.pitchReference?.timing?.source==='unverified'));
    const ungraded=await page.evaluate(async()=>{
      const t=__qa.recording.takes.find(t=>t.finalized&&t.pitchReference?.timing?.source==='unverified');
      const row=document.querySelector('[data-take-id="'+t.id+'"]'), wav=await __qa.takeStore.wav(t.id);
      return {bytes:wav.size,frames:t.frames,applied:t.pitchReference.latency,score:t.pitchScore??null,inComp:
        (await __qa.takeStore.comps(t.song)).some(c=>c.segments.some(s=>s.takeId===t.id)),warning:row?.querySelector('.take-warning')?.title};
    });
    assert.ok(ungraded.frames>0);assert.equal(ungraded.bytes,44+2*ungraded.frames);assert.equal(ungraded.applied,0);
    assert.equal(ungraded.score,null);assert.equal(ungraded.inComp,false);assert.match(ungraded.warning,/without a pitch grade/);
    // An older offline player can open the same IndexedDB before its replacement
    // activates. Exercise the exact stale grade found on the real iPad.
    const witness=await page.evaluate(async()=>{
      const s=__qa.takeStore,t=__qa.recording.takes.find(t=>t.pitchReference?.timing?.source==='unverified');
      if(t.pitchReference.version===MeleteTakePitch.VERSION)throw Error('Older players could grade the new reference.');
      const wav=await (await s.wav(t.id)).arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wav)));
      await s.transaction(['takes'],'readwrite',(tx,done)=>{
        const records=tx.objectStore('takes');records.get(t.id).onsuccess=e=>{
          const r=e.target.result;r.pitchReference={...r.pitchReference,version:MeleteTakePitch.VERSION};
          r.pitchScore={...__qa.recording.takes.find(other=>other.pitchScore)?.pitchScore,meanAbsCents:271.3};
          records.put(r);done(true);};
      });return {id:t.id,hash,created:t.createdAt,updated:t.updatedAt};
    });
    await page.reload();await page.waitForFunction(()=>window.__qa?.engine&&!__qa.busy);
    await page.waitForFunction(id=>{const t=__qa.recording.takes.find(t=>t.id===id);
      return t&&!t.pitchScore&&t.pitchReference.version===MeleteTakePitch.UNGRADED_VERSION&&
        document.querySelector('.take-row[data-take-id="'+id+'"] .take-error strong')?.textContent==='\u2014';},witness.id);
    const restored=await page.evaluate(async id=>{const s=__qa.takeStore,t=(await s.usage()).find(t=>t.id===id);
      const wav=await (await s.wav(id)).arrayBuffer();return {id,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wav))),
        created:t.createdAt,updated:t.updatedAt,raw:!t.pitchScore&&t.pitchReference.version===MeleteTakePitch.UNGRADED_VERSION};},witness.id);
    assert.deepEqual(restored,{...witness,raw:true});
    return {outputRouting:'virtual cable',addedMs:115,observedMs:deltaMs,reloadedCalibrationAgeDays:60,checks:results.map(r=>r.text),expectedEntrancesMs:[-60,0,70],recordedEntrancesMs:take.residualsMs,recovery,ungraded};
  } finally {await page.close();}
}
module.exports={checkAcousticClock};
