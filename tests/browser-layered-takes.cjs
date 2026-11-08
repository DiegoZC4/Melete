const assert = require('node:assert/strict');
const path = require('node:path');
const {startRecording, stopRecording} = require('./browser-sing.cjs');

async function checkNoteHitAreas(frame, page) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('[data-view="bars"]').getAttribute('aria-selected') === 'true') await frame.locator('#scoreViewToggle').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') === 'true') await frame.locator('#settingsToggle').click();
  await frame.waitForFunction(() => !(window.__qa||window.__probe).busy && document.querySelector('#score svg'));
  await frame.locator('#score').scrollIntoViewIfNeeded();
  const points = await frame.evaluate(() => {
    const q=window.__qa||window.__probe,origin=document.getElementById('score').getBoundingClientRect();
    const lookup=q.api.boundsLookup||q.api.renderer.boundsLookup;
    const result=[], candidates=[];
    for(let i=0;i<q.scoreMeasures.length;i++){
      const master=lookup.findMasterBarByIndex(i);
      for(const bar of master?.bars||[])for(const beat of bar.beats||[])for(const bound of beat.notes||[]){
        const b=bound.noteHeadBounds;if(!b)continue;
        for(const [dx,dy] of [[b.w+9,8],[-9,8],[0,14]]){
          const x=Math.round(origin.left+b.x+dx),y=Math.round(origin.top+b.y+dy);
          if(candidates.length<12)candidates.push({x,y,element:document.elementFromPoint(x,y)?.outerHTML.slice(0,200),near:q.auditionNote(x,y,true)});
          if(x<0||x>=innerWidth||y<0||y>=innerHeight||q.auditionNote(x,y)||q.auditionChord(x,y))continue;
          if(!document.elementFromPoint(x,y)?.closest('#score'))continue;
          const note=q.auditionNote(x,y,true);
          if(note&&!result.some(p=>p.note.key===note.key))result.push({x,y,note});
        }
        if(result.length>=2)break;
      }
      if(result.length>=2)break;
    }
    if(result.length<2)throw Error('No two blank-space note targets in viewport: '+JSON.stringify({origin:origin.toJSON(),candidates}));
    const m=lookup.findMasterBarByIndex(0),sys=m.staffSystemBounds.realBounds;
    for(let y=Math.max(sys.y,m.lineAlignedBounds.y-44);y<m.lineAlignedBounds.y-2;y+=3){
      for(const fraction of [.15,.3,.45,.55,.75]) {
      const x=Math.round(origin.left+m.realBounds.x+m.realBounds.w*fraction),cy=Math.round(origin.top+y);
      const chord=q.auditionChord(x,cy);
      if(cy>0&&cy<innerHeight&&chord&&q.scoreNotes.some(n=>n[1]<=chord.tick&&n[2]>chord.tick)
        &&!q.auditionNote(x,cy)&&document.elementFromPoint(x,cy)?.closest('#score')){result.push({x,y:cy,chord});break;}
      }
      if(result.some(p=>p.chord))break;
    }
    const engine=q.engine,hold=engine.holdNote;
    window.__hitProof={hold,calls:[]};engine.holdNote=function(key,track,options){
      __hitProof.calls.push({key,track,fullChord:!!options?.fullChord});return hold.call(this,key,track,options);
    };
    return result;
  });
  const offset=frame===page?{x:0,y:0}:await (await frame.frameElement()).boundingBox();
  const clickPoint=p=>({x:p.x+offset.x,y:p.y+offset.y});
  const [a,b]=points.map(clickPoint);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await frame.waitForFunction(()=>__hitProof.calls.length>0);
  assert.deepEqual(await frame.evaluate(()=>__hitProof.calls[0]),{key:points[0].note.key,track:points[0].note.track,fullChord:false});
  await page.mouse.move(b.x,b.y,{steps:5});
  await frame.waitForFunction(key=>__hitProof.calls.some(n=>n.key===key),points[1].note.key);
  await page.mouse.up();
  const chord=points.find(p=>p.chord);
  assert.ok(chord,'the full-chord strip remains reachable');
  const at=clickPoint(chord);
  await frame.evaluate(()=>{__hitProof.calls=[];});
  await page.mouse.move(at.x,at.y);await page.mouse.down();
  const chordProof = await frame.evaluate(p=>({calls:__hitProof.calls,point:p,
    element:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,600),
    chord:(window.__qa||window.__probe).auditionChord(p.x,p.y),note:(window.__qa||window.__probe).auditionNote(p.x,p.y)}),chord);
  assert.ok(chordProof.calls.some(n=>n.fullChord),JSON.stringify(chordProof));
  await page.mouse.up();
  const count=await frame.evaluate(()=>__hitProof.calls.length);
  await frame.evaluate(()=>{const q=window.__qa||window.__probe;q.engine.holdNote=__hitProof.hold;});
  return {blankSpaceNote:true,dragChangesPitch:true,chordTones:count};
}

async function checkLayeredTakes(frame, page, {output, label}) {
  const initialVisibility = await frame.evaluate(() => document.visibilityState);
  await page.bringToFront();
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  await require('./browser-sing.cjs').choosePart(frame);
  await frame.waitForFunction(() => Number.isInteger((window.__qa || window.__probe).savedPractice.practicePart));
  for (const section of ['takes', 'practice']) {
    const toggle = frame.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  }
  // Earlier capture tests intentionally preserve Sing across reload. Start with
  // playback-only here; the later overdub explicitly exercises Sing-on playback.
  await stopRecording(frame);
  const fixture = await frame.evaluate(async () => {
    const q = window.__qa || window.__probe, engine = q.engine;
    const originalIds = q.recording.takes.map(t=>t.id);
    engine.pauseTransport(); engine.clearTakeLayers();
    const settings = q.pitchbar.captureSettingsState();
    q.pitchbar.applySettingsState({...settings, loopStart: null, loopEnd: null, loopStartTick: null, loopEndTick: null});
    const end = q.scoreMeasures[3][0], ref = q.pitchReference({start: 0, end, rate: 1});
    ref.latency = 0;
    const ids = [], hashes = [];
    const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',');
    for (let n = 0; n < 2; n++) {
      const id = crypto.randomUUID(), sr = 48000;
      const pcm = Int16Array.from({length: Math.ceil(ref.seconds * sr)}, (_, i) => Math.round(3000 * Math.sin(2 * Math.PI * (440 + 220 * n) * i / sr)));
      const t = await q.takeStore.append({id, song: q.takeSong, part: `QA${n}`, start: 0, end, rate: 1, restAudioVersion: 1,
        sampleRate: sr, pitchReference: ref, createdAt: Date.now() + n}, 0, pcm, {finalized: true, complete: true});
      const frames = Array.from({length: Math.ceil(pcm.length / 480)}, (_, i) => {
        const start = i * 480 / sr, end = Math.min((i + 1) * 480, pcm.length) / sr;
        const note = ref.notes.find(n => n[0] <= start && n[1] > start);
        return {start, end, cents: note ? note[2][0] * 100 + 1200 : null};
      });
      const score = MeleteTakePitch.scoreFrames(frames, ref, ref.seconds);
      await q.takeStore.pitchScore(id, pcm.length, ref, score, MeleteTakePitch.packContour(frames, t));
      ids.push(id); hashes.push(await hash(await q.takeStore.wav(id)));
    }
    // Older recordings outside the track, listed as loose takes.
    await q.keepLoose(ids);
    await q.reloadTakes();
    window.__layerProof = {hash, hashes, settings, hold: engine.holdNote, calls: []};
    engine.holdNote = function(key, track, options) {
      __layerProof.calls.push({key, track, options}); return __layerProof.hold.call(this, key, track, options);
    };
    return {ids, originalIds, end, seconds: ref.seconds};
  });
  const hear = id => frame.locator(`[data-take-id="${id}"] .take-hear`);
  for (const id of fixture.ids) await hear(id).click();
  await frame.waitForFunction(ids => ids.every(id => (window.__qa || window.__probe).engine.takeLayers.has(id)), fixture.ids);
  const prefs = await frame.evaluate(() => (window.__qa || window.__probe).savedPractice);
  await require('./browser-sing.cjs').nextPart(frame);
  await frame.waitForFunction(() => (window.__qa || window.__probe).engine.takeLayers.size === 2);
  // Layers are attached before asynchronous loudness analysis sets their gain.
  // Source-node readiness alone is not evidence that the layer is audible yet.
  await frame.waitForFunction(() => [...(window.__qa || window.__probe).engine.takeLayers.values()]
    .every(layer => Number.isFinite(layer.loudness?.gain) && layer.loudness.gain > 0));
  await frame.evaluate(() => {
    const e = (window.__qa || window.__probe).engine;
    e.setRate(1); e.seek(.25);
  });
  await frame.locator('#playPause').click();
  try {
    await frame.waitForFunction(() => [...(window.__qa || window.__probe).engine.takeLayers.values()].every(r => r.source));
  } catch (error) {
    const state = await frame.evaluate(() => {
      const q=window.__qa||window.__probe,e=q.engine;
      return {playing:e.playing,time:e.currentSeconds(),end:e.playbackEndSeconds(),recording:q.recording.state,visibility:document.visibilityState,
        sing:document.querySelector('#pitchCapture').getAttribute('aria-pressed'),
        notices:[...document.querySelectorAll('[role="alert"],.toast')].map(n=>n.textContent),
        layers:[...e.takeLayers.values()].map(r=>({id:r.id,start:r.start,end:r.end,rate:r.rate,
          source:!!r.source,window:e.takeReviewWindow(0,r)}))};
    });
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  }
  const audio = await frame.evaluate(async () => {
    const e = (window.__qa || window.__probe).engine;
    const analysers = [...e.takeLayers.values()].map(r => {const a=e.context.createAnalyser();a.fftSize=8192;a.smoothingTimeConstant=0;r.gain.connect(a);return [r,a];});
    await new Promise(r => setTimeout(r, 220));
    return analysers.map(([r,a]) => {
      const x = new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(x);
      let peak = 1;for(let i=2;i<x.length;i++)if(x[i]>x[peak])peak=i;
      r.gain.disconnect(a);a.disconnect();return {hz:peak*e.context.sampleRate/a.fftSize,db:x[peak]};
    });
  });
  assert.ok(Math.abs(audio[0].hz - 440) < 12 && Math.abs(audio[1].hz - 660) < 12, JSON.stringify(audio));
  assert.ok(audio.every(a => a.db > -40), JSON.stringify(audio));
  const octave = frame.locator(`[data-take-id="${fixture.ids[0]}"] .take-octave`);
  const cycleOctave = async label => {
    await octave.click();
    await frame.waitForFunction(({id,label}) => document.querySelector(`[data-take-id="${id}"] .take-octave`)
      .textContent===label,{id:fixture.ids[0],label});
  };
  assert.equal(await octave.textContent(),'-');
  await cycleOctave('8va');
  assert.equal(await octave.textContent(),'8va');
  await frame.waitForFunction(id => {
    const r=(window.__qa||window.__probe).engine.takeLayers.get(id);
    return r?.octave===1 && r.source?.stretch;
  },fixture.ids[0]);
  const shifted = await frame.evaluate(async id => {
    const e=(window.__qa||window.__probe).engine,r=e.takeLayers.get(id),a=e.context.createAnalyser();
    a.fftSize=8192;a.smoothingTimeConstant=0;r.gain.connect(a);
    await new Promise(resolve=>setTimeout(resolve,300));
    const x=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(x);
    let peak=1;for(let i=2;i<x.length;i++)if(x[i]>x[peak])peak=i;
    r.gain.disconnect(a);a.disconnect();return {hz:peak*e.context.sampleRate/a.fftSize,db:x[peak]};
  },fixture.ids[0]);
  assert.ok(Math.abs(shifted.hz-880)<12 && shifted.db>-40,JSON.stringify(shifted));
  await cycleOctave('8vb');
  assert.equal(await octave.textContent(),'8vb');
  assert.equal(await frame.evaluate(id=>(window.__qa||window.__probe).engine.takeLayers.get(id).octave,fixture.ids[0]),-1);
  await cycleOctave('-');
  assert.equal(await octave.textContent(),'-','the button wraps without a double-octave option');
  await cycleOctave('8va');
  assert.equal(await octave.textContent(),'8va');
  await hear(fixture.ids[0]).click();
  assert.deepEqual(await frame.evaluate(() => [...(window.__qa || window.__probe).engine.takeLayers.keys()]), [fixture.ids[1]]);
  await hear(fixture.ids[0]).click();
  await frame.waitForFunction(() => (window.__qa || window.__probe).engine.takeLayers.size === 2);
  await frame.locator('#playPause').click();
  assert.equal(await frame.evaluate(() => [...(window.__qa || window.__probe).engine.takeLayers.values()].some(r=>r.source)), false);
  await frame.evaluate(() => {const e=(window.__qa||window.__probe).engine;e.seek(.4);e.setRate(.8);});
  await frame.locator('#playPause').click();
  await frame.waitForFunction(() => [...(window.__qa || window.__probe).engine.takeLayers.values()].every(r=>r.octave
    ? r.source?.stretch : r.source?.media && !r.audio.paused));
  await frame.locator('#playPause').click();
  await frame.evaluate(() => {const e=(window.__qa||window.__probe).engine;e.setRate(1);e.seek(.5);});
  await startRecording(frame);
  await frame.waitForFunction(() => (window.__qa || window.__probe).recording.state === 'recording');
  await frame.waitForFunction(() => [...(window.__qa || window.__probe).engine.takeLayers.values()].every(r=>r.source));
  await page.waitForTimeout(1200);
  await stopRecording(frame);
  const recorded = await frame.evaluate(ids => (window.__qa||window.__probe).recording.takes.filter(t=>!ids.includes(t.id)).map(t=>t.frames),[...fixture.ids,...fixture.originalIds]);
  assert.ok(recorded.some(n=>n>24000),'overdub captured microphone samples while both layers sounded');
  await page.screenshot({path:path.join(output,`${label}-layered-takes.png`)});
  const unchanged = await frame.evaluate(async ids => {
    const q=window.__qa||window.__probe;
    const hashes=await Promise.all(ids.map(async id=>__layerProof.hash(await q.takeStore.wav(id))));
    return JSON.stringify(hashes)===JSON.stringify(__layerProof.hashes);
  },fixture.ids);
  assert.equal(unchanged,true,'original source WAVs remain byte-identical');
  await frame.evaluate(async originalIds => {
    const q=window.__qa||window.__probe;q.engine.clearTakeLayers();q.engine.holdNote=__layerProof.hold;
    await q.takeStore.deleteTakes(q.takeSong,q.recording.takes.filter(t=>!originalIds.includes(t.id)).map(t=>t.id));
    await q.reloadTakes();q.pitchbar.applySettingsState(__layerProof.settings);
  },fixture.originalIds);
  return {layers:2,audio,shifted,octaveCycle:['-','8va','8vb','-'],overdub:true,rawAudioUnchanged:unchanged,priorPart:prefs.practicePart,initialVisibility};
}
module.exports = {checkLayeredTakes,checkNoteHitAreas};
