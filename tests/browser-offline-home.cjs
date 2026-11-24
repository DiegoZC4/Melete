// Use a real loopback fixture server. Kill it and quit the browser; a warm tab or an HTTP cache hit is not a pass.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {fixture,audioRig,active,section,seek,stored,level}=require('./browser-compatibility.cjs');
const {readCollection}=require('./collection-fixture.cjs');
const {enableSing}=require('./browser-sing.cjs');
const pw=require(require.resolve('playwright',{paths:[process.env.GUI_QA_NODE_MODULES||__dirname]}));

async function run(engine,localDir) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'melete-offline-home-'));
  let server,ctx,stage='build',page;
  try {
    let dir=localDir;
    if(!dir) {
      dir=path.join(tmp,'hosted');
      execFileSync(process.env.PYTHON||'python3',[path.join(__dirname,'../offline_player.py'),fixture(tmp),'--output-dir',dir]);
    }
    let doc=fs.readFileSync(path.join(dir,'index.html')),worker=fs.readFileSync(path.join(dir,'melete-offline.js'));
    const iconPath=path.join(dir,'apple-touch-icon.png'),icon=fs.existsSync(iconPath)?fs.readFileSync(iconPath):null;
    const songs=readCollection(doc.toString()).songs;
    const scope='/choir/', profile=path.join(tmp,'isolated-profile');
    let damagedDownload=true, brokenUpdate=false;
    const wrong=Buffer.from(doc); wrong[wrong.length-1]^=1;
    server=http.createServer((req,res)=>{
      const p=new URL(req.url,'http://localhost').pathname;
      const content=p===scope||p===scope+'index.html'?[damagedDownload && p.endsWith('index.html')?wrong:doc,'text/html; charset=utf-8']:
        p===scope+'melete-offline.js'?[brokenUpdate?worker.toString().replace(/SHA = "[0-9a-f]{64}"/,'SHA = "'+'0'.repeat(64)+'"'):worker,'text/javascript']:
        p===scope+'release.json'?[JSON.stringify({schema:1,kind:'melete-player',nativeProtocol:1,player:'index.html',
          bytes:doc.length,sha256:require('node:crypto').createHash('sha256').update(doc).digest('hex')}),'application/json']:
        p===scope+'apple-touch-icon.png'&&icon?[icon,'image/png']:null;
      // HTTP cache must not be able to satisfy the off-network tests.
      res.writeHead(content?200:404,{'Content-Type':content?.[1]||'text/plain','Cache-Control':'no-store'});
      res.end(content?.[0]||'Not found');
    });
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port, home=origin+scope;
    const open=async(offline)=>{
      ctx=await pw[engine].launchPersistentContext(profile,{headless:true,viewport:{width:820,height:1032},
        ...(engine==='chromium'?{args:['--mute-audio']}:{}),...(engine==='firefox'?{firefoxUserPrefs:{'media.autoplay.default':0}}:{})});
      // No real microphone and no physical sound, including on an offline cold start.
      await ctx.addInitScript(audioRig,{synthetic:true,hz:220});
      if(offline)await ctx.setOffline(true);
      page=ctx.pages()[0]||await ctx.newPage();page.setDefaultTimeout(20000);
    };
    const ready=async(f)=>{
      const status=f.locator('#offlineReady[data-state=ready]');
      await status.waitFor({state:'attached',timeout:45000});
      assert.equal(await status.isVisible(),false,'success should not occupy the transport');
      assert.equal(await status.textContent(),'');
      assert.equal(await f.locator('.transport-primary #offlineReady').count(),0,'no offline badge is mounted in the playbar');
      assert.match(await f.locator('#saveCollection, #download').getAttribute('aria-description'),/saved for offline use/);
    };
    stage='online preparation';
    await open(false);
    const target=songs[1], part=target.id==='the-seed'?'B2':'A', start=part==='B2'?14000:0;
    const link=home+'?song='+target.id+'&view=pitchbar&part='+part;
    await page.goto(link,{waitUntil:'commit'});
    if(icon) {
      const resolved=await page.locator('head link[rel="apple-touch-icon"]').evaluate(async el=>{
        const img=new Image();img.src=el.href;await img.decode();
        return [new URL(img.src).pathname,img.naturalWidth,img.naturalHeight];
      });
      assert.deepEqual(resolved,[scope+'apple-touch-icon.png',180,180]);
    }
    let first=await active(page,target);
    await section(first,'tools');
    await first.locator('#offlineReady[data-state=failed]').waitFor({state:'visible',timeout:50000});
    assert.equal(await page.evaluate(async()=>(await caches.keys()).some(k=>k.startsWith('melete:offline-player:'))),false);
    damagedDownload=false;await first.locator('#offlineReady').click();await ready(first);
    const cached=await page.evaluate(async()=>{
      const keys=(await caches.keys()).filter(k=>k.startsWith('melete:offline-player:'));
      return Promise.all(keys.map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)));
    });
    assert.deepEqual(cached,[[scope+'index.html']]);
    await page.evaluate(async()=>{
      localStorage.setItem('melete:qa-retention','prior-device-setting');
      await (await caches.open('independent-test-cache')).put('./keep',new Response('untouched'));
    });
    stage='reject mismatched update without losing the good copy';
    brokenUpdate=true;
    const updateState=await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.getRegistration();
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('No failed update observed')),20000);
        reg.addEventListener('updatefound',()=>{
          const next=reg.installing;next.addEventListener('statechange',()=>{
            if(['redundant','activated','installed'].includes(next.state)){clearTimeout(timer);resolve(next.state);}
          });
        },{once:true});
        reg.update().catch(reject);
      });
    });
    assert.equal(updateState,'redundant');await ready(first);
    stage='deliver verified update on reload while a second tab stays open';
    brokenUpdate=false;
    const sibling=await ctx.newPage();
    await sibling.goto(link,{waitUntil:'commit'});await ready(await active(sibling,target));
    const oldBuild=worker.toString().match(/BUILD = "([0-9a-f]{64})"/)[1];
    const digest=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
    const next=digest('second:'+oldBuild),previous=digest(doc),bytes=doc.length;
    doc=Buffer.from(doc.toString().replace(oldBuild,next).replace('</head>','<meta name="qa-release" content="second"></head>'));
    worker=Buffer.from(worker.toString().replace(oldBuild,next).replace(previous,digest(doc)).replace('BYTES = '+bytes,'BYTES = '+doc.length));
    const opened=await ctx.newPage();
    await opened.goto(link,{waitUntil:'commit'});
    assert.equal(await opened.locator('meta[name=qa-release]').getAttribute('content'),'second',
      'ordinary online open should fetch a new verified release without a second manual reload');
    await ready(await active(opened,target));await opened.close();
    assert.equal(await page.locator('meta[name=qa-release]').count(),0,'updating must not reload the running document');
    assert.equal(await sibling.locator('meta[name=qa-release]').count(),0,'another open practice session is untouched');
    await page.reload({waitUntil:'commit'});first=await active(page,target);await ready(first);
    assert.equal(await page.locator('meta[name=qa-release]').getAttribute('content'),'second');
    await sibling.close();
    await first.evaluate(audioRig,{synthetic:true,hz:220});await section(first,'practice');await enableSing(first);
    await first.locator('#microphoneCheck[data-state=signal]').waitFor({state:'attached'});
    await ctx.close();ctx=null;
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); server=null;
    assert.equal(await fetch(home,{signal:AbortSignal.timeout(1000)}).then(()=>false,()=>true),true);

    stage='cold offline launch and second song';
    await open(true);
    await page.goto(link,{waitUntil:'commit'});
    let f=await active(page,target);await ready(f);
    assert.equal(new URL(page.url()).searchParams.get('part'),part);
    assert.equal(await page.evaluate(()=>localStorage.getItem('melete:qa-retention')),'prior-device-setting');
    assert.equal(await page.evaluate(async()=>(await caches.match('./keep',{cacheName:'independent-test-cache'})).text()),'untouched');
    assert.equal(await page.evaluate(async()=>fetch('./not-the-score',{cache:'no-store'}).then(()=>false,()=>true)),true);
    stage='record while completely offline';
    await f.evaluate(audioRig,{synthetic:true,hz:220});
    assert.equal(await f.evaluate(()=>MeleteMicrophoneCheck.mediaDevicesFor(window).getUserMedia.name),'syntheticMicrophone');
    await section(f,'practice');
    await f.locator('#pitchCapture[aria-pressed=true][data-state=standby]').waitFor({state:'attached'});
    assert.match(await f.locator('#microphoneCheck').innerText(),/Mic on Play/);
    await seek(f,start);await f.locator('#playPause').click();
    await f.locator('#pitchCapture[data-state=recording]').waitFor({state:'attached'});
    await f.waitForFunction(at=>+document.querySelector('#seek').value>at+2600,start);
    await f.locator('#playPause').click();await section(f,'takes');
    const hear='#compRows .take-row:not(.is-new) .take-hear:not(:disabled)';
    await f.locator(hear).first().waitFor({state:'attached'});
    const before=await stored(f);
    assert.ok(before?.rms>20 && before.trackedSeconds>.1 && before.voiced>=5 && before.contourHash,'expected recorded audio and a readable saved contour');
    await section(f,'practice');await f.locator('#pitchCapture').click();
    await f.locator('#songToggle').click();f=await active(page,songs[0]);await ready(f);
    await f.locator('#songToggle').click();f=await active(page,target);
    await ctx.close();ctx=null;
    stage='second cold offline launch and take replay';
    await open(true);await page.goto(link,{waitUntil:'commit'});f=await active(page,target);await ready(f);
    await f.evaluate(audioRig,{synthetic:true,hz:220});assert.deepEqual(await stored(f),before);
    await section(f,'parts');
    for(const ctl of await f.locator('[data-audio-index]').all()) if(await ctl.getAttribute('aria-pressed')==='true') await ctl.click();
    await section(f,'takes');
    const play=f.locator(hear).first();
    if(await play.getAttribute('aria-pressed')==='true') await play.click();
    const quiet=await level(f,start+300);await play.click();
    await f.waitForFunction(s=>document.querySelector(s)?.getAttribute('aria-pressed')==='true',hear);
    const sound=await level(f,start+300);
    assert.ok(quiet<.0001 && sound>.001,'expected take-only audio after second cold launch: '+[quiet,sound]);
    console.log(JSON.stringify({engine,version:ctx.browser()?.version(),songs:songs.map(s=>s.title),
      damagedInstallRejected:true,brokenUpdateKeptGoodCopy:true,rememberedSingRecordedOnPlay:true,twoBrowserRestarts:true,serverStopped:true,cached,trackedSeconds:before.trackedSeconds,
      identicalPCM:true,identicalContour:true,voicedPoints:before.voiced,mutedPeak:quiet,takeOnlyPeak:sound}));
  } catch(error) {throw new Error(engine+' '+stage+': '+error.stack);}
  finally {
    try {await ctx?.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
    finally {fs.rmSync(tmp,{recursive:true,force:true});}
  }
}
run(process.argv[2]||'webkit',process.argv[3]).catch(e=>{console.error(e);process.exitCode=1;});
