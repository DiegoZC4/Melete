const assert=require('node:assert/strict');
const {checkRecordingTime}=require('./browser-recording-time.cjs');
const {checkCompHistory}=require('./browser-comp-history.cjs');
async function checkRecordingMix(page, frame, {output,label}) {
  if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserDismiss').click();
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
  for(const section of ['parts','practice','display','takes']){
    const toggle=frame.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
    if(await toggle.count()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  }
  const toolsToggle=frame.locator('[data-settings-section="tools"] .settings-section-toggle');
  if(await toolsToggle.count()&&await toolsToggle.getAttribute('aria-expanded')==='false')await toolsToggle.click();
  const toolColumns=await frame.locator('.tools-group').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(toolColumns,2,'Tools retains the two-column arrangement on phones too');
  assert.equal(await frame.locator('#practicePart').evaluate(el=>el.hidden),false);
  assert.equal(await frame.locator('#takeTitle').textContent(),'Record');
  assert.equal(await frame.locator('#downloadTakes').count(),0);
  assert.equal(await frame.locator('#compView [data-take-sort="start"], #compView [data-take-sort="end"]').count(),0);
  assert.equal(await frame.locator('#compView [data-take-sort="segments"]').count(),1);
  const dailyTime = await checkRecordingTime(frame);
  const editHistory = await checkCompHistory(frame);
  assert.equal(await frame.locator('#compCloud, #compAccount').count(),0);
  assert.equal(await frame.locator('#downloadMix').innerText(),'');
  assert.equal(await frame.locator('#downloadMix svg').count(),2);
  assert.equal(await frame.locator('#downloadMix').getAttribute('aria-label'),'Download audible recording mix');
  const positions=await frame.evaluate(()=>{
    const vol=document.querySelector('.take-volume'),reverb=document.querySelector('.take-reverb');
    return {vol:vol.getBoundingClientRect().toJSON(),reverb:reverb.getBoundingClientRect().toJSON(),
      align:[vol,reverb].map(el=>getComputedStyle(el.querySelector('span')).textAlign)};
  });
  assert.deepEqual(positions.align,['right','right']);
  assert.ok(positions.vol.y<positions.reverb.y || positions.vol.x<positions.reverb.x);
  await frame.waitForFunction(()=>Number.isFinite(Number(document.querySelector('#recordingToday').dataset.seconds)));
  const recordedBefore=Number(await frame.locator('#recordingToday').getAttribute('data-seconds'));
  if(label.includes('autumn')||label.includes('the-seed')){
    const pdf=await frame.evaluate(async()=>{
      const link=document.querySelector('#printParts');
      const bytes=new Uint8Array(await (await fetch(link.href)).arrayBuffer());
      return {visible:!link.hidden,header:new TextDecoder().decode(bytes.slice(0,4)),bytes:bytes.length};
    });
    assert.equal(pdf.visible,true);assert.equal(pdf.header,'%PDF');assert.ok(pdf.bytes>10000);
  }
  const labels=await frame.locator('#mixer [data-visible-index]').allTextContents();
  const sorted=await frame.evaluate(names=>[...names].sort(MeleteTakePitch.compareParts),labels);
  assert.deepEqual(labels,sorted);
  if(label.includes('autumn')) {
    await frame.locator('[data-visible-index]').nth(labels.indexOf('A2')).press('Shift+Enter');
    const strict=await frame.evaluate(()=>{
      const q=(window.__qa||window.__probe).pitchResolution;
      const s=q.divisiSpans.find(s=>s.pitches.length===2&&(s.pitches[0]-s.pitches[1])%12!==0);
      return s&&{upper:s.pitches[0],lower:s.pitches[1],result:q.divisiTargets((s.start+s.end)/2,s.pitches[0]*100)};
    });
    assert.ok(strict&&strict.result.error!==0,JSON.stringify(strict));
    assert.deepEqual(strict.result.pitches,[strict.lower],'Autumn A2 accepts only its own division');
  }
  await frame.locator('[data-visible-index="0"]').press('Shift+Enter');
  await frame.waitForFunction(()=> (window.__qa||window.__probe).savedPractice.practicePart===0);
  while(await frame.locator('[data-audio-index][aria-pressed="true"]').count())await frame.locator('[data-audio-index][aria-pressed="true"]').first().click();
  assert.equal(await frame.locator('[data-audio-index][aria-pressed="true"]').count(),0);
  await frame.locator('[data-visible-index="0"]').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).savedPractice.practicePart),null);
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  if(await frame.locator('[data-view="standard"]').getAttribute('aria-selected')==='true')
    assert.equal(await frame.locator('#score').isVisible(),false,'zero See channels hides notation without an engraving retry');
  await frame.locator('[data-visible-index="0"]').press('Shift+Enter');
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  // Meter starts from Sing, without a separate test command or transport.
  if(await frame.locator('#pitchCapture').getAttribute('aria-pressed')==='true')await frame.locator('#pitchCapture').click();
  await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(()=>document.querySelector('#microphoneCheck').dataset.state==='signal');
  const meter=await frame.locator('[aria-label="Microphone input level"]').getAttribute('aria-valuenow');
  assert.ok(Number(meter)>-45);
  assert.equal(Number(await frame.locator('#recordingToday').getAttribute('data-seconds')),recordedBefore,'mic monitoring alone is not practice duration');
  if(await frame.locator('[data-view="bars"]').getAttribute('aria-selected')!=='true')await frame.locator('#scoreViewToggle').click();
  assert.equal(await frame.locator('#recordCountIn').count(),0);
  const beats=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe;return Math.round(-q.engine.leadInTicks/q.engine.division);
  });
  assert.equal(beats,label.includes('autumn')?3:4);
  await frame.waitForFunction(()=>document.querySelectorAll('.bar-count-in-label').length>0);
  assert.equal(await frame.locator('.bar-count-in-label').count(),beats);
  // On a phone the expanded settings overlay intentionally covers the score.
  if(label.includes('mobile'))await frame.locator('#settingsToggle').click();
  await frame.locator('.bar-count-in-label').first().click();
  assert.ok(await frame.evaluate(()=>(window.__qa||window.__probe).engine.currentSeconds()<0),'a pitchbar tap reaches preparation');
  const rail=await frame.locator('#seek').boundingBox(),x=rail.x+rail.width*.4,y=rail.y+rail.height/2;
  if(label.includes('mobile')){
    const session=await page.context().newCDPSession(page);
    try{
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rail.x+2,y}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }finally{await session.detach();}
  }else{
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(rail.x+2,y,{steps:5});await page.mouse.up();
  }
  assert.ok(await frame.evaluate(()=>{
    const e=(window.__qa||window.__probe).engine;return Math.abs(e.currentSeconds()-e.secondsAtTick(e.leadInTicks))<.01;
  }),'dragging the transport reaches the beginning of the lead-in');
  await frame.evaluate(()=>{
    const q=window.__qa||window.__probe;q.engine.ensureAudio();q.engine.setMetronome(100);
    window.__countClicks=[];const create=q.engine.context.createOscillator.bind(q.engine.context);
    q.engine.context.createOscillator=()=>{
      const node=create(),start=node.start.bind(node);node.start=t=>{window.__countClicks.push({at:t,hz:node.frequency.value});return start(t)};return node;
    };
  });
  await require('./browser-sing.cjs').startRecording(frame);
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.state==='recording');
  await frame.waitForFunction(()=>{
    const q=window.__qa||window.__probe;return q.pitchResolution.snapshot().count>0;
  });
  assert.ok(await frame.evaluate(()=>(window.__qa||window.__probe).countIn.spec.initial.start<0));
  await page.screenshot({path:require('node:path').join(output,`${label}-seekable-lead-in.png`)});
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.currentSeconds()>.15);
  assert.ok(await frame.evaluate(beats=>window.__countClicks.filter(c=>[880,1320].includes(c.hz)).length>=beats,beats),'ordinary metronome clicks cover the lead-in');
  assert.notEqual(await frame.locator('#microphoneCheck').getAttribute('data-state'),'error');
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
  await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).recording.state==='off');
  await frame.waitForFunction(before=>Number(document.querySelector('#recordingToday').dataset.seconds)>before,recordedBefore);
  const today=await frame.locator('#recordingToday').evaluate(el=>({seconds:Number(el.dataset.seconds),label:el.querySelector('output').textContent}));
  assert.equal(today.label,`${Math.round(today.seconds/60)} min`);
  assert.equal(await frame.locator('#microphoneCheck').getAttribute('data-state'),'idle');
  if(await frame.locator('#playPause').getAttribute('aria-label')==='Pause score')await frame.locator('#playPause').click();
  await frame.evaluate(()=>{const q=window.__qa||window.__probe;q.engine.setMetronome(0);q.engine.seek(0);});
  // Same-part clones have separate source ownership and audible grey contours.
  const seed = async clone => frame.evaluate(async clone => {
    const q=window.__qa||window.__probe, ref={...q.compDescriptor.reference,latency:0};
    const id=crypto.randomUUID(),sr=8000,n=Math.ceil(ref.seconds*sr);
    const take=await q.takeStore.append({id,song:q.takeSong,sampleRate:sr,createdAt:Date.now(),
      start:ref.start,end:ref.end,rate:ref.rate,part:'S',replaces:true,pitchReference:ref,
      trackSlot:clone?q.compState.descriptor.slot:null},0,
      Int16Array.from({length:n},(_,i)=>2000*Math.sin(2*Math.PI*220*i/sr)),{finalized:true,complete:true});
    const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
      const start=i*80/sr,end=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=start&&n[1]>start);
      return {start,end,cents:note?note[2][0]*100+(clone?10:20):null};
    });
    await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,ref.seconds),MeleteTakePitch.packContour(frames,take));
    await q.reloadTakes();await q.refreshComp();return id;
  },clone);
  const original=await seed(false);
  await frame.locator('#addTrack').click();
  await frame.locator('#partChooserOptions button').first().click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).compState?.descriptor.slot);
  const clone=await seed(true);
  await frame.waitForFunction(()=>document.querySelectorAll('#compRows > .comp-row').length===2);
  const parts=await frame.locator('#compRows .take-part').allTextContents();
  assert.equal(parts[0],parts[1],'layering another singer never changes the musical part label');
  assert.ok(!parts[1].includes('\u00b7'),'take and singer columns identify duplicate parts');
  const latestTrack=await frame.evaluate(()=>(window.__qa||window.__probe).compState.key);
  // New recordings may select their completed track. Clear review explicitly,
  // then turn on both independent Hear controls.
  for(const selected of await frame.locator('#compRows .comp-review[aria-pressed="true"]').all())await selected.click();
  for(const row of await frame.locator('#compRows > .comp-row').all())if(await row.locator('.take-hear').getAttribute('aria-pressed')!=='true')await row.locator('.take-hear').click();
  try { await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.takeLayers.size===2); }
  catch(error){throw new Error(JSON.stringify(await frame.evaluate(()=>{
    const q=window.__qa||window.__probe;return {layers:[...q.engine.takeLayers.keys()],selected:q.takeReview?.id,
      rows:[...document.querySelectorAll('#compRows .take-hear')].map(el=>({pressed:el.getAttribute('aria-pressed'),busy:el.getAttribute('aria-busy'),disabled:el.disabled,title:el.title})),
      notice:document.querySelector('#toast')?.textContent};
  }))+' '+error.message);}
  if(await frame.locator('[data-view="bars"]').getAttribute('aria-selected')!=='true')await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>new Set([...document.querySelectorAll('#barScore [data-reference="true"]')].map(p=>p.dataset.takeId)).size===2);
  const firstRow=frame.locator('#compRows > .comp-row').first();
  await firstRow.locator('.comp-review').click();
  await frame.waitForFunction(()=>document.querySelector('#barScore [data-reference="false"]'));
  assert.equal(await frame.locator('[data-visible-index][aria-pressed="true"]').count(),1);
  assert.equal(await frame.locator('[data-audio-index][aria-pressed="false"]').count(),1);
  assert.equal(await firstRow.locator('.take-segments').textContent(),'1');
  if(await frame.locator('[data-view="standard"]').getAttribute('aria-selected')!=='true')await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  const scoreGroups=frame.locator('#score .take-pitch-trace-group');
  assert.equal(await scoreGroups.count(),0,'even an inspected saved take leaves notation clean');
  await firstRow.locator('.comp-review').click();
  await frame.waitForFunction(()=>!document.querySelector('#score .take-pitch-trace-group'));
  assert.ok(await frame.evaluate(()=>(window.__qa||window.__probe).engine.takeLayers.size>=1),'deselection clears notation even with audible recordings');
  await firstRow.locator('.comp-review').click();
  assert.equal(await scoreGroups.count(),0,'reselection does not restore notation contours');
  await page.screenshot({path:require('node:path').join(output,`${label}-notation-contour.png`)});
  await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  await firstRow.locator('.take-hear').click();
  assert.ok(await frame.locator('#barScore [data-reference="false"]').count(),'selected contour remains graded even when muted');
  await firstRow.locator('.comp-review').click();
  await frame.waitForFunction(()=>!(document.querySelector('#barScore [data-reference="false"]')));
  assert.equal(await frame.evaluate(()=>new Set([...document.querySelectorAll('#barScore .take-pitch-trace-edge')].map(p=>p.dataset.takeId)).size),1);
  assert.equal(await frame.locator('#barScore [data-from-bin]').count(),0,'deselection cannot restore a raw live trace');
  const holdHear=async()=>{
    const button=firstRow.locator('.take-hear');await button.scrollIntoViewIfNeeded();
    await button.evaluate(el=>{
      window.__hearEvents||=[];
      if(el.dataset.listened)return;el.dataset.listened='true';
      for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','click'])
        el.addEventListener(type,e=>window.__hearEvents.push({type,at:performance.now(),disabled:el.disabled,
          layers:(window.__qa||window.__probe).engine.takeLayers.size}));
    });
    const box=await button.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    if(label.includes('mobile')){
      const session=await page.context().newCDPSession(page);
      try{await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await page.waitForTimeout(700);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      finally{await session.detach();}
    }else{await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();}
  };
  await holdHear();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.takeLayers.size===1);
  assert.equal(await firstRow.locator('.take-hear').getAttribute('aria-pressed'),'true');
  const available=await frame.locator('#compRows .take-hear:enabled, #takeList .take-hear:enabled').count();
  await frame.waitForFunction(() => !(window.__qa||window.__probe).engine.takeBalanceJob);
  await frame.evaluate(() => {
    const engine=(window.__qa||window.__probe).engine,original=MeleteTakeMix.prepare;
    window.__batchMixProof={original,calls:[],counts:[],running:true};
    MeleteTakeMix.prepare=async function(layers,options) {
      __batchMixProof.calls.push(layers.map(layer=>layer.id));
      return original.call(this,layers,options);
    };
    const sample=()=>{__batchMixProof.counts.push(engine.takeLayers.size);if(__batchMixProof.running)requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
  });
  await holdHear();
  try{await frame.waitForFunction(count=>(window.__qa||window.__probe).engine.takeLayers.size===count,available);}
  catch(error){throw Error(label+' '+JSON.stringify(await frame.evaluate(()=>({events:window.__hearEvents,
    layers:[...(window.__qa||window.__probe).engine.takeLayers.values()].map(t=>t.label),rows:[...document.querySelectorAll('#compRows .take-hear')]
      .map(el=>({label:el.getAttribute('aria-label'),disabled:el.disabled,busy:el.getAttribute('aria-busy'),pressed:el.getAttribute('aria-pressed')}))})))+' '+error.message);}
  await frame.waitForFunction(() => !(window.__qa||window.__probe).engine.takeBalanceJob);
  const batchMix=await frame.evaluate(() => {
    const {calls,counts,original}=__batchMixProof;
    __batchMixProof.running=false;MeleteTakeMix.prepare=original;
    return {calls,counts:[...new Set(counts)]};
  });
  assert.equal(batchMix.calls.length,1,JSON.stringify(batchMix));
  assert.equal(batchMix.calls[0].length,available,JSON.stringify(batchMix));
  assert.ok(batchMix.counts.every(count=>count===1||count===available),JSON.stringify(batchMix));
  const audibleButtons=frame.locator('#compRows .take-hear[aria-pressed="true"], #takeList .take-hear[aria-pressed="true"]');
  while(await audibleButtons.count()) await audibleButtons.first().click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.takeLayers.size===0);
  await firstRow.locator('.take-hear').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.takeLayers.size===1);
  await firstRow.locator('.take-hear').click();
  await frame.waitForFunction(()=>(window.__qa||window.__probe).engine.takeLayers.size===0);
  await holdHear();
  await frame.waitForFunction(count=>(window.__qa||window.__probe).engine.takeLayers.size===count,available);
  assert.equal(await firstRow.locator('.take-hear').getAttribute('aria-pressed'),'true','hold from all muted enables everyone');
  const octave=firstRow.locator('.take-octave');
  for(const value of ['-','8va','8vb','-']){
    assert.equal(await octave.textContent(),value);
    if(value==='-'&&await octave.getAttribute('data-tested'))break;
    await octave.evaluate(el=>el.dataset.tested='true');await octave.click();
  }
  const centering=await octave.evaluate(el=>({display:getComputedStyle(el).display,align:getComputedStyle(el).placeItems}));
  assert.equal(centering.display,'grid');assert.equal(centering.align,'center');
  await require('./browser-take-column-layout.cjs').checkTakeColumnLayout(page,frame,firstRow,{output,label});
  await frame.evaluate(()=>{
    const q=window.__qa||window.__probe;q.pitchResolution.seedReviewOutlier(100);
  });
  await require('./browser-sing.cjs').nextPart(frame);
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).pitchResolution.snapshot().count),0,'switching See removes previous live contour');
  assert.equal(await frame.locator('#barScore .take-pitch-trace-edge').count(),0,'other-part layers do not enlarge the current part');
  assert.equal(await frame.evaluate(async({original,clone})=>{
    const q=window.__qa||window.__probe,states=await q.takeStore.comps(q.takeSong);
    return [original,clone].every(id=>states.some(s=>s.segments.some(p=>p.takeId===id)));
  },{original,clone}),true,'the clone did not replace its original');
  await require('./browser-sing.cjs').choosePart(frame,0);
  await frame.waitForFunction(key=>{
    const q=window.__qa||window.__probe;return q.compState?.key===key&&q.takeReview?.id===`comp:${key}`;
  },latestTrack);
  assert.equal(await frame.locator('#compRows .take-number').allTextContents().then(labels=>labels.includes('Comp')),false);
  assert.equal(await frame.locator('#addTrack').evaluate(el=>!!el.closest('.take-controls')),true);
  const cellWidths=await frame.evaluate(()=>['addTrack','undoComp','redoComp','downloadMix','loopToggle'].map(id=>({id,width:document.getElementById(id).getBoundingClientRect().width})));
  assert.ok(cellWidths.every(cell=>cell.width>=44),JSON.stringify(cellWidths));
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).engine.takeBalanceJob);
  const levels=await frame.evaluate(()=>{
    const e=(window.__qa||window.__probe).engine;
    return {mix:e.takeMixLoudness,tracks:[...e.takeLayers.values()].map(t=>({gain:t.gain.gain.value,lufs:t.loudness?.outputLufs}))};
  });
  assert.ok(levels.mix&&Math.abs(levels.mix.outputLufs+14)<.2,JSON.stringify(levels));
  assert.ok(levels.tracks.every(t=>t.gain>1&&Math.abs(t.lufs+14)<.2),JSON.stringify(levels));
  // Offline mix preserves alignment, duration, octave shifts and phrasing.
  const mix=await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe; q.engine.ensureAudio();
    const ctx=q.engine.context, sr=ctx.sampleRate, buffer=ctx.createBuffer(1,sr, sr);
    buffer.getChannelData(0).set(Float32Array.from({length:sr},(_,i)=>.1*Math.sin(2*Math.PI*220*i/sr)));
    const layer={id:'test',buffer,blob:new Blob(),start:0,end:1,rate:1,latency:0,octave:0};
    const out=[];
    for(const octave of [0,1,-1]){
      const result=await MeleteTakeMix.render([{...layer,octave}],{duration:1,sampleRate:sr});
      const audio=await ctx.decodeAudioData(await result.blob.arrayBuffer());
      const a=audio.getChannelData(0),from=Math.floor(.3*sr),to=Math.floor(.8*sr);
      let crossings=0,peak=0;for(let i=from+1;i<to;i++){if(a[i-1]<0&&a[i]>=0)crossings++;peak=Math.max(peak,Math.abs(a[i]));}
      out.push({octave,hz:crossings/.5,peak,seconds:audio.duration,lufs:(await MeleteTakeLoudness.measure(audio)).integratedLufs});
    }
    const wet=await MeleteTakeMix.render([layer],{duration:1,reverb:40,sampleRate:sr});
    const resampled=await MeleteTakeMix.render([{...layer,octave:1}],{duration:1,sampleRate:sr===48000?44100:48000});
    if(resampled.blob.size<1000)throw Error('Empty resampled mix');
    const pcm=Int16Array.from({length:sr*2},(_,i)=>3000*Math.sin(2*Math.PI*220*i/sr));
    const source={id:'preroll',origin:-1,pitchReference:{latency:0}};
    const snapshot={descriptor:{reference:{seconds:1}},segments:[{takeId:'preroll',from:-1,to:1}]};
    const prepared=await MeleteCompAudio.prepare(ctx,snapshot,new Map([[source.id,source]]),
      async()=>new Blob([MeleteRecording.wavBytes(pcm,sr)]),new AbortController().signal);
    const prefix=prepared.buffer.getChannelData(0).slice(Math.round(.25*sr),Math.round(.5*sr));
    const exported=await MeleteTakeMix.render([{...layer,buffer:prepared.buffer,blob:prepared.blob,start:-1,end:1}],{duration:1,sampleRate:sr});
    return {out,wet:wet.seconds,preRoll:{origin:prepared.origin,seconds:prepared.buffer.duration,
      audible:prefix.some(s=>Math.abs(s)>.05),exportSeconds:exported.seconds}};
  });
  for(const row of mix.out){assert.ok(Math.abs(row.hz-220*2**row.octave)<10,JSON.stringify(mix));assert.ok(row.peak>.02);assert.equal(row.seconds,1);assert.ok(Math.abs(row.lufs+14)<.3,JSON.stringify(row));}
  assert.ok(mix.wet>2);
  assert.deepEqual(mix.preRoll,{origin:-1,seconds:2,audible:true,exportSeconds:2});
  await frame.locator('#takeReverb').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).pitchbar.captureSettingsState().takeReverb),10);
  await frame.locator('#takeVolume').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).pitchbar.captureSettingsState().takeVolume),110);
  const downloadReady=page.waitForEvent('download');
  await frame.locator('#downloadMix').click();
  const download=await downloadReady;
  assert.match(download.suggestedFilename(),/-mix\.wav$/);
  assert.equal(await download.failure(),null);
  await download.delete();
  await frame.evaluate(async()=>{await (window.__qa||window.__probe).refreshComp();document.activeElement?.blur();});
  const savedSegments=await frame.evaluate(()=>JSON.stringify((window.__qa||window.__probe).compState.segments));
  await frame.locator('body').press('Meta+z');
  await frame.waitForFunction(before=>JSON.stringify((window.__qa||window.__probe).compState.segments)!==before,savedSegments);
  assert.equal(await frame.locator('#redoComp').isEnabled(),true);
  await frame.locator('body').press('Meta+Shift+z');
  await frame.waitForFunction(before=>JSON.stringify((window.__qa||window.__probe).compState.segments)===before,savedSegments);
  await frame.locator('body').press('Control+z');
  await frame.waitForFunction(before=>JSON.stringify((window.__qa||window.__probe).compState.segments)!==before,savedSegments);
  await frame.locator('#redoComp').click();
  await frame.waitForFunction(before=>JSON.stringify((window.__qa||window.__probe).compState.segments)===before,savedSegments);
  await frame.evaluate(()=>{
    const input=document.createElement('textarea');input.id='history-input-test';document.body.append(input);
    input.addEventListener('keydown',event=>queueMicrotask(()=>window.__historyTextPrevented=event.defaultPrevented));
  });
  await frame.locator('#history-input-test').press('Meta+z');
  assert.equal(await frame.evaluate(()=>window.__historyTextPrevented),false,'text editing keeps native Undo');
  assert.equal(await frame.evaluate(()=>JSON.stringify((window.__qa||window.__probe).compState.segments)),savedSegments);
  await frame.locator('#history-input-test').evaluate(el=>el.remove());
  assert.equal(await frame.locator('#takeLoose').isVisible(),false,'ordinary track sources have no unused-takes table');
  if (label.includes('mobile')) {
    for(const section of ['parts','practice','display','tools']){
      const toggle=frame.locator(`[data-settings-section="${section}"] .settings-section-toggle`);
      if(await toggle.count()&&await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
    }
  }
  await frame.locator('#downloadMix').scrollIntoViewIfNeeded();
  const counterFits=await frame.locator('#recordingToday').evaluate(el=>{
    const r=el.getBoundingClientRect(),p=el.closest('.take-controls').getBoundingClientRect();
    return r.top>=p.top-.5&&r.bottom<=p.bottom+.5&&el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1;
  });
  assert.ok(counterFits,'daily minutes fits the existing left Record grid without increasing its height');
  await frame.evaluate(async()=>{
    const q=window.__qa||window.__probe,d=q.compState.descriptor,r=d.reference;
    localStorage.setItem('melete:cloud:local-only:v1',JSON.stringify([JSON.stringify([d.song,r.part,r.line??null,d.slot||null])]));
    await q.refreshComp();
  });
  const privateButton=frame.locator('#compRows .take-upload.is-local-only');
  await privateButton.waitFor({state:'visible'});
  assert.equal(await privateButton.isEnabled(),false);
  assert.match(await privateButton.getAttribute('title'),/Kept on this device/);
  await page.screenshot({path:require('node:path').join(output,`${label}-recording-mix.png`)});
  return {partOrder:labels,countInBeats:beats,countInRecorded:true,noLegacyContour:true,hearIsolationCycle:true,centeredOctaveCycle:true,
    batchMix,
    allMidiMuted:true,practiceFromSee:true,automaticMeter:true,independentClones:true,audibleGreyContours:true,mixDownload:true,reverbControl:true,mix,levels,cleanNotation:true,dailyTime,editHistory,keyboardHistory:true};
}
module.exports={checkRecordingMix};
