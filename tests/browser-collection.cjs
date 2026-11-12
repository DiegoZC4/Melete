const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const {readCollection, mapCollectionAssets} = require('./collection-fixture.cjs');
const {enableSing,startRecording} = require('./browser-sing.cjs');

async function shown(page, title) {
  const locator = page.locator(`iframe[title="${title} practice score"][aria-hidden="false"]`);
  await locator.waitFor({state:'visible'});
  const frame = await (await locator.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.__collection && !__collection.busy && document.querySelector('#playPause:not(:disabled)')
    && document.querySelector('#score svg, #barScore svg') && document.querySelector('#songToggle, #songSelect'));
  return frame;
}

async function checkCollections(browser, temporary, output) {
  const fixture = await fs.readFile(path.join(__dirname, 'fixtures/shared-regressions.musicxml'), 'utf8');
  const scores = [];
  for (const [index, title] of ['First song', 'Second song', 'Third song'].entries()) {
    const file = path.join(temporary, `song-${index}.musicxml`);
    await fs.writeFile(file, fixture.replace('Shared regression score', title));
    scores.push(file);
  }
  const config = path.join(temporary,'collection-defaults.json');
  await fs.writeFile(config,JSON.stringify({defaults:{practicePart:'Soprano'},conductorScore:{private:'must not ship by default'}}));
  const pdf = Buffer.from('%PDF-1.4\nmanual attachment round-trip fixture\n%%EOF\n');
  const partsPdf = path.join(temporary,'parts.pdf');
  await fs.writeFile(partsPdf,pdf);
  const results = [];
  for (const count of [2,3]) {
    const project = path.join(temporary,`collection-${count}`);
    execFileSync(process.env.PYTHON || 'python3', [path.resolve(__dirname,'../build_trainer.py'),
      ...scores.slice(0,count), '--project-dir',project,'--config',config,'--parts-pdf',partsPdf],{stdio:'pipe'});
    const original = await fs.readFile(path.join(project,'dist/index.html'),'utf8');
    const unpacked = readCollection(original);
    assert.equal(unpacked.songs.length,count);
    assert.equal(Object.values(unpacked.assets).filter(text=>text.includes('engine = new GuideEngine(sequence);')).length,1,
      'one copy of the player runtime in the package');
    const html = mapCollectionAssets(original,text=>text.replace('engine = new GuideEngine(sequence);',
      `engine = new GuideEngine(sequence);
       window.__collection = {engine, get busy(){return Boolean(renderTimer || barRenderFrame || notationRenderInFlight || notationRenderQueued);},
         get song(){return takeSongKey();}, get capture(){return pitchCaptureStream;},
         get recordState(){return takeState;}, get store(){return takeStore;},
         portable:currentPortableState, octave:takeOctave,
         annotate(text){annotations.set('0:0',{tick:0,partIndex:0,text});saveAnnotations();}};`));
    const offline = path.join(temporary,`collection-${count}.html`);
    await fs.writeFile(offline,html);
    for(const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},
        isMobile:mobile,hasTouch:mobile,permissions:['microphone'],colorScheme:'dark'});
      await context.addInitScript(() => {
        const devices = navigator.mediaDevices;
        if (!devices) return;
        window.__collectionMediaCalls = {capture:0, enumerate:0};
        for (const [method, counter] of [['getUserMedia','capture'],['enumerateDevices','enumerate']]) {
          const original = devices[method].bind(devices);
          devices[method] = (...args) => {
            if (window !== window.top) return Promise.reject(new DOMException('srcdoc microphone unavailable', 'NotAllowedError'));
            window.__collectionMediaCalls[counter]++;
            return original(...args);
          };
        }
      });
      const requests=[], errors=[];
      const origin='http://127.0.0.1:8809/multi-song-fixture';
      await context.route('**/*',route=>{
        if(route.request().url().split('?')[0]===origin)return route.fulfill({body:html,contentType:'text/html'});
        requests.push(route.request().url());return route.abort();
      });
      try {
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'?part=B&loop=2-3#second-song');
        let frame=await shown(page,'Second song');
        const secondKey=await frame.evaluate(()=>__collection.song);
        await frame.waitForFunction(()=>document.querySelector('#loopStart').textContent.trim()==='2');
        assert.equal(page.url(),origin+'?song=second-song&part=B&loop=2-3','mixed legacy links become shareable queries');
        assert.equal(await frame.locator('#loopEnd').textContent(),'2','end-exclusive link covers measure 2');
        if(count===3)assert.equal(await page.locator('iframe').count(),1,'larger collections load songs on demand');
        if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
        const practiceGroup=frame.locator('[data-settings-section="practice"] .settings-section-toggle');
        if(await practiceGroup.count()&&await practiceGroup.getAttribute('aria-expanded')==='false')await practiceGroup.click();
        for(let step=0;step<2;step++)await frame.locator('#tempo').press('ArrowDown');
        await frame.locator('#playPause').click();
        await frame.waitForFunction(()=>__collection.engine.playing);
        if(count===2)await frame.locator('#songToggle [aria-selected="true"]').click();
        else await frame.locator('#songSelect').selectOption('0');
        const first=await shown(page,'First song');
        assert.equal(page.url(),origin+'?song=first-song','passage options belong to the linked song only');
        assert.equal(await frame.evaluate(()=>__collection.engine.playing),false,'switching stops old playback');
        assert.equal(await frame.evaluate(()=>__collection.capture?.getAudioTracks().some(t=>t.readyState==='live')||false),false);
        assert.notEqual(await first.evaluate(()=>__collection.song),secondKey);
        assert.equal(await first.locator('#tempo').getAttribute('data-value'),'100','preferences do not bleed between songs');
        await first.evaluate(()=>__collection.annotate('First annotation </script> with a second line\nkeep it'));
        const firstIdentity=await first.evaluate(()=>{window.__instance=crypto.randomUUID();return __instance;});
        if(count===2)await first.locator('#songToggle').click();
        else await first.locator('#songSelect').selectOption('1');
        frame=await shown(page,'Second song');
        const embedded=await frame.evaluate(async()=>{
          const config=JSON.parse(document.getElementById('trainer-config').textContent);
          const bytes=new Uint8Array(await (await fetch(document.getElementById('printParts').href)).arrayBuffer());
          return {pdf:[...bytes],conductor:!!config.conductorScore,extension:!!window.MeleteConductor};
        });
        assert.deepEqual(embedded,{pdf:[...pdf],conductor:false,extension:false},'manual PDF stays embedded, conductor assets do not');
        assert.equal(await frame.locator('#tempo').getAttribute('data-value'),'80');
        await frame.evaluate(()=>{
          __collection.annotate('Second annotation');
          localStorage.setItem(`melete:take-octaves:${__collection.song}`,JSON.stringify({'fixture-cloud-row':-1}));
        });
        assert.equal(await frame.locator('#loopStart').textContent(),'2');
        if(count===2)await frame.locator('#songToggle').click();
        else await frame.locator('#songSelect').selectOption('0');
        frame=await shown(page,'First song');
        assert.equal(await frame.evaluate(()=>__instance),firstIdentity,'visited scores reuse their state');

        // Capture synthetic microphone audio, switch away, then reload. The
        // source song ID and stored PCM must survive the new packaging.
        await enableSing(frame);
        await startRecording(frame);
        await frame.waitForFunction(()=>__collection.recordState==='recording');
        await page.waitForTimeout(650);
        if(count===2)await frame.locator('#songToggle').click();
        else await frame.locator('#songSelect').selectOption('1');
        await shown(page,'Second song');
        await frame.waitForFunction(()=>__collection.recordState==='off');
        const recorded=await frame.evaluate(async()=>{
          const takes=await __collection.store.list(__collection.song);
          const take=takes.at(-1);
          return {id:take?.id,song:__collection.song,bytes:take?(await __collection.store.wav(take.id)).size:0};
        });
        assert.ok(recorded.bytes>44,'switching finalizes the recorded passage');
        const mediaCalls = await page.evaluate(()=>window.__collectionMediaCalls);
        assert.ok(mediaCalls.capture>0 && mediaCalls.enumerate>0,'collection permission and device discovery use the host page');
        assert.equal(await frame.evaluate(()=>__collection.capture?.getAudioTracks().some(t=>t.readyState==='live')||false),false);
        await page.reload();
        frame=await shown(page,'Second song');
        assert.equal(await frame.evaluate(()=>__collection.capture),null,'reload never opens the microphone');
        if(count===2) {
          // Sing stayed on for the first song, which now preloads hidden.
          const hidden=await (await page.locator('iframe[title="First song practice score"]').elementHandle()).contentFrame();
          await hidden.waitForFunction(()=>window.__collection&&document.readyState==='complete'&&document.querySelector('#playPause:not(:disabled)'));
          assert.equal((await page.evaluate(()=>window.__collectionMediaCalls)).capture,0,'a preloaded song never requests the microphone');
        }
        if(count===2)await frame.locator('#songToggle').click();
        else await frame.locator('#songSelect').selectOption('0');
        frame=await shown(page,'First song');
        await frame.waitForFunction(()=>__collection.capture?.getAudioTracks().some(track=>track.readyState==='live'));
        assert.deepEqual(await frame.evaluate(async id=>({song:__collection.song,bytes:(await __collection.store.wav(id)).size}),recorded.id),
          {song:recorded.song,bytes:recorded.bytes});
        await page.screenshot({path:path.join(output,`collection-${count}-${mobile?'mobile':'desktop'}.png`)});
        if(mobile) {
          if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')==='true')await frame.locator('#settingsToggle').click();
          await frame.locator('#score svg, #barScore svg').first().scrollIntoViewIfNeeded();
          assert.ok(await frame.locator('#score svg, #barScore svg').first().isVisible());
          await page.screenshot({path:path.join(output,`collection-${count}-mobile-score.png`)});
        }

        // Open the actual download with file://, offline, and select another
        // song. No original build directory or HTTP server is available there.
        await page.evaluate(()=>{window.showSaveFilePicker=async()=>({createWritable:async()=>({
          write:async blob=>{window.__savedCollection=await blob.text();},close:async()=>{}})});});
        if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
        const tools=frame.locator('[data-settings-section="tools"] .settings-section-toggle');
        if(await tools.count()&&await tools.getAttribute('aria-expanded')==='false')await tools.click();
        await frame.locator('#saveCollection').click();
        await page.waitForFunction(()=>typeof __savedCollection==='string');
        const saved=await page.evaluate(()=>__savedCollection);
        assert.equal(readCollection(saved).songs.length,count);
        const exported=readCollection(saved).songs.map(song=>song.portableState);
        assert.deepEqual(exported.slice(0,2).map(state=>state.annotations.items[0].text),
          ['First annotation </script> with a second line\nkeep it','Second annotation']);
        assert.equal(exported[1].takeOctaves['fixture-cloud-row'],-1);
        assert.ok(exported.every(state=>state.preferences.sing===false),'HTML never transfers microphone consent');
        assert.equal((await page.evaluate(()=>window.__collectionMediaCalls)).capture,1,'export does not open hidden microphones');
        await fs.writeFile(offline,saved);
        await page.unrouteAll({behavior:'wait'});
        await page.route('**/*',route=>{
          if(route.request().url().startsWith('file:'))return route.continue();
          requests.push(route.request().url());return route.abort();
        });
        await page.goto(pathToFileURL(offline).href+'#second-song');
        frame=await shown(page,'Second song');
        assert.equal(page.url(),pathToFileURL(offline).href+'?song=second-song','the local file also keeps a query URL');
        assert.equal(await frame.locator('#tempo').getAttribute('data-value'),'80','current settings survive the download');
        assert.equal(await frame.evaluate(()=>__collection.portable().annotations.items[0].text),'Second annotation');
        assert.equal(await frame.evaluate(()=>__collection.octave('fixture-cloud-row')),-1,'octave choices apply live after import');
        assert.equal(await frame.evaluate(()=>__collection.capture),null);
        if(count===2)await frame.locator('#songToggle').click();
        else await frame.locator('#songSelect').selectOption('2');
        const finalTitle=count===2?'First song':'Third song';
        frame=await shown(page,finalTitle);
        if(count===2)assert.equal(await frame.evaluate(()=>__collection.portable().annotations.items[0].text),
          'First annotation </script> with a second line\nkeep it');
        // Browsers can reload a srcdoc frame independently of its collection.
        // Restore collection controls as well as the ordinary player on load.
        await Promise.all([frame.waitForNavigation({waitUntil:'load'}),frame.evaluate(()=>location.reload())]);
        frame=await shown(page,finalTitle);
        assert.equal(await frame.locator('#saveCollection').count(),1);
        assert.equal(await frame.locator('#songToggle, #songSelect').count(),1);
        if(count===2)await frame.locator('#songToggle').click();
        else await frame.locator('#songSelect').selectOption('1');
        frame=await shown(page,'Second song');
        assert.equal(await frame.locator('#stationPicker').evaluate(picker=>picker.hidden),true,'no station without the parameter');

        // Both spellings have to reach the song frames, find the roster beside the
        // collection page, and survive switching songs.
        const rosterFetches=[];
        await context.route('**/station-roster.json',route=>{rosterFetches.push(route.request().url());
          return route.fulfill({json:{singers:[{name:'DemoA',voice:'Alto'}]}});});
        const station=await context.newPage();station.on('pageerror',e=>errors.push(e.message));
        const oldStation = mobile ? '?station=1#part=B&second-song' : '?station#second-song';
        await station.goto(origin+(count===2?oldStation:'?song=second-song&mode=station'));
        const openStation=async title=>{
          const stationFrame=await shown(station,title);
          if(await stationFrame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await stationFrame.locator('#settingsToggle').click();
          const takes=stationFrame.locator('[data-settings-section="takes"] .settings-section-toggle');
          if(await takes.count()&&await takes.getAttribute('aria-expanded')==='false')await takes.click();
          await stationFrame.locator('#stationPicker').waitFor({state:'visible'});
          await stationFrame.locator('#stationSinger').click();
          await stationFrame.locator('#stationSingerList .station-option',{hasText:'DemoA'}).waitFor({state:'visible'});
          await stationFrame.locator('#stationSinger').press('Escape');
          return stationFrame;
        };
        const stationFrame=await openStation('Second song');
        const linkedAddress = origin+'?song=second-song&mode=station'+(count===2&&mobile?'&part=B':'');
        assert.equal(station.url(),linkedAddress);
        if(count===2)await stationFrame.locator('#songToggle').click();
        else await stationFrame.locator('#songSelect').selectOption('0');
        await openStation('First song');
        assert.equal(station.url(),origin+'?song=first-song&mode=station','a switch keeps the mode');
        await station.goBack();
        await openStation('Second song');
        assert.equal(station.url(),linkedAddress);
        await station.goForward();
        await openStation('First song');
        await station.reload();
        const firstStation=await openStation('First song');
        assert.equal(station.url(),origin+'?song=first-song&mode=station','refresh keeps the exact address');
        const singer=firstStation.locator('#stationSinger');
        await singer.fill('DemoA'); await singer.press('Enter');
        const checkSinger=async frame=>frame.waitForFunction(()=>{
          const row=document.querySelector('#compRows .comp-row:first-child');
          return document.querySelector('#stationSinger').value==='DemoA' && row?.querySelector('.take-part').textContent==='A'
            && row.querySelector('.take-singer').textContent==='DemoA' && row.classList.contains('is-new');
        });
        await checkSinger(firstStation);
        if(count===2)await firstStation.locator('#songToggle').click();
        else await firstStation.locator('#songSelect').selectOption('2');
        const otherStation=await openStation(count===2?'Second song':'Third song');
        await checkSinger(otherStation);
        assert.ok(!station.url().includes('DemoA'),'names are not put in a shareable link');
        await otherStation.locator('#stationSinger').fill('');
        await otherStation.locator('#stationSinger').blur();
        await station.goBack();
        const cleared=await openStation('First song');
        await cleared.waitForFunction(()=>document.querySelector('#stationSinger').value==='' && !document.querySelector('#compRows .is-new'));
        assert.ok(rosterFetches.length&&rosterFetches.every(url=>url==='http://127.0.0.1:8809/station-roster.json'),rosterFetches.join());
        await station.close();
        assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
        results.push({songs:count,mobile,bytes:Buffer.byteLength(original),uniqueAssets:Object.keys(unpacked.assets).length,
          separateSettings:true,recordingSurvivesSwitchAndReload:true,hostMicrophonePermission:true,offlineDownload:true,frameReload:true,stationSingerHandoff:true,errors,requests});
      } finally {await context.close();}
    }
  }
  return results;
}
module.exports={checkCollections};
