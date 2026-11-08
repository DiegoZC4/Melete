const assert = require('node:assert/strict');
const path = require('node:path');

async function checkSelectiveLyrics(page, frame, {mobile = false, output, label = 'lyrics', splitWord, reload} = {}) {
  const ready = () => frame.waitForFunction(() => !(window.__qa || window.__probe)?.busy
    && !document.querySelector('.score-render-snapshot') && document.querySelector('#score .lyric-toggle'));
  const settings = async () => {
    if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
    if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
    if (!await frame.locator('#lyricEditing').isVisible()) await frame.locator('[data-settings-section="display"] .settings-section-toggle').click();
  };
  const showScore = async () => {
    if (mobile && await frame.locator('#settingsToggle').getAttribute('aria-expanded') === 'true') await frame.locator('#settingsToggle').click();
    await frame.evaluate(() => window.scrollTo(0,0));
  };
  const reset = async () => {
    await settings();
    if (mobile) {
      const box=await frame.locator('#lyricEditing').boundingBox();
      const touch=await page.context().newCDPSession(page);
      try {
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
        await page.waitForTimeout(750);
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } finally {await touch.detach();}
    } else await frame.locator('#lyricEditing').click({button:'right'});
  };
  await settings();
  assert.equal(await frame.locator('#annotationLayout,#showAllLyrics').count(),0);
  await require('./browser-sing.cjs').choosePart(frame);
  if (await frame.locator('#barScore').isVisible()) await frame.locator('#scoreViewToggle').click();
  if (await frame.locator('#lyricEditing').getAttribute('aria-pressed') !== 'true') await frame.locator('#lyricEditing').click();
  await ready();await showScore();
  const first=frame.locator('#score .lyric-toggle').filter({visible:true}).first();
  const ids=await first.getAttribute('data-lyric-words'), selector=`.lyric-toggle[data-lyric-words="${ids}"]`;
  const before=await first.locator('text').boundingBox(),position=await frame.locator('#seek').inputValue();
  await first.click();
  assert.equal(await first.getAttribute('aria-pressed'),'true');
  assert.deepEqual(await first.locator('text').boundingBox(),before);
  assert.equal(await frame.locator('#seek').inputValue(),position);
  await first.press('Enter');assert.equal(await first.getAttribute('aria-pressed'),'false');
  await first.press('Enter');
  await settings();await frame.locator('#lyricEditing').click();
  assert.equal(await first.getAttribute('aria-disabled'),'true');
  if(reload) {frame=await reload();await ready();assert.equal(await frame.locator('#score '+selector).first().getAttribute('aria-pressed'),'true');}
  await reset();assert.equal(await frame.locator('.lyric-toggle.is-lyric-hidden').count(),0);
  const editState=await frame.locator('#lyricEditing').getAttribute('aria-pressed');
  await reset();
  assert.ok(await frame.locator('.lyric-toggle.is-lyric-hidden').count()>0);
  assert.equal(await frame.locator('#lyricEditing').getAttribute('aria-pressed'),editState,'hold/context action does not toggle the editing tool');
  await reset();
  if(editState!=='true') await frame.locator('#lyricEditing').click();
  await frame.locator('#scoreViewToggle').click();
  await frame.waitForFunction(()=>document.querySelector('#barScore .lyric-toggle'));
  await showScore();
  const bar=frame.locator('#barScore .lyric-toggle').first();await bar.click();
  assert.equal(await bar.getAttribute('aria-pressed'),'true');
  await reset();assert.equal(await frame.locator('.lyric-toggle.is-lyric-hidden').count(),0);
  await frame.locator('#scoreViewToggle').click();await ready();
  if(output)await page.screenshot({path:path.join(output,`selective-lyrics-${label}.png`)});
  return {compactAlways:true,hideAndRestore:true,globalHideShow:true,persistent:true,gesturePreservesTool:true,mobile};
}

async function checkLyricNotePriority(page, frame, {mobile=false, part, measure=0, word, output, label='generic'} = {}) {
  const state=await frame.evaluate(()=> (window.__qa||window.__probe).pitchbar.captureSettingsState());
  try {
    await frame.evaluate(({part})=>{
      const q=window.__qa||window.__probe,s=q.pitchbar.captureSettingsState();
      Object.assign(s,{scoreView:'standard',flow:'wrap',vertical:100,horizontal:100,lyricEditing:true,
        lyrics:'full',annotationLayouts:{desktop:'part',mobile:'part'},hiddenLyrics:[]});
      s.visible=s.visible.map((_,i)=>i===(part??Math.min(7,s.visible.length-1)));
      delete s.visibleChannels;
      q.pitchbar.applySettingsState(s);
    },{part});
    await frame.waitForTimeout(500);
    await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy && !document.querySelector('.score-render-snapshot')
      && document.querySelector('#score .lyric-toggle') && !document.querySelector('#score .shared-notation-layer'));
    if(await frame.locator('#settingsToggle').getAttribute('aria-expanded')==='true') await frame.locator('#settingsToggle').click();
    const target=await frame.evaluate(({measure,word})=>{
      const q=window.__qa||window.__probe,lookup=q.api.boundsLookup;
      const master=lookup.findMasterBarByIndex(measure), notes=[];
      for(const bar of master.bars)for(const beat of bar.beats) {
        if(!beat.beat.lyrics?.some(t=>t && (!word||t===word)))continue;
        for(const n of beat.notes||[])notes.push({key:n.note.realValue,box:n.noteHeadBounds,text:word||beat.beat.lyrics.find(Boolean)});
      }
      notes.sort((a,b)=>a.key-b.key);
      if(!notes.length)throw Error('No lyric note in target measure');
      const n=notes[0],o=document.getElementById('score').getBoundingClientRect();
      window.scrollTo(0,scrollY+o.top+n.box.y-240);
      return n;
    },{measure,word});
    await frame.waitForFunction(target=>{
      const o=document.getElementById('score').getBoundingClientRect();
      const x=o.left+target.box.x+target.box.w/2,y=o.top+target.box.y+target.box.h/2;
      return [...document.querySelectorAll('#score .lyric-toggle text')].some(e=>{
        const b=e.getBoundingClientRect();
        return e.textContent===target.text && Math.hypot(b.x+b.width/2-x,b.y+b.height/2-y)<80;
      });
    },target);
    const initial=await frame.evaluate(target=>{
      const q=window.__qa||window.__probe,o=document.getElementById('score').getBoundingClientRect();
      const x=o.left+target.box.x+target.box.w/2,y=o.top+target.box.y+target.box.h/2;
      const groups=[...document.querySelectorAll('#score .lyric-toggle')].filter(e=>e.querySelector('text')?.textContent===target.text);
      groups.sort((a,b)=>Math.hypot(a.getBoundingClientRect().x-x,a.getBoundingClientRect().y-y)
        -Math.hypot(b.getBoundingClientRect().x-x,b.getBoundingClientRect().y-y));
      const group=groups[0],hit=group.querySelector('.lyric-toggle-hit'),text=group.querySelector('text');
      const padTop=+hit.getAttribute('y')-text.getBBox().y;
      window.__lyricHitProof={group,hit,original:{x:hit.getAttribute('x'),y:hit.getAttribute('y')},calls:[],releases:0,hold:q.engine.holdNote};
      q.engine.holdNote=(key,track)=>{__lyricHitProof.calls.push({key,track});return {release(){__lyricHitProof.releases++;}};};
      return {padTop,point:{x,y},key:target.key};
    },target);
    assert.ok(initial.padTop>=-.01,'lyric padding never grows above the word');
    const pointer=async(point)=>{
      const offset=frame===page?{x:0,y:0}:await (await frame.frameElement()).boundingBox();
      if(mobile) await page.touchscreen.tap(point.x+offset.x,point.y+offset.y);
      else {await page.mouse.move(point.x+offset.x,point.y+offset.y);await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();}
    };
    await pointer(initial.point);
    const proof=()=>frame.evaluate(()=>({calls:__lyricHitProof.calls,releases:__lyricHitProof.releases,
      hidden:(window.__qa||window.__probe).pitchbar.captureSettingsState().hiddenLyrics}));
    let actual=await proof();
    assert.ok(actual.calls.some(n=>n.key===initial.key),'clicking the low note auditions its pitch');
    assert.equal(actual.releases,actual.calls.length);
    assert.deepEqual(actual.hidden,[],'clicking a note cannot hide its lyric');

    // Force an overlap to protect against future engraving/font changes, too.
    const overlap=await frame.evaluate(target=>{
      const o=document.getElementById('score').getBoundingClientRect(),x=o.left+target.box.x+target.box.w/2,y=o.top+target.box.y+target.box.h/2;
      // Seeking may replace lazy-mounted score SVGs; use the current lyric node.
      const groups=[...document.querySelectorAll('#score .lyric-toggle')].filter(e=>e.querySelector('text')?.textContent===target.text);
      groups.sort((a,b)=>Math.hypot(a.getBoundingClientRect().x-x,a.getBoundingClientRect().y-y)
        -Math.hypot(b.getBoundingClientRect().x-x,b.getBoundingClientRect().y-y));
      const group=groups[0],hit=group.querySelector('.lyric-toggle-hit');
      Object.assign(__lyricHitProof,{group,hit,original:{x:hit.getAttribute('x'),y:hit.getAttribute('y')}});
      const p=new DOMPoint(x,y).matrixTransform(__lyricHitProof.hit.getScreenCTM().inverse());
      __lyricHitProof.hit.setAttribute('x',String(p.x-4));
      __lyricHitProof.hit.setAttribute('y',String(p.y-4));
      return {x,y,intercepts:document.elementFromPoint(x,y)?.closest('.lyric-toggle')===__lyricHitProof.group,
        connected:group.isConnected,groupBox:group.getBoundingClientRect().toJSON(),
        target:document.elementFromPoint(x,y)?.outerHTML.slice(0,300)};
    },target);
    assert.equal(overlap.intercepts,true,`fixture reproduces the original competing lyric hit target: ${JSON.stringify(overlap)}`);
    await pointer(overlap);
    actual=await proof();
    assert.equal(actual.calls.length,2,'a direct note still wins an overlapping lyric target');
    assert.deepEqual(actual.hidden,[]);
    await frame.evaluate(()=>Object.entries(__lyricHitProof.original).forEach(([k,v])=>__lyricHitProof.hit.setAttribute(k,v)));
    if(output) await page.screenshot({path:path.join(output,`lyric-note-priority-${label}.png`)});
    return {measure:measure+1,word:target.text,part:part??null,actualNote:initial.key,noteWins:true,downwardPadding:true};
  } finally {
    await frame.evaluate(state=>{
      const q=window.__qa||window.__probe;
      if(window.__lyricHitProof){q.engine.holdNote=__lyricHitProof.hold;Object.entries(__lyricHitProof.original).forEach(([k,v])=>__lyricHitProof.hit.setAttribute(k,v));delete window.__lyricHitProof;}
      q.pitchbar.applySettingsState(state);
    },state);
    await frame.waitForFunction(()=>!(window.__qa||window.__probe).busy);
  }
}

module.exports = {checkSelectiveLyrics,checkLyricNotePriority};
