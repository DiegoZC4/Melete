// An offline collection in a disposable profile. All input takes are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const {expandSettingsFixture} = require('./browser-settings-sections.cjs');
const {recordingProbe} = require('./browser-loop-recorder.cjs');

async function checkSong(browser, html, song) {
  const context = await browser.newContext({viewport:{width:1180,height:780}, serviceWorkers:'block'});
  try {
    const origin = 'http://127.0.0.1:18862';
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === origin && new URL(route.request().url()).pathname === '/qa'
        ? route.fulfill({contentType:'text/html', body:html}) : route.abort());
    await expandSettingsFixture(context);
    await context.addInitScript(probe => {
      if (window.top !== window) return;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {...descriptor, set(html) {
        const marker = 'engine = new GuideEngine(sequence);';
        descriptor.set.call(this, html.replace(marker, () => marker+'window.__qa = {engine,'+probe+'};'));
      }});
    }, recordingProbe);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(9000);
    async function player() {
      const iframe = page.locator('iframe[data-melete-collection-player][aria-hidden="false"]');
      await iframe.waitFor();
      const frame = await (await iframe.elementHandle()).contentFrame();
      await frame.waitForFunction(() => window.__qa?.recording.ready && !document.querySelector('#playPause').disabled);
      if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
      if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
      return frame;
    }
    await page.goto(origin+'/qa?mode=station#'+song);
    let frame = await player();
    const seeded = await frame.evaluate(async () => {
      const q = window.__qa, takes = [];
      const bytes = Int16Array.from({length:1600}, (_, i) => (i % 61) * 81);
      const ids = {};
      for (const kind of ['silent','quiet','writing','favorite']) {
        const id = ids[kind] = crypto.randomUUID(), pcm = new Int16Array(64);
        if (kind === 'quiet') pcm[63] = 1;
        await q.takeStore.append({id,song:q.takeSong,sampleRate:8000,part:'QA',rate:1,
          createdAt:Date.now(),peak:0,favorite:kind==='favorite'},0,pcm,{finalized:kind!=='writing'});
      }
      await q.reloadTakes();
      const left = new Set((await q.takeStore.list(q.takeSong)).map(r => r.id));
      if (left.has(ids.silent) || ['quiet','writing','favorite'].some(k => !left.has(ids[k]))) {
        throw Error('Only a finalized, entirely silent, unprotected take should disappear');
      }
      for (let i=0; i<22; i++) {
        const take = await q.takeStore.append({id:crypto.randomUUID(), song:q.takeSong, sampleRate:8000,
          part:'QA', rate:1, createdAt:Date.now()+i*2000, peak:.15}, 0, bytes, {finalized:true, complete:true});
        takes.push(take.id);
      }
      await q.reloadTakes();
      return takes;
    });
    const rawRow = i => frame.locator('#compRows > .take-row[data-take-id="'+seeded[i]+'"]');
    const rowPosition = row => row.evaluate(el => ({
      index:Array.from(el.parentElement.children).indexOf(el), y:el.getBoundingClientRect().top,
      height:el.getBoundingClientRect().height, scroll:el.closest('.take-review').scrollTop
    }));
    async function remove(row) {
      await row.locator('.take-delete').click();
      await row.locator('.take-delete.is-delete-armed').click();
    }
    await rawRow(0).waitFor();
    // Decoding a second full score on slower CI machines can exceed the real 10 s window.
    // Keep wall time fixed across reload. Real timers and the transport keep running.
    await page.clock.setFixedTime(new Date());
    await frame.locator('.comp-columns [data-take-sort="number"]').click();
    await rawRow(13).scrollIntoViewIfNeeded();
    const before = await rowPosition(rawRow(13));
    assert.ok(before.scroll>0, 'check a scrolled table');
    await remove(rawRow(13));
    await rawRow(13).locator('.take-undo button').waitFor();
    assert.deepEqual(await rowPosition(rawRow(13)), before, 'deleting preserves row, height and scroll');
    assert.equal(await frame.locator('#takeUndo').count(),0);
    await remove(rawRow(14));
    await rawRow(14).locator('.take-undo button').click();
    await rawRow(14).locator('.take-delete').waitFor();
    assert.equal(await rawRow(13).locator('.take-undo button').count(),1, 'only the clicked take is restored');
    const pos = (await rowPosition(rawRow(13))).index;
    await page.reload();
    frame = await player();
    await rawRow(13).locator('.take-undo button').waitFor();
    assert.equal((await rowPosition(rawRow(13))).index,pos,'pending row survives reload in sort order');
    await rawRow(13).locator('.take-undo button').click();
    await rawRow(13).locator('.take-delete').waitFor();
    assert.equal(await frame.evaluate(async id => {
      const bytes = new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer());
      const samples = new Int16Array(bytes.buffer,44);
      return samples.length === 1600 && samples.every((s,i) => s === (i % 61)*81);
    },seeded[13]),true,'restored audio is byte-identical');

    // A synthetic comp with a real, timed score reference.
    await require('./browser-sing.cjs').choosePart(frame,0);
    await frame.waitForFunction(()=>Boolean(window.__qa.compDescriptor));
    await frame.evaluate(async () => {
      const q = __qa, d = q.compDescriptor, first = d.reference.notes[0];
      const start=q.engine.tickAtSeconds(first[0]*d.reference.rate);
      const end=Math.min(d.reference.end,q.engine.tickAtSeconds((first[0]+6)*d.reference.rate));
      const ref=q.pitchReference({start,end,rate:1}); ref.latency=0;
      const sr=8000, n=Math.ceil(ref.seconds*sr), id=crypto.randomUUID();
      const pcm=Int16Array.from({length:n},(_,i)=>2000*Math.sin(i*.2));
      const rec=await q.takeStore.append({id,song:q.takeSong,createdAt:Date.now(),sampleRate:sr,
        replaces:true,part:d.label,rate:1,start,end,peak:.1,pitchReference:ref},0,pcm,{finalized:true,complete:true});
      const frames=Array.from({length:Math.ceil(n/80)},(_,i)=>{
        const from=i*80/sr,to=Math.min((i+1)*80,n)/sr,note=ref.notes.find(n=>n[0]<=from && n[1]>from);
        return {start:from,end:to,cents:note?note[2][0]*100+15:null};
      });
      await q.takeStore.pitchScore(id,n,ref,MeleteTakePitch.scoreFrames(frames,ref,n/sr),MeleteTakePitch.packContour(frames,rec));
      await q.reloadTakes(); await q.refreshComp();
    });
    const comp = frame.locator('#compRows .is-armed[data-comp-key]');
    await comp.waitFor();
    await comp.scrollIntoViewIfNeeded();
    const compBefore = await rowPosition(comp);
    await remove(comp);
    const deleted = frame.locator('#compRows [data-deleted-comp]');
    await deleted.locator('.take-undo button').waitFor();
    assert.deepEqual(await rowPosition(deleted),compBefore,'comp Undo stays in the deleted row');
    await deleted.locator('.take-undo button').click();
    await comp.waitFor();
    assert.ok(await frame.evaluate(()=>__qa.compState.segments.length>0),'Undo restores the comp segments');
    // The feature must be available within the actual collection iframe.
    assert.ok(await frame.evaluate(()=>document.featurePolicy.allowsFeature('screen-wake-lock')));
    assert.deepEqual(errors,[]);
    return {song, scrolledPixels:before.scroll, independentDeletes:true, reload:true, restoredPCM:true, comp:true, wakeLockAllowed:true};
  } finally { await context.close(); }
}

(async () => {
  const html = await fs.readFile(process.argv[2],'utf8');
  const browser = await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL, args:['--mute-audio','--use-fake-device-for-media-stream']});
  require('./browser-silent-output.cjs').useSilentOutput(browser);
  try {
    for (const song of ['autumn','the-seed']) console.log(JSON.stringify(await checkSong(browser,html,song)));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
