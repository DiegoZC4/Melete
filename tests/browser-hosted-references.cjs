const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const http=require('node:http'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {audioRig,active,section,level}=require('./browser-compatibility.cjs');
const {readCollection}=require('./collection-fixture.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const scope='/media-test/';

async function checkHostedReferences(browser,tmp) {
  const dir=path.join(tmp,'reference-releases');
  execFileSync(process.env.PYTHON||'python3',[path.join(__dirname,'reference_releases.py'),
    path.join(tmp,'player/dist/index.html'),dir]);
  let rev='a', offline=false, blockAudio=false, stallReplacement=false, downloads=[];
  const stalled=new Set();
  const file=(r,n)=>fs.readFileSync(path.join(dir,r,n));
  const manifest=r=>JSON.parse(file(r,'release.json'));
  await require('./browser-performance-clock.cjs').checkPerformanceClock(browser,file('single','melete-portable.html').toString(),'fixture');
  const expected=manifest('a').hosted.media.map(r=>r.mp3).sort();
  assert.deepEqual(manifest('b').hosted.media,manifest('a').hosted.media);
  assert.ok(manifest('c').hosted.media.some(r=>!expected.includes(r.mp3)));
  const server=http.createServer((req,res)=>{
    const p=new URL(req.url,'http://localhost').pathname;
    const single=p.startsWith(scope+'one/'), selected=single?'single':rev;
    const name=(single?p.slice((scope+'one/').length):p.startsWith(scope)?p.slice(scope.length):'missing')||'index.html';
    const mp3=name.match(/^media\/([a-f0-9]{64})\.mp3$/)?.[1];
    if(mp3) downloads.push(mp3);
    if(mp3 && stallReplacement && !expected.includes(mp3)) {
      stalled.add(res);res.once('close',()=>stalled.delete(res));return;
    }
    let data,type;
    if(!offline && !(mp3 && blockAudio)) {
      if(mp3) {type='audio/mpeg';data=file(selected,name);if(selected==='c'&&!expected.includes(mp3))data=Buffer.alloc(data.length);}
      else if(['index.html','melete-offline.js','release.json'].includes(name)) {
        type=name.endsWith('html')?'text/html':name.endsWith('.js')?'text/javascript':'application/json';data=file(selected,name);
      }
    }
    res.writeHead(data?200:503,{'Content-Type':type||'text/plain','Cache-Control':'no-store'});res.end(data);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let ctx;
  try {
    ctx=await browser.newContext({acceptDownloads:true});
    await ctx.addInitScript(audioRig,{synthetic:false});
    await ctx.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
    let page=await ctx.newPage();
    const home='http://127.0.0.1:'+server.address().port+scope;
    const ready=async(r)=>{
      const f=await active(page,{title:'Reference 1'});
      await f.locator('#offlineReady[data-state=ready]').waitFor({state:'attached',timeout:35000});
      assert.equal(await page.locator('meta[name=qa-release]').getAttribute('content'),r);return f;
    };
    await page.goto(home);await ready('a');
    assert.deepEqual([...downloads].sort(),expected);
    rev='b';blockAudio=true;downloads=[];
    await page.reload();await ready('b');
    assert.deepEqual(downloads,[],'GUI-only update must not request any MP3');
    rev='c';blockAudio=false;await page.reload();await ready('b');
    assert.ok(downloads.some(s=>!expected.includes(s)),'corrupt new recording was tried but rejected');
    stallReplacement=true;
    await page.reload({timeout:15000});await ready('b');
    assert.ok(stalled.size,'a stalled replacement must not delay an already installed player');
    stallReplacement=false;for(const res of stalled)res.writeHead(503).end();
    blockAudio=true;
    await page.close();offline=true;await ctx.setOffline(true);
    page=await ctx.newPage();await page.goto(home);const f=await ready('b');
    const save=async(frame,selector,include,name)=>{
      await section(frame,'tools');await frame.locator(selector).click();
      const box=frame.locator('#portableDownloadDialog');
      assert.equal(await box.locator('input').isChecked(),false,'recordings must be opt-in every time');
      if(include)await box.locator('input').check();
      const download=page.waitForEvent('download');
      await box.getByRole('button',{name:'Download',exact:true}).click();await(await download).saveAs(name);
    };
    const lean=path.join(tmp,'midi-collection.html');
    await save(f,'#saveCollection',false,lean);
    const leanHTML=fs.readFileSync(lean,'utf8'),bare=readCollection(leanHTML);
    assert.ok(bare.songs.every(s=>s.portableState&&!JSON.parse(/<script id="trainer-config" type="application\/json">([\s\S]*?)<\/script>/.exec(s.html)[1]).referenceAudio));
    const leanBundle=JSON.parse(/<script id="melete-collection-data" type="application\/json">([\s\S]*?)<\/script>/.exec(leanHTML)[1]);
    assert.ok(Object.values(leanBundle.assets).every(v=>!v?.mp3));
    const used=new Set(leanBundle.songs.flatMap(s=>s.chunks));assert.ok(Object.keys(leanBundle.assets).every(k=>used.has(k)),'no orphaned recording bytes');
    const out=path.join(tmp,'saved-reference-collection.html');
    await save(f,'#saveCollection',true,out);
    const restored=readCollection(fs.readFileSync(out,'utf8'));
    const hashes=restored.songs.map(s=>{
      assert.ok(s.portableState,'keeps current settings');
      const cfg=JSON.parse(/<script id="trainer-config" type="application\/json">([\s\S]*?)<\/script>/.exec(s.html)[1]);
      return sha(Buffer.from(cfg.referenceAudio.data,'base64'));
    });
    assert.deepEqual(hashes.sort(),expected);assert.ok(!downloads.some(s=>expected.includes(s)),'never re-fetch a verified MP3');
    await page.goto(pathToFileURL(lean).href);
    for(const s of bare.songs){
      if(s!==bare.songs[0])await(await active(page,bare.songs[0])).locator('#songToggle').click();
      const frame=await active(page,s);assert.equal(await frame.locator('.reference-hear').count(),0);
      assert.ok(await level(frame,400)>.001,'MIDI-only file still sounds offline: '+s.title);
    }
    // A downloaded collection must play real stereo audio when opened as a file,
    // not merely contain audio-shaped bytes or fall back to the MIDI guide.
    await page.goto(pathToFileURL(out).href);
    for(const s of restored.songs){
      if(s!==restored.songs[0])await (await active(page,restored.songs[0])).locator('#songToggle').click();
      const frame=await active(page,s);await section(frame,'parts');
      for(const b of await frame.locator('[data-audio-index]').all())if(await b.getAttribute('aria-pressed')==='true')await b.click();
      const ref=frame.locator('.reference-hear');await ref.click();
      assert.ok(await level(frame,400)>.005,'offline file should render '+s.title);
    }
    offline=false;blockAudio=false;await ctx.setOffline(false);await page.goto(home+'one/');
    await page.locator('#offlineReady[data-state=ready]').waitFor({state:'attached'});
    offline=true;await ctx.setOffline(true);await page.reload();await section(page,'tools');
    const lightOne=path.join(tmp,'midi-single.html');
    await save(page,'#download',false,lightOne);
    assert.ok(!JSON.parse(/<script id="trainer-config" type="application\/json">([\s\S]*?)<\/script>/.exec(fs.readFileSync(lightOne,'utf8'))[1]).referenceAudio);
    const one=path.join(tmp,'saved-single.html');await save(page,'#download',true,one);
    await page.goto(pathToFileURL(one).href);
    const singleHash=await page.locator('#trainer-config').evaluate(async el=>{
      const raw=Uint8Array.from(atob(JSON.parse(el.textContent).referenceAudio.data),c=>c.charCodeAt(0));
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),n=>n.toString(16).padStart(2,'0')).join('');
    });
    assert.ok(expected.includes(singleHash));assert.equal(await page.locator('#melete-offline-install').count(),0);
    return {guiOnlyMp3Requests:0,corruptNewAudioKeptOldRelease:true,stalledNewAudioKeptOldRelease:true,offlineExportHashes:hashes,filePlayback:true,standaloneSong:true};
  } finally {
    await ctx?.close();await new Promise(r=>{server.close(r);server.closeAllConnections()});
  }
}
module.exports={checkHostedReferences};
if(require.main===module){
  const tmp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'melete-reference-regression-'));
  (async()=>{let browser;try{
    execFileSync(process.env.PYTHON||'python3',[path.join(__dirname,'../build_trainer.py'),path.join(__dirname,'fixtures/shared-regressions.musicxml'),'--project-dir',path.join(tmp,'player')]);
    const name=process.argv[2]||'chromium';
    const pw=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));
    // The fake microphone is a second Web Audio context, not a hardware device with a permission gesture.
    browser=await pw[name].launch({headless:true,...(name==='firefox'?{firefoxUserPrefs:{'media.autoplay.default':0,'media.autoplay.block-webaudio':false}}:{})});console.log(JSON.stringify(await checkHostedReferences(browser,tmp)));
  }finally{await browser?.close();fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
}
