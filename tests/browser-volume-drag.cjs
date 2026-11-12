const assert = require('node:assert/strict');
const {withMixerSignal} = require('./browser-mixer-signal.cjs');

async function checkNumericWheel(surface,page,probe='__qa') {
  const original=await surface.evaluate(probe=>window[probe].pitchbar.captureSettingsState(),probe),results=[];
  try {
    if(await surface.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await surface.locator('#settingsToggle').click();
    for(const toggle of await surface.locator('.settings-section-toggle').all())
      if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    for(const selector of ['[data-volume-index="0"]','#tempo','#metronome','#takeVolume','#takeReverb','#verticalScale','#horizontalScale']) {
      const control=surface.locator(selector);
      await control.scrollIntoViewIfNeeded();await control.press('Home');
      await surface.waitForFunction(probe=>!window[probe].busy,probe);
      const before=Number(await control.getAttribute('data-value'));
      const box=await control.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      const scroll=await surface.evaluate(()=>[scrollX,scrollY,document.getElementById('takePanel').scrollTop]);
      await page.mouse.wheel(0,-24);
      await surface.waitForFunction(({selector,before})=>Number(document.querySelector(selector).dataset.value)>before,{selector,before});
      await surface.waitForFunction(probe=>!window[probe].busy,probe);
      const after=Number(await control.getAttribute('data-value'));
      assert.deepEqual(await surface.evaluate(()=>[scrollX,scrollY,document.getElementById('takePanel').scrollTop]),scroll,selector+' wheel is not page scroll');
      await page.mouse.wheel(0,24);
      await surface.waitForFunction(({selector,before})=>Number(document.querySelector(selector).dataset.value)===before,{selector,before});
      results.push({selector,before,after});
    }
    const volume=surface.locator('[data-volume-index="0"]');await volume.press('Home');
    await volume.evaluate(button=>{for(let i=0;i<4;i++)button.dispatchEvent(new WheelEvent('wheel',{deltaY:-6,bubbles:true,cancelable:true}));});
    assert.equal(await volume.getAttribute('data-value'),'5','small trackpad deltas accumulate');
    await volume.press('End');
    await volume.evaluate(button=>{
      button.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,bubbles:true,cancelable:true}));
      button.dispatchEvent(new WheelEvent('wheel',{deltaY:24,bubbles:true,cancelable:true}));
    });
    assert.equal(await volume.getAttribute('data-value'),'195','no scroll debt at the ceiling');
    const ignored=await volume.evaluate(button=>[
      {deltaY:-24,ctrlKey:true},{deltaY:-24,metaKey:true},{deltaX:100,deltaY:-1},
    ].map(props=>{const e=new WheelEvent('wheel',{...props,bubbles:true,cancelable:true});button.dispatchEvent(e);return e.defaultPrevented;}));
    assert.deepEqual(ignored,[false,false,false]);
    assert.equal(await volume.getAttribute('data-value'),'195','zoom/horizontal gestures do not change values');
    return {controls:results,trackpad:true,limits:true,nativeZoom:true};
  } finally {
    await surface.evaluate(({probe,state})=>window[probe].pitchbar.applySettingsState(state),{probe,state:original});
    await surface.waitForFunction(probe=>!window[probe].busy,probe);
  }
}

async function checkNumericClicks(surface, page, mobile, probe) {
  const original=await surface.evaluate(probe=>window[probe].pitchbar.captureSettingsState(),probe),results=[];
  try {
    const reset=()=>surface.evaluate(probe=>{
      const api=window[probe].pitchbar,state=api.captureSettingsState();
      state.tempo=100;state.metronome=0;state.vertical=100;state.horizontal=100;state.volumes=state.volumes.map(()=>100);
      api.applySettingsState(state);
    },probe);
    for(const selector of ['#tempo','#metronome','#verticalScale','#horizontalScale','[data-volume-index="0"]']){
      await reset();
      await surface.waitForFunction(probe=>!window[probe].busy,probe);
      const control=surface.locator(selector),before=Number(await control.getAttribute('data-value'));
      if(mobile)await control.tap();else await control.click();
      assert.equal(Number(await control.getAttribute('data-value')),before+10,selector+' click adds ten percentage points');
      // Pointer-up deliberately blurs toolbar controls on the next frame. Let
      // that finish before focusing again for a separate keyboard gesture.
      await surface.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await control.press('Enter');
      await surface.waitForFunction(({selector,value})=>Number(document.querySelector(selector)?.dataset.value)===value,{selector,value:before+20});
      assert.equal(Number(await control.getAttribute('data-value')),before+20,selector+' keyboard activation');
      results.push({selector,before,after:before+20});
    }
  } finally {
    await surface.evaluate(({probe,state})=>window[probe].pitchbar.applySettingsState(state),{probe,state:original});
  }
  return results;
}

async function checkVolumeDrag(surface, page, mobile, probe, screenshot) {
  const controls = surface.locator('#mixer [data-volume-index]');
  const count = await controls.count();
  // The mixer lists parts in voice order (The Seed's S2 soloist sits after S2), so read levels by channel index, as settings store them.
  const values = () => controls.evaluateAll(nodes => nodes.map(node => [Number(node.dataset.volumeIndex), Number(node.dataset.value)])
    .sort((a, b) => a[0] - b[0]).map(([, value]) => value));
  const original = await surface.evaluate(probe => window[probe].pitchbar.captureSettingsState(), probe);
  const setVolumes = volumes => surface.evaluate(({probe, volumes}) => {
    const api = window[probe].pitchbar, state = api.captureSettingsState();
    state.volumes = volumes;
    api.applySettingsState(state);
  }, {probe, volumes});
  const otherSettings = () => surface.evaluate(probe => {
    const state = window[probe].pitchbar.captureSettingsState();
    return {see: state.visible, hear: state.audible, pans: state.pans, part: state.practicePart};
  }, probe);
  const before = await otherSettings();
  await surface.evaluate(() => { window.__volumeScore = document.querySelector('#score svg'); });
  const high = Array.from({length: count}, (_, i) => [190, 175, 155, 200][i % 4]);
  const low = Array.from({length: count}, (_, i) => [45, 25, 10, 0][i % 4]);
  const clamp = value => Math.max(0, Math.min(200, value));
  const gestures = [];
  try {
    for (const start of [high, low]) {
      await setVolumes(start);
      assert.deepEqual(await values(), start, 'settings restoration preserves levels above 150%');
      const label = surface.locator('[data-mixer-row="vol"]');
      await label.scrollIntoViewIfNeeded();
      const box = await label.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      const session = mobile ? await page.context().newCDPSession(page) : null;
      try {
        if (session) await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
        else { await page.mouse.move(x, y); await page.mouse.down(); }
        const direction = start === high ? -1 : 1;
        // The same uninterrupted gesture crosses every limit, then retraces it.
        for (const distance of [8, 24, 48, 64, 40, 16, 0]) {
          const dy = direction * distance;
          if (session) await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + dy}]});
          else await page.mouse.move(x, y + dy);
          const expected = start.map(value => clamp(value - dy / 4 * 5));
          await surface.waitForFunction(expected => expected.every((value, index) =>
            Number(document.querySelector(`#mixer [data-volume-index="${index}"]`)?.dataset.value) === value), expected);
          assert.deepEqual(await values(), expected, `group drag at ${dy}px remembers individual limits`);
        }
      } finally {
        if (session) {
          await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
          await session.detach();
        } else await page.mouse.up();
      }
      assert.deepEqual(await values(), start, 'returning to the start restores the original balance');
      gestures.push({start, restored: await values()});
    }
    await controls.nth(0).press('End');
    assert.equal(await controls.nth(0).getAttribute('data-value'), '200');
    assert.equal(await controls.nth(0).getAttribute('aria-valuemax'), '200');
    await withMixerSignal(surface, probe, () => surface.waitForFunction(probe =>
      Math.abs(window[probe].engine.trackStrips[0].gain.gain.value - 2) < .01, probe));
    await controls.nth(0).press('ArrowDown');
    assert.equal(await controls.nth(0).getAttribute('data-value'), '195');
    await surface.locator('[data-mixer-row="vol"]').press('ArrowUp');
    assert.equal(await controls.nth(0).getAttribute('data-value'), '200');
    await setVolumes(high);
    const geometry = await controls.evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, width: node.clientWidth, scrollWidth: node.scrollWidth,
    })));
    assert.ok(geometry.every(node => node.scrollWidth <= node.width + 1), JSON.stringify(geometry));
    if (screenshot) await page.screenshot({path: screenshot});
    assert.deepEqual(await otherSettings(), before, 'volume edits leave the other mixer settings alone');
    assert.equal(await surface.evaluate(() => __volumeScore === document.querySelector('#score svg')), true,
      'volume edits do not redraw notation');
    return {parts: count, pointer: mobile ? 'touch' : 'mouse', ceiling: 200, gestures, audioGain: 2, geometry};
  } finally {
    await surface.evaluate(({probe, original}) => window[probe].pitchbar.applySettingsState(original), {probe, original});
  }
}

async function checkBoostedAudio(surface, probe) {
  const report = await surface.evaluate(async probe => {
    const data = JSON.parse(document.getElementById('playback-data').textContent);
    const Player = window[probe].engine.constructor, count = data.parts.length;
    const results = [];
    for (const percent of [100, 200]) {
      const player = new Player({...data, division: 960, endTick: 1920, tempos: [[0, 60]],
        measures: [[0, 1920, 2, 4]], legato: [],
        notes: Array.from({length: count}, (_, i) => [i, 0, 1440, 60, 127])});
      const context = new OfflineAudioContext(2, 48000 * 2, 48000);
      const Audio = window.AudioContext;
      try {
        // Exercise the real compressor/limiter chain without speaker output.
        window.AudioContext = function() { return context; };
        player.ensureAudio();
      } finally { window.AudioContext = Audio; }
      // A divided part has several mixer channels, so mix every strip, not every part.
      const strips = player.trackStrips.length;
      player.updateMix(new Set(Array.from({length: strips}, (_, i) => i)), Array(strips).fill(percent), Array(strips).fill(0), true);
      for (const note of player.notes) player.scheduleNote(note, 0, .028);
      const buffer = await context.startRendering();
      const gains = player.trackStrips.map(strip => strip.gain.gain.value);
      let peak = 0, sum = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        for (const sample of buffer.getChannelData(channel)) {
          peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
        }
      }
      results.push({percent, gains, peak, rms: Math.sqrt(sum / (buffer.length * buffer.numberOfChannels))});
    }
    return results;
  }, probe);
  for (const sample of report) {
    assert.ok(sample.gains.every(gain => gain === sample.percent / 100), JSON.stringify(sample));
    assert.ok(Number.isFinite(sample.peak) && sample.peak > .001 && sample.peak < 1, JSON.stringify(sample));
  }
  assert.ok(report[1].rms > report[0].rms, '200% produces a real boost through the output protection');
  return report;
}

async function checkMetronome(surface) {
  const control=surface.locator('#metronome'), original=await control.getAttribute('data-value');
  try {
    await control.press('End');
    assert.equal(await control.getAttribute('data-value'),'200');
    assert.equal(await control.getAttribute('aria-valuemax'),'200');
    assert.equal(await surface.evaluate(()=>(window.__qa||window.__probe).engine.metronomeVolume),2);
    const audio=await surface.evaluate(async()=>{
      const q=window.__qa||window.__probe, Player=q.engine.constructor;
      const data=JSON.parse(document.getElementById('playback-data').textContent), samples=[];
      for(const percent of [100,200]) {
        const player=new Player(data), context=new OfflineAudioContext(2,48000/4,48000), Audio=window.AudioContext;
        try { window.AudioContext=function(){return context;};player.ensureAudio(); }
        finally {window.AudioContext=Audio;}
        player.setMetronome(percent);player.scheduleClick({time:0,downbeat:true},0,.028);
        const buffer=await context.startRendering(), values=buffer.getChannelData(0);
        samples.push({percent,peak:Math.max(...values.map(Math.abs)),rms:Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length)});
      }
      return samples;
    });
    assert.ok(audio[1].rms>audio[0].rms*1.8,'200% is an audible boost, not just a changed label');
    assert.ok(audio.every(s=>s.peak>0&&s.peak<1),'metronome stays inside the output headroom');
    return {ceiling:200,audio};
  } finally {
    await surface.evaluate(value=>{
      const q=window.__qa||window.__probe,state=q.pitchbar.captureSettingsState();state.metronome=Number(value);q.pitchbar.applySettingsState(state);
    },original);
  }
}

module.exports = {checkNumericClicks, checkNumericWheel, checkVolumeDrag, checkBoostedAudio, checkMetronome};
