const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {wavBytes} = require('../template/loop_recorder.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function checkReviewCache(browser,html,{baseline=false,delayMs=0}={}) {
  const context = await browser.newContext({viewport:{width:1280,height:800}});
  const url = 'http://127.0.0.1:8809/review-media-fixture?station';
  const songs = new Map(), blobs = new Map(), assets = new Map(), counts = [];
  const failures = [];
  let signed = true, apiOnline = true, revision = 1, active = 0, peak = 0, transferred = 0;
  let pendingManifest = null;
  function media(bytes) {
    const size = Math.min(1024*1024,Math.ceil(bytes.length/6)), chunks = [];
    for (let i=0;i<bytes.length;i+=size) {
      const chunk = bytes.subarray(i,i+size), key = hash(chunk);
      chunks.push(key); blobs.set(key,chunk);
    }
    return {chunks,bytes:bytes.length};
  }
  const delay = () => new Promise(resolve=>setTimeout(resolve,delayMs));
  function submission(ref,song) {
    if (!assets.has(revision)) {
      const rate = 48000, seconds = Math.min(60,ref.seconds);
      const pcm = Int16Array.from({length:Math.ceil(seconds*rate)},(_,i)=>
        Math.round(3800*Math.sin(2*Math.PI*(165+revision*30)*i/rate)));
      const audio = Buffer.from(wavBytes(pcm,rate));
      const [first, last, targets] = ref.notes[0], step = Math.min(.1,(last-first)/3);
      const pitches = Buffer.from(new Float32Array([first,first+step,targets[0]*100-3,
        first+step,first+2*step,targets[0]*100+2]).buffer);
      const m = {song,part:ref.part,line:ref.line,rate:ref.rate,fingerprint:ref.fingerprint,
        origin:0,seconds:ref.seconds,seams:[[0,seconds,1]],audio:media(audio),
        pitches:{chunks:[hash(pitches)],bytes:pitches.length}};
      blobs.set(hash(pitches),pitches);
      assets.set(revision,{m,hash:hash(audio)});
    }
    return assets.get(revision);
  }
  await context.addInitScript(()=>Object.defineProperty(window,'MeleteCompPanel',{configurable:true,set(panel){
    const create = panel.create;
    panel.create = adapter => {
      adapter.cloudConfig = {api:'/melete/api.php'};
      window.cacheQA = adapter;
      const review = adapter.review;
      adapter.review = (data,...rest) => {
        window.cacheQAResult={data,ms:performance.now()-window.cacheQAClick};
        return review(data,...rest);
      };
      return create(adapter);
    };
    document.addEventListener('click',event=>{
      if (event.target.closest('.comp-review')) window.cacheQAClick=performance.now();
    },true);
    Object.defineProperty(window,'MeleteCompPanel',{value:panel,configurable:true});
  }}));
  await context.route('**/*',async route=>{
    const u = new URL(route.request().url()), action = u.searchParams.get('action');
    if (u.pathname==='/review-media-fixture') return route.fulfill({body:html,contentType:'text/html'});
    if (u.pathname==='/melete/signin.html') return route.fulfill({body:'<title>Fixture login</title>',contentType:'text/html'});
    if (u.pathname!=='/melete/api.php') return route.abort();
    if (['blob','submission'].includes(action)) counts.push(action);
    if (!apiOnline) return route.abort('internetdisconnected');
    if (action==='status') return route.fulfill({json:{configured:true,user:signed?{id:'reviewer',name:'Reviewer'}:null,
      reviewer:false,submissionReviewer:true,directoryAccess:false}});
    if (action==='logout') { signed=false; return route.fulfill({json:{ok:true}}); }
    if (!signed) return route.fulfill({json:{error:'Sign in'},status:403});
    if (action==='load') return route.fulfill({json:{profile:null}});
    if (action==='list') return route.fulfill({json:{items:[],next:null}});
    if (action==='submissions') {
      const song = u.searchParams.get('song');
      const items = ['selected','unopened'].map(id=>({owner:'reviewer',id,label:'Choir',name:id,
        uploaded:1700000000000+revision,part:0,revision}));
      for (const item of items) songs.set(item.id,song);
      return route.fulfill({json:{items,next:null}});
    }
    if (action==='submission') {
      if (u.searchParams.get('id')==='unopened' && pendingManifest) await pendingManifest;
      const ref=await route.request().frame().evaluate(()=>cacheQA.descriptor(0,null,1).reference);
      const {m}=submission(ref,songs.get(u.searchParams.get('id')));
      await delay(); return route.fulfill({json:{manifest:m}});
    }
    if (action==='blob') {
      const data=blobs.get(u.searchParams.get('hash'));
      assert.ok(data); active++; peak=Math.max(peak,active);
      try { await delay(); transferred+=data.length; return await route.fulfill({body:data,contentType:'application/octet-stream'}); }
      finally {active--;}
    }
    throw Error('Unexpected action '+action);
  });
  const page=await context.newPage();
  page.on('pageerror',error=>failures.push(error.message));
  const row = page.locator('[data-cloud-id="submitted:reviewer:selected"] .comp-review');
  async function openPlayer() {
    await page.goto(url);
    await page.waitForFunction(()=>window.cacheQA&&!document.getElementById('playPause').disabled);
    if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserDismiss').click();
    if (await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await page.locator('#settingsToggle').click();
    const toggle=page.locator('[data-settings-section="takes"] .settings-section-toggle');
    if (await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
    const expand=page.locator('#expandTakes');
    if (await expand.getAttribute('aria-expanded')==='false') await expand.click();
    await row.waitFor({state:'visible'});
  }
  async function listen() {
    const files=counts.length,bytes=transferred;
    await row.click();
    await page.waitForFunction(()=>window.cacheQAResult?.data?.id===cacheQA.selected()&&window.cacheQAResult&&cacheQA.audible(cacheQA.selected()));
    const result=await page.evaluate(async()=>{
      const {ms,data}=window.cacheQAResult;
      const bytes=await crypto.subtle.digest('SHA-256',await data.blob.arrayBuffer());
      return {ms:Math.round(ms),sha:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join(''),
        samples:data.buffer.length,hasSignal:data.buffer.getChannelData(0).subarray(0,4800).some(n=>Math.abs(n)>.01),
        pitches:data.frames.length};
    });
    assert.equal(result.sha,assets.get(revision).hash); assert.ok(result.hasSignal); assert.equal(result.pitches,2);
    return {ms:result.ms,requests:counts.length-files,bytes:transferred-bytes};
  }
  const saved=()=>page.waitForFunction(()=>document.querySelector('[data-cloud-id="submitted:reviewer:selected"] .comp-review')?.title.includes('Saved on this device'));
  try {
    await openPlayer();
    if (!baseline) {
      await page.locator('#takeFields').click();await page.locator('#allTakeFields').click();await page.locator('#takeFields').click();
      const mean = page.locator('[data-cloud-id="submitted:reviewer:selected"] .take-distribution');
      await mean.click();
      const dialog = page.locator('#takeDistributionDialog');
      await dialog.locator('details:not([hidden])').waitFor({state:'attached'});
      assert.deepEqual(await dialog.locator('tbody tr td:first-child').allTextContents(),['-3','+2']);
      assert.equal(transferred,24,'the histogram downloads only two pitch triples and no audio');
      assert.equal(await page.evaluate(()=>Boolean(window.cacheQAResult)),false);
      await dialog.getByRole('button',{name:'Close intonation distribution'}).click();
      await mean.click();await dialog.locator('details:not([hidden])').waitFor({state:'attached'});
      assert.equal(transferred,24,'reopening the chart reuses its measured contour');
      await dialog.getByRole('button',{name:'Close intonation distribution'}).click();
    }
    const cold=await listen();
    assert.ok(cold.requests>=7); assert.ok(cold.bytes>0);
    if (baseline) return {cold,peak};
    assert.ok(peak>1&&peak<=4);
    await saved();
    const firstHash=assets.get(revision).hash;
    await openPlayer();
    const repeat=await listen();
    assert.equal(repeat.requests,0);
    revision++; await openPlayer();
    await page.waitForFunction(()=>document.querySelector('[data-cloud-id="submitted:reviewer:unopened"]'));
    const updated=await listen(); assert.ok(updated.requests>0); assert.notEqual(assets.get(revision).hash,firstHash);
    await saved();
    await page.locator('#openCloudLibrary').click(); await page.locator('#compCloudLogout').click();
    await page.waitForFunction(()=>document.getElementById('compCloudLogout').hidden);
    apiOnline=false; await openPlayer();
    const offline=await listen();
    assert.equal(offline.requests,0);assert.equal(await page.locator('[data-cloud-id]').count(),1);
    assert.equal(await page.locator('[data-cloud-id] .take-delete').isVisible(),false);
    const {song,ref}=await page.evaluate(()=>({song:cacheQA.song(),ref:cacheQA.descriptor(0,null,1).reference}));
    const rehearsal=await require('./browser-rehearsal-cache.cjs').checkRehearsalCache(context,html,song,ref);
    // A late cloud review or Hear request must not add the singer back after +.
    signed=true;apiOnline=true;revision++;
    await openPlayer();await listen();
    const unopened=page.locator('[data-cloud-id="submitted:reviewer:unopened"]');
    let release;
    pendingManifest=new Promise(resolve=>{release=resolve;});
    try {
      await unopened.locator('.take-hear').click();
      await unopened.locator('.comp-review').click();
      await page.waitForFunction(()=>cacheQA.loading('submitted:reviewer:unopened'));
      await page.locator('#addTrack').click();
      await page.waitForFunction(()=>document.querySelector('#compRows .is-new.is-selected.is-armed'));
    } finally {release();pendingManifest=null;}
    await page.waitForFunction(()=>!cacheQA.loading('submitted:reviewer:unopened') &&
      document.querySelector('[data-cloud-id="submitted:reviewer:unopened"] .comp-review').getAttribute('aria-busy')==='false');
    const draft=await page.locator('#compRows .is-new.is-selected').getAttribute('data-comp-key');
    assert.equal(await page.evaluate(()=>cacheQA.selected()),'comp:'+draft);
    assert.equal(await page.locator('#compRows .take-hear[aria-pressed="true"]').count(),0);
    assert.deepEqual(failures,[]);
    return {cold,repeat,updated,offline,peak,rehearsal,newDraftMutesCloud:true};
  } finally { await context.close(); }
}
module.exports={checkReviewCache};
