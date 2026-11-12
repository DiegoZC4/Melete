const assert = require('node:assert/strict');
const path = require('node:path');

async function checkUiImports(frame,page,{mobile,output,label}) {
  if(await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')!=='true')await frame.locator('#settingsToggle').click();
  const settings=async open=>{
    if((await frame.locator('#settingsToggle').getAttribute('aria-expanded')==='true')!==open)await frame.locator('#settingsToggle').click();
  };
  if(mobile) await settings(false);
  await frame.waitForFunction(()=>document.querySelectorAll('[class*="melete-range-"][data-pitch]').length>=4).catch(async error=>{
    console.error(await frame.evaluate(()=>({ranges:[...document.querySelectorAll('[class*="melete-range-"]')].map(n=>n.outerHTML.slice(0,300)),
      factories:alphaTab.Environment.defaultRenderers.map(f=>({staff:f.staffId,installed:f.meleteRangeInstalled})),
      tracks:(window.__qa||window.__probe).api.score.tracks.map(t=>({index:t.index,name:t.name}))})));
    throw error;
  });
  const ranges=frame.locator('[class*="melete-range-"][data-pitch]');
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  const rangeCount=await ranges.count();
  const note=ranges.first(), hit=note.locator('.range-hit');
  await hit.scrollIntoViewIfNeeded();
  const b=await hit.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
  const before=await frame.evaluate(()=>(window.__qa||window.__probe).engine.currentSeconds());
  await page.mouse.move(x,y);
  if(await note.locator('.hover-notehead').count()!==1) {
    await page.screenshot({path:path.join(output,`range-hit-failure-${label}.png`)});
    console.error({label,b,hit:await frame.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,300),{x,y})});
  }
  assert.equal(await note.locator('.hover-notehead').count(),1,'range hover is visibly grey');
  await page.mouse.down();
  assert.equal(await note.locator('.preview-notehead').count(),1,'held range note is blue');
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.held.size),1);
  await page.mouse.up();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.held.size),0);
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.currentSeconds()),before,'range taps never seek');
  await note.focus(); await page.keyboard.down('Enter');
  assert.equal(await note.locator('.preview-notehead').count(),1);
  await page.keyboard.up('Enter');
  assert.equal(await note.locator('.preview-notehead').count(),0);
  const geometry=await frame.evaluate(()=>{
    const q=window.__qa||window.__probe, bounds=q.api.boundsLookup;
    const beat=bounds.findMasterBarByIndex(0).bars.flatMap(b=>b.beats).find(b=>b.notes?.length);
    const rect=beat.notes[0].noteHeadBounds, origin=document.getElementById('score').getBoundingClientRect();
    return {x:origin.x+rect.x+rect.w/2,y:origin.y+rect.y+rect.h/2};
  });
  await page.mouse.move(geometry.x,geometry.y); await page.mouse.down();
  assert.equal(await frame.locator('#score .preview-notehead').count(),1,'ordinary notation shares blue preview');
  await page.mouse.up();
  await page.screenshot({path:path.join(output,`range-preview-${label}.png`)});
  await settings(true);
  await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>document.querySelector('#barScore .bar-note'));
  if(mobile) await settings(false);
  const bar=frame.locator('#barScore .bar-note').first();await bar.scrollIntoViewIfNeeded();
  const bb=await bar.boundingBox();await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);
  await page.mouse.down(); assert.equal(await frame.locator('#barScore .preview-notehead').count(),1);
  await page.mouse.up(); assert.equal(await frame.locator('#barScore .preview-notehead').count(),0);
  await settings(true);
  await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  await frame.evaluate(()=>{const q=window.__qa||window.__probe;q.api.tickPosition=0;});
  await frame.locator('#loopStart').click();
  await frame.evaluate(()=>{const q=window.__qa||window.__probe;const seq=JSON.parse(document.getElementById('playback-data').textContent);q.api.tickPosition=seq.measures[1][0];});
  await frame.locator('#loopEnd').click();
  const endpoints=await frame.locator('.loop-pill').innerText();
  assert.equal(await frame.locator('#loopToggle').getAttribute('aria-pressed'),'true');
  await frame.locator('#loopToggle').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.hasLoop()),false);
  assert.equal(await frame.locator('.loop-pill').innerText(),endpoints);
  await frame.locator('#loopToggle').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.hasLoop()),true);
  const toggle=await frame.locator('#loopToggle').boundingBox();
  await page.mouse.move(toggle.x+toggle.width/2,toggle.y+toggle.height/2);await page.mouse.down();
  await page.waitForTimeout(850); await page.mouse.up();
  assert.equal(await frame.locator('#loopToggle').isDisabled(),false,'empty loop can be enabled for the whole song');
  await frame.locator('#loopToggle').click();
  assert.equal(await frame.evaluate(()=>(window.__qa||window.__probe).engine.loopStartSeconds),0);
  await frame.locator('#loopToggle').click();
  assert.equal(await frame.locator('#scaleLabel').innerText(),'Scale');
  assert.equal(await frame.locator('#score').isVisible(),true);
  assert.equal(await frame.locator('#barScore').isVisible(),false);
  return {rangeCount,greyHover:true,blueHold:true,rangeDoesNotSeek:true,keyboard:true,pitchbarPreview:true,
    retainedLoop:true,holdClear:true,separateViews:true,mobile};
}
module.exports={checkUiImports};
