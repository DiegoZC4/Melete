const assert=require('node:assert/strict');
const {choosePart}=require('./browser-sing.cjs');

async function checkRecordEdits(page,frame,{output,label}) {
  if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserDismiss').click();
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
  for(const section of ['parts','practice','display','takes']){
    const toggle=frame.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
    if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  }
  await choosePart(frame,0);
  if(await frame.locator('[data-view="bars"]').getAttribute('aria-selected')!=='true')await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  const seed=async(error)=>frame.evaluate(async error=>{
    const q=window.__qa||window.__probe,ref={...q.compDescriptor.reference,latency:0},sr=8000,n=Math.ceil(ref.seconds*sr),id=crypto.randomUUID();
    const take=await q.takeStore.append({id,song:q.takeSong,sampleRate:sr,createdAt:Date.now(),start:ref.start,end:ref.end,
      rate:ref.rate,part:'fixture',replaces:true,pitchReference:ref},0,Int16Array.from({length:n},(_,i)=>1000*Math.sin(2*Math.PI*220*i/sr)),{finalized:true,complete:true});
    const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{const start=i/100,end=Math.min((i+1)/100,n/sr),note=ref.notes.find(n=>n[0]<=start&&n[1]>start);
      return {start,end,cents:note?note[2][0]*100+error:null};});
    await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,n/sr),MeleteTakePitch.packContour(frames,take));
    await q.reloadTakes();await q.refreshComp();return q.compState.key;
  },error);
  const key=await seed(30);
  const row=frame.locator(`[data-comp-key='${key.replaceAll("'","\\'")}']`);
  if(await row.locator('.comp-review').getAttribute('aria-pressed')!=='true')await row.locator('.comp-review').click();
  await frame.waitForFunction(()=>!!(window.__qa||window.__probe).takeReview?.duration);
  await frame.evaluate(()=>{
    const q=window.__qa||window.__probe,settings=q.pitchbar.captureSettingsState();settings.loopEnabled=false;q.pitchbar.applySettingsState(settings);
    const start=q.compDescriptor.reference.notes[0][0]*q.engine.rate;
    q.engine.seek(start);
    window.__editProbe={recordUntil:start+1.3,workerAnalyses:0,audioPrepares:0,blankFrames:0,selectionLost:0,stopping:false};
    const worker=MeleteTakePitch.workerSource;
    MeleteTakePitch.workerSource=(...args)=>{__editProbe.workerAnalyses++;return worker(...args);};
    const prepare=MeleteCompAudio.prepare;
    MeleteCompAudio.prepare=async(...args)=>{
      __editProbe.audioPrepares++;
      __editProbe.audioPreparing=true;
      await new Promise(resolve=>{__editProbe.releaseAudio=resolve;});
      return prepare(...args);
    };
    const flush=MeleteRecording.TakeJournal.prototype.flush;
    MeleteRecording.TakeJournal.prototype.flush=async function(){
      await flush.call(this);
      await new Promise(resolve=>{__editProbe.releaseFlush=resolve;});
    };
    __editProbe.restore=()=>{MeleteCompAudio.prepare=prepare;MeleteTakePitch.workerSource=worker;MeleteRecording.TakeJournal.prototype.flush=flush;};
  });
  await frame.locator('#recordAudio').click();
  await frame.locator('#playPause').click();
  try {
    await frame.waitForFunction(()=>{const q=window.__qa||window.__probe;return q.recording.state==='recording'&&q.engine.currentSeconds()>__editProbe.recordUntil;});
  } catch(error) {
    console.error('Record edit start:',await frame.evaluate(()=>{
      const q=window.__qa||window.__probe;
      return {state:q.recording.state,playing:q.engine.playing,seconds:q.engine.currentSeconds(),until:__editProbe.recordUntil,
        notice:document.querySelector('#takeStatus')?.textContent,mic:document.querySelector('#pitchCapture')?.outerHTML,
        toast:document.querySelector('#toastMessage')?.textContent};
    }));
    throw error;
  }
  assert.deepEqual(await frame.evaluate(()=>{
    const q=window.__qa||window.__probe, previous=q.engine.takeLayers.get('comp:'+q.compState.key);
    return {present:!!previous, playing:!!previous?.source};
  }),{present:true,playing:false},'the selected comp is silent during its overdub and retains its Hear selection');
  const frozen=await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe, systems=()=>q.pitchbar.systems.map(s=>[
      s.startTick,s.endTick,s.minPitch,s.maxPitch,s.shell.getBoundingClientRect().height,s.shell.querySelectorAll('.pitch-guide').length]);
    const before=systems(), first=q.pitchbar.systems[0], svg=first.shell.querySelector('svg');
    const tick=q.engine.tickAtSeconds(q.engine.currentSeconds()),system=q.pitchbar.systems.find(s=>s.startTick<=tick && tick<s.endTick);
    const high=q.pitchResolution.seedReviewOutlier(tick,(system.maxPitch+20)*100,true);
    await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));
    const sameSvg=q.pitchbar.systems[0].shell.querySelector('svg')===svg;
    const low=q.pitchResolution.seedReviewOutlier(tick,Math.max(1,system.minPitch-20)*100);
    const after=systems(); q.pitchResolution.restoreReviewOutlier(low); q.pitchResolution.restoreReviewOutlier(high);
    return {before,after,sameSvg};
  });
  assert.ok(frozen.sameSvg,'a live outlier does not schedule a score redraw');
  assert.deepEqual(frozen.after,frozen.before,'even an explicit repaint keeps every recording system and pitch guide in place');
  await frame.evaluate(()=>{
    __editProbe.svg=document.querySelector('#barScore svg');__editProbe.started=performance.now();
    const sample=()=>{
      if(!__editProbe.stopping)return;
      if(!document.querySelector('#barScore [data-from-bin],#barScore [data-reference="false"]'))__editProbe.blankFrames++;
      if(!document.querySelector('#compRows .comp-review[aria-pressed="true"]'))__editProbe.selectionLost++;
      requestAnimationFrame(sample);
    };__editProbe.stopping=true;requestAnimationFrame(sample);
  });
  await frame.locator('#playPause').click();
  // Exercise the race where the comp sees finalized PCM before Stop settles.
  await frame.waitForFunction(()=>{const q=window.__qa||window.__probe,t=q.recording.takes.at(-1);
    return __editProbe.releaseFlush&&q.recording.state==='stopping'&&q.compState.segments.some(s=>s.takeId===t?.id);});
  await frame.evaluate(()=>__editProbe.releaseFlush());
  await frame.waitForFunction(()=>{const q=window.__qa||window.__probe;return q.recording.state==='off'&&__editProbe.audioPreparing&&!q.pendingCaptureTrace;});
  const commit=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe,t=q.recording.takes.at(-1);__editProbe.stopping=false;
    return {elapsed:performance.now()-__editProbe.started,blank:__editProbe.blankFrames,deselected:__editProbe.selectionLost,
      version:t.pitchContour?.version,scored:MeleteTakePitch.currentScore(t.pitchScore),workerAnalyses:__editProbe.workerAnalyses,audioPrepares:__editProbe.audioPrepares,
      sameSvg:__editProbe.svg===document.querySelector('#barScore svg'),selected:q.takeReview?.id,source:t.id,
      incorporated:q.compState.segments.some(s=>s.takeId===t.id),frames:q.takeReview?.frames.length};
  });
  assert.equal(commit.blank,0,JSON.stringify(commit));assert.equal(commit.deselected,0,JSON.stringify(commit));
  assert.equal(commit.version,2);assert.equal(commit.scored,true);assert.equal(commit.workerAnalyses,0);
  assert.equal(commit.audioPrepares,1,'save/stop races share one background audio preparation');
  assert.equal(commit.incorporated,true);assert.equal(commit.selected,`comp:${key}`);assert.ok(commit.frames>0);
  assert.equal(commit.sameSvg,true,'committing a contour does not rebuild the pitchbar');
  // Manual deselection during delayed audio preparation wins over its completion.
  await row.locator('.comp-review').click();
  await frame.evaluate(()=>{__editProbe.restore();__editProbe.releaseAudio();});
  await frame.waitForFunction(()=>document.querySelector('#compRows .comp-review')?.getAttribute('aria-busy')==='false');
  assert.equal(await row.locator('.comp-review').getAttribute('aria-pressed'),'false');
  if(await frame.locator('#pitchCapture').getAttribute('aria-pressed')==='true')await frame.locator('#pitchCapture').click();
  const audio=await frame.evaluate(async()=>{
    const rate=16000,n=rate*2;
    const source=new Float32Array(n);
    for(let h=1;h<=70;h++){
      const hz=h*100,amplitude=Math.exp(-.5*((hz-600)/130)**2)+.35*Math.exp(-.5*((hz-1800)/220)**2)+.1*Math.exp(-.5*((hz-3000)/280)**2);
      for(let i=0;i<n;i++)source[i]+=.03*amplitude*Math.sin(2*Math.PI*hz*i/rate);
    }
    const render=async(compensation,semitones)=>{
      const c=new OfflineAudioContext(1,n+4000,rate),buffer=c.createBuffer(1,n,rate);buffer.copyToChannel(source,0);
      const node=await MeleteTakeStretch.create(c,buffer);node.connect(c.destination);
      await node.start({active:true,output:.1,input:0,rate:1,semitones,formantSemitones:0,formantCompensation:compensation});
      try{return (await c.startRendering()).getChannelData(0);}finally{node.disconnect();node.port.close();}
    };
    const centroid=(data)=>{
      const fft=new Pitchy.FFT(8192),spectrum=fft.createComplexArray(),input=Float64Array.from({length:8192},(_,i)=>data[5000+i]*(.5-.5*Math.cos(2*Math.PI*i/8191)));
      fft.realTransform(spectrum,input);let energy=0,moment=0,peak=0,peakHz=0;
      for(let k=100;k<1800;k++){const power=spectrum[2*k]**2+spectrum[2*k+1]**2,hz=k*rate/8192;
        energy+=power;moment+=hz*power;if(power>peak){peak=power;peakHz=hz;}}
      return {centroid:moment/energy,peakHz};
    };
    const original=centroid(source),shifted=centroid(await render(false,12)),preserved=centroid(await render(true,12)),down=centroid(await render(true,-12));
    return {original,shifted,preserved,down};
  });
  assert.ok(Math.abs(audio.preserved.centroid-audio.original.centroid)<Math.abs(audio.shifted.centroid-audio.original.centroid)*.65,JSON.stringify(audio));
  assert.ok(Math.abs(audio.preserved.peakHz-audio.original.peakHz)<220,JSON.stringify(audio));
  assert.ok(Math.abs(audio.down.peakHz-audio.original.peakHz)<220,JSON.stringify(audio));
  const cleanup=await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe,rate=16000,n=rate*3;
    let seed=1,filtered=0;
    const pcm=Int16Array.from({length:n},(_,i)=>{
      const t=i/rate;if(t<1||t>2)return 4000*Math.sin(2*Math.PI*180*t);
      if(t>1.08&&t<1.22){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2**32*2-1)*90;}
      if(t>1.3&&t<1.65){seed=(Math.imul(seed,1664525)+1013904223)>>>0;filtered=.8*filtered+.2*(seed/2**32*2-1);return filtered*5000;}
      return 0;
    });
    const ref={version:1,fingerprint:'cleanup',part:0,line:null,start:0,end:12,rate:1,seconds:3,latency:0,notes:[[0,1,[60]],[2,3,[60]]]};
    let take=await q.takeStore.append({id:crypto.randomUUID(),song:'disposable-cleanup',sampleRate:rate,createdAt:Date.now(),pitchReference:ref},0,pcm,{complete:true,finalized:true});
    const frames=Array.from({length:300},(_,i)=>({start:i/100,end:(i+1)/100,cents:i<100||i>=200?6000:null}));
    take=await q.takeStore.pitchScore(take.id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,3),MeleteTakePitch.packContour(frames,take));
    const result=await q.cleanedTakeBlob(take),clean=new Int16Array(await result.arrayBuffer(),44);
    const raw=new Int16Array(await (await q.takeStore.wav(take.id)).arrayBuffer(),44);
    const energy=p=>p.subarray(1.32*rate,1.63*rate).reduce((n,x)=>n+x*x,0);
    const quickEnergy=p=>p.subarray(1.08*rate,1.22*rate).reduce((n,x)=>n+x*x,0);
    const saved={ratio:energy(clean)/energy(pcm),quickRatio:quickEnergy(clean)/quickEnergy(pcm),cleanupVersion:MeleteTakeCleanup.VERSION,
      sameLength:clean.length===pcm.length,originalKept:raw.every((x,i)=>x===pcm[i]),
      singingKept:clean.subarray(0,rate).every((x,i)=>x===pcm[i])};
    await q.takeStore.deleteTakes('disposable-cleanup',[take.id]);
    const click={id:crypto.randomUUID(),song:'disposable-cleanup',sampleRate:8000,createdAt:Date.now()};
    const first=await q.takeStore.append(click,0,new Int16Array(7200).fill(1000),{finalized:false});
    const last=await q.takeStore.append(first,7200,new Int16Array(800).fill(9000),{finalized:true,complete:true,stopNoiseFrom:.8});
    const muted=new Int16Array(await (await q.takeStore.wav(last.id)).arrayBuffer(),44);
    saved.checkpointTail=muted.subarray(6441).every(x=>x===0)&&muted.subarray(0,6400).every(x=>x===1000);
    await q.takeStore.deleteTakes('disposable-cleanup',[last.id]);
    return saved;
  });
  assert.ok(cleanup.ratio<.04,JSON.stringify(cleanup));assert.ok(cleanup.originalKept&&cleanup.singingKept&&cleanup.sameLength&&cleanup.checkpointTail,JSON.stringify(cleanup));
  assert.equal(cleanup.cleanupVersion,2);assert.ok(cleanup.quickRatio<.03,JSON.stringify(cleanup));
  await choosePart(frame,1);await seed(5);
  await choosePart(frame,0);
  await frame.waitForFunction(()=>document.querySelectorAll('#compRows .comp-row').length===2);
  const sort=frame.locator('#compView [data-take-sort="mean"]');
  if(await sort.getAttribute('aria-sort')!=='ascending')await sort.click();
  const rows=()=>frame.locator('#compRows .comp-row').evaluateAll(rows=>rows.map(r=>({mean:Number(r.querySelector('.comp-mean').textContent),key:r.dataset.compKey})));
  let order=await rows();if(order[0].mean>order[1].mean){await sort.click();order=await rows();}
  assert.ok(order[0].mean<=order[1].mean);assert.notEqual(order[0].key,key,'selected part is not pinned above column sort');
  await frame.evaluate(()=>{const el=document.querySelector('.take-review');el.style.maxHeight='30px';el.scrollTop=15;window.__sortTop=el.scrollTop;});
  await sort.evaluate(el=>el.click());
  assert.equal(await frame.evaluate(()=>document.querySelector('.take-review').scrollTop),await frame.evaluate(()=>__sortTop));
  await frame.evaluate(()=>{const el=document.querySelector('.take-review');el.style.maxHeight='';el.scrollTop=0;window.scrollTo(0,0);});
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:require('node:path').join(output,`${label}-record-edits.png`)});
  const boundaryOverdub=await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe,d=q.compDescriptor,notes=d.reference.notes;
    const index=notes.findIndex((n,i)=>i>0&&Math.abs(n[0]-notes[i-1][1])<1e-8&&n[1]-n[0]>.2);
    if(index<0)throw Error('Boundary regression requires adjacent written notes');
    const boundary=notes[index][0],tick=q.engine.tickAtSeconds(boundary*d.reference.rate);
    const start=tick-Math.max(1,Math.abs(tick))*Number.EPSILON*4;
    const end=q.engine.tickAtSeconds((boundary+Math.min(1,notes[index][1]-boundary)/2)*d.reference.rate);
    const ref=q.pitchReference({start,end,rate:d.reference.rate});ref.latency=0;
    if(ref.notes.some(n=>n[1]-n[0]<=MeleteTakePitch.TIME_EPSILON))throw Error('New reference contains a phantom note');
    const fragment=ref.notes[0][0];
    if(!(fragment>0&&fragment<1e-10))throw Error(`Expected floating-point fragment, got ${fragment}`);
    ref.notes.unshift([0,fragment,notes[index-1][2]]);
    const id=crypto.randomUUID(),sr=8000,n=Math.ceil(ref.seconds*sr);
    const pcm=Int16Array.from({length:n},(_,i)=>2000*Math.sin(2*Math.PI*220*i/sr));
    MeleteTakePitch.discardRestAudio(pcm,sr,ref);
    const t=await q.takeStore.append({id,song:q.takeSong,sampleRate:sr,createdAt:Date.now(),start,end,
      trackSlot:d.slot,rate:ref.rate,replaces:true,pitchReference:ref,restAudioVersion:MeleteTakePitch.REST_POLICY_VERSION},
      0,pcm,{finalized:true,complete:true});
    const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>({start:i*80/sr,end:Math.min((i+1)*80,n)/sr,cents:notes[index][2][0]*100+8}));
    await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,n/sr),MeleteTakePitch.packContour(frames,t));
    const bytes=async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await q.takeStore.wav(id)).arrayBuffer()))).join(',');
    const originalBytes=await bytes(),before=q.compState.segments.map(s=>({...s}));
    await q.reloadTakes();await q.refreshComp();
    const after=q.compState,origin=q.engine.secondsAtTick(start)/ref.rate;
    const used=after.segments.find(s=>s.takeId===id),saved=q.recording.takes.find(t=>t.id===id);
    const prior=before.map(s=>({...s,to:Math.min(s.to,origin)})).filter(s=>s.to-s.from>1e-6);
    const retained=after.segments.map(s=>({...s,to:Math.min(s.to,origin)})).filter(s=>s.to-s.from>1e-6);
    return {fragment,incorporated:!!used,processed:after.processed.includes(id),
      originalBytesKept:originalBytes===await bytes(),referenceKept:JSON.stringify(saved.pitchReference)===JSON.stringify(ref),
      priorKept:JSON.stringify(prior)===JSON.stringify(retained),capturedOnly:!!used&&Math.abs(used.from-origin)<1e-6&&used.to<=origin+ref.seconds+1e-6,
      undoable:(await q.takeStore.compHistory(q.takeSong)).past.some(e=>e.after.segments.some(s=>s.takeId===id))};
  });
  for(const field of ['incorporated','processed','originalBytesKept','referenceKept','priorKept','capturedOnly','undoable'])
    assert.equal(boundaryOverdub[field],true,JSON.stringify(boundaryOverdub));
  return {commit,audio,cleanup,boundaryOverdub,selectionPersists:true,manualDeselectionWins:true,columnSorting:true};
}
module.exports={checkRecordEdits};
