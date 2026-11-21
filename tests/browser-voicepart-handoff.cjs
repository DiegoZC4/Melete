// The complete two-song collection, disposable IndexedDB and synthetic PCM.
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os');
const assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
const {recordingProbe}=require('./browser-loop-recorder.cjs');
const {expandSettingsFixture}=require('./browser-settings-sections.cjs');
const {pick}=require('./browser-station.cjs');
const {wavBytes}=require('../template/loop_recorder.js');

async function run() {
  const html=await fs.readFile(process.argv[2],'utf8');
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'melete-part-handoff-'));
  const wav=path.join(fixture,'synthetic.wav'), rate=48000;
  const pcm=Int16Array.from({length:rate*4},(_,i)=>Math.round(5700*Math.sin(2*Math.PI*190*i/rate)+1300*Math.sin(2*Math.PI*380*i/rate)));
  await fs.writeFile(wav,Buffer.from(wavBytes(pcm,rate)));
  const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'chrome',headless:true,
    args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+wav]});
  const reports=[];
  try {for(const song of ['the-seed','autumn']){
    const c=await browser.newContext({permissions:['microphone'],serviceWorkers:'block',viewport:{width:1366,height:850},timezoneId:'America/Los_Angeles'});
    try {
      const origin='http://127.0.0.1:18872', person='Voicepart Fixture';
      await c.route('**/*',r=>r.request().url().startsWith(origin+'/qa')?r.fulfill({body:html,contentType:'text/html'}):r.abort());
      await c.route('**/station-roster.json',r=>r.fulfill({json:{singers:[{name:person,voice:'B2'}]}}));
      await expandSettingsFixture(c);
      await c.addInitScript(probe=>{
        // Keep media and UI timers running normally while the rehearsal date changes.
        const RealDate=Date, dateKey='test-rehearsal-offset';
        if(location.origin!=='null' || window.parent!==window) {
          const offset=()=>Number(sessionStorage.getItem(dateKey));
          if(!sessionStorage.getItem(dateKey))sessionStorage.setItem(dateKey,new RealDate(2026,10,19,12).getTime()-RealDate.now());
          window.Date=class extends RealDate {
            constructor(...args){super(...(args.length?args:[RealDate.now()+offset()]));}
            static now(){return RealDate.now()+offset();}
          };
          window.nextRehearsal=()=>sessionStorage.setItem(dateKey,offset()+2*86400000);
        }
        const Real=window.AudioContext;
        if(Real)window.AudioContext=class extends Real{constructor(options={}){super({...options,sinkId:{type:'none'}});}};
        if(window.top!==window)return;
        const original=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
        Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...original,set(s){
          const m='engine = new GuideEngine(sequence);';
          original.set.call(this,s.replace(m,()=>m+'window.__qa={engine,api,get inspecting(){return Boolean(stationReview)},'
            +'get selected(){return takePreviewId},get currentPass(){return takeJournal?.spec.initial},'
            +'descriptor:compDescriptor,parts:mixerParts,'+probe+'};'));
        }});
      },recordingProbe);
      const p=await c.newPage(), errors=[];p.setDefaultTimeout(35000);p.on('pageerror',e=>errors.push(e.message));
      await p.goto(origin+'/qa?mode=station#'+song);
      async function active(dismiss=true){
        const iframe=p.locator('iframe[aria-hidden="false"]');await iframe.waitFor();
        const f=await(await iframe.elementHandle()).contentFrame();
        await f.waitForFunction(()=>window.__qa?.recording.ready && !playPause.disabled);
        if(dismiss && await f.locator('#partChooser').isVisible())await f.locator('#partChooserDismiss').click();
        return f;
      }
      let f=await active();await pick(f,person);
      const row=part=>f.locator('#compRows .comp-row').filter({has:f.locator('.take-part',{hasText:new RegExp('^'+part+'$')})})
        .filter({has:f.locator('.take-singer',{hasText:person})});
      async function hold(part){
        const button=f.locator('[data-visible-index]').filter({hasText:new RegExp('^'+part+'$')});
        const box=await button.boundingBox();assert.ok(box,part+' is visible');
        await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
        await p.waitForTimeout(620);await p.mouse.up();
        await f.waitForFunction(part=>document.querySelectorAll('[data-visible-index][aria-pressed=true]').length===1
          && document.querySelector('[data-visible-index][aria-pressed=true]').textContent===part,part);
      }
      if(await f.locator('[data-visible-index][aria-pressed=true]').first().textContent()!=='B2')await hold('B2');
      if(await f.locator('#pitchCapture').getAttribute('aria-pressed')!=='true')await f.locator('#pitchCapture').click();
      await f.waitForFunction(()=>pitchCapture.dataset.state==='armed');
      const entry=()=>f.evaluate(()=>{
        const ref=short=>{const part=__qa.parts.find(x=>x.short===short);return __qa.descriptor(part.source,part.line).reference;};
        const a=ref('A2'), b=ref('B2');
        for(const [s,e] of a.notes)for(const [bs,be] of b.notes){
          if(Math.min(e,be)-Math.max(s,bs)>1) return (Math.max(s,bs)+.05)*a.rate;
        }
        throw Error('Expected a shared sung passage');
      });
      async function start(part){
        await f.evaluate(t=>__qa.engine.seek(t),await entry());
        await f.locator('#playPause').click();
        await f.waitForFunction(part=>__qa.recording.state==='recording' && __qa.recording.part===part
          && __qa.recording.takes.some(t=>t.active && t.frames/t.sampleRate>1.65),part);
        return f.evaluate(()=>{const t=__qa.recording.takes.find(t=>t.active);
          return {id:t.id,part:t.pitchReference.part,line:t.pitchReference.line,slot:t.trackSlot,singer:t.station?.name};});
      }
      async function saved(t){
        await f.waitForFunction(id=>__qa.recording.state==='off' && __qa.recording.takes.some(t=>t.id===id&&t.finalized&&t.pitchScore),t.id);
        return f.evaluate(async id=>{
          const blob=await __qa.takeStore.wav(id);
          return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join('.');
        },t.id);
      }
      const bass=await start('B2');await f.locator('#playPause').click();
      const digest=await saved(bass);
      const review=row('B2').locator('.comp-review:not(:disabled)[aria-busy="false"]');
      await review.waitFor();
      if(await review.getAttribute('aria-pressed')!=='true')await review.press('Enter');
      await f.waitForFunction(()=>__qa.inspecting && __qa.takeReview);
      await hold('A2');
      await f.waitForFunction(()=>document.querySelector('#compRows .is-new.is-selected.is-armed .take-part')?.textContent==='A2');
      assert.equal(await row('A2').locator('.comp-tracked').textContent(),'0%');
      assert.equal(await f.locator('#pitchCapture').getAttribute('aria-pressed'),'true');
      assert.ok(await f.evaluate(()=>!__qa.inspecting&&!__qa.engine.takeLayers.size));
      const alto=await start('A2');assert.equal(alto.singer,person);
      assert.notDeepEqual([bass.part,bass.line],[alto.part,alto.line]);
      // Switch during an active pass. It must close against A2 before rearming B2.
      await hold('B2');await saved(alto);
      assert.equal(await f.locator('#pitchCapture').getAttribute('aria-pressed'),'true');
      await f.waitForFunction(()=>!__qa.engine.playing && __qa.recording.state==='off' && __qa.compDescriptor.label.startsWith('B2'));
      await f.waitForFunction(()=>['B2','A2'].every(part=>[...document.querySelectorAll('#compRows .comp-row')]
        .some(r=>r.querySelector('.take-part').textContent===part&&r.querySelector('.comp-mean').textContent!=='—')));
      const intact=await saved(bass);assert.equal(intact,digest);
      const members=await f.evaluate(async ids=>{
        const states=await __qa.takeStore.comps(__qa.takeSong);
        return ids.map(id=>states.filter(s=>s.segments.some(x=>x.takeId===id)).map(s=>s.descriptor.label.split(' · ')[0]));
      },[bass.id,alto.id]);
      assert.deepEqual(members,[['B2'],['A2']]);
      // Returning to an existing part reuses the row and a subsequent + stays on it.
      await hold('A2');
      await f.waitForFunction(()=>__qa.compState?.descriptor.label.startsWith('A2'));
      const pickup=await start('A2');await f.locator('#playPause').click();await saved(pickup);
      assert.equal(pickup.part,alto.part);assert.equal(pickup.line,alto.line);
      assert.notEqual(pickup.id,alto.id);
      await f.waitForFunction(()=>[...document.querySelectorAll('#compRows .comp-row')].filter(r=>
        r.querySelector('.take-singer').textContent==='Voicepart Fixture' && r.querySelector('.take-part').textContent==='A2'
        && !r.classList.contains('is-new')).length===1);
      await f.locator('#addTrack').click();
      await f.waitForFunction(()=>document.querySelector('#compRows .is-new.is-armed.is-selected .take-part')?.textContent==='A2');
      assert.equal(await row('B2').count(),1);
      await p.reload();f=await active();
      await f.waitForFunction(()=>__qa.compState?.descriptor.label.startsWith('A2'));
      assert.equal(await saved(bass),digest);
      await hold('B2');
      if(await f.locator('#pitchCapture').getAttribute('aria-pressed')!=='true')await f.locator('#pitchCapture').click();
      await f.waitForFunction(()=>pitchCapture.dataset.state==='armed');
      assert.equal(await f.evaluate(()=>MeleteRecording.recordingDay()),'2026-11-19');
      await f.evaluate(()=>nextRehearsal());
      const today=await start('B2');await f.locator('#playPause').click();const todayDigest=await saved(today);
      assert.match(today.slot,/take@2026-11-21/);
      assert.notEqual(today.slot,bass.slot);
      await f.locator('#addTrack').click();
      await f.waitForFunction(()=>document.querySelector('#compRows .is-new.is-armed.is-selected .take-part')?.textContent==='B2');
      assert.equal(await f.evaluate(()=>__qa.engine.takeLayers.size),0);
      const extra=await start('B2');await f.locator('#playPause').click();await saved(extra);
      const group=slot=>slot.split(':').slice(3).join(':');
      assert.equal(new Set([bass,today,extra].map(t=>group(t.slot))).size,3);
      await p.reload();f=await active();
      await f.waitForFunction(()=>[...document.querySelectorAll('#compRows .comp-row')].filter(r=>
        !r.classList.contains('is-new') && r.querySelector('.take-part').textContent==='B2').length===3);
      const separate=await f.evaluate(async ids=>{
        const states=await __qa.takeStore.comps(__qa.takeSong);
        return ids.map(id=>states.filter(s=>s.segments.some(x=>x.takeId===id)).map(s=>[...new Set(s.segments.map(x=>x.takeId))]));
      },[bass.id,today.id,extra.id]);
      assert.deepEqual(separate,[[[bass.id]],[[today.id]],[[extra.id]]]);
      assert.equal(await saved(bass),digest);assert.equal(await saved(today),todayDigest);
      assert.equal(group(await f.evaluate(()=>__qa.compState.descriptor.slot)),group(extra.slot));
      // Switch via the two song tabs during real synthetic capture. The new
      // frame should be ready on the same part, without a second Sing click.
      const other=song==='autumn'?'the-seed':'autumn';
      if(await f.locator('#pitchCapture').getAttribute('aria-pressed')!=='true')await f.locator('#pitchCapture').click();
      const last=await start('B2'), original=f;
      await f.locator('#melete-song-'+other).click();
      f=await active(false);
      const readyToSing=()=>f.waitForFunction(name=>partChooser.hidden && !__qa.inspecting
        && pitchCapture.getAttribute('aria-pressed')==='true' && stationSinger.value===name
        && __qa.compState?.descriptor.label.startsWith('B2') && !__qa.engine.playing,person);
      await readyToSing();
      await original.waitForFunction(id=>__qa.recording.state==='off' && __qa.recording.takes.some(t=>t.id===id && t.complete && t.finalized),last.id);
      const nextSong=await start('B2');
      assert.equal(nextSong.singer,person);
      await f.locator('#playPause').click();await saved(nextSong);
      const otherFrame=f;
      await f.locator('#melete-song-'+song).click();
      f=await active(false);await readyToSing();
      assert.ok(await saved(last));
      assert.equal(await f.evaluate(id=>__qa.recording.takes.some(t=>t.id===id),nextSong.id),false);
      assert.equal(await otherFrame.evaluate(id=>__qa.recording.takes.some(t=>t.id===id),last.id),false);
      await f.locator('#pitchCapture').click();
      await f.locator('#melete-song-'+other).click();
      f=await active(false);
      await f.waitForFunction(()=>pitchCapture.getAttribute('aria-pressed')==='false' && __qa.recording.state==='off');
      assert.deepEqual(errors,[]);
      reports.push({song,bassPreserved:true,independentAlto:true,heldFromReview:true,automaticSelectedDraft:true,
        singKeptOn:true,savedFirstPartBeforeSwitch:true,returningPickup:true,manualPlusAndReload:true,
        nextDayFresh:true,sameDayPlusIndependent:true,threeB2RowsAfterReload:true,
        switchingSavedOutgoingPass:true,singerAndPartCarried:true,singOnAndOffFollowedAcrossSongs:true});
    }catch(error){
      const details=await Promise.all(c.pages()[0].frames().slice(1).map(frame=>frame.evaluate(()=>({
        song:window.__qa?.takeSong,active:!frameElement.inert,recording:window.__qa?.recording.state,
        sing:document.getElementById('pitchCapture')?.dataset.state,singer:document.getElementById('stationSinger')?.value,
        target:window.__qa?.compState?.descriptor.label,reviewing:window.__qa?.inspecting,
        chooser:document.getElementById('partChooser')?.hidden,playing:window.__qa?.engine.playing
      }))));
      throw new Error(song+' '+JSON.stringify(details),{cause:error});
    }finally{await c.close();}
  }}finally{await browser.close();await fs.unlink(wav);await fs.rmdir(fixture);}
  if(process.argv[3])await fs.writeFile(process.argv[3],JSON.stringify(reports,null,2)+'\n');
  console.log(JSON.stringify(reports));
}
run().catch(e=>{console.error(e);process.exitCode=1});
