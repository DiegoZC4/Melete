const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {wavBytes} = require('../template/loop_recorder.js');
const {timing} = require('../template/reference_audio.js');
const {expandSettingsFixture} = require('./browser-settings-sections.cjs');

async function checkHomeTransport(browser,html) {
  const origin='http://127.0.0.1:8809/transport-fixture';
  for(const [platform,touch,installed,embedded,clearance] of [
    ['MacIntel',5,true,false,32],['MacIntel',5,true,true,32],['iPad',5,true,true,32],
    ['MacIntel',5,false,true,0],['MacIntel',0,true,false,0],['iPhone',5,true,false,0]
  ]){
    const context=await browser.newContext({viewport:{width:1032,height:1344},hasTouch:!!touch});
    try{
      // Match WebKit on the physical iPad: display-mode is browser, navigator.standalone is true.
      await context.addInitScript(({platform,touch,installed})=>{
        for(const [key,value] of Object.entries({platform,maxTouchPoints:touch,standalone:installed}))
          Object.defineProperty(navigator,key,{configurable:true,get:()=>value});
      },{platform,touch,installed});
      await context.route(origin,r=>r.fulfill({contentType:'text/html',body:embedded?
        '<style>*{margin:0}iframe{border:0;width:100%;height:100dvh}</style><iframe></iframe>':html}));
      const page=await context.newPage();await page.goto(origin);
      if(embedded)await page.locator('iframe').evaluate((f,src)=>{f.srcdoc=src;},html);
      const frame=embedded?page.frames().find(f=>f.parentFrame()):page;
      await frame.waitForSelector('#playPause:not(:disabled)');
      if(await frame.locator('#partChooser').isVisible())await frame.locator('#partChooserDismiss').click();
      for(const theme of ['dark','light']){
        await page.emulateMedia({colorScheme:theme});
        const result=await frame.evaluate(()=>{
          const header=document.querySelector('.transport'),row=header.querySelector('.transport-primary');
          const seek=document.querySelector('#seek'),r=seek.getBoundingClientRect(),s=getComputedStyle(header);
          return {pad:parseFloat(getComputedStyle(row).paddingTop),color:s.backgroundColor,filter:s.backdropFilter,
            y:document.querySelector('#playPause').getBoundingClientRect().top,
            hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===seek};
        });
        assert.equal(result.pad,6+clearance,JSON.stringify({platform,touch,installed,embedded,theme,result}));
        assert.ok(result.y>=clearance&&result.hit,'safe-area padding must precede, not cover, the usable playbar');
        assert.match(result.color,/^rgb\(/,'the sticky surface is opaque');
        assert.equal(result.filter,'none');
      }
    } finally {await context.close();}
  }
}

async function checkGeometry(frame, width) {
  const geometry = await frame.evaluate(() => {
    const box = e => {const {left,top,right,bottom,width} = e.getBoundingClientRect();return {left,top,right,bottom,width};};
    const q = s => document.querySelector(s), scroller = q('.mixer-scroll');
    scroller.scrollLeft = scroller.scrollWidth;
    const rect = box(scroller);
    const refs = ['.reference-heading','.reference-hear','.reference-volume','.reference-pan'].map(s => {
      const e = q(s), r = box(e), hit = document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
      return {r, hit: !!hit && (hit === e || e.contains(hit))};
    });
    scroller.scrollLeft = 0;
    return {rect,refs,strip:box(q('.settings-strip')),parts:box(q('.parts-group')),practice:box(q('.practice-group')),
      display:box(q('.display-group')),tools:box(q('.tools-group')),scroll:scroller.scrollWidth-scroller.clientWidth,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  const details=JSON.stringify({width,...geometry});
  assert.ok(geometry.strip.width >= width-2 && geometry.overflow <= 1, 'use the viewport without page overflow: '+details);
  assert.ok(geometry.refs.every(({r,hit}) => r.width>0 && r.left>=geometry.rect.left-1 &&
    r.right<=geometry.rect.right+1 && hit), 'all four Ref cells must be reachable and not covered: '+details);
  if(width>=768){
    assert.ok(geometry.scroll<=1, 'nine parts and Ref should fit without scrolling on a tablet');
    assert.ok(Math.abs(geometry.parts.top-geometry.practice.top)<2, 'Parts and Practice belong on the same row');
    if(width>=1024)for(const panel of [geometry.display,geometry.tools])
      assert.ok(Math.abs(geometry.parts.top-panel.top)<2, 'all four settings groups fit side by side');
  }
  return {width, mixerOverflow:geometry.scroll, refReachable:true};
}

async function checkTabletSettings(browser,temporary) {
  const names=['S1','S2','S2 solo','A1','A2','T1','T2','B1','B2'];
  const score=path.join(temporary,'tablet.musicxml'), project=path.join(temporary,'tablet-player');
  const config=path.join(temporary,'tablet-reference.json'), prefix=['python3',path.join(__dirname,'../build_trainer.py'),score,'--project-dir',project];
  await fs.writeFile(score,'<score-partwise version="3.1"><part-list>'+names.map((name,i)=>
    `<score-part id="P${i}"><part-name>${name}</part-name></score-part>`).join('')+'</part-list>'+names.map((_,i)=>
    `<part id="P${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`).join('')+'</score-partwise>');
  const build = args => execFileSync(process.env.PYTHON||prefix[0], [...prefix.slice(1),...args], {stdio:'pipe'});
  build([]);
  const sequence=JSON.parse(await fs.readFile(path.join(project,'assets/playback.json'),'utf8'));
  await fs.writeFile(config,JSON.stringify({referenceAudio:{label:'Reference',mime:'audio/wav',
    data:Buffer.from(wavBytes(new Int16Array(16000),8000)).toString('base64'),timing:timing(sequence)}}));
  build(['--config',config]);
  const html=await fs.readFile(path.join(project,'dist/index.html'),'utf8');
  await checkHomeTransport(browser,html);
  assert.doesNotMatch(html,/id="vowel(?:Toggle|Panel)"|#vowelPanel|function makeEstimator\(/,'release has no embedded vowel panel or estimator');
  const result=[];
  const context=await browser.newContext({viewport:{width:1032,height:1244},isMobile:true,hasTouch:true});
  try {
    await expandSettingsFixture(context);
    const url='http://127.0.0.1:8809/tablet-settings-fixture';
    await context.route(url,r=>r.fulfill({contentType:'text/html',body:html}));
    const p=await context.newPage();await p.goto(url);await p.waitForSelector('#playPause:not(:disabled)');
    if(await p.locator('#partChooser').isVisible())await p.locator('#partChooserDismiss').click();
    if(await p.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await p.locator('#settingsToggle').click();
    assert.equal(await p.locator('.mixer [data-visible-index]').count(),9);
    for(const width of [1032,1244,768,600,393,320]){
      await p.setViewportSize({width,height:width>1100?850:1244});
      await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      // Score engraving also resizes asynchronously when rotating a tablet.
      await p.waitForFunction(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,
        null,{timeout:5000}).catch(()=>{});
      result.push(await checkGeometry(p,width));
    }
  }finally{await context.close();}
  return result;
}
module.exports={checkTabletSettings,checkGeometry};
