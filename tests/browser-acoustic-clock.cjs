const assert = require('node:assert/strict');

// Isolated browser only. Send the real guide through a known delay into the
// real capture worklet, crossing the independently running Web Audio clocks.
async function checkAcousticClock(context, origin) {
  const page=await context.newPage();
  try {
    await page.goto(origin);await page.waitForFunction(()=>window.__qa?.engine && !__qa.busy);
    if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
    if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
    function installCable(){
      const create=MeleteRecording.PcmCapture.create.bind(MeleteRecording.PcmCapture);
      window.cable={delay:.06};
      MeleteRecording.PcmCapture.create=async(mic,_source,onSamples,onError)=>{
        const e=__qa.engine, bus=e.context.createMediaStreamDestination(), delay=e.context.createDelay(1);
        const source=mic.createMediaStreamSource(bus.stream);
        delay.delayTime.value=cable.delay;
        if(!cable.disconnected)e.finalOutput.connect(delay);
        delay.connect(bus);
        const capture=await create(mic,source,onSamples,onError), stop=capture.stop.bind(capture);
        capture.stop=async()=>{await stop();if(!cable.disconnected)e.finalOutput.disconnect(delay);
          delay.disconnect();source.disconnect();bus.stream.getTracks().forEach(t=>t.stop());};
        return capture;
      };
    }
    await page.evaluate(installCable);
    await page.locator('#openTimingCheck').click();
    // Chrome's fake "default" is deliberately unrelated to the two named endpoints.
    await page.locator('#measureTiming').click();
    await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled);
    assert.match(await page.locator('#timingCheckStatus').innerText(),/This tab only/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('melete:last-timing-route')),null);
    await page.locator('#playbackDevice').selectOption({label:'Fake Audio Output 1'});
    await page.waitForFunction(()=>document.getElementById('playbackDeviceStatus').textContent.includes('selected'));
    await page.locator('#closeTimingCheck').click();
    await page.locator('#takeMicrophone').selectOption({label:'Fake Audio Input 1'});
    await page.locator('#openTimingCheck').click();
    const results=[];
    for(const delay of [.06,.175,null]){
      await page.evaluate(d=>Object.assign(cable,{delay:d||0,disconnected:d===null}),delay);
      await page.locator('#measureTiming').click();
      await page.waitForFunction(()=>!document.getElementById('measureTiming').disabled && !document.getElementById('timingCheckStatus').textContent.startsWith('Measuring'));
      const result=await page.evaluate(()=>{
        const text=document.getElementById('timingCheckStatus').textContent;
        const key=Object.keys(localStorage).find(k=>k.startsWith('melete:roundtrip:'));
        return {text,saved:key && JSON.parse(localStorage.getItem(key))};
      });
      if(delay!==null)assert.ok(result.text.includes('Saved for this audio setup') && Math.abs(result.saved?.residualMs)<=12,result.text);
      else {assert.match(result.text,/0 of 4 chirps/);assert.deepEqual(result.saved,results.at(-1).saved,'weak input must not replace the last valid correction');}
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
    assert.equal(take.timing.source,'acoustic');
    assert.equal(take.timing.seconds,results[1].saved.seconds);
    [-60,0,70].forEach((v,i)=>assert.ok(take.residualsMs[i]!==null && Math.abs(take.residualsMs[i]-v)<=16,JSON.stringify(take)));
    assert.ok(Date.now()-take.timing.measuredAt>=60*86400000,'reloaded take really used the two-month-old correction');
    return {addedMs:115,observedMs:deltaMs,reloadedCalibrationAgeDays:60,checks:results.map(r=>r.text),expectedEntrancesMs:[-60,0,70],recordedEntrancesMs:take.residualsMs};
  } finally {await page.close();}
}
module.exports={checkAcousticClock};
