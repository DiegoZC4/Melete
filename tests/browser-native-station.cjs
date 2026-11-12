// Explicit hardware test. Uses disposable browser storage, never the user's takes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const {recordingProbe} = require('./browser-loop-recorder.cjs');

async function main() {
  const origin = process.env.NATIVE_STATION_ORIGIN;
  assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/);
  const htmlPath = process.env.NATIVE_STATION_PLAYER;
  assert.ok(htmlPath, 'provide a freshly built player');
  const output = path.resolve(process.env.QA_OUTPUT_DIR || 'qa/native-station');
  await fs.mkdir(output, {recursive:true});
  const hostPage = await (await fetch(origin+'/practice')).text();
  const config = JSON.parse(hostPage.match(/window\.MeleteNativeStationConfig=([^;]+);/)[1]);
  let html = await fs.readFile(htmlPath, 'utf8');
  const marker = 'engine = new GuideEngine(sequence);';
  assert.equal(html.split(marker).length, 2);
  html = html.replace(marker, marker+`window.__qa = {engine, api, ${recordingProbe}
    get mixerIndex(){return practiceMixerIndex();},
    get busy(){return Boolean(renderTimer || barRenderFrame || notationRenderInFlight || notationRenderQueued);}};`);
  html = html.replaceAll('const buffer = await context.startRendering();', 'window.__nativeOfflineContext=context; const buffer = await context.startRendering();');
  const errors = [], report = {player:htmlPath, checks:{}};
  const browser = await chromium.launch({channel:'chrome', headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  try {
    await context.addInitScript(config => {
      window.MeleteNativeStationConfig = config;
      window.__browserMicRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { __browserMicRequests++; throw new Error('Native station must not open browser microphone'); };
    }, config);
    await context.route(origin+'/native-test*', route => route.fulfill({contentType:'text/html', body:html}));
    await context.route('**/station-roster.json', route => route.fulfill({json:{singers:[{name:'Native Test',discord:'native.test',voice:'B2'}]}}));
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type()==='error')console.error(m.text());});
    page.setDefaultTimeout(90000);
    await page.goto(origin+'/native-test?mode=station');
    await page.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
    if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserDismiss').click();
    const singer = page.locator('#stationSinger');
    await singer.click(); await singer.fill('Native Test'); await singer.press('Enter');
    if(await page.locator('#partChooser').isVisible())await page.locator('#partChooserOptions button').last().click();
    await page.waitForFunction(() => __qa.compState);
    assert.equal(await page.evaluate(() => Boolean(__qa.engine.native)), true);
    report.client = await page.evaluate(() => __qa.engine.native.client);
    await page.locator('#pitchCapture').click();
    await page.waitForFunction(() => __qa.recording.pitch === 'armed');
    const calibratedDelay = await page.evaluate(() => __qa.engine.native.state.latency);
    report.checks.noBrowserCapture = await page.evaluate(() => __browserMicRequests === 0);
    assert.equal(report.checks.noBrowserCapture, true);
    await page.evaluate(() => {
      const q=__qa,e=q.engine;
      e.setMetronome(0);
      const n=e.trackStrips.length;
      e.updateMix(new Set([q.mixerIndex]), Array(n).fill(150), Array(n).fill(-100));
      q.api.tickPosition = e.tickAtSeconds(q.compDescriptor.reference.notes[0][0]);
    });
    const startedAt=Date.now();
    await page.locator('#playPause').click();
    await page.waitForFunction(() => __qa.recording.state === 'recording',null,{timeout:120000});
    report.checks.preparationMs=Date.now()-startedAt;
    await page.evaluate(async () => {
      const e=__qa.engine,n=e.trackStrips.length;
      await e.native.mix(new Set([__qa.mixerIndex]),Array(n).fill(200),Array(n).fill(-100));
    });
    await page.waitForFunction(() => __qa.engine.native.frame-__qa.engine.native.startFrame >= 48000*3);
    const moving = await page.evaluate(() => ({position:__qa.engine.currentSeconds(),
      native:__qa.engine.native.state, browserMic:__browserMicRequests, live:__qa.recording.frames?.length}));
    assert.equal(moving.native.fault, null);
    assert.ok(moving.native.frame > 0);
    report.checks.inputPeak = moving.native.peak;
    await page.locator('#playPause').click();
    await page.waitForFunction(() => __qa.recording.state === 'off');
    await page.waitForFunction(() => __qa.recording.takes.some(t => t.finalized));
    await page.waitForFunction(() => __qa.recording.takes.some(t => t.pitchScore));
    report.checks.recording = await page.evaluate(() => __qa.recording.takes.map(t => ({id:t.id,frames:t.frames,
      gap:t.gap,seconds:t.seconds,complete:t.complete,finalized:t.finalized,active:t.active,unsaved:t.unsaved,
      origin:t.origin,trackSlot:t.trackSlot,reference:t.pitchReference,
      timing:t.pitchReference.timing,latency:t.pitchReference.latency,capture:t.captureProfile,pitch:t.pitchScore})));
    assert.ok(report.checks.recording.every(t => !t.gap && t.frames > 48000 && Math.abs(t.latency-calibratedDelay)<1e-7));
    await page.locator('#pitchCapture').click();
    await page.waitForFunction(() => __qa.recording.pitch === 'off');
    await page.evaluate(() => __qa.refreshComp());
    const saved = await (await page.waitForFunction(async () => (await __qa.takeStore.comps(__qa.takeSong)).find(s => s.segments.length)||false, null, {timeout:15000})).jsonValue();
    report.checks.adoption = {slot:saved.descriptor.slot,segments:saved.segments.length};
    await page.locator('#compRows .comp-row').evaluateAll((rows,key) => rows.find(r=>r.dataset.compKey===key).click(), saved.key);
    await page.evaluate(from => __qa.engine.seek(from), saved.segments[0].from);
    await page.locator('#playPause').click();
    await page.waitForFunction(() => __qa.engine.playing);
    await page.waitForFunction(() => __qa.engine.native.assets.recordings);
    await page.evaluate(async () => {
      const e=__qa.engine,n=e.trackStrips.length;
      await e.native.mix(new Set(),Array(n).fill(100),Array(n).fill(0));
    });
    await page.waitForFunction(() => __qa.engine.native.state.outputRms > .00001);
    report.checks.savedAudioRms = await page.evaluate(() => __qa.engine.native.state.outputRms);
    assert.equal(await page.evaluate(() => __qa.engine.native.state.fault), null);
    await page.locator('#playPause').click();
    report.checks.review = true;
    await page.evaluate(() => {const e=__qa.engine;e.setLoop(0,e.tickAtSeconds(1));e.seek(0);});
    await page.locator('#playPause').click();
    await page.waitForFunction(() => __qa.engine.native.state.events.filter(x=>x.kind==='loop').length>=2);
    report.checks.loops = await page.evaluate(() => __qa.engine.native.state.events.filter(x=>x.kind==='loop').map(x=>x.frame));
    assert.equal(report.checks.loops[1]-report.checks.loops[0],48000);
    await page.locator('#playPause').click();
    await page.evaluate(() => {const e=__qa.engine;e.setLoop(null,null);e.setRate(.8);e.seek(0);});
    await page.locator('#playPause').click();
    await page.waitForFunction(() => __qa.engine.native.state.playing && __qa.engine.native.state.rate===.8);
    assert.equal(await page.evaluate(() => __qa.engine.native.state.fault),null);
    await page.locator('#playPause').click();
    report.checks.rate = true;
    if(process.env.NATIVE_CHECK_TIMING==='1') {
      report.checks.calibration = await page.evaluate(() => __qa.engine.native.calibrate());
      assert.ok(report.checks.calibration.seconds>.02 && report.checks.calibration.seconds<.06);
    }
    report.checks.limitedFrames = await page.evaluate(() => __qa.engine.native.state.limitedFrames);
    await page.screenshot({path:path.join(output,'station.png')});
    await page.evaluate(async () => {await __qa.engine.native.close();});
    report.errors = errors;
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output,'result.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } catch(error) {
    report.failure = String(error);
    const page=context.pages()[0];
    report.diagnostic=await page.evaluate(()=>({recording:__qa.recording,notice:document.querySelector('#toast')?.textContent,
      playing:__qa.engine.playing,preparing:__qa.engine.preparing,starting:__qa.engine.starting,
      contextState:__qa.engine.context?.state,nativePreparing:Boolean(__qa.engine.native.preparing),
      offline:window.__nativeOfflineContext && {state:__nativeOfflineContext.state,time:__nativeOfflineContext.currentTime,length:__nativeOfflineContext.length},
      native:__qa.engine.native.state,bridgeError:String(__qa.engine.native.failure||''),assets:__qa.engine.native.assets,
      transfer:__qa.engine.native.transfer})).catch(()=>null);
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    throw error;
  } finally {
    for(const page of context.pages()) await page.evaluate(async () => {await window.__qa?.engine?.native?.close();}).catch(()=>{});
    await context.close(); await browser.close();
    await fs.writeFile(path.join(output,'last-report.json'), JSON.stringify({...report,errors},null,2));
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
