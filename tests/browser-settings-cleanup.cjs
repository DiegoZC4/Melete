const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {recordingProbe}=require('./browser-loop-recorder.cjs');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');
async function main(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'melete-controls-')),output=path.resolve(process.env.QA_OUTPUT_DIR||'qa/ui-cleanup');
  let browser;const report=[],errors=[];
  try{
    await fs.mkdir(output,{recursive:true});
    execFileSync(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['build_trainer.py','tests/fixtures/divisi.musicxml','--project-dir',path.join(temp,'divisi')],{stdio:'pipe'});
    browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL,headless:true});
    const project=process.env.QA_COLLECTION_PROJECT;
    for(const song of (project?['divisi','autumn','the-seed']:['divisi']))for(const mobile of [false,true]){
      let html=await fs.readFile(song==='divisi'?path.join(temp,'divisi/dist/index.html'):path.resolve(project,'players',song,'dist/index.html'),'utf8');
      html=html.replace('engine = new GuideEngine(sequence);',`engine = new GuideEngine(sequence);
        window.__qa={engine,api,${recordingProbe} get channels(){return mixerParts},get staves(){return parts.length},get busy(){return !!(renderTimer||barRenderFrame||notationRenderInFlight||notationRenderQueued)}};`);
      const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1920,height:900},isMobile:mobile,hasTouch:mobile});
      try{
        await expandSettingsFixture(context);
        const origin='http://127.0.0.1:8809/controls-'+song;
        await context.route('**/*',route=>route.request().url()===origin?route.fulfill({contentType:'text/html',body:html}):route.abort());
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        const ready=()=>page.waitForFunction(()=>window.__qa&&!__qa.busy&&document.querySelector('#playPause:not(:disabled)'));
        await page.goto(origin);await ready();
        if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
        if(await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await page.locator('#settingsToggle').click();
        const channels=await page.evaluate(()=>__qa.channels);
        while(await page.locator('[data-visible-index][aria-pressed="true"]').count())
          await page.locator('[data-visible-index][aria-pressed="true"]').first().click();
        await ready();
        assert.equal(await page.locator('#score').isVisible(),false);
        await page.reload();await ready();
        assert.equal(await page.locator('[data-visible-index][aria-pressed="true"]').count(),0);
        assert.equal(await page.locator('#score').isVisible(),false,'an empty See selection survives reload');
        assert.equal(await page.locator('#practiceDivisi').count(),0);
        assert.equal(await page.locator('#mixer [data-volume-index]').count(),channels.length);
        if(song==='autumn'){assert.equal(await page.evaluate(()=>__qa.staves),4);assert.ok(channels.length>4);}
        for(let index=0;index<channels.length;index++){
          await require('./browser-sing.cjs').choosePart(page,index);
          const selected=await page.evaluate(()=>({source:__qa.savedPractice.practicePart,line:__qa.savedPractice.practiceDivisi[__qa.savedPractice.practicePart]}));
          assert.deepEqual(selected,{source:channels[index].source,line:channels[index].line});
        }
        await page.evaluate(async()=>{__qa.engine.ensureAudio();await __qa.engine.context.resume();});
        const last=channels.length-1;
        await page.locator(`[data-audio-index="${last}"]`).click();
        await page.waitForTimeout(150);
        const gains=await page.evaluate(()=>__qa.engine.trackStrips.map(s=>s.gain.gain.value));
        assert.ok(gains[last]<.01,JSON.stringify({song,mobile,gains,hear:await page.evaluate(()=>__qa.savedPractice.audible)}));assert.ok(gains.slice(0,last).every(g=>g>.99));
        await page.locator(`[data-volume-index="${last}"]`).press('ArrowUp');
        await page.locator(`[data-pan-index="${last}"]`).press('ArrowRight');
        const mix=await page.evaluate(()=>({vol:__qa.savedPractice.volumes,pan:__qa.savedPractice.pans,hear:__qa.savedPractice.audible}));
        assert.equal(mix.vol[last],105);assert.equal(mix.pan[last],5);
        const noteRoutes=await page.evaluate(()=>__qa.engine.playbackNotes.every(n=>n.mixChannels?.length&&n.mixChannels.every(c=>__qa.channels[c].source===n.track)));
        assert.equal(noteRoutes,true);
        await page.reload();await ready();
        assert.deepEqual(await page.evaluate(()=>({vol:__qa.savedPractice.volumes,pan:__qa.savedPractice.pans,hear:__qa.savedPractice.audible})),mix);
        assert.deepEqual(await page.locator('.loop-pill > button').evaluateAll(nodes=>nodes.map(n=>n.id)),['loopStart','loopToggle','loopEnd']);
        await page.locator('#loopToggle').click();
        assert.equal(await page.evaluate(()=>__qa.engine.loopStartSeconds),0);
        assert.equal(await page.evaluate(()=>__qa.engine.loopEndSeconds),await page.evaluate(()=>__qa.engine.duration));
        await page.locator('#loopToggle').click();
        assert.equal(await page.locator('#annotationLayout,#showAllLyrics,#takeActions summary').count(),0);
        assert.equal(await page.locator('#lyricEditing').innerText(),'Hide Lyrics');
        await page.waitForFunction(()=>__qa.compState);
        await page.evaluate(async()=>{
          const q=__qa,d=q.compDescriptor,first=d.reference.notes[0];if(!first)return;
          const start=q.engine.tickAtSeconds(first[0]*d.reference.rate),end=Math.min(d.reference.end,q.engine.tickAtSeconds((first[0]+6)*d.reference.rate));
          const ref=q.pitchReference({start,end,rate:1});ref.latency=0;
          const sr=8000,n=Math.ceil(ref.seconds*sr),id=crypto.randomUUID(),now=Date.now();
          const pcm=Int16Array.from({length:n},(_,i)=>2000*Math.sin(i*.2));
          const rec=await q.takeStore.append({id,song:q.takeSong,createdAt:now,sampleRate:sr,replaces:true,part:d.label,rate:1,start,end,peak:.1,pitchReference:ref},0,pcm,{finalized:true,complete:true});
          const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{const from=i*80/sr,to=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=from&&n[1]>from);return {start:from,end:to,cents:note?note[2][0]*100+15:null}});
          await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,n/sr),MeleteTakePitch.packContour(frames,rec));
          await q.reloadTakes();await q.refreshComp();
        });
        const row=page.locator('#compRows .is-armed');
        await page.waitForFunction(()=>Number(document.querySelector('#compRows .is-armed .take-segments')?.textContent)>0);
        const dates=await row.locator('.take-created,.take-modified').allTextContents();assert.ok(dates.every(t=>t&&t!=='\u2014'));
        assert.equal(await page.locator('#compCloud, #compAccount').count(),0);
        assert.equal(await page.locator('#downloadMix').getAttribute('aria-label'),'Download audible recording mix');
        await page.screenshot({path:path.join(output,`controls-${song}-${mobile?'mobile':'desktop'}.png`)});
        if(mobile){
          for(const id of ['parts','practice','display','tools']){
            const toggle=page.locator(`[data-settings-section="${id}"] .settings-section-toggle`);
            if(await toggle.count() && await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
          }
          await row.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(output,`takes-${song}-mobile.png`)});
        }
        await row.locator('.take-delete').click();assert.ok((await page.evaluate(()=>__qa.compState.segments.length))>0);
        await page.keyboard.press('Escape');assert.doesNotMatch(await row.locator('.take-delete').getAttribute('class'),/is-delete-armed/);
        await row.locator('.take-delete').click();await row.locator('.take-delete').click();
        await page.waitForFunction(()=>!__qa.compState.segments.length);
        await page.locator('#undoComp').click();await page.waitForFunction(()=>__qa.compState.segments.length);
        report.push({song,mobile,channels:channels.map(p=>p.short),staves:await page.evaluate(()=>__qa.staves),independentMix:true,persisted:true,twoClickDeleteAndUndo:true,dates:true});
      }finally{await context.close();}
    }
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'controls.json'),JSON.stringify({passed:true,report},null,2));
    console.log(JSON.stringify(report));
  }finally{await browser?.close();await fs.rm(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
