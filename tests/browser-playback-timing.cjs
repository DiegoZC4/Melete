const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))] || 0;

async function checkPlaybackTiming(frame,page,{probe='__qa',output,label}={}) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  const cases=[];
  try {
    const geometry=await checkPlayingNoteEdges(frame,probe);
    cases.push({geometry});
    for(const view of ['standard','bars']) for(const slow of [false,true]) {
      await frame.evaluate(({name,view,slow,trace})=>{
        const qa=window[name];
        qa.traceTiming=trace;
        qa.pitchResolution.prepare();
        qa.engine.pauseTransport(); qa.pitchResolution.disablePitchCapture(false);
        qa.pitchResolution.setScoreView(view); qa.engine.seek(0);
        qa.timingHistory=0;
        if(view==='bars') {
          const state=qa.pitchbar.captureSettingsState(), sequence=qa.pitchbar.sequence;
          state.practicePart=state.visible.length-1;
          state.visible=state.visible.map((_,i)=>i===state.practicePart);
          delete state.visibleChannels;
          state.audible=state.visible.map((_,i)=>i!==state.practicePart);
          state.volumes=state.visible.map(()=>200);state.horizontal=200;state.vertical=120;
          const first=sequence.measures.length>24?18:0;
          const start=sequence.measures[first][0],end=sequence.measures[first+5]?.[0]??sequence.endTick;
          state.loopStart=first;state.loopEnd=Math.min(first+4,sequence.measures.length-1);
          state.loopStartTick=null;state.loopEndTick=null;
          qa.pitchbar.applySettingsState(state);
          qa.engine.seek(qa.engine.secondsAtTick(start));
          qa.timingHistory=qa.pitchResolution.seedHistory(start,end);
        }
        qa.workerSource ||= MeleteLivePitch.workerSource;
        MeleteLivePitch.workerSource = slow ? runtime=>qa.workerSource(runtime).replaceAll(
          'const started = performance.now();',
          'const delayUntil=performance.now()+80; while(performance.now()<delayUntil){} const started=performance.now();'
        ) : qa.workerSource;
        qa.timing={frames:[],positions:[],workerStates:[]};
        qa.originalPush ||= qa.engine.pushPosition;
        qa.engine.pushPosition=function(seconds) {
          const start=performance.now();
          const result=qa.originalPush.call(this,seconds);
          const beat=document.querySelector('.at-cursor-beat');
          const bar=[...document.querySelectorAll('.bar-playhead')].find(node=>Number(getComputedStyle(node).opacity)>.5);
          const system=bar?.closest('.bar-system');
          const plot=system?.querySelector('.bar-system-background');
          const barX=bar ? new DOMMatrixReadOnly(getComputedStyle(bar).transform).m41+1 : null;
          const barTick=system && plot ? Number(system.dataset.startTick)
            + (barX-Number(plot.getAttribute('x')))/Number(plot.getAttribute('width'))
              * (Number(system.dataset.endTick)-Number(system.dataset.startTick)) : null;
          if(this.playing && Number.isFinite(seconds)) qa.timing.positions.push({at:start,seconds,
            error:Math.abs(seconds-this.presentationSeconds())/this.rate*1000,
            tickError:Math.abs(this.secondsAtTick(this.api.tickPosition)-seconds)/this.rate*1000,
            barLag:barTick===null ? null : (seconds-this.secondsAtTick(barTick))/this.rate*1000,
            outputDelay:(this.currentSeconds()-seconds)/this.rate*1000,
            baseLatency:this.context.baseLatency, outputLatency:this.context.outputLatency,
            cursor:beat?.style.transform,duration:beat?getComputedStyle(beat).transitionDuration:null,
            cost:performance.now()-start,
            ...(qa.traceTiming ? {documentTime:document.timeline.currentTime,
              contextTime:this.context.currentTime,stamp:this.context.getOutputTimestamp(),
              animation:bar?.getAnimations().map(a=>({start:a.startTime,current:a.currentTime,
                rate:a.playbackRate,timing:a.effect.getComputedTiming(),frames:a.effect.getKeyframes()}))} : {})});
          return result;
        };
      },{name:probe,view,slow,trace:!!process.env.QA_TIMING_TRACE});
      await frame.waitForFunction(name=>!window[name].busy,probe);
      await frame.waitForFunction(name=>window[name].recording.state==='off',probe);
      await frame.locator('#pitchCapture').click();
      await frame.locator('#playPause').click();
      try { await frame.waitForFunction(name=>window[name].pitchResolution.snapshot().state==='recording',probe); }
      catch (error) {
        console.error('Timing start', {view,slow}, await frame.evaluate(name=>{
          const q=window[name];return {sing:q.singPreferences.snapshot(),recording:q.recording,
            transport:{playing:q.engine.playing,starting:q.engine.starting,preparing:q.engine.preparing},
            toast:document.getElementById('toastMessage').textContent};
        },probe)); throw error;
      }
      await frame.evaluate(name=>window[name].pitchResolution.input(),probe);
      await frame.waitForFunction(name=>window[name].engine.playing && window[name].recording.state==='recording',probe);
      const compositor=view==='bars'&&!slow ? await checkCompositorLayer(page) : null;
      await frame.evaluate(name=>{
        const qa=window[name];qa.timing.positions.length=0;let previous=performance.now();
        const measure=()=>{
          const now=performance.now();
          qa.timing.frames.push(now-previous);previous=now;
          qa.timing.workerStates.push(qa.pitchResolution.workerActive());
          if(qa.engine.playing)qa.timingRAF=requestAnimationFrame(measure);
        };qa.timingRAF=requestAnimationFrame(measure);
      },probe);
      await page.waitForTimeout(2400);
      const result=await frame.evaluate(name=>{
        const qa=window[name];cancelAnimationFrame(qa.timingRAF);
        const state=qa.pitchResolution.snapshot();
        return {...qa.timing,readings:state.observations.length,points:state.count,history:qa.timingHistory};
      },probe);
      if(process.env.QA_TIMING_TRACE&&output)await fs.writeFile(
        path.join(output,`timing-trace-${label}-${view}-${slow?'slow':'normal'}.json`),JSON.stringify(result));
      const transport=view==='bars'&&!slow ? await checkMotionTransport(frame,page,probe) : null;
      await frame.evaluate(name=>window[name].pitchResolution.stop(),probe);
      assert.ok(result.positions.length>40,'visual updates have their own frame loop');
      assert.ok(result.workerStates.every(Boolean),'live detection runs in a worker');
      assert.ok(result.readings>0,'actual pitch analysis completes');
      if(slow)assert.ok(result.readings<70,'the injected 80 ms worker stall really ran');
      assert.ok(percentile(result.frames,.95)<65,`pitch worker must not freeze rendering: ${JSON.stringify(result.frames)}`);
      assert.ok(percentile(result.positions.map(p=>p.error),.95)<20,'presentation uses a fresh output-clock sample');
      assert.ok(percentile(result.positions.map(p=>p.tickError),.95)<10,'notation follows the same audible score time');
      if(view==='bars') {
        assert.ok(result.positions.every(p=>Number.isFinite(p.barLag)),'visible pitchbar cursor is present');
        assert.ok(percentile(result.positions.map(p=>Math.abs(p.barLag)),.95)<20,
          `composited cursor must follow the presentation clock, not just AlphaTab internal ticks: ${JSON.stringify(result.positions.map(p=>Math.round(p.barLag)))}`);
      }
      if(view==='standard') {
        assert.ok(result.positions.every(p=>p.duration==='0s'),`no lagging CSS cursor animation: ${JSON.stringify(result.positions.filter(p=>p.duration!=='0s').slice(0,4))}`);
        assert.ok(new Set(result.positions.map(p=>p.cursor)).size>40,'real notation cursor moves every frame');
      }
      // Dense rows must still be fluid under a deliberately 80 ms detector.
      const summary={view,slowWorker:slow,frames:result.frames.length,readings:result.readings,
        frameP95:percentile(result.frames,.95),clockErrorP95:percentile(result.positions.map(p=>p.error),.95),
        notationClockErrorP95:percentile(result.positions.map(p=>p.tickError),.95),
        barLagP95:percentile(result.positions.map(p=>p.barLag).filter(Number.isFinite),.95),
        outputDelayP95:percentile(result.positions.map(p=>p.outputDelay),.95),
        baseLatency:result.positions[0]?.baseLatency,outputLatency:result.positions[0]?.outputLatency,
        paintCostP95:percentile(result.positions.map(p=>p.cost),.95),history:result.history,compositor,transport};
      cases.push(summary);
      if(output && !slow)await page.screenshot({path:path.join(output,`playback-timing-${label}-${view}.png`)});
    }
    return cases;
  } finally {
    await frame.evaluate(name=>{
      const qa=window[name];qa.pitchResolution.stop();qa.pitchResolution.clearPitchTrace();
      if(qa.workerSource)MeleteLivePitch.workerSource=qa.workerSource;
      if(qa.originalPush)qa.engine.pushPosition=qa.originalPush;
      cancelAnimationFrame(qa.timingRAF);
    },probe);
  }
}

async function checkMotionTransport(frame,page,probe) {
  // Transport edits intentionally stop a take. Finish it before testing
  // guide-only seeks/rate changes independently of the live detector above.
  await frame.evaluate(name=>window[name].pitchResolution.disablePitchCapture(false),probe);
  await frame.waitForFunction(name=>window[name].recording.state==='off',probe);
  const samples=[];
  const sample=async label=>{
    const result=await frame.evaluate(name=>{
      const qa=window[name],engine=qa.engine;
      const cursors=[...document.querySelectorAll('.bar-playhead')]
        .filter(node=>Number(getComputedStyle(node).opacity)>.5);
      const cursor=cursors[0],row=cursor?.closest('.bar-system'),plot=row?.querySelector('.bar-system-background');
      const x=cursor?new DOMMatrixReadOnly(getComputedStyle(cursor).transform).m41+1:NaN;
      const tick=row?Number(row.dataset.startTick)+(x-Number(plot.getAttribute('x')))
        /Number(plot.getAttribute('width'))*(Number(row.dataset.endTick)-Number(row.dataset.startTick)):NaN;
      return {count:cursors.length,error:(engine.secondsAtTick(tick)-engine.presentationSeconds())/engine.rate*1000,
        seconds:engine.currentSeconds(),playing:engine.playing,loopArmed:engine.loopArmed,
        loopStart:engine.loopStartSeconds,loopEnd:engine.loopEndSeconds,timer:engine.timer,
        animations:document.getAnimations().filter(a=>a.effect?.target?.classList.contains('bar-playhead')).length};
    },probe);
    assert.equal(result.count,1,`${label}: exactly one cursor`);
    assert.equal(result.playing,label!=='pause',`${label}: expected transport state`);
    assert.ok(Math.abs(result.error)<35,`${label}: ${JSON.stringify(result)}`);
    if (process.env.QA_TIMING_TRACE) console.log('Transport sample', label, result);
    samples.push({label,...result});return result;
  };
  const boundarySetup = await frame.evaluate(name=>{
    const qa=window[name];qa.engine.setLoop(null,null);
    const boundary=qa.pitchbar.systems.length>1 ? qa.pitchbar.systems[0].endTick : qa.pitchbar.sequence.measures[1][0];
    qa.engine.seek(qa.engine.secondsAtTick(boundary)-.15);
    // Reproduce missing JS presentation callbacks without freezing the audio.
    cancelAnimationFrame(qa.engine.presentationFrame);qa.engine.presentationFrame=0;
    return {boundary, duration:qa.engine.duration, position:qa.engine.currentSeconds(),playing:qa.engine.playing};
  },probe);
  if (process.env.QA_TIMING_TRACE) console.log('Transport boundary', boundarySetup);
  await page.waitForTimeout(300);await sample('boundary crossing without presentation callbacks');
  await frame.evaluate(name=>window[name].engine.startPresentation(),probe);
  for(const rate of [.5,1.5]) {
    // The UI changes AlphaTab's speed, which synchronizes the external engine.
    await frame.evaluate(({name,rate})=>{window[name].api.playbackSpeed=rate;},{name:probe,rate});
    await page.waitForTimeout(200);await sample(`speed ${rate}`);
  }
  await frame.evaluate(name=>{
    const qa=window[name],sequence=qa.pitchbar.sequence;
    qa.api.playbackSpeed=1;qa.engine.setLoop(sequence.measures[0][0],sequence.measures[1][0]);
    qa.engine.seek(qa.engine.loopEndSeconds-.12);
  },probe);
  await page.waitForTimeout(320);
  const loop=await sample('loop restart');assert.ok(loop.seconds<.5,`loop actually wrapped: ${JSON.stringify(loop)}`);
  await frame.evaluate(name=>window[name].engine.pauseTransport(),probe);
  await page.waitForTimeout(100);
  const pause=await sample('pause');assert.equal(pause.animations,0,'pause cancels every preplanned row');
  return samples;
}

async function checkCompositorLayer(page) {
  const session=await page.context().newCDPSession(page);
  let layers=[];
  try {
    session.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers||[];});
    await session.send('DOM.enable');await session.send('LayerTree.enable');
    await page.waitForTimeout(150);
    let matches=[];
    for(let attempt=0;attempt<3;attempt++) {
      matches=[];
      for(const layer of [...layers]) {
        if(!layer.backendNodeId)continue;
        try {
          const {node}=await session.send('DOM.describeNode',{backendNodeId:layer.backendNodeId});
          const attrs=node.attributes||[],index=attrs.indexOf('class');
          if(index<0 || !attrs[index+1].split(' ').includes('bar-playhead'))continue;
          matches.push(await session.send('LayerTree.compositingReasons',{layerId:layer.layerId}));
        } catch(error) {
          // A system wrap can retire a layer between these two CDP calls.
          if(!/No layer matching|No node found|Could not find node/.test(error.message))throw error;
        }
      }
      if(matches.some(r=>r.compositingReasonIds.includes('ActiveTransformAnimation')))break;
      await page.waitForTimeout(50);
    }
    assert.ok(matches.some(r=>r.compositingReasonIds.includes('ActiveTransformAnimation')),
      `playhead must really animate on the compositor: ${JSON.stringify(matches)}`);
    return {layers:matches.length,accelerated:matches.filter(r=>r.compositingReasonIds.includes('ActiveTransformAnimation')).length,
      reasons:[...new Set(matches.flatMap(r=>r.compositingReasonIds))]};
  } finally { await session.detach(); }
}

async function checkPlayingNoteEdges(frame,probe) {
  await frame.evaluate(name=>{
    const qa=window[name], state=qa.pitchbar.captureSettingsState();
    qa.timingSettings=structuredClone(state);
    qa.engine.pauseTransport(); qa.pitchResolution.disablePitchCapture(false);
    state.scoreView='standard';state.visible=state.visible.map((_,i)=>i===state.visible.length-1);
    delete state.visibleChannels;
    state.practicePart=state.visible.length-1;state.horizontal=200;
    qa.pitchbar.applySettingsState(state);
  },probe);
  await frame.waitForFunction(name=>!window[name].busy && window[name].api.boundsLookup
    && window[name].api.tracks.length===1
    && window[name].api.tracks[0].index===window[name].pitchbar.sequence.parts.length-1
    && !document.getElementById('score').hidden,probe);
  const result=await frame.evaluate(name=>{
    const qa=window[name], {api,engine}=qa, score=document.getElementById('score');
    const track=api.tracks.at(-1), total=track.staves[0].bars.length;
    const first=total>20?18:0;
    const entries=[];
    for(const staff of track.staves)for(const bar of staff.bars.slice(first,first+6))for(const voice of bar.voices)
      for(const beat of voice.beats) {
        if(beat.isRest || beat.isGrace)continue;
        const bounds=api.boundsLookup.findBeat(beat);
        if(!bounds?.notes?.length)continue;
        const expected=Math.min(...bounds.notes.map(n=>n.noteHeadBounds.x));
        engine.seek(engine.secondsAtTick(beat.absolutePlaybackStart));
        engine.playing=true;
        engine.pushPosition(engine.secondsAtTick(beat.absolutePlaybackStart));
        const cursor=score.querySelector('.at-cursor-beat').getBoundingClientRect();
        engine.playing=false;
        entries.push({measure:bar.index+1,index:beat.index,tick:beat.absolutePlaybackStart,
          actual:cursor.left+cursor.width/2-score.getBoundingClientRect().left+score.scrollLeft,expected});
      }
    engine.stopPresentation();
    return entries;
  },probe);
  await frame.evaluate(name=>window[name].pitchbar.applySettingsState(window[name].timingSettings),probe);
  assert.ok(result.length>0,'check real rendered noteheads, not an empty geometry result');
  for(const entry of result)assert.ok(Math.abs(entry.actual-entry.expected)<.6,
    `clock-driven cursor must arrive at the notehead left edge: ${JSON.stringify(entry)}`);
  return {checked:result.length,maximumError:Math.max(...result.map(r=>Math.abs(r.actual-r.expected))),
    errors:result.filter(r=>Math.abs(r.actual-r.expected)>.6).slice(0,12)};
}
module.exports={checkPlaybackTiming};
