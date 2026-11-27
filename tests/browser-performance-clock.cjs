const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {audioRig,section}=require('./browser-compatibility.cjs');
const near=(a,b,t=.002)=>assert.ok(Math.abs(a-b)<t,`${a} should be within ${t} of ${b}`);

async function checkPerformanceClock(browser,html,name,alignment,review) {
  const needle='engine = new GuideEngine(sequence);';
  assert.ok(html.includes(needle));
  html=html.replace(needle,needle+`window.clockQA={e:engine,s:sequence,c:config,go:seekPlaybackTick,loop:applyLoopLink,
    snapshot:()=>takePitchReference({start:0,end:sequence.endTick,rate:1},0,null),timed:timedTake,matches:matchesPlaybackClock,
    visibleTakes:()=>allTakes().filter(t=>t.finalized).map(t=>t.id),store:()=>takeStore,
    reloadLibrary:loadTakeLibrary,refreshTracks:()=>compPanel.refresh({force:true}),song:takeSongKey,
    saveMeasurement:async()=>applyMeasuredTiming(await recordingChain(),{seconds:.04025,spreadMs:1,residualMs:0,measuredAt:Date.now()}),
    compUses:(key,id)=>{const state=compPanel.state();return state?.key===key&&state.segments.some(s=>s.takeId===id);},
    prepareComp:key=>compPanel.layers().find(layer=>layer.id==='comp:'+key).prepare(),
    status:()=>({part:practicePartIndex,sing:singEnabled,capture:pitchCaptureState,take:takeState,notice:takeNotice,
      context:engine.context?.state,playing:engine.playing,seconds:engine.currentSeconds(),mic:document.querySelector('#microphoneCheck')?.innerText})};`);
  const ctx=await browser.newContext({viewport:{width:1300,height:900}});
  try{
    await ctx.addInitScript(audioRig,{synthetic:true,hz:220});
    await ctx.route('http://127.0.0.1:8809/performance-qa',r=>r.fulfill({contentType:'text/html',body:html}));
    const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:8809/performance-qa');
    await page.waitForFunction(()=>window.clockQA&&!document.querySelector('#playPause').disabled);
    if(await page.locator('#partChooser').isVisible()){
      if(name==='fixture')await page.locator('#partChooserOptions button').first().click();
      else await page.locator('#partChooserDismiss').click();
    }
    await section(page,'parts');
    const hear=page.locator('.reference-hear'),play=page.locator('#playPause');
    const off=await page.evaluate(name=>{
      const q=clockQA,e=q.e,s=q.s,p=q.c.referenceAudio.performanceMap.points;
      const m=name==='autumn'?10:name==='the-seed'?18:1;
      const tick=s.measures[m][0];q.go(tick);
      q.old=q.snapshot();q.written=e.secondsAtTick(tick);
      return {tick,measure:m+1,loopEnd:tick+s.measures[m][1],division:s.division,duration:e.duration,written:q.written,points:p,
        midi:e.notes.map(n=>({start:n.start,end:n.end})),end:s.endTick,measures:s.measures,
        release:Math.max(...s.notes.map(n=>n[2])),audioSeconds:q.c.referenceAudio.audioSeconds??p.at(-1)[1]};
    },name);
    const interp=(t,pts)=>{let i=pts.findIndex(a=>a[0]>t);i=i<0?pts.length-1:Math.max(1,i);
      const [x,y]=pts[i-1],[xx,yy]=pts[i];return y+(t-x)*(yy-y)/(xx-x);};
    const pts=off.points;
    if(alignment){
      const reviewed=new Map(review?.anchors||[]),offset=reviewed.get(0)??alignment.measures[0].start;
      const measured=new Map(alignment.time_map.ticks.map((t,i)=>[t,alignment.time_map.seconds[i]]));
      const expected=new Set([off.end,...reviewed.keys()]);if(off.release!==off.end)expected.delete(off.release);
      for(const [i,m] of alignment.measures.entries()){
        expected.add(m.tick);near(interp(m.tick,pts),(reviewed.get(m.tick)??m.start)-offset,.00001);
        const count=off.measures[i][2];
        for(const beat of name==='the-seed'?(count===9?[4,7]:count===6||count===7?[4]:[]):[]){
          const tick=m.tick+(beat-1)*off.division;if(tick>=off.release)continue;
          expected.add(tick);const observed=reviewed.get(tick)??measured.get(tick);
          if(observed!==undefined)near(interp(tick,pts),observed-offset,.00001);
        }
      }
      assert.deepEqual(pts.map(p=>p[0]),[...expected].sort((a,b)=>a-b),'only main downbeats and manually pinned note attacks');
      near(interp(off.release,pts),(reviewed.get(off.release)??alignment.time_map.final_release)-offset,.00001);
    }
    await hear.click();await page.waitForFunction(()=>clockQA.e.referenceLayers.get('reference:original')?.buffer);
    const on=await page.evaluate(tick=>{
      const q=clockQA,e=q.e,r=e.referenceLayers.get('reference:original'),next=q.snapshot();
      const origin=q.timed({start:tick,rate:1,pitchReference:{...q.old,captureStart:tick}}).origin;
      return {position:e.tickAtSeconds(e.currentSeconds()),duration:e.duration,buffer:r.buffer.duration,channels:r.buffer.numberOfChannels,
        clicks:e.clicks.map(c=>[c.tick,c.time]),allNotes:e.notes.flatMap(n=>n.segments||[n]).map(n=>[n.track,n.key,n.start,n.end]),
        score:q.s.notes,clock:next.scoreClock,oldMatches:q.matches(q.old),oldOrigin:origin,oldSeconds:q.old.seconds,
        distinct:!MeleteTakePitch.sameTimeline(q.old,next),newMatches:q.matches(next),fingerprint:q.old.fingerprint!==next.fingerprint,
        inverse:q.c.referenceAudio.performanceMap.points.every(([t,s])=>Math.abs(e.tickAtSeconds(s)-t)<.001),
        max:+document.getElementById('seek').max};
    },off.tick);
    near(on.position,off.tick,3);near(on.duration,pts.at(-1)[1]);near(on.buffer,off.audioSeconds,.12);near(on.max/1000,on.duration);
    assert.ok(on.clock&&on.inverse&&on.distinct&&on.fingerprint&&on.newMatches&&!on.oldMatches);near(on.oldOrigin,off.written);
    const order=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3];
    const channelNotes=on.allNotes.sort(order);
    const expected=on.score.filter(n=>n[2]>n[1]).map(([i,a,b,k])=>[i,k,interp(a,pts),interp(b,pts)]).sort(order);
    assert.equal(channelNotes.length,expected.length);
    expected.forEach(([part,key,a,b],i)=>{
      const n=channelNotes[i];assert.deepEqual(n.slice(0,2),[part,key]);near(n[2],a,1e-7);near(n[3],b,1e-7);
    });
    for(const [t,s] of on.clicks)near(s,interp(t,pts),.00001);
    await page.evaluate(({tick,measure})=>{
      const {e,go,loop}=clockQA;e.setMetronome(100);
      if(!loop(measure+'-'+(measure+1)))throw Error('Cannot enable measure loop');
      go(tick);
      const playClick=e.scheduleClick.bind(e),playNote=e.scheduleNote.bind(e);
      clockQA.clicks=[];clockQA.notes=[];
      const realStart=AudioBufferSourceNode.prototype.start, starts=new WeakMap();
      clockQA.audioAt=source=>{const v=starts.get(source);return v&&v.offset+e.context.currentTime-v.when;};
      AudioBufferSourceNode.prototype.start=function(when=0,offset=0,...rest){starts.set(this,{when,offset});return realStart.call(this,when,offset,...rest);};
      const cursor=e.api.customCursorHandler, sync=cursor.sync.bind(cursor);
      cursor.sync=(t,...args)=>{clockQA.cursorTick=t;return sync(t,...args);};
      e.scheduleClick=(c,...args)=>{clockQA.clicks.push(c.time);return playClick(c,...args);};
      e.scheduleNote=(n,...args)=>{clockQA.notes.push(n.start);return playNote(n,...args);};
    },{tick:off.tick,measure:off.measure});
    await play.click();
    await page.waitForFunction(()=>clockQA.e.playing&&clockQA.e.referenceLayers.get('reference:original')?.source&&clockQA.clicks.length&&clockQA.cursorTick>0);
    const sounding=await page.evaluate(()=>{const e=clockQA.e,r=e.referenceLayers.get('reference:original');
      return {nativeRate:r.source instanceof AudioBufferSourceNode&&r.source.playbackRate.value,click:clockQA.clicks[0],
        position:e.presentationSeconds(),tick:clockQA.cursorTick,sourcePosition:clockQA.audioAt(r.source),transport:e.currentSeconds(),loop:e.loopEndSeconds};});
    near(sounding.click,interp(off.tick,pts));near(sounding.loop,interp(off.loopEnd,pts));
    assert.equal(sounding.nativeRate,1);near(interp(sounding.tick,pts),sounding.position,.12);
    near(sounding.sourcePosition,sounding.transport,.025);
    await hear.click();
    const back=await page.evaluate(()=>{const q=clockQA,e=q.e;return {playing:e.playing,duration:e.duration,
      tick:e.tickAtSeconds(e.currentSeconds()),loop:e.tickAtSeconds(e.loopEndSeconds),matches:q.matches(q.old),
      ref:q.snapshot().fingerprint===q.old.fingerprint,layer:e.referenceLayers.size}});
    assert.ok(back.playing&&back.matches&&back.ref);assert.equal(back.layer,0);near(back.duration,off.duration);
    near(back.loop,off.loopEnd,1);assert.ok(back.tick>=off.tick-3&&back.tick<back.loop+3);
    await play.click();
    if(name==='fixture'){
      // Record to real IndexedDB on both clocks, then reopen the same practice part.
      await page.evaluate(audioRig,{synthetic:true,hz:220});
      await section(page,'practice');await page.locator('#loopToggle').click();
      await section(page,'parts');
      for(const [i,b] of (await page.locator('[data-visible-index]').all()).entries())
        if((await b.getAttribute('aria-pressed')==='true')!==(i===0))await b.click();
      await page.waitForFunction(()=>clockQA.status().part===0);
      await require('./browser-sing.cjs').enableSing(page);
      await page.waitForFunction(()=>clockQA.status().sing);
      const record=async(performance)=>{
        await page.evaluate(()=>clockQA.go(clockQA.s.notes.find(n=>n[0]===0)[1]));
        await play.click();
        try{await page.locator('#pitchCapture[data-state=recording]').waitFor({state:'attached',timeout:12000});}
        catch(error){throw Error('Could not start '+(performance?'rubato':'written')+' fixture take: '+JSON.stringify(await page.evaluate(()=>clockQA.status())),{cause:error});}
        const enabled=await hear.getAttribute('aria-pressed');await hear.click();
        assert.equal(await hear.getAttribute('aria-pressed'),enabled,'a running take cannot silently change clocks');
        await page.waitForFunction(()=>clockQA.e.currentSeconds()>clockQA.e.secondsAtTick(clockQA.s.notes.find(n=>n[0]===0)[1])+1.8);
        await play.click();
        return page.evaluate(async p=>{
          const st=clockQA.store(),deadline=Date.now()+12000;let row;
          do{
            row=(await st.usage()).find(t=>t.finalized&&t.frames&&!!t.pitchReference?.scoreClock===p);
            if(!row)await new Promise(r=>setTimeout(r,60));
          }while(!row&&Date.now()<deadline);
          if(!row)throw Error('Take was not committed: '+JSON.stringify(clockQA.status()));
          const data=await(await st.wav(row.id)).arrayBuffer();
          return {id:row.id,clock:row.pitchReference.scoreClock??null,seconds:row.pitchReference.seconds,
            pcm:[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].join('.')};
        },performance);
      };
      const writtenTake=await record(false);await hear.click();await page.waitForFunction(()=>!!clockQA.e.performanceId);
      await page.waitForFunction(id=>!clockQA.visibleTakes().includes(id),writtenTake.id);
      const rubatoTake=await record(true);assert.equal(rubatoTake.clock,on.clock);assert.notEqual(rubatoTake.id,writtenTake.id);
      await page.waitForFunction(()=>clockQA.status().take==='off');
      const measured=await page.evaluate(async ids=>{
        const result=await clockQA.saveMeasurement(),rows=await clockQA.store().usage();
        return {result,rows:ids.map(id=>{const r=rows.find(t=>t.id===id)?.pitchReference;return [r?.scoreClock??null,r?.latency];})};
      },[writtenTake.id,rubatoTake.id]);
      assert.deepEqual(measured.rows,[[null,.04025],[rubatoTake.clock,.04025]],measured.result);
      await page.locator('#pitchCapture').click();
      await section(page,'takes');
      const otherClock=page.locator('#otherClockTakes');
      assert.ok(await otherClock.evaluate(b=>Boolean(b.compareDocumentPosition(document.getElementById('takeList')) & Node.DOCUMENT_POSITION_FOLLOWING)));
      await page.locator('#openTimingCheck').click();await page.locator('#closeTimingCheck').click();
      assert.equal(await page.evaluate(()=>clockQA.e.performanceId),rubatoTake.clock,'opening calibration must not change the playback clock');
      await page.getByRole('button',{name:'Show MIDI-timed takes (Ref off)'}).click();
      await page.waitForFunction(()=>!clockQA.e.performanceId);
      await page.waitForFunction(([a,b])=>clockQA.visibleTakes().includes(a)&&!clockQA.visibleTakes().includes(b),[writtenTake.id,rubatoTake.id]);
      await page.getByRole('button',{name:'Show reference-timed takes (Ref on)'}).click();
      await page.waitForFunction(([a,b])=>!clockQA.visibleTakes().includes(a)&&clockQA.visibleTakes().includes(b),[writtenTake.id,rubatoTake.id]);
      await page.getByRole('button',{name:'Show MIDI-timed takes (Ref off)'}).click();
      await page.waitForFunction(()=>!clockQA.e.performanceId);
      for (const take of [writtenTake,rubatoTake]) {
        const pcm=await page.evaluate(async id=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await clockQA.store().wav(id)).arrayBuffer()))].join('.'),take.id);
        assert.equal(pcm,take.pcm,'switching between populated clocks must preserve both recordings');
      }
    }
    // A deletion on written time survives a switch to Ref time. The old panel
    // decoded that history entry through the new clock's filtered source map.
    const oldId=await page.evaluate(async()=>{
      const q=clockQA,st=q.store(),id=crypto.randomUUID(),song=q.song();
      const d={song,label:'history fixture',reference:q.snapshot(),slot:'history-fixture'};
      await st.append({id,song,part:'QA',createdAt:Date.now(),sampleRate:8000,peak:.2},0,new Int16Array([4000,2000]),{finalized:true,complete:true});
      const saved=await st.saveComp({...MeleteComp.empty(d),track:true,firstTakeNumber:123,segments:[{from:0,to:.001,takeId:id}]});
      await st.saveComp(MeleteComp.remove(saved));await q.reloadLibrary();await q.refreshTracks();return id;
    });
    await page.locator('[data-deleted-comp] .take-undo').waitFor({state:'attached'});
    await section(page,'parts');await hear.click();await page.waitForFunction(()=>!!clockQA.e.performanceId);
    await page.evaluate(()=>clockQA.refreshTracks());
    assert.equal(await page.locator('[data-deleted-comp]').count(),0,'other-clock Undo is not a track on this clock');
    if (name!=='fixture') {
      await section(page,'takes');await page.getByRole('button',{name:'Show MIDI-timed takes (Ref off)'}).click();
      await page.waitForFunction(()=>!clockQA.e.performanceId);
      await page.locator('[data-deleted-comp] .take-undo').waitFor({state:'attached'});
      await section(page,'parts');await hear.click();await page.waitForFunction(()=>!!clockQA.e.performanceId);
    }
    const seen=page.locator('[data-visible-index]');
    for(const cell of (await seen.all()).slice(0,2))if(await cell.getAttribute('aria-pressed')==='false')await cell.click();
    await section(page,'practice');assert.equal(await page.locator('#practicePart').isVisible(),false);
    await page.locator('#pitchCapture').click();await page.locator('#partChooserOptions button').last().click();
    await page.waitForFunction(()=>clockQA.status().capture==='armed' && document.getElementById('partChooser').hidden);
    await page.locator('#pitchCapture').click();
    await section(page,'parts');await seen.first().click();
    await section(page,'takes');await page.locator('#addTrack').click();
    await page.locator('#partChooserOptions button').last().click();
    await page.waitForFunction(()=>{const el=document.querySelector('#compRows [data-comp-key].is-armed.is-selected');
      return el && !document.getElementById('addTrack').disabled && /^take@[^:]+:[a-f0-9-]{36}$/.test(JSON.parse(el.dataset.compKey).at(-1));});
    const key=await page.locator('#compRows [data-comp-key].is-armed.is-selected').getAttribute('data-comp-key');
    const retained=async()=>page.evaluate(async({key,oldId})=>({draft:(await clockQA.store().comps(clockQA.song())).some(c=>c.key===key&&c.track),
      bytes:Array.from(new Int16Array(await(await clockQA.store().wav(oldId)).arrayBuffer(),44))}),{key,oldId});
    assert.deepEqual(await retained(),{draft:true,bytes:[4000,2000]},'selected slot: '+JSON.parse(key).at(-1));
    const slot=JSON.parse(key).at(-1);
    await section(page,'practice');await page.locator('#pitchCapture').click();
    await page.waitForFunction(()=>clockQA.status().capture==='armed');
    await page.evaluate(()=>{const q=clockQA;if(q.e.hasLoop())document.getElementById('loopToggle').click();
      q.go(q.s.notes.find(n=>n[0]===q.status().part)[1]);});
    await play.click();await page.waitForFunction(()=>clockQA.status().take==='recording');
    await page.waitForFunction(()=>{const q=clockQA;return q.e.currentSeconds()>q.e.secondsAtTick(q.s.notes.find(n=>n[0]===q.status().part)[1])+1.8;});
    await play.click();
    const capture=()=>page.evaluate(async slot=>{
      const st=clockQA.store(),deadline=performance.now()+15000;let t,rows;
      do {
        rows=await st.usage();t=rows.find(row=>row.trackSlot===slot&&row.finalized&&row.frames>0);
        if(!t)await new Promise(resolve=>setTimeout(resolve,75));
      } while(!t&&performance.now()<deadline);
      if(!t)throw Error('No saved audio for '+slot+': '+JSON.stringify({status:clockQA.status(),
        takes:rows.map(({trackSlot,frames,finalized})=>({trackSlot,frames,finalized}))}));
      const bytes=await(await st.wav(t.id)).arrayBuffer();
      return {id:t.id,clock:t.pitchReference.scoreClock,pcm:new Int16Array(bytes,44).some(v=>v!==0),
        hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].join('.')};
    },slot);
    const recorded=await capture();assert.ok(recorded.pcm);assert.equal(recorded.clock,on.clock);
    await page.waitForFunction(([key,id])=>clockQA.compUses(key,id),[key,recorded.id]);
    const playable=await page.evaluate(async key=>{const mix=await clockQA.prepareComp(key);
      return mix.blob.size>44 && mix.buffer.getChannelData(0).some(v=>v!==0);},key);
    assert.ok(playable,'the selected comp plays the newly recorded source');
    await page.reload();await page.waitForFunction(()=>window.clockQA && !document.querySelector('#playPause').disabled);
    assert.deepEqual(await retained(),{draft:true,bytes:[4000,2000]},'new track and original audio survive reopening');
    assert.deepEqual(await capture(),recorded,'audio saved to the selected new take survives reopening');
    assert.deepEqual(errors,[]);
    return {song:name,writtenSeconds:off.duration,originalSeconds:on.duration,tempoAnchors:pts.length,
      notesChecked:on.allNotes.length,clicksChecked:on.clicks.length,scorePositionPreserved:true};
  } finally{await ctx.close();}
}
module.exports={checkPerformanceClock};
if(require.main===module){(async()=>{
  const choir=process.argv[2],type=process.argv[3]||'chromium';
  const pw=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
  const browser=await pw[type].launch({headless:true});
  try{for(const slug of ['autumn','the-seed'])
    console.log(await checkPerformanceClock(browser,fs.readFileSync(path.join(choir,'players',slug,'dist/index.html'),'utf8'),slug,
      JSON.parse(fs.readFileSync(path.join(choir,'separation/reports',slug+'-alignment-full.json'),'utf8')),
      fs.existsSync(path.join(choir,'reference',slug+'-reviewed-anchors.json'))?JSON.parse(fs.readFileSync(path.join(choir,'reference',slug+'-reviewed-anchors.json'),'utf8')):null));}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});}
