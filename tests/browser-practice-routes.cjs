const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const roleProbe = `
window.__roleQa = {engine, api, get busy() {return Boolean(renderTimer || barRenderFrame || notationRenderInFlight || notationRenderQueued || scoreRenderSnapshot);},
  snapshot() {return {part:practicePartIndex, parts:parts.map(p=>p.name), lyrics:pitchBarLyrics(),
    roles:sequence.practiceRoles || [], reference:takePitchReference({start:0,end:sequence.endTick,rate:1}),
    notes:sequence.notes, playback:(engine.playbackNotes || engine.notes).flatMap(n=>n.segments || [n]),
    visible:[...visibleTracks], fingerprint:pitchTraceFingerprint(), traceKey:pitchTraceKey,
    allReferences:parts.map((_,part)=>takePitchReference({start:0,end:sequence.endTick,rate:1},part)),
    onsets:this.onsets || []};},
  seek(tick) {api.tickPosition=tick;}, onsets:[]};
const roleSchedule=engine.scheduleNote;
engine.scheduleNote=function(note,...args) {const before=this.scheduled.size;const result=roleSchedule.call(this,note,...args);
  if(this.scheduled.size>before) __roleQa.onsets.push({track:note.track,key:note.key,start:note.start});return result;};
`;

async function checkPracticeRoutes(browser, temporary, output) {
  const project = path.join(temporary,'handoff-player');
  execFileSync(process.env.PYTHON || 'python3',[path.resolve(__dirname,'../build_trainer.py'),
    path.join(__dirname,'fixtures/handoffs.musicxml'),'--config',path.join(__dirname,'fixtures/handoffs.config.json'),
    '--project-dir',project],{stdio:'pipe'});
  let html=await fs.readFile(path.join(project,'dist/index.html'),'utf8');
  html=html.replace('engine = new GuideEngine(sequence);','engine = new GuideEngine(sequence);'+roleProbe);
  const report=[];
  for (const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:900},
      isMobile:mobile,hasTouch:mobile,colorScheme:'dark'});
    try {
      await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const settled=()=>page.waitForFunction(()=>window.__roleQa&&!__roleQa.busy&&!document.querySelector('#playPause').disabled);
      await page.goto('http://127.0.0.1:8809/handoff-fixture?part=S2');
      await settled();
      const choir=await page.evaluate(()=>__roleQa.snapshot());
      assert.equal(choir.part,1);
      assert.deepEqual(choir.parts,['Soprano 1','Soprano 2','S2 soloist']);
      const paints=await page.locator('[data-visible-index]').evaluateAll(buttons=>buttons.map(b=>getComputedStyle(b).getPropertyValue('--part-color').trim()));
      assert.equal(new Set(paints).size,3,'fresh singer builds distinguish the solo and both staves');
      assert.ok(paints.every(p=>p.startsWith('oklch(')));
      assert.deepEqual(choir.lyrics.map(l=>l[3]),['Before','Join','shared','hold','Return','after']);
      assert.deepEqual(choir.notes.filter(n=>n[0]===1 && n[1]===3360).map(n=>n[3]),[74]);
      assert.deepEqual(choir.notes.filter(n=>n[0]===2 && n[1]===4800).map(n=>n[3]),[71]);
      assert.notEqual(choir.allReferences[1].fingerprint,choir.allReferences[2].fingerprint);
      // Actual scheduled voices, not only a data assertion.
      await page.evaluate(()=>__roleQa.seek(4800));
      await page.locator('#playPause').click();
      await page.waitForFunction(()=>__roleQa.onsets.some(n=>n.track===2&&n.key===71));
      await page.locator('#playPause').click();
      if (await page.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await page.locator('#settingsToggle').click();
      // Direct link uses the same chooser route as ordinary singer links.
      await page.goto('http://127.0.0.1:8809/handoff-fixture?part=S2%20solo');
      await settled();
      let solo=await page.evaluate(()=>__roleQa.snapshot());
      assert.equal(solo.part,2);
      assert.deepEqual(solo.lyrics.map(l=>l[3]),['Before','Solo','Return','after']);
      assert.equal(solo.playback.find(n=>n.start===0&&n.key===60).track,2);
      await page.reload(); await settled();
      solo=await page.evaluate(()=>__roleQa.snapshot());
      assert.equal(solo.part,2);
      assert.notEqual(solo.traceKey,choir.traceKey);
      assert.equal(await page.locator('#score svg').count()>0,true);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
      assert.equal(overflow,false);
      await page.screenshot({path:path.join(output,`handoffs-${mobile?'mobile':'desktop'}.png`)});
      assert.deepEqual(errors,[]);
      report.push({mobile,chorusPickup:74,soloPickup:71,sharedGuideOnce:true,roleReferencesSeparate:true});
    } finally {await context.close();}
  }
  return report;
}
async function checkSeedRoutes(frame,page,{output,label}) {
  const before=await frame.evaluate(()=>__roleQa.snapshot());
  if (!before.roles.length) {
    assert.equal(before.parts.length,4,'Autumn retains its four original parts');
    return {unchanged:true};
  }
  const role=before.roles[0], {start,end}=role.handoffs[0];
  assert.deepEqual([role.part,role.soloist,start,end],[1,8,234720,251520]);
  const clip=(track)=>before.notes.filter(n=>n[0]===track && n[1]<end && n[2]>start)
    .map(n=>[Math.max(n[1],start),Math.min(n[2],end),n[3],n[4]]);
  assert.deepEqual(clip(1),clip(0),'ordinary S2 follows S1 exactly during the handoff');
  const soloStart=before.notes.find(n=>n[0]===8 && n[1]>=start);
  assert.deepEqual(soloStart.slice(1,4),[237600,237840,69]);
  assert.deepEqual(before.notes.find(n=>n[0]===1&&n[1]===end).slice(1,4),[251520,252480,69]);
  if(!label.includes('mobile')) {
    const original=page.viewportSize();
    await page.setViewportSize({width:1280,height:original.height});
    if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
    await frame.waitForFunction(()=>!__roleQa.busy);
    const layout=await frame.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      return {takeTop:rect('#takePanel').top,practiceTop:rect('.practice-group').top,
        overflow:document.documentElement.scrollWidth>innerWidth,
        scroll:document.querySelector('.mixer-scroll').scrollWidth>rect('.mixer-scroll').width,
        groups:[...document.querySelectorAll('.control-group')].map(el=>({name:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})),
        strip: getComputedStyle(document.querySelector('.settings-strip')).gridTemplateColumns};
    });
    await page.screenshot({path:path.join(output,`handoffs-${label}-1280.png`)});
    assert.equal(layout.takeTop,layout.practiceTop,'the soloist must not add a settings row');
    assert.equal(layout.overflow,false,JSON.stringify(layout));
    assert.equal(layout.scroll,true,'all mixer columns remain accessible within Parts');
    await page.setViewportSize(original);
  }
  const choose=async index=>{
    if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true') await frame.locator('#settingsToggle').click();
    await require('./browser-sing.cjs').choosePart(frame,index);
    await frame.waitForFunction(index=>__roleQa.snapshot().part===index&&!__roleQa.busy,index);
    assert.equal((await frame.evaluate(()=>__roleQa.snapshot())).part,index);
  };
  // Keyboard pager navigation exercises the same route as mouse/touch changes.
  await choose(1);
  const choir=await frame.evaluate(()=>__roleQa.snapshot());
  assert.ok(choir.lyrics.some(l=>l[1]===start && l[3]==='Let'));
  await choose(8);
  let solo=await frame.evaluate(()=>__roleQa.snapshot());
  assert.ok(solo.lyrics.some(l=>l[1]===237600 && l[3]==='Let'));
  assert.notEqual(choir.reference.fingerprint,solo.reference.fingerprint);
  const scoring=await frame.evaluate(()=>{
    const q=__roleQa.snapshot(), start=__roleQa.engine.secondsAtTick(237600);
    const frames=[{start,end:start+.1,cents:6900}];
    return [1,8].map(i=>MeleteTakePitch.scoreFrames(frames,q.allReferences[i],q.allReferences[i].seconds).meanAbsCents);
  });
  assert.equal(scoring[1],0,'soloist A4 is graded against the solo, not the S1 route');
  assert.ok(scoring[0]>0,'chorus and soloist are not interchangeable score targets');
  const scoreTab=frame.getByRole('tab',{name:'Score',exact:true});
  if(await scoreTab.getAttribute('aria-selected')!=='true') await scoreTab.click();
  const visible=frame.locator('[data-visible-index="8"]');
  if(!(await frame.evaluate(()=>__roleQa.snapshot())).visible.includes(8)) await visible.click();
  const state=await frame.evaluate(()=>__roleQa.snapshot());
  for(const i of state.visible) if(i!==8) await frame.locator(`[data-visible-index="${i}"]`).click();
  if(!(await frame.evaluate(()=>__roleQa.snapshot())).visible.includes(8)) await visible.click();
  await frame.waitForFunction(()=>!__roleQa.busy);
  await frame.evaluate(()=>__roleQa.seek(237600));
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__roleQa.onsets.some(n=>n.track===8&&n.key===69));
  await frame.locator('#playPause').click();
  await page.screenshot({path:path.join(output,`handoffs-${label}-score.png`)});
  await frame.getByRole('tab',{name:'Pitchbar',exact:true}).click();
  await frame.waitForFunction(()=>!__roleQa.busy);
  await frame.locator('.bar-measure-number').filter({hasText:/^37$/}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,`handoffs-${label}-pitchbar.png`)});
  await choose(1);
  await scoreTab.click();
  if(!(await frame.evaluate(()=>__roleQa.snapshot())).visible.includes(1)) await frame.locator('[data-visible-index="1"]').click();
  for(const i of (await frame.evaluate(()=>__roleQa.snapshot())).visible) {
    if(i!==1) await frame.locator(`[data-visible-index="${i}"]`).click();
  }
  await frame.waitForFunction(()=>!__roleQa.busy);
  await frame.evaluate(()=>{__roleQa.onsets=[];__roleQa.seek(234720);});
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>__roleQa.onsets.some(n=>n.track===1&&n.key===70));
  await frame.locator('#playPause').click();
  await frame.waitForFunction(()=>!__roleQa.busy);
  // Frame the exact handoff row without capturing the smooth scroll mid-flight.
  await frame.evaluate(()=>{
    const y=__roleQa.api.boundsLookup.findMasterBarByIndex(35).staffSystemBounds.realBounds.y;
    const score=document.querySelector('#score').getBoundingClientRect();
    const toolbar=document.querySelector('.transport').getBoundingClientRect();
    window.scrollTo({top:scrollY+score.top+y-toolbar.bottom-20,behavior:'instant'});
  });
  await page.screenshot({path:path.join(output,`handoffs-${label}-chorus.png`)});
  return {start,end,soloStart:237600,scoring,soloNotes:solo.notes.filter(n=>n[0]===8).length};
}
module.exports={checkPracticeRoutes,checkSeedRoutes,roleProbe};
