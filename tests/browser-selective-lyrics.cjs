const assert = require('node:assert/strict');
const path = require('node:path');

async function checkSelectiveLyrics(page, frame, {mobile = false, output, label = 'lyrics', splitWord, reload} = {}) {
  const ready = () => frame.waitForFunction(() => !(window.__qa || window.__probe)?.busy
    && !document.querySelector('.score-render-snapshot')
    && document.querySelector('#score .lyric-toggle')
    && (document.getElementById('annotationLayout').getAttribute('aria-pressed') === 'true'
      || !document.querySelector('#score .shared-notation-layer')));
  const showSettings = async () => {
    if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
    if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
    if (!(await frame.locator('#annotationLayout').isVisible())) {
      await frame.locator('[data-settings-section="display"] .settings-section-toggle').click();
    }
  };
  const showScore = async () => {
    if (mobile && await frame.locator('#settingsToggle').getAttribute('aria-expanded') === 'true') await frame.locator('#settingsToggle').click();
    await frame.evaluate(() => window.scrollTo(0,0));
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await showSettings();
  const editingInitially = await frame.locator('#lyricEditing').getAttribute('aria-pressed');
  if (editingInitially !== 'true') await frame.locator('#lyricEditing').click();
  if (await frame.locator('#barScore').isVisible()) await frame.locator('#scoreViewToggle').click();
  if (await frame.locator('#annotationLayout').getAttribute('aria-pressed') === 'true') await frame.locator('#annotationLayout').click();
  await ready();
  const first = frame.locator('#score .selective-lyric-source.lyric-toggle').first();
  const id = await first.getAttribute('data-lyric-words');
  const part = await first.getAttribute('data-lyric-parts');
  for (let step=0; step<20 && await frame.locator('#practicePart').getAttribute('data-value') !== part; step++) {
    await frame.locator('#practicePart').press('ArrowDown');
    await frame.waitForFunction(() => !document.getElementById('practicePart').classList.contains('is-paging'));
  }
  assert.equal(await frame.locator('#practicePart').getAttribute('data-value'),part);
  await showScore();
  const selector = `.lyric-toggle[data-lyric-words="${id}"]`;
  const target = frame.locator(`#score ${selector}`).first();
  const text = await target.locator('text').textContent();
  const before = await target.locator('text').boundingBox();
  const playhead = await frame.locator('#seek').inputValue();
  try { await (mobile ? target.tap({timeout:3000}) : target.click({timeout:3000})); }
  catch (error) {
    console.error('Lyric hit area', await target.evaluate(el => ({html:el.outerHTML,box:el.getBoundingClientRect().toJSON(),
      text:el.querySelector('text').getBBox(),transform:el.getAttribute('transform')})));
    if (output) await page.screenshot({path:path.join(output,`selective-lyrics-${label}-failure.png`)});
    throw error;
  }
  assert.equal(await target.getAttribute('aria-pressed'), 'true');
  assert.equal(await target.locator('text').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.deepEqual(await target.locator('text').boundingBox(), before, 'masking never moves a word');
  assert.equal(await frame.locator('#seek').inputValue(), playhead, 'lyric click must not seek');
  assert.equal(await frame.locator('#showAllLyrics').isEnabled(), true);
  if (output) await page.screenshot({path:path.join(output,`selective-lyrics-${label}-hidden.png`)});
  await target.press('Enter');
  assert.equal(await target.getAttribute('aria-pressed'), 'false');
  await target.press('Enter');
  assert.equal(await target.getAttribute('aria-pressed'), 'true');

  await showSettings();
  await frame.locator('#lyricEditing').click();
  assert.equal(await target.getAttribute('aria-disabled'),'true');
  assert.equal(await target.getAttribute('tabindex'),'-1');
  await target.press('Enter');
  assert.equal(await target.getAttribute('aria-pressed'),'true','locking keeps the word hidden and disables editing');

  if (reload) {
    frame = await reload();
    await ready();
    assert.equal(await frame.locator(`#score ${selector}`).first().getAttribute('aria-pressed'), 'true', 'hidden words persist on reload');
    assert.equal(await frame.locator('#lyricEditing').getAttribute('aria-pressed'),'false','word editing lock persists on reload');
  }
  await showSettings();
  await frame.locator('#lyricEditing').click();
  await frame.locator('#scoreViewToggle').click();
  await showScore();
  try { await frame.waitForFunction(() => document.querySelector('#barScore .lyric-toggle'),null,{timeout:5000}); }
  catch(error) {
    console.error('Pitchbar lyric state', await frame.evaluate(() => ({
      part:document.querySelector('#practicePart').dataset.value,
      bars:document.querySelector('#barScore').innerHTML.slice(0,1500),
      view:document.querySelector('#scoreViewToggle').outerHTML,
      lyrics:JSON.parse(document.querySelector('#playback-data').textContent).lyrics.slice(0,4),
    })));
    throw error;
  }
  const bar = frame.locator(`#barScore ${selector}`).first();
  if (!await bar.count()) {
    console.error('Missing mapped pitchbar word', await frame.evaluate(({id,text}) => ({id,text,
      part:document.querySelector('#practicePart').dataset.value,
      words:[...document.querySelectorAll('#barScore .bar-lyric-text')].slice(0,8).map(el=>({text:el.textContent,attr:{...el.dataset},group:el.parentElement.outerHTML.slice(0,600)})),
      prefs:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('prefs'))),
    }),{id,text}));
  }
  assert.equal(await bar.getAttribute('aria-pressed'), 'true', 'same occurrence is hidden in pitchbar');
  await (mobile ? bar.tap() : bar.click());
  assert.equal(await bar.getAttribute('aria-pressed'), 'false');
  await (mobile ? bar.tap() : bar.click());
  await showSettings();
  await frame.locator('#showAllLyrics').click();
  assert.equal(await frame.locator('.lyric-toggle.is-lyric-hidden').count(), 0);
  assert.equal(await frame.locator('#showAllLyrics').isDisabled(), true);
  await frame.locator('#scoreViewToggle').click();
  await ready();
  await showScore();
  assert.equal(await frame.locator(`#score ${selector}`).first().getAttribute('aria-pressed'), 'false');

  const split = splitWord && frame.locator(`#score .lyric-toggle[aria-label="Hide lyric: ${splitWord}"]`);
  if (split) {
    assert.equal(await split.count(),2,'fixture has a two-syllable word');
    await split.first().click();
    assert.equal(await frame.locator('#score .lyric-toggle.is-lyric-hidden').count(), 2, 'both syllables hide together');
    await showSettings();
    await frame.locator('#showAllLyrics').click();
  }
  await showSettings();
  await frame.locator('#annotationLayout').click();
  await ready();
  await showScore();
  const shared = frame.locator('.shared-notation-layer .lyric-toggle');
  const sharedCount = await shared.count();
  if (sharedCount) {
    const members = (await shared.first().getAttribute('data-lyric-words')).split(',');
    await (mobile ? shared.first().tap() : shared.first().click());
    assert.equal(await shared.first().getAttribute('aria-pressed'), 'true');
    const owner = shared.first().locator('..').locator('.shared-owners');
    if (await owner.count()) assert.equal(await owner.evaluate(el => getComputedStyle(el).opacity), '1');
    await showSettings();
    await frame.locator('#annotationLayout').click();
    await ready();
    try { await frame.waitForFunction(ids => ids.every(id => document.querySelector(
      `#score .lyric-toggle.is-lyric-hidden[data-lyric-words="${id}"]`)),members,{timeout:5000}); }
    catch(error) {
      console.error('Shared masks after full notation', await frame.evaluate(ids => ({ids,
        mode:document.querySelector('#annotationLayout').getAttribute('aria-pressed'),
        groups:[...document.querySelectorAll('#score .lyric-toggle.is-lyric-hidden')].map(el=>({ids:el.dataset.lyricWords,text:el.textContent})),
        counts:ids.map(id=>({id,count:document.querySelectorAll(`#score .lyric-toggle[data-lyric-words="${id}"]`).length})),
      }),members));
      throw error;
    }
    for (const id of members) {
      assert.ok(await frame.locator(`#score .lyric-toggle.is-lyric-hidden[data-lyric-words="${id}"]`).count(), 'each shared part keeps its mask in full notation');
    }
    await frame.locator('#showAllLyrics').click();
    await frame.locator('#annotationLayout').click();
    await ready();
  }
  await showSettings();
  await ready();
  if (output) await page.screenshot({path: path.join(output, `selective-lyrics-${label}.png`)});
  if (!mobile) await frame.locator('#annotationLayout').click();
  await ready();
  if (await frame.locator('#lyricEditing').getAttribute('aria-pressed') !== editingInitially) await frame.locator('#lyricEditing').click();
  if (mobile) await frame.locator('#settingsToggle').click();
  return {text, persisted: Boolean(reload), sharedCount, hidden: await frame.locator('.is-lyric-hidden').count()};
}

async function checkLyricNotePriority(page, frame, {mobile=false, part, measure=0, word, output, label='generic'} = {}) {
  const state=await frame.evaluate(()=> (window.__qa||window.__probe).pitchbar.captureSettingsState());
  try {
    await frame.evaluate(({part})=>{
      const q=window.__qa||window.__probe,s=q.pitchbar.captureSettingsState();
      Object.assign(s,{scoreView:'standard',flow:'wrap',vertical:100,horizontal:100,lyricEditing:true,
        lyrics:'full',annotationLayouts:{desktop:'part',mobile:'part'},hiddenLyrics:[]});
      s.visible=s.visible.map((_,i)=>i===(part??Math.min(7,s.visible.length-1)));
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
