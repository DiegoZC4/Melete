const assert = require('node:assert/strict');
const path = require('node:path');

async function checkMicrophone(frame, page, {output,label}) {
  if(await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  const section=frame.locator('#takePanel');
  if(await section.evaluate(el=>el.classList.contains('is-collapsed'))) await section.locator('.settings-section-toggle').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.ready);
  const before=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe;
    return {preferences:q.savedPractice,takes:q.recording.takes.length,playing:q.engine.playing};
  });
  assert.equal(before.playing,false);
  assert.match(await frame.locator('#pitchCapture').getAttribute('data-help'), /Use headphones\./);
  await frame.evaluate(()=>{
    // Collection frames ask the host document, so stub the API the player uses.
    const devices=MeleteMicrophoneCheck.mediaDevicesFor(window),original=devices.getUserMedia.bind(devices);
    window.micCheckTest={requests:0,original,devices,mode:'signal',streams:[]};
    devices.getUserMedia=async constraints=>{
      const t=window.micCheckTest;t.requests++;t.constraints=constraints;
      if(t.mode==='denied') throw new DOMException('Test permission denied','NotAllowedError');
      if(t.mode==='pending') await new Promise(resolve=>{t.resolve=resolve;});
      const granted=await original(constraints);
      granted.getTracks().forEach(track=>track.stop());
      // Route a known synthetic signal through the actual MediaStream input.
      const context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),out=context.createMediaStreamDestination();
      await context.resume();osc.frequency.value=220;gain.gain.value=.1;
      osc.connect(gain).connect(out);osc.start();
      t.streams.push({context,osc,gain,stream:out.stream});
      return out.stream;
    };
  });
  const dialog=frame.locator('#microphoneCheck');
  const state=value=>frame.waitForFunction(value=>document.getElementById('microphoneCheck').dataset.state===value,value);
  const close=async()=>{if(await frame.locator('#pitchCapture').getAttribute('aria-pressed')==='true')await frame.locator('#pitchCapture').click();};
  const open=async()=>{await close();await frame.locator('#pitchCapture').click();};
  const endInput=()=>frame.evaluate(()=>{
    const t=micCheckTest.streams.at(-1)?.stream.getAudioTracks()[0];
    if(t){t.stop();t.dispatchEvent(new Event('ended'));}
  });
  try {
    assert.equal(await frame.evaluate(()=>micCheckTest.requests),0,'no permission request before explicit check');
    await open();await state('signal');
    assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).recording.microphone),true);
    assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).recording.pitch),'armed');
    const box=await dialog.boundingBox(),viewport=page.viewportSize();
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
    assert.equal(await frame.locator('#takeMicrophone').isEnabled(),false);
    await page.screenshot({path:path.join(output,`mic-check-${label}.png`)});
    await frame.evaluate(()=>micCheckTest.streams.at(-1).gain.gain.value=.003);await state('quiet');
    await frame.evaluate(()=>micCheckTest.streams.at(-1).gain.gain.value=0);await state('silent');
    await frame.evaluate(()=>micCheckTest.streams.at(-1).gain.gain.value=1.1);await state('clipping');
    await frame.evaluate(()=>micCheckTest.streams.at(-1).gain.gain.value=.1);await state('signal');
    await close();
    await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.microphone===false);
    assert.deepEqual(await frame.evaluate(()=>{
      const q=window.__qa||window.__probe;
      return {preferences:q.savedPractice,takes:q.recording.takes.length,playing:q.engine.playing};
    }),before,'check changes neither mix, Sing, playback nor saved takes');

    await open();await state('signal');
    assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).recording.microphone), true, 'paused Sing monitors the input');
    assert.match(await frame.locator('#pitchCapture').getAttribute('data-help'), /pitch feedback without audio/i);
    assert.equal(await frame.locator('#takeMicrophone').isEnabled(),false,'Sing owns input until turned off');
    await close();
    assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).recording.microphone),false);

    await open();await state('signal');await endInput();await state('error');
    assert.match(await frame.locator('#checkMicrophone').getAttribute('title'),/disconnected/);
    await frame.evaluate(()=>micCheckTest.mode='denied');
    await open();await state('error');
    assert.match(await frame.locator('#checkMicrophone').getAttribute('title'),
      /^Microphone blocked\. Allow access in browser settings, then try again\./);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'inline error stays within its grid cell');
    await page.screenshot({path:path.join(output,`mic-blocked-${label}.png`)});
    await frame.evaluate(()=>micCheckTest.mode='signal');
    await open();await state('signal');
    await close();

    const count=await frame.evaluate(()=>{micCheckTest.mode='pending';return micCheckTest.streams.length;});
    await open();await state('requesting');
    await close();await frame.evaluate(()=>micCheckTest.resolve());
    await frame.waitForFunction(count=>micCheckTest.streams.length===count+1&&micCheckTest.streams.at(-1).stream.getAudioTracks()[0].readyState==='ended',count);
    await state('idle');
    assert.equal(await dialog.isVisible(),true,'meter stays visible without retaining microphone ownership');
    await frame.evaluate(()=>micCheckTest.mode='signal');
    await open();await state('signal');
    await frame.evaluate(()=>document.dispatchEvent(new Event('melete:deactivate')));
    await state('idle');
    assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).recording.microphone),false);
    await frame.evaluate(()=>document.dispatchEvent(new Event('melete:activate')));
    return {signal:true,quiet:true,silence:true,clipping:true,disconnect:true,deniedRetry:true,
      cancellation:true,sharesInput:true,noTakes:true,settingsUnchanged:true,viewport:box};
  } finally {
    await close();
    await endInput();
    await frame.evaluate(async()=>{
      micCheckTest.devices.getUserMedia=micCheckTest.original;
      for(const {context,osc,stream} of micCheckTest.streams){osc.stop();stream.getTracks().forEach(t=>t.stop());await context.close();}
      delete window.micCheckTest;
    });
  }
}
module.exports={checkMicrophone};
