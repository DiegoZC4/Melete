const {toggleRecording} = require('./browser-sing.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const checkCloud = fs.existsSync(path.join(__dirname, 'browser-cloud.cjs'))
  ? require('./browser-cloud.cjs').checkCloud
  : async () => ({skipped: 'Optional cloud backend is not included in this distribution'});

// The row of the track that recordings for the selected practice part fill.
const trackRow = frame => frame.locator('#compRows > .comp-row.is-armed');

async function checkComp(frame, page, {output, label, reload, cloud: testCloud = true, continuous: testContinuous = true}) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  if (await frame.locator('#practicePart').getAttribute('data-value') === '') await frame.locator('#practicePart').press('ArrowDown');
  await frame.waitForFunction(() => (window.__qa || window.__probe).compDescriptor);
  await frame.waitForFunction(() => (window.__qa || window.__probe).compState);
  if(testCloud) {
    await frame.evaluate(async()=>{
      localStorage.setItem('melete:cloud:visited','true');
      localStorage.setItem('melete:cloud:enabled','true');
      await (window.__qa||window.__probe).refreshComp();
    });
    assert.equal(await frame.locator('#compGoogleInline').getAttribute('src'),null,'old login preferences cannot activate an unconfigured player');
  }
  assert.equal(await frame.locator('#compCloud').isEnabled(), true, 'choosing a part enables its empty track immediately');
  const created = await frame.evaluate(async () => {
    const q = window.__qa || window.__probe, d = q.compDescriptor, ref = d.reference;
    const mid = Math.floor(q.scoreMeasures.length / 2);
    const startTick = q.scoreMeasures[mid][0], endTick = q.scoreMeasures[Math.min(mid + 1, q.scoreMeasures.length - 1)][0];
    const ids = [], now = Date.now();
    // Track recordings, oldest first. Each replaces the passages it sings, even
    // when it scores worse, so the 50-cent take ends up unused and is deleted.
    for (const [index, [start, end, cents]] of [[0, ref.end, 50], [0, ref.end, 30], [startTick, endTick, 10]].entries()) {
      const r = q.pitchReference({start, end, rate: q.engine.rate}); r.latency = 0;
      const id = crypto.randomUUID(), sr = 8000, n = Math.ceil(r.seconds * sr);
      const pcm = Int16Array.from({length:n}, (_,i)=>Math.round((2000+cents)*Math.sin(2*Math.PI*220*i/sr)));
      const record = await q.takeStore.append({id,song:q.takeSong,createdAt:now+index,sampleRate:sr,replaces:true,
        part:d.label,label:'comp-test',rate:ref.rate,start,end,peak:.1,pitchReference:r},0,pcm,{finalized:true,complete:true});
      const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
        const from=i*80/sr,to=Math.min((i+1)*80,n)/sr,note=r.notes.find(n=>n[0]<=from&&n[1]>from);
        return {start:from,end:to,cents:note&&(cents===10||i%97!==0)?note[2][0]*100+cents+15*Math.sin(i*.37):null};
      });
      await q.takeStore.pitchScore(id,n,r,MeleteTakePitch.scoreFrames(frames,r,n/sr),MeleteTakePitch.packContour(frames,record));
      ids.push(id);
    }
    await q.reloadTakes(); await q.refreshComp();
    const [replaced, full] = ids;
    const cleaned = q.recording.takes.find(t=>t.id===full);
    const audio = new Int16Array(await (await q.takeStore.wav(full)).arrayBuffer(),44);
    const keep = cleaned.pitchReference.restPolicy.keep;
    let ignored = 0, changedKept = 0, nonzeroIgnored = 0;
    for(let i=0;i<audio.length;i++) {
      const t=i/cleaned.sampleRate;
      const r=keep.find(([a,b])=>t>=a&&t<b);
      if(!r) {ignored++;if(audio[i]!==0)nonzeroIgnored++;}
      else if(t-r[0]>.01&&r[1]-t>.01&&audio[i]!==Math.round(2030*Math.sin(2*Math.PI*220*i/cleaned.sampleRate))) changedKept++;
    }
    return {ids:ids.slice(1),state:q.compState,preferences:q.savedPractice,
      replaced:{listed:q.recording.takes.some(t=>t.id===replaced),stored:await q.takeStore.wav(replaced).then(()=>true,()=>false)},
      restCleanup:{ignored,nonzeroIgnored,changedKept,version:cleaned.restAudioVersion},
      pcm:Array.from(new Uint8Array(await (await q.takeStore.wav(full)).arrayBuffer())).slice(0,80)};
  });
  assert.equal(created.restCleanup.version,1,'existing source takes gain score-aware rest handling');
  assert.equal(created.restCleanup.nonzeroIgnored,0,'discarded rest audio is absent from stored WAV, not just muted');
  assert.equal(created.restCleanup.changedKept,0,'singing and the one-beat guards preserve original samples');
  assert.deepEqual(created.replaced,{listed:false,stored:false},'a replaced recording is deleted once neither the track nor Undo uses it');
  assert.ok(created.state.segments.some(s=>s.takeId===created.ids[1]),'the newest recording punches in the passage it sang');
  assert.ok(created.state.segments.some(s=>s.takeId===created.ids[0]),'the earlier recording keeps the rest of the track');
  assert.ok(created.state.undo?.length&&created.state.undo.every(s=>s.takeId===created.ids[0]),'Undo holds the track before the newest recording');
  const recovered = await frame.evaluate(async ({ids}) => {
    const q = window.__qa || window.__probe;
    await q.takeStore.saveComp({...q.compState, offerVersion: 1, processed: ids,
      segments: q.compState.segments.filter(s=>s.takeId===ids[1]), undo: null});
    await q.refreshComp();
    return {state:q.compState, completion:Number(document.querySelector('#compRows > .comp-row.is-armed .comp-review').dataset.completion) * 100};
  }, created);
  assert.deepEqual(recovered.state.segments.filter(s=>s.takeId===created.ids[1]),
    created.state.segments.filter(s=>s.takeId===created.ids[1]), 'legacy backfill keeps the newer excerpt');
  assert.ok(recovered.state.segments.some(s=>s.takeId===created.ids[0]), 'legacy processed recordings fill new regions');
  assert.ok(Math.abs(recovered.completion - 100) < 1e-7, 'all written singing is recovered; rest-only tails need no source');
  assert.equal(recovered.state.offerVersion, 2);
  created.state = recovered.state;
  let row = trackRow(frame);
  assert.equal(await row.locator('.take-number').textContent(), 'Comp', 'a track built from two recordings');
  assert.notEqual(await row.locator('.take-part').textContent(), '');
  assert.doesNotMatch(await frame.locator('#compView').innerText(), /\bBest\b/);
  assert.equal(await frame.locator('#compView [data-take-sort]').count(), 0, 'one row per track needs no sorting');
  assert.equal(await frame.locator(created.ids.map(id => `#takeList [data-take-id="${id}"]`).join(', ')).count(), 0,
    'track recordings are not listed as loose takes');
  assert.equal(await frame.locator('#compProgress, .comp-progress, .comp-summary').count(),0,'no separate comp graphic remains');
  assert.equal(await frame.locator('#takeTimeline').isVisible(),false);
  const chapters = await frame.locator('#timelineSegments').innerHTML();
  await frame.evaluate(()=>{
    window.__compPerformance={prepare:MeleteCompAudio.prepare,calls:0,tasks:[],start:performance.now()};
    MeleteCompAudio.prepare=async(...args)=>{__compPerformance.calls++;return __compPerformance.prepare(...args);};
    __compPerformance.observer=new PerformanceObserver(list=>__compPerformance.tasks.push(...list.getEntries().map(e=>e.duration)));
    __compPerformance.observer.observe({type:'longtask'});
  });
  await row.locator('.comp-review').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview?.id.startsWith('comp:'));
  assert.deepEqual(await frame.evaluate(()=>(window.__qa||window.__probe).savedPractice),created.preferences);
  const review=await frame.evaluate(() => {
    const q=window.__qa||window.__probe;
    return {id:q.takeReview.id,frames:q.takeReview.frames.length,duration:q.takeReview.duration,
      ranges:q.engine.takeReview.ranges,nonzero:q.engine.takeReview.buffer.getChannelData(0).some(x=>Math.abs(x)>.01)};
  });
  assert.ok(review.frames>0); assert.equal(review.nonzero,true);
  assert.equal(review.ranges.length,created.state.segments.length);
  await checkSelectedTimeline(frame, created.state.segments.length);
  const firstPerformance=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe,p=__compPerformance;
    p.buffer=q.engine.takeReview.buffer;p.elapsed=performance.now()-p.start;
    return {elapsed:p.elapsed,frames:q.engine.takeReview.frames.length,paths:document.querySelectorAll('.take-pitch-trace-edge').length,
      timelineNodes:document.querySelector('#takeTimeline').childElementCount,maxLongTask:Math.max(0,...p.tasks),audioBuilds:p.calls};
  });
  assert.equal(firstPerformance.audioBuilds,1);
  assert.ok(firstPerformance.timelineNodes<=5+created.state.segments.length*3,'playbar DOM scales with source segments, not pitch samples');
  assert.equal(await frame.locator('#timelineSegments').innerHTML(),chapters,'take coverage does not replace song chapters');
  await page.screenshot({path:path.join(output,`comp-selected-${label}.png`)});
  const viewport = page.viewportSize();
  if (viewport.width > 800) {
    try {
      await page.setViewportSize({width:320,height:852});
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await frame.waitForFunction(() => !(window.__qa || window.__probe).busy && !document.querySelector('.score-render-snapshot'));
      const transport = await frame.evaluate(() => {
        const rail = document.getElementById('takeTimeline').getBoundingClientRect();
        const seek = document.getElementById('seek').getBoundingClientRect();
        const exit = document.getElementById('exitTakeReview').getBoundingClientRect();
        const gear = document.getElementById('settingsToggle').getBoundingClientRect();
        return {width:innerWidth,rail:rail.toJSON(),seek:seek.toJSON(),exit:exit.toJSON(),gear:gear.toJSON(),
          tableScrolls:getComputedStyle(document.querySelector('.take-review')).overflowX==='auto',
          overflow:document.documentElement.scrollWidth > innerWidth,
          overflowElements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1)
            .slice(0,8).map(el=>({id:el.id,class:el.className?.baseVal??el.className,right:el.getBoundingClientRect().right}))};
      });
      await page.screenshot({path:path.join(output,`comp-selected-${label}-320.png`)});
      assert.equal(transport.overflow,false,`selected comp keeps narrow phone transport within the viewport: ${JSON.stringify(transport)}`);
      assert.equal(transport.tableScrolls,true,'additional boundary columns scroll within the fixed-height table at 320px');
      assert.ok(transport.rail.width >= 54,'the main playbar remains usable at 320px');
      assert.ok(transport.exit.right <= transport.seek.left && transport.gear.right <= transport.width,
        'selected-take control does not overlap the playbar or push out the settings gear');
      await checkSelectedTimeline(frame, created.state.segments.length);
    } finally { await page.setViewportSize(viewport); }
  }
  await row.locator('.comp-review').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).takeReview),null);
  assert.equal(await frame.locator('#takeTimeline').isVisible(),false);
  assert.equal(await frame.locator('#takeTimeline span').count(),0,'deselection removes all coverage');
  await frame.evaluate(()=>{__compPerformance.start=performance.now();__compPerformance.tasks=[];});
  await row.locator('.comp-review').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview?.id.startsWith('comp:'));
  const cachedPerformance=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe,p=__compPerformance;
    return {elapsed:performance.now()-p.start,audioBuilds:p.calls,sameBuffer:q.engine.takeReview.buffer===p.buffer,
      maxLongTask:Math.max(0,...p.tasks),paths:document.querySelectorAll('.take-pitch-trace-edge').length};
  });
  assert.equal(cachedPerformance.audioBuilds,1,'reselecting comp never rebuilds or decodes its audio');
  assert.equal(cachedPerformance.sameBuffer,true);
  const trackDownload=page.waitForEvent('download');await row.locator('.take-download').click();
  assert.match((await trackDownload).suggestedFilename(),/-track\.wav$/);
  assert.equal(await frame.evaluate(()=>__compPerformance.calls),1,'download reuses prepared track audio');
  assert.equal(await row.locator('.comp-review').getAttribute('aria-pressed'),'true','download does not toggle selection');
  await row.locator('.comp-review').click();
  await frame.evaluate(()=>{MeleteCompAudio.prepare=__compPerformance.prepare;__compPerformance.observer.disconnect();delete window.__compPerformance;});
  const protection=await frame.evaluate(async ids=>{
    const q=window.__qa||window.__probe;
    let rejected=false, stale=false;
    try{await q.takeStore.stageDelete(q.takeSong,ids[0],Date.now(),{includeFavorites:true});}catch{rejected=true;}
    try{await q.takeStore.saveComp(q.compState,0);}catch{stale=true;}
    const deleted=await q.takeStore.deleteTakes(q.takeSong,ids);
    return {rejected,stale,deleted};
  },created.ids);
  assert.deepEqual(protection,{rejected:true,stale:true,deleted:[]});
  await row.locator('.take-delete').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).compState?.segments.length===0);
  frame=await reload();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).compState);
  row = trackRow(frame);
  const removed=await frame.evaluate(async ids=>{
    const q=window.__qa||window.__probe;
    return {segments:q.compState.segments.length,undo:q.compState.undo?.length||0,
      stored:await Promise.all(ids.map(id=>q.takeStore.wav(id).then(()=>true,()=>false)))};
  },created.ids);
  assert.deepEqual(removed,{segments:0,undo:created.state.segments.length,stored:[true,true]},'a removed track keeps its recordings for Undo');
  await frame.locator('#takeActions summary').click();
  assert.match(await frame.locator('#undoComp span').textContent(),/^Undo .+ change$/);
  await frame.locator('#undoComp').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).compState.segments.length>0);
  assert.deepEqual(await frame.evaluate(()=>(window.__qa||window.__probe).compState.segments),created.state.segments);
  await frame.waitForFunction(()=>Number.isFinite(Number(document.querySelector('#compRows > .comp-row.is-armed .comp-mean').textContent)));
  const geometry = await frame.evaluate(() => {
    const value = document.querySelector('#compRows > .comp-row.is-armed .comp-mean').getBoundingClientRect();
    const region = document.querySelector('.take-review').getBoundingClientRect();
    return {value: value.bottom, region: region.bottom};
  });
  assert.ok(geometry.value <= geometry.region + 1, 'track metrics fit without scrolling');
  const columns = await frame.evaluate(() => {
    const headers=[...document.querySelectorAll('.comp-columns > span')].map(e=>e.getBoundingClientRect());
    const values=[...document.querySelector('#compRows > .comp-row.is-armed').querySelectorAll(
      '.comp-review > span:not(.take-detail), .take-detail > span, .take-octave, .take-hear')].map(e=>e.getBoundingClientRect());
    return {headers:headers.length,deltas:values.map((v,i)=>Math.abs(headers[i].x+headers[i].width/2-v.x-v.width/2))};
  });
  assert.ok(columns.deltas.length===columns.headers&&columns.deltas.every(delta=>delta<1),
    `track values align under the audition-style column headers: ${JSON.stringify(columns)}`);
  const controls=await frame.evaluate(()=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect();
    const panel=rect('#takePanel'),mic=rect('.take-microphone'),table=rect('.take-review');
    const row=document.querySelector('#compRows > .comp-row.is-armed'),box=row.getBoundingClientRect();
    return {side:mic.right<=table.left,wide:panel.width>520,
      status:document.getElementById('singRecordingStatus').textContent,
      actions:[...row.querySelectorAll('.take-download, .take-delete')].map(e=>{
        const r=e.getBoundingClientRect();
        return r.top>=box.top&&r.bottom<=box.bottom+1;
      })};
  });
  if(controls.wide)assert.equal(controls.side,true,'mic picker is left of the grid when space permits');
  assert.ok(controls.actions.length===2&&controls.actions.every(Boolean),'download and remove are in the track row');
  assert.notEqual(controls.status,'Saved locally');
  await page.screenshot({path:path.join(output,`comp-${label}.png`)});
  const wasBars=await frame.locator('[data-view="bars"]').getAttribute('aria-selected')==='true';
  if(!wasBars)await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  await row.locator('.comp-review').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview?.id.startsWith('comp:'));
  const pitchbarPaths=await frame.locator('#barScore .take-pitch-trace-edge').count();
  assert.ok(pitchbarPaths>0&&pitchbarPaths<1000,'full-length pitchbar contour uses a bounded path palette');
  await frame.locator('#takePanel').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,`comp-pitchbar-${label}.png`)});
  await row.locator('.comp-review').click();
  if(!wasBars)await frame.locator('#scoreViewToggle').click();
  if (testCloud) {
    assert.equal(await frame.locator('#compAccount').isVisible(),false,'offline/unconfigured builds omit cloud controls');
  }
  assert.deepEqual(await frame.evaluate(async id=>Array.from(new Uint8Array(await (await (window.__qa||window.__probe).takeStore.wav(id)).arrayBuffer())).slice(0,80),created.ids[0]),created.pcm);
  const cloud = testCloud ? await checkCloud(frame, page, created, reload) : null;
  if (testCloud) frame = page.mainFrame();
  // Clean up only this test's disposable library, after explicitly removing its track.
  await frame.evaluate(async ({ids,key})=>{
    const q=window.__qa||window.__probe;
    await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{tx.objectStore('comps').delete(key);done();});
    await q.takeStore.deleteTakes(q.takeSong,ids); await q.reloadTakes(); await q.refreshComp();
  },{ids:created.ids,key:created.state.key});
  const rests = await checkPhraseMargins(frame,page,{output,label,reload});
  frame=await reload();
  const referenceRevision = await checkReferenceRevision(frame,page,{output,label,reload});
  frame=await reload();
  const segment = await checkSegmentCapture(frame);
  const continuous = testContinuous ? await checkContinuousCapture(frame) : null;
  return {persisted:true,undo:true,originalsPreserved:true,protectedSources:true,staleWritesRejected:true,replacedDiscarded:true,
    compositeReview:review,performance:{first:firstPerformance,cached:cachedPerformance,pitchbarPaths},rowActions:true,
    legacyBackfill:true,selectedPlaybarCoverage:true,metricGrid:true,noSorting:true,offlineNoUpload:true,cloud,rests,referenceRevision,segment,continuous};
}

async function checkReferenceRevision(frame,page,{output,label,reload}) {
  const fixture=await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe,P=MeleteTakePitch,C=MeleteComp,d=q.compDescriptor;
    const ref=structuredClone(d.reference);ref.fingerprint='pre-correction';ref.notes[0][2]=ref.notes[0][2].map(n=>n-2);
    const old={...d,reference:ref},id=crypto.randomUUID(),sr=8000,n=Math.ceil(ref.seconds*sr);
    const part=d.label.split(' \u00b7 ')[0];
    const take=await q.takeStore.append({id,song:q.takeSong,createdAt:Date.now(),sampleRate:sr,part,
      label:'revision-proof',rate:ref.rate,start:0,end:ref.end,restAudioVersion:1,pitchReference:ref},
      0,Int16Array.from({length:n},(_,i)=>Math.round(1000*Math.sin(i/7))),{finalized:true,complete:true});
    const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
      const start=i*80/sr,end=Math.min((i+1)*80,n)/sr,note=d.reference.notes.find(n=>n[0]<=start&&n[1]>start);
      return {start,end,cents:note?note[2][0]*100+12:null};
    });
    const cached=await q.takeStore.pitchScore(id,n,ref,P.scoreFrames(frames,ref,n/sr),P.packContour(frames,take));
    const sources=new Map([[id,{...cached,origin:0}]]);
    const oldState=await q.takeStore.saveComp({...C.offer(C.empty(old),sources.get(id),sources),track:true});
    const previous=(await q.takeStore.comps(q.takeSong)).find(s=>s.key===C.key(d));
    if(previous?.segments.length)throw Error('Revision fixture requires an empty temporary track');
    await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{tx.objectStore('comps').delete(C.key(d));done();});
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    return {id,oldKey:oldState.key,key:C.key(d),audio:await hash(await(await q.takeStore.wav(id)).arrayBuffer()),
      raw:await hash(cached.pitchContour.pitches),oldMean:cached.pitchScore.meanAbsCents,
      expectedMean:P.scoreFrames(P.readContour(cached),d.reference,n/sr).meanAbsCents,number:cached.number};
  });
  const adopted=key=>{const s=(window.__qa||window.__probe).compState;return s?.revisionOf===key&&s.segments.length>0;};
  try {
    frame=await reload();
    await frame.waitForFunction(adopted,fixture.oldKey);
    const result=await frame.evaluate(async id=>{
      const q=window.__qa||window.__probe,t=q.recording.takes.find(t=>t.id===id),s=q.compState;
      const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      return {audio:await hash(await(await q.takeStore.wav(id)).arrayBuffer()),raw:await hash(t.pitchContour.pitches),
        original:t.originalPitchReference.fingerprint,current:t.pitchReference.fingerprint,target:q.compDescriptor.reference.fingerprint,
        mean:t.pitchScore.meanAbsCents,revisionOf:s.revisionOf,segments:s.segments.length};
    },fixture.id);
    assert.equal(result.audio,fixture.audio);assert.equal(result.raw,fixture.raw);
    assert.equal(result.original,'pre-correction');assert.equal(result.current,result.target);
    assert.ok(Math.abs(result.mean-fixture.expectedMean)<1e-7,`regraded mean ${result.mean} matches ${fixture.expectedMean}`);
    assert.ok(fixture.oldMean>result.mean);
    assert.equal(result.revisionOf,fixture.oldKey);assert.ok(result.segments>0);
    const row=trackRow(frame);
    assert.equal(await row.locator('.take-number').textContent(),String(fixture.number));
    assert.equal(await row.locator('.take-start').textContent(),'1');
    assert.match(await row.locator('.take-end').textContent(),/^\d+$/);
    await row.locator('.comp-review').click();
    await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview?.id.startsWith('comp:'));
    assert.equal(await frame.locator('.take-timeline-start').count(),1);
    assert.equal(await frame.locator('.take-timeline-end').count(),1);
    await page.screenshot({path:path.join(output,`reference-revision-${label}.png`)});
    await row.locator('.comp-review').click();
    frame=await reload();
    await frame.waitForFunction(adopted,fixture.oldKey);
    return {...result,reload:true,bounds:true};
  } finally {
    await frame.evaluate(async f=>{
      const q=window.__qa||window.__probe;
      await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{for(const k of[f.key,f.oldKey])tx.objectStore('comps').delete(k);done();});
      await q.takeStore.deleteTakes(q.takeSong,[f.id]);await q.reloadTakes();await q.refreshComp();
    },fixture);
  }
}

async function checkPhraseMargins(frame,page,{output,label,reload}) {
  const result = await frame.evaluate(async () => {
    const q=window.__qa||window.__probe, P=MeleteTakePitch, C=MeleteComp;
    const d=q.compDescriptor, ref=d.reference, guard=ref.restPolicy.guards.find(([a,b])=>b-a>.04);
    if(!guard)throw new Error('The browser fixture needs an entrance/release rest');
    const ids=[],sr=8000;
    const insert=async(r,noise)=>{
      const id=crypto.randomUUID(),n=Math.ceil(r.seconds*sr),pcm=new Int16Array(n).fill(noise?1000:0);
      P.discardRestAudio(pcm,sr,r);
      const t=await q.takeStore.append({id,song:q.takeSong,createdAt:Date.now(),sampleRate:sr,
        part:d.label,label:'phrase-margins',rate:r.rate,start:r.start,end:r.end,pitchReference:r,restAudioVersion:P.REST_POLICY_VERSION},
        0,pcm,{finalized:true,complete:true});
      const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
        const start=i*80/sr,end=Math.min((i+1)*80,n)/sr,note=r.notes.find(n=>n[0]<end&&n[1]>start);
        return {start,end,cents:note?note[2][0]*100+20:noise?6000:null};
      });
      const clean=P.cleanRestFrames(frames,r);
      await q.takeStore.pitchScore(id,n,r,P.scoreFrames(clean,r,n/sr),P.packContour(clean,t));
      ids.push(id);await q.reloadTakes();await q.refreshComp();return id;
    };
    const source=await insert(ref,true);
    const sources=()=>new Map(q.recording.takes.map(t=>[t.id,{...t,origin:q.engine.secondsAtTick(t.pitchReference.captureStart)/t.rate}]));
    const before=C.stats(q.compState,sources());
    const r=q.pitchReference({start:q.engine.tickAtSeconds((guard[0]+.01)*ref.rate),
      end:q.engine.tickAtSeconds((guard[1]-.01)*ref.rate),rate:ref.rate});r.latency=0;
    if(r.notes.length)throw new Error('Rest-only fixture accidentally includes singing');
    const silent=await insert(r,false),after=C.stats(q.compState,sources());
    const used=q.compState.segments.some(s=>s.takeId===silent);
    const missing={...sources().get(silent),id:'missing',createdAt:Date.now()+10,analysisFrames:[]};
    const unchanged=JSON.stringify(C.offer(q.compState,missing,new Map([...sources(),[missing.id,missing]])).segments)===JSON.stringify(q.compState.segments);
    // Simulate a comp saved by the old independent-rest policy. The real load
    // path must repair this, without running pitch analysis or changing audio.
    const spliced=C.replace(q.compState.segments,C.segment(sources().get(silent)));
    const legacy={...q.compState,segments:spliced,undo:spliced};
    await q.takeStore.saveComp(legacy);
    return {used,unchanged,before:before.restVoicedSeconds,after:after.restVoicedSeconds,
      meanBefore:before.meanAbsCents,meanAfter:after.meanAbsCents,ids,key:q.compState.key,
      number:sources().get(source).number,preferences:q.savedPractice};
  });
  assert.equal(result.used,false,'rest-only silence cannot hide a phrase timing error');
  assert.equal(result.after,result.before,'the chosen phrase keeps its entrance/release errors');
  assert.ok(Math.abs(result.meanAfter-result.meanBefore)<1e-7,'neighboring singing is untouched');
  assert.equal(result.unchanged,true,'missing observations never count as a clean rest');
  try {
    frame=await reload();
    const repaired=await frame.evaluate(()=>{
      const q=window.__qa||window.__probe,C=MeleteComp;
      const sources=new Map(q.recording.takes.map(t=>[t.id,{...t,origin:q.engine.secondsAtTick(t.pitchReference.captureStart)/t.rate}]));
      return {segments:q.compState.segments,undo:q.compState.undo,stats:C.stats(q.compState,sources)};
    });
    assert.equal(repaired.segments.length,1);
    assert.equal(repaired.segments[0].takeId,result.ids[0]);
    assert.deepEqual(repaired.undo,repaired.segments,'Undo cannot reintroduce independent rest splices');
    assert.equal(repaired.stats.restVoicedSeconds,result.before,'legacy repair restores the phrase original timing errors');
    assert.equal(repaired.stats.meanAbsCents,result.meanBefore,'legacy repair preserves the sung passage');
    result.savedCompRepaired=true;
    let row=trackRow(frame);
    assert.equal(await row.count(),1,'a repaired track has one row');
    assert.equal(await row.locator('.take-number').textContent(),String(result.number),'a single-recording track shows its take number');
    await row.locator('.comp-review').click();
    await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview?.id.startsWith('comp:'));
    assert.deepEqual(await frame.evaluate(()=>(window.__qa||window.__probe).savedPractice),result.preferences);
    const downloadPromise=page.waitForEvent('download');await row.locator('.take-download').click();
    assert.match((await downloadPromise).suggestedFilename(),/-track\.wav$/);
    await row.locator('.comp-review').click();
    await frame.waitForFunction(()=>(window.__qa||window.__probe).takeReview===null);
    assert.equal(await frame.locator('#reviewRestComp').count(),0,'no obsolete rest-repair variant');
    frame=await reload();
    row=trackRow(frame);
    assert.equal(await row.count(),1,'reload preserves the single-row presentation');
    if(output){
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`phrase-margins-${label}.png`)});
    }
    await row.locator('.take-delete').click();
    await frame.waitForFunction(()=>{const s=(window.__qa||window.__probe).compState;return s&&!s.segments.length;});
    const kept=await frame.evaluate(()=>(window.__qa||window.__probe).recording.takes.map(t=>t.id));
    assert.ok(result.ids.every(id=>kept.includes(id)),'removing the track keeps its sources for Undo');
    await frame.locator('#takeActions summary').click();await frame.locator('#undoComp').click();
    await frame.waitForFunction(()=>(window.__qa||window.__probe).compState?.segments.length);
    assert.equal(await row.count(),1,'Undo restores the track in its row');
  } finally {
    await frame.evaluate(async ({ids,key})=>{
      const q=window.__qa||window.__probe;
      await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{tx.objectStore('comps').delete(key);done();});
      await q.takeStore.deleteTakes(q.takeSong,ids);await q.reloadTakes();await q.refreshComp();
    },result);
  }
  delete result.ids;delete result.key;delete result.preferences;
  return result;
}

async function checkSelectedTimeline(frame, segments) {
  assert.equal(await frame.locator('#takeTimeline').isVisible(),true);
  const expected=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe,t=MeleteTakePitch.reviewTimeline(q.engine.takeReview,q.engine.duration);
    return {segments:t.segments.length,covered:t.covered,seams:t.seams};
  });
  assert.equal(expected.segments,segments);
  assert.equal(await frame.locator('#takeTimeline .take-timeline-coverage').count(),expected.covered.length);
  assert.equal(await frame.locator('#takeTimeline svg, #takeTimeline canvas, #takeTimeline .take-timeline-segment, #takeTimeline .take-timeline-tracked').count(),0,'playbar has only coverage bands and source seams, not per-sample detail');
  assert.equal(await frame.locator('#takeTimeline .take-timeline-boundary').count(),expected.seams.length);
  assert.equal(await frame.locator('#takeTimeline .take-timeline-start').count(),1);
  assert.equal(await frame.locator('#takeTimeline .take-timeline-end').count(),1);
  assert.equal(await frame.locator('#seek').getAttribute('aria-describedby'),'takeTimelineDescription');
  const layout = await frame.evaluate(()=>{
    const q=window.__qa||window.__probe, rail=document.getElementById('takeTimeline').getBoundingClientRect();
    const marks=[...document.querySelectorAll('.take-timeline-coverage')];
    return marks.map(mark=>{
      const box=mark.getBoundingClientRect();
      return Math.abs(box.x-rail.x-Number(mark.dataset.from)/q.engine.duration*rail.width)<1
        && Math.abs(box.width-(Number(mark.dataset.to)-Number(mark.dataset.from))/q.engine.duration*rail.width)<1;
    });
  });
  assert.ok(layout.every(Boolean),'coverage uses the actual main-playbar time scale');
  const boundaries=await frame.evaluate(()=>{
    const track=document.querySelector('.timeline-track').getBoundingClientRect();
    const rail=document.getElementById('timelineRail').getBoundingClientRect();
    return [...document.querySelectorAll('.take-timeline-boundary')].map(e=>{
      const b=e.getBoundingClientRect();return {above:b.bottom<track.top,insideRail:b.top>=rail.top};
    });
  });
  assert.ok(boundaries.every(b=>b.above&&b.insideRail),'take boundaries are visible above, not on top of section chapters');
  assert.equal(await frame.locator('#timelineSegments').evaluate(e=>getComputedStyle(e).opacity),'1','section chapters retain full contrast');
  assert.equal(await frame.locator('#takeTimeline').evaluate(e=>getComputedStyle(e).pointerEvents),'none','coverage never intercepts seeking');
}

async function checkSegmentCapture(frame) {
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const target = await frame.evaluate(() => {
    const q=window.__qa||window.__probe, ref=q.compDescriptor.reference;
    const note=ref.notes[Math.floor(ref.notes.length/3)];
    const position=(note[0]+(note[1]-note[0])*.37)*ref.rate;
    q.engine.pauseTransport(); q.api.tickPosition=q.engine.tickAtSeconds(position);
    return {tick:q.engine.tickAtSeconds(position),position,end:ref.end,key:q.compState.key};
  });
  assert.equal(await frame.locator('#recordTake').count(),0,'one combined toggle, no separate Record');
  await toggleRecording(frame);
  await frame.waitForFunction(() => (window.__qa||window.__probe).recording.state==='recording');
  await frame.waitForFunction(()=>document.getElementById('checkMicrophone').getAttribute('aria-pressed')==='true');
  assert.equal(await frame.locator('#checkMicrophone').isDisabled(),true,'recording owns the inline meter');
  assert.equal(await frame.locator('#takeMicrophone').isDisabled(),true);
  const spec=await frame.evaluate(()=>(window.__qa||window.__probe).countIn.spec);
  assert.ok(Math.abs(spec.start-target.tick)<3,'free recording starts at the chosen playhead, not zero');
  assert.equal(spec.initial.start,spec.start,'no lead-in moves the chosen entrance');
  assert.equal(spec.initial.leadInSeconds,0);
  assert.equal(await frame.locator('#takeCountIn').isVisible(),false);
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).countIn.startTime),undefined,
    'normal recording never creates count-in clicks');
  await frame.waitForFunction(()=>{
    const q=window.__qa||window.__probe,t=q.recording.takes.find(t=>t.active);
    return q.recording.state==='recording'&&t?.seconds>t.leadInSeconds+1.2;
  });
  await toggleRecording(frame);
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.state==='off');
  const take=await frame.evaluate(()=>(window.__qa||window.__probe).recording.takes.at(-1));
  assert.equal(take.complete,true,JSON.stringify(take));
  assert.equal(take.finalized,true);
  assert.equal(take.mode,'segment');
  assert.ok(take.end<target.end,'manual stop saves the sung excerpt instead of claiming the whole song');
  assert.ok(Math.abs(take.seconds-take.frames/take.sampleRate)<1/take.sampleRate);
  assert.equal(take.pitchReference.end,take.end);
  assert.ok(take.pitchReference.notes.every(n=>n[1]<=take.seconds));
  await frame.waitForFunction(id=>(window.__qa||window.__probe).recording.takes.find(t=>t.id===id)?.pitchScore,take.id,{timeout:30000});
  await frame.evaluate(()=>(window.__qa||window.__probe).refreshComp());
  const offered=await frame.evaluate(id=>{
    const q=window.__qa||window.__probe,t=q.recording.takes.find(t=>t.id===id);
    const origin=q.engine.secondsAtTick(t.pitchReference.captureStart)/t.rate;
    return {used:q.compState.segments.some(s=>s.takeId===id),score:t.pitchScore,
      eligible:MeleteComp.eligible({...t,origin},q.compDescriptor),origin,
      range:[t.pitchReference.start,t.pitchReference.end],segments:q.compState.segments};
  },take.id);
  assert.ok(offered.used,`the saved excerpt replaces its passage in the track: ${JSON.stringify(offered)}`);
  await frame.evaluate(async ({id,key})=>{
    const q=window.__qa||window.__probe;
    await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{tx.objectStore('comps').delete(key);done();});
    await q.takeStore.deleteTakes(q.takeSong,[id]);await q.reloadTakes();await q.refreshComp();
  },{id:take.id,key:target.key});
  return {playheadStart:true,noCountIn:true,manualStopSaved:true,actualRange:true,eligibleForComp:true,replacesPassage:true};
}

async function checkContinuousCapture(frame) {
  // The tiny synthetic song reaches its actual end: no fake completion event.
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  assert.equal(await frame.evaluate(() => (window.__qa || window.__probe).engine.hasLoop()), false);
  await frame.evaluate(()=>{
    const write=MeleteRecording.TakeBuffer.prototype.write;
    window.__captureGaps=[];
    MeleteRecording.TakeBuffer.prototype.write=function(take,frame,samples){
      const hadGap=take.gap;write.call(this,take,frame,samples);
      if(!hadGap&&take.gap)window.__captureGaps.push({start:take.start,frame,...take.firstGap});
    };
  });
  let result;
  const recoveredInputDropouts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await frame.evaluate(()=>{const q=window.__qa||window.__probe;q.api.tickPosition=0;window.__captureGaps=[];});
    await toggleRecording(frame);
    await frame.waitForFunction(() => ['counting','recording'].includes((window.__qa || window.__probe).recording.state));
    await frame.waitForFunction(() => (window.__qa || window.__probe).recording.state === 'off', null, {timeout: 45000});
    result = await frame.evaluate(() => (window.__qa || window.__probe).recording);
    assert.equal(result.takes.length, 1, 'one uninterrupted performance, without count-in');
    assert.equal(result.takes[0].leadInSeconds,0);
    if (result.takes[0].complete) break;
    const gaps = await frame.evaluate(()=>window.__captureGaps);
    // Chrome's realtime audio driver can drop one quantum. Verify recovery,
    // then allow one real rerecording; never fake completion or patch the PCM.
    assert.ok(attempt === 0 && result.takes[0].gap && gaps.length === 1 && gaps[0].frames === 128,
      JSON.stringify({take:result.takes[0],gaps}));
    assert.equal(result.takes[0].finalized, true);
    assert.equal(result.takes[0].unsaved, false);
    assert.equal(await frame.evaluate(id => (window.__qa || window.__probe).compState.segments.some(s => s.takeId === id),
      result.takes[0].id), false, 'a recording with a real audio gap never enters the track');
    await frame.evaluate(async id => {
      const q=window.__qa||window.__probe;
      const wav=await q.takeStore.wav(id);
      if (!wav || wav.size < 44) throw new Error('Recovery audio was lost');
      await q.takeStore.deleteTakes(q.takeSong,[id]);await q.reloadTakes();await q.refreshComp();
    },result.takes[0].id);
    recoveredInputDropouts.push(...gaps);
  }
  assert.equal(result.takes[0].complete, true, JSON.stringify(result.takes[0]));
  assert.equal(result.takes[0].finalized, true);
  const id = result.takes[0].id;
  await frame.waitForFunction(id => (window.__qa || window.__probe).compState?.segments.some(s => s.takeId === id), id, {timeout: 30000});
  assert.equal(await trackRow(frame).locator('.take-number').textContent(), String(result.takes[0].number),
    'a complete performance fills the track as one recording');
  assert.equal(await trackRow(frame).locator('.comp-review').isEnabled(), true);
  await frame.evaluate(async id => {
    const q = window.__qa || window.__probe;
    await q.takeStore.transaction(['comps'],'readwrite',(tx,done)=>{tx.objectStore('comps').delete(q.compState.key);done();});
    await q.takeStore.deleteTakes(q.takeSong,[id]); await q.reloadTakes(); await q.refreshComp();
  }, id);
  return {endFinalizes: true, noCountIn: true, fillsTrack: true, recoveredInputDropouts};
}
module.exports={checkComp};
