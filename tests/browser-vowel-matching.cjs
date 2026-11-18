// Run against the built, offline two-song preview. Every take is synthetic in a disposable context.
const assert=require('node:assert/strict');
const path=require('node:path'), fs=require('node:fs/promises'), {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {choosePart,enableSing}=require('./browser-sing.cjs');
const {vowels,vowelPCM}=require('./vowel-fixture.cjs');
const {observeFrames,checkChart}=require('./browser-vowel-chart.cjs');

function signals() {
  const signals={};
  for (const [name,formants] of Object.entries({...vowels,repeat:[395,900]})) {
    signals[name]=Array.from(vowelPCM(formants,125,48000,.16).slice(-3072));
  }
  signals.high=Array.from(vowelPCM(vowels.ah,500).slice(-3072));
  for (const pitch of [100,200]) {
    signals['octave'+pitch]=Array.from(vowelPCM([700,1800],pitch,48000,.3).slice(-4800));
  }
  signals.ground=Array.from(vowelPCM(vowels.ah,125,48000,2.7,{start:1.15,duration:.75,formants:vowels.oo}));
  signals.silence=Array(3072).fill(0);
  let state=96725, last=0;
  signals.noise=Array.from({length:8192},()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const v=state/2**32-.5, out=.25*(v-last); last=v;return out;
  });
  return signals;
}
function installVirtualMic(waves) {
  // Obtain Chrome's virtual device via the application's real permission path.
  // Feed controllable fixtures through a MediaStream into its existing capture graph.
  if (window===window.top) {
    let context, destination, current, name='oo', calls=0;
    function sing(next) {
      name=next;
      if (!destination) return;
      if (current) {current.stop(); current.disconnect();}
      const pcm=waves[name], buffer=context.createBuffer(1,pcm.length,48000);
      buffer.copyToChannel(Float32Array.from(pcm),0);
      current=context.createBufferSource(); current.buffer=buffer; current.loop=true;
      current.connect(destination); current.start();
    }
    window.vowelLab={sing,get calls(){return calls;},async acquire() {
      calls++;
      context ||= new AudioContext({sampleRate:48000});
      await context.resume();
      destination=context.createMediaStreamDestination(); sing(name);
      return destination.stream;
    }};
  }
  if (navigator.mediaDevices) {
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const fake=await original(constraints);
      fake.getTracks().forEach(track=>track.stop());
      return window.top.vowelLab.acquire();
    };
  }
  const original=URL.createObjectURL.bind(URL);
  window.vowelWorkerCount=0;
  URL.createObjectURL=blob=>{
    if (blob.type==='text/javascript') void blob.slice(0,35).text().then(text=>{
      if (text.startsWith('const estimate = (')) window.vowelWorkerCount++;
    });
    return original(blob);
  };
}

async function shown(page,title) {
  const frameEl=page.locator('iframe[title="'+title+' practice score"][aria-hidden="false"]');
  await frameEl.waitFor({state:'visible'});
  const frame=await (await frameEl.elementHandle()).contentFrame();
  await frame.waitForFunction(()=>!document.querySelector('#playPause').disabled && document.querySelector('#songToggle'));
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
  for(const area of ['parts','practice','display']) {
    const fold=frame.locator('[data-settings-section="'+area+'"] .settings-section-toggle');
    if(await fold.isVisible() && await fold.getAttribute('aria-expanded')==='false') await fold.click();
  }
  await choosePart(frame,0);
  await observeFrames(frame);
  return frame;
}
const sing=(page,name)=>page.evaluate(name=>vowelLab.sing(name),name);
const calls=page=>page.evaluate(()=>vowelLab.calls);
const toggle=frame=>frame.locator('#vowelToggle').click();
const pin=frame=>frame.locator('#vowelPin').click();
const dot=frame=>frame.locator('#vowelDot');
const waitDot=(frame,visible)=>frame.waitForFunction(value=>document.getElementById('vowelDot').getAttribute('visibility')===value,visible?'visible':'hidden',{timeout:6500});
async function waitRecording(frame) {
  try { await frame.waitForFunction(()=>document.getElementById('pitchCapture').dataset.state==='recording'); }
  catch(error) {
    console.error('Recording UI at timeout:',await frame.evaluate(()=>({
      sing:document.getElementById('pitchCapture').outerHTML,
      play:document.getElementById('playPause').outerHTML,
      status:document.getElementById('takeStatus')?.textContent,
    })));
    throw error;
  }
}
const mixerState=frame=>frame.locator('#mixer button').evaluateAll(buttons=>buttons.map(b=>
  [b.getAttribute('aria-pressed'),b.getAttribute('data-value')]));
async function stable(frame) {
  await frame.waitForFunction(()=>document.querySelectorAll('#vowelTrail path').length>=5 && document.getElementById('vowelHz').textContent.length>0);
}

async function checkOctave(page,frame) {
  const dots=[];
  for (const pitch of [100,200]) {
    await sing(page,'silence'); await waitDot(frame,false);
    await sing(page,'octave'+pitch);
    await frame.waitForFunction(()=>document.getElementById('vowelHz').textContent==='F1 700 Hz · F2 1800 Hz',
      null,{timeout:6500});
    dots.push(await dot(frame).evaluate(d=>[Number(d.getAttribute('cx')),Number(d.getAttribute('cy'))]));
  }
  assert.deepEqual(dots[0],dots[1]);
  return {inputPitchHz:[100,200],formantsHz:[700,1800],identicalSvgPoint:dots[0]};
}

async function main() {
  if (!process.argv[2]) throw Error('Pass the path to the Autumn and The Seed preview HTML.');
  const file=path.resolve(process.argv[2]), output=process.argv[3] && path.resolve(process.argv[3]);
  const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL || undefined,headless:true,
    args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
  require('./browser-silent-output.cjs').useSilentOutput(browser);
  const context=await browser.newContext({viewport:{width:1280,height:800},permissions:['microphone']});
  const errors=[],external=[], report={};
  try {
    if(output) await fs.mkdir(output,{recursive:true});
    await context.addInitScript(installVirtualMic,signals());
    await context.route(/^https?:/,route=>{external.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    const autumn=await shown(page,'Autumn');
    const initialMix=await mixerState(autumn);
    assert.equal(await autumn.locator('#vowelToggle').getAttribute('aria-pressed'),'false');
    assert.equal(await autumn.locator('#vowelPanel').isHidden(),true);
    await autumn.locator('#playPause').click();
    await autumn.waitForFunction(()=>Number(document.getElementById('seek').value)>200);
    await toggle(autumn);
    assert.equal(await calls(page),0);
    assert.equal(await autumn.locator('#vowelPin').isDisabled(),true);
    assert.equal(await autumn.locator('#pitchCapture').getAttribute('aria-pressed'),'false');
    assert.equal(await autumn.evaluate(()=>vowelWorkerCount),0);
    await toggle(autumn);
    assert.notEqual(await autumn.locator('#playPause').getAttribute('aria-label'),'Play score');
    await autumn.locator('#playPause').click();
    await toggle(autumn);
    await autumn.locator('#pitchCapture').click();
    await waitDot(autumn,true); await stable(autumn);
    assert.equal(await calls(page),1);
    await pin(autumn); await page.waitForTimeout(1100); await pin(autumn);
    await autumn.locator('#vowelReference .vowel-region').waitFor();
    const ooGuide=await autumn.locator('#vowelReference .vowel-region').getAttribute('x');
    const firstWidth=Number(await autumn.locator('#vowelReference .vowel-region').getAttribute('width'));
    const ooHz=await autumn.locator('#vowelHz').textContent();
    assert.match(await autumn.locator('#vowelGuide').textContent(),/One example/);
    await sing(page,'repeat'); await page.waitForTimeout(330); await pin(autumn);
    await page.waitForTimeout(1100); await pin(autumn);
    assert.match(await autumn.locator('#vowelGuide').textContent(),/2 examples/);
    assert.ok(Number(await autumn.locator('#vowelReference .vowel-region').getAttribute('width'))>firstWidth);
    assert.deepEqual(await mixerState(autumn),initialMix);
    const autumnChart=await checkChart(autumn);
    if(output) await autumn.locator('#vowelPanel').screenshot({path:path.join(output,'Autumn.png')});
    await sing(page,'silence'); await waitDot(autumn,false);
    await autumn.waitForFunction(()=>[...document.querySelectorAll('#vowelTrail path')].some(p=>Number(p.getAttribute('opacity'))<.75));
    await autumn.waitForFunction(()=>!document.querySelector('#vowelTrail *'),null,{timeout:4500});
    assert.equal(await autumn.locator('#vowelReference .vowel-region').count(),1);
    await pin(autumn); await page.waitForTimeout(450); await pin(autumn);
    assert.match(await autumn.locator('#vowelGuide').textContent(),/No steady middle/);
    assert.equal(await autumn.locator('#vowelReference .vowel-region').count(),1);
    await sing(page,'oo'); await waitDot(autumn,true);
    for(const signal of ['silence','noise','high']) {
      await sing(page,signal); await waitDot(autumn,false);
      await page.waitForTimeout(300);
      assert.equal(await dot(autumn).getAttribute('visibility'),'hidden',signal);
      assert.equal(await autumn.locator('#vowelHz').textContent(),'');
      await sing(page,'oo'); await waitDot(autumn,true);
    }
    // Force a long spatial jump across silence and inspect every live line segment.
    await sing(page,'silence'); await waitDot(autumn,false); await sing(page,'ee'); await waitDot(autumn,true);
    await autumn.waitForFunction(()=>Number(document.querySelector('#vowelDot').getAttribute('cx'))<150);
    const noBridge=await autumn.locator('#vowelTrail path').evaluateAll(paths=>paths.every(path=>{
      const x=path.getAttribute('d').match(/[ML]([\d.]+)/g).map(s=>Number(s.slice(1)));
      return x.length<2 || Math.abs(x[0]-x[1])<60;
    }));
    assert.ok(noBridge,'no straight bridge across silence');
    assert.ok(await autumn.locator('#vowelTrail path[opacity]').count()>0);
    const autumnOctave=await checkOctave(page,autumn);
    await choosePart(autumn,1);
    await autumn.waitForFunction(()=>!document.querySelector('#vowelReference .vowel-region'));
    await choosePart(autumn,0);
    await autumn.locator('#vowelReference .vowel-region').waitFor();
    await toggle(autumn); // Ordinary pitch/audio recording starts with the chart off.
    if (await autumn.locator('#loopToggle').getAttribute('aria-pressed')==='true') await autumn.locator('#loopToggle').click();
    await sing(page,'oo');
    // Changing the selected part disarms the previous singer's capture.
    await enableSing(autumn);
    await autumn.locator('#playPause').click();
    await waitRecording(autumn);
    const before=Number(await autumn.locator('#seek').inputValue());
    await page.waitForTimeout(500); await toggle(autumn); await waitDot(autumn,true);
    await toggle(autumn);
    assert.equal(await autumn.locator('#pitchCapture').getAttribute('data-state'),'recording');
    assert.ok(Number(await autumn.locator('#seek').inputValue())>before+200);
    assert.equal(await calls(page),1);
    await autumn.locator('#pitchCapture').click();
    if(await autumn.locator('#playPause').getAttribute('aria-label')!=='Play score') await autumn.locator('#playPause').click();
    const saved=await autumn.waitForFunction(async()=>{
      const slug=JSON.parse(document.getElementById('trainer-config').textContent).slug;
      window.vowelTestStore ||= new MeleteRecording.TakeStore();
      const take=(await window.vowelTestStore.list(slug)).find(t=>t.finalized && t.frames>0 && t.pitchContour && t.pitchScore);
      if (!take) return false;
      return {frames:take.frames,rate:take.sampleRate,hasReference:Boolean(take.pitchReference),containsVowelData:/vowel|formant/i.test(JSON.stringify(take))};
    },null,{timeout:20000,polling:160});
    const ordinaryTake=await saved.jsonValue();
    assert.ok(ordinaryTake.frames>ordinaryTake.rate*.25 && ordinaryTake.hasReference);
    assert.equal(ordinaryTake.containsVowelData,false);
    report.Autumn={chart:autumnChart,octave:autumnOctave,held:ooHz,examples:2,uncertain:['silence','noise','high pitch'],noBridge,sharedMicCalls:1,ordinaryTake};

    await autumn.locator('#melete-song-the-seed').click();
    const seed=await shown(page,'The Seed');
    assert.equal(await seed.locator('#vowelPanel').isHidden(),true);
    await toggle(seed);
    assert.equal(await seed.locator('#vowelReference .vowel-region').count(),0);
    const beforeSeed=await calls(page);
    await sing(page,'ah'); await seed.locator('#pitchCapture').click(); await waitDot(seed,true);
    await pin(seed); await sing(page,'ground'); await page.waitForTimeout(2350);
    await sing(page,'noise'); await waitDot(seed,false); await pin(seed);
    const target=seed.locator('#vowelReference .vowel-region');await target.waitFor();
    assert.ok(Math.abs(Number(await target.getAttribute('x'))-Number(ooGuide))>20);
    const stampCount=await seed.locator('#vowelReference .vowel-beat').count();
    assert.ok(stampCount>=4);
    const span=await seed.locator('#vowelReference path').evaluateAll(paths=>Math.max(...paths.map(p=>p.getBBox().height)));
    assert.ok(span>30,'moving closure retained, path height '+span);
    await sing(page,'ah'); await waitDot(seed,true); await stable(seed);
    const seedChart=await checkChart(seed);
    if(output) await seed.locator('#vowelPanel').screenshot({path:path.join(output,'The Seed.png')});
    const seedOctave=await checkOctave(page,seed);
    await seed.locator('#vowelClear').click(); assert.equal(await target.count(),0);
    for(const signal of ['silence','high']) {
      await sing(page,signal); await waitDot(seed,false);
      await page.waitForTimeout(300);
      assert.equal(await dot(seed).getAttribute('visibility'),'hidden',signal);
      await sing(page,'ah'); await waitDot(seed,true);
    }
    if(await seed.locator('#loopToggle').getAttribute('aria-pressed')==='true') await seed.locator('#loopToggle').click();
    await enableSing(seed);
    await seed.locator('#playPause').click();
    await waitRecording(seed);
    await toggle(seed); await toggle(seed); await waitDot(seed,true);
    assert.equal(await seed.locator('#pitchCapture').getAttribute('data-state'),'recording');
    assert.equal(await calls(page),beforeSeed+1);
    report['The Seed']={chart:seedChart,octave:seedOctave,movingPathHeight:Math.round(span),quarterSecondMarkers:stampCount,independentGuide:true,
      uncertain:['silence','noise','high pitch'],recordingContinued:true};
    await seed.locator('#pitchCapture').click();
    if(await seed.locator('#playPause').getAttribute('aria-label')!=='Play score') await seed.locator('#playPause').click();
    await seed.locator('#melete-song-autumn').click();
    const back=await shown(page,'Autumn');
    assert.equal(await back.locator('#vowelPanel').isHidden(),true);
    await toggle(back);assert.match(await back.locator('#vowelGuide').textContent(),/2 examples/);
    await page.reload();const fresh=await shown(page,'Autumn');
    assert.equal(await fresh.locator('#vowelPanel').isHidden(),true);
    await toggle(fresh); assert.equal(await fresh.locator('#vowelReference').locator('*').count(),0);
    await page.setViewportSize({width:390,height:740});
    const compact=await fresh.locator('#vowelPanel').boundingBox();
    assert.ok(compact && compact.x>=0 && compact.x+compact.width<=390 && compact.y>=0 && compact.y+compact.height<=740);
    await fresh.locator('#vowelClose').click();
    assert.equal(await fresh.locator('#vowelToggle').getAttribute('aria-pressed'),'false');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({passed:true,report,browserErrors:errors,networkRequests:external},null,2));
  } finally {await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
