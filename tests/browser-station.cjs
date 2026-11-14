const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {choosePart, toggleRecording} = require('./browser-sing.cjs');
const {checkTakeColumnLayout} = require('./browser-take-column-layout.cjs');

const ROSTER = {singers: [{name: 'DemoA', voice: 'Alto'}, {name: 'DemoZ', voice: 'Alto'}, {name: 'DemoB (AliasB)', voice: 'Bass'},
  {name: 'DemoS', voice: 'Soprano'}, {name: 'DemoN', voice: ''}, {name: 'Loop Fixture', voice: ''}]};

const slot = page => page.evaluate(() => __qa.compState?.descriptor.slot || null);
const rows = page => page.locator('#compRows .comp-row').evaluateAll(list => list.map(row => ({
  singer: row.querySelector('.take-singer').textContent, part: MeleteStation.stageLabel(String(JSON.parse(row.dataset.compKey).at(-1)).split(':')[2]) || row.querySelector('.take-part').textContent,
  mean: row.querySelector('.comp-mean').textContent, median: row.querySelector('.comp-median').textContent, armed: row.classList.contains('is-armed'),
  upload: !row.querySelector('.take-upload').hidden})));
const cents = value => value === '\u2014' ? value : Math.round(Number(value));
const stage = page => page.evaluate(() => MeleteStation.stageLabel(__qa.compState?.descriptor.station?.stage));

// A finished, scored recording, as a real one lands in the armed track.
const seed = (page, error, legacyFinal = false, performer = null) => page.evaluate(async ({error, legacyFinal,performer}) => {
  const q = __qa, d = q.compDescriptor, rate = d.reference.rate;
  const from = d.reference.notes[0][0], to = Math.min(from + 8, d.reference.seconds);
  const start = q.engine.tickAtSeconds(from * rate), end = q.engine.tickAtSeconds(to * rate);
  const ref = q.pitchReference({start, end, rate}); ref.latency = 0;
  const sampleRate = 8000, frames = Math.ceil(ref.seconds * sampleRate), id = crypto.randomUUID();
  window.__stationCreated = Math.max(Date.now(), (window.__stationCreated || 0) + 1);
  const take = await q.takeStore.append({id, song: q.takeSong, createdAt: window.__stationCreated, sampleRate, replaces: true,...(performer?{performer}:{}),
    ...(legacyFinal ? {station:{...q.compState.descriptor.station, stage:'final'}, trackSlot:'station:demoa:final'}
      : {trackSlot: q.compState.descriptor.slot || null}), part: d.label, rate, start, end, pitchReference: ref},
  0, new Int16Array(frames), {finalized: true, complete: true});
  const contour = Array.from({length: Math.ceil(frames / 80)}, (_, i) => {
    const from = i / 100, to = Math.min((i + 1) / 100, frames / sampleRate);
    const note = ref.notes.find(n => n[0] <= from && n[1] > from);
    return {start: from, end: to, cents: note ? note[2][0] * 100 + error : null};
  });
  await q.takeStore.pitchScore(id, frames, ref, MeleteTakePitch.scoreFrames(contour, ref, frames / sampleRate), MeleteTakePitch.packContour(contour, take));
  await q.reloadTakes(); await q.refreshComp();
}, {error, legacyFinal,performer});

async function open(page, address) {
  await page.goto(address);
  await page.waitForFunction(() => window.__qa && !__qa.busy && document.querySelector('#playPause:not(:disabled)'));
  if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserDismiss').click();
  if (!await page.locator('#stationSinger').inputValue()) await choosePart(page, 0);
  const toggle = page.locator('[data-settings-section="takes"] .settings-section-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.waitForFunction(() => __qa.compState);
  await page.evaluate(() => __qa.refreshComp());
}

// Seeded takes skip the recorder; this one goes through the microphone path.
async function record(page) {
  await page.evaluate(() => {
    const q = __qa, reference = q.compDescriptor.reference, note = reference.notes[Math.floor(reference.notes.length / 3)];
    q.engine.pauseTransport();
    q.api.tickPosition = q.engine.tickAtSeconds((note[0] + (note[1] - note[0]) * .37) * reference.rate);
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'recording');
  await page.waitForFunction(() => {
    const take = __qa.recording.takes.find(item => item.active);
    return __qa.recording.state === 'recording' && take?.seconds > take.leadInSeconds + 1.2;
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off');
  const take = await page.evaluate(() => __qa.recording.takes.at(-1));
  await page.waitForFunction(id => __qa.recording.takes.find(item => item.id === id)?.pitchScore, take.id, {timeout: 30000});
  await page.evaluate(() => __qa.refreshComp());
  return take;
}

async function pick(page, text) {
  await page.locator('#stationSinger').click();
  await page.locator('#stationSinger').fill(text);
  await page.locator('#stationSinger').press('Enter');
  if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserOptions button').first().click();
  await page.evaluate(() => __qa.refreshComp());
}

async function checkStation(newContext, origin, html, {output, label, mobile, errors}) {
  let geometry;
  const context = await newContext(mobile);
  const served = html.replace('cloudConfig: config.cloud || {}', "cloudConfig: {api: '/melete/api.php'}");
  assert.notEqual(served, html, 'cloud fixture patch applied');
  await context.route(address => address.href.split('?')[0] === origin, route => route.fulfill({contentType: 'text/html', body: served}));
  await context.route('**/station-roster.json', route => route.fulfill({json: ROSTER}));
  await context.route('**/melete/api.php*', route => route.fulfill({json: {}}));
  try {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));

    await open(page, origin);
    assert.equal(await page.locator('#stationExport').isVisible(), false, 'ordinary visitors see no station');
    const panelHeight = () => page.locator('.take-layout').evaluate(el => el.getBoundingClientRect().height);
    const ordinaryHeight = await panelHeight();
    assert.equal(await page.locator('[data-take-sort="singer"]').isVisible(), false);

    await open(page, `${origin}?station`);
    assert.equal(await page.locator('#stationPicker').isVisible(), true);
    assert.equal(await page.locator('[data-take-sort="singer"]').isVisible(), true);
    assert.equal(await page.locator('#stationStage, #stationBar, #stationNewSinger').count(), 0);
    assert.equal(await panelHeight(), ordinaryHeight, 'station does not add a row to Record');
    assert.equal(await page.locator('label[for="stationSinger"]').innerText(), 'Singer');
    assert.ok(await page.locator('#takeActions #stationExport').isVisible());
    assert.ok(await page.locator('.comp-columns #downloadMix').isVisible());

    const input = page.locator('#stationSinger');
    await input.click();
    await page.locator('#stationSingerList .station-option').first().waitFor();
    assert.equal(await page.locator('#stationSingerList .station-option').count(), ROSTER.singers.length);
    await input.pressSequentially('alto ');
    assert.equal(await page.evaluate(() => __qa.engine.playing), false, 'Space stays in the search field');
    assert.deepEqual(await page.locator('#stationSingerList .station-option span:last-child').allTextContents(), ['DemoA', 'DemoZ']);
    assert.deepEqual(await page.locator('#stationSingerList .station-option span:first-child').allTextContents(), ['A', 'A']);
    const uncovered = await page.locator('#stationSingerList .station-option').evaluateAll(options => options.every(option => {
      const box = option.getBoundingClientRect();
      return option.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }));
    assert.equal(uncovered, true, 'the list is drawn above the page, not clipped');
    await page.screenshot({path: path.join(output, `station-picker-${label}.png`)});
    await input.press('Escape');
    assert.equal(await input.inputValue(), '', 'Escape leaves nobody chosen');
    assert.equal(await slot(page), null);

    await input.click();
    await input.fill('aliasb');
    assert.deepEqual(await page.locator('#stationSingerList .station-option span:last-child').allTextContents(), ['DemoB (AliasB)']);
    await input.fill('bass');
    assert.deepEqual(await page.locator('#stationSingerList .station-option span:first-child').allTextContents(), ['B']);
    await input.fill('');
    await input.press('Escape');

    // With an empty field, clicking or tapping must commit before blur; an
    // active keyboard option must take precedence over the empty search.
    await input.click();
    const firstOption = page.getByRole('option', {name:'Alto, DemoA',exact:true});
    if (mobile) await firstOption.tap(); else await firstOption.click();
    await page.evaluate(() => __qa.refreshComp());
    assert.equal(await input.inputValue(), 'DemoA');
    assert.equal(await slot(page), 'station:demoa:start');
    await input.fill(''); await input.blur();
    await input.click(); await input.press('ArrowDown'); await input.press('ArrowDown'); await input.press('Enter');
    await page.evaluate(() => __qa.refreshComp());
    assert.equal(await input.inputValue(), 'DemoA');
    assert.equal(await page.locator('#stationSingerList').isVisible(), false);
    assert.equal(await stage(page), 'Start');
    assert.equal(await slot(page), 'station:demoa:start');
    assert.deepEqual((await rows(page)).filter(row => row.armed).map(row => [row.singer, row.part]), [['DemoA', 'Start']]);

    await seed(page, 30);
    assert.equal(await stage(page), 'Scratchpad', 'a landed Start take protects the baseline');
    assert.equal(await slot(page), 'station:demoa:scratchpad');
    await seed(page, 20);
    await seed(page, 10);
    await seed(page, 12, true);
    assert.equal(await stage(page), 'Scratchpad', 'an imported Final remains reviewable without arming it');

    await page.locator('#pitchCapture').click();
    assert.equal(await page.locator('#pitchCapture').getAttribute('data-state'),'armed');
    await input.fill('demoz');
    await page.getByRole('option', {name: 'Alto, DemoZ', exact:true}).click();
    await page.evaluate(() => __qa.refreshComp());
    assert.equal(await stage(page), 'Start');
    assert.equal(await page.locator('#pitchCapture').getAttribute('aria-pressed'),'false','two singers in the same section do not share audio consent');
    assert.equal(await page.evaluate(()=>__qa.engine.playing),false);
    await page.locator('#pitchCapture').click();
    await seed(page, 40);
    await pick(page, 'demoa');
    assert.equal(await stage(page), 'Scratchpad', 'returning singers resume after Start');
    await pick(page, 'Guest Singer');
    assert.equal(await slot(page), 'station:demoa:scratchpad', 'a name outside the directory cannot create a singer');
    assert.deepEqual((await rows(page)).filter(row => row.armed).map(row => row.singer), ['DemoA']);
    await pick(page, 'DemoZ');

    await page.locator('[data-take-sort="singer"]').click();
    await page.waitForFunction(() => document.querySelector('[data-take-sort="singer"]').dataset.sorted);
    assert.deepEqual((await rows(page)).map(row => [row.singer, row.part, cents(row.mean), row.median]), [['DemoZ', 'Scratchpad', '—', '—'], ['DemoA', 'Start', 30, '30.0'],
      ['DemoA', 'Scratchpad', 10, '10.0'], ['DemoA', 'Final', 12, '12.0'], ['DemoZ', 'Start', 40, '40.0']]);
    assert.equal(await page.locator('#compRows .comp-row:first-child .take-part').innerText(),'A');
    assert.equal(await page.locator('[data-take-sort="stage"],.take-stage').count(),0);

    // Listening to someone else must never redirect the next recording.
    const armedBefore = await slot(page);
    const recorded=page.locator('#compRows .comp-row:not(.is-new)').first();
    await recorded.locator('.comp-review').click();
    await page.waitForFunction(() => document.querySelector('#compRows .comp-row:not(.is-new) .comp-review').getAttribute('aria-pressed') === 'true');
    assert.equal(await slot(page), armedBefore);
    assert.equal(await input.inputValue(), 'DemoZ');
    await recorded.locator('.comp-review').click();

    assert.equal((await rows(page)).some(row => row.upload), false, 'named tracks never offer upload');
    const toggle = page.locator('#expandTakes'), fieldMenu = page.locator('#takeFieldMenu');
    const scrollRegion = page.locator('.take-review');
    const dimensions=()=>scrollRegion.evaluate(el=>({height:el.clientHeight, width:el.clientWidth, top:el.getBoundingClientRect().top-el.closest('#takePanel').getBoundingClientRect().top}));
    const compact = await dimensions();
    await toggle.click();
    await page.waitForFunction(h=>document.querySelector('.take-review').clientHeight>h,compact.height);
    const opened=await dimensions();
    assert.equal(opened.width,compact.width); assert.equal(opened.top,compact.top);
    assert.ok(await scrollRegion.evaluate(el=>el.clientHeight<innerHeight*.55 && !document.querySelector('dialog[open]')), 'table grows downwards in place');
    assert.equal(await slot(page), armedBefore);
    const fields = page.locator('#takeFields');
    await fields.click(); await page.locator('#allTakeFields').click(); await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'),'true','dismissing fields leaves the table expanded');
    assert.ok(!await fieldMenu.isVisible());
    const heading = await page.locator('#compView').evaluate(view => {
      const box = node => node.getBoundingClientRect(), head = view.querySelector('.take-singer-heading'), cell = view.querySelector('.take-singer');
      return [box(head).left - box(cell).left, box(head).width - box(cell).width, cell.scrollWidth - cell.clientWidth];
    });
    assert.deepEqual(heading.map(value => Math.abs(value) < 1), [true, true, true], 'Singer heading and cells share one column');
    geometry = await checkTakeColumnLayout(page, page, recorded, {output, label: `station-${label}`});
    await fields.click(); await fieldMenu.getByLabel('Created', {exact:true}).uncheck();
    await fieldMenu.getByLabel('Median (\u00a2)', {exact:true}).uncheck();
    await page.keyboard.press('Escape');
    assert.ok(!await page.locator('#compView .take-created').first().isVisible());
    assert.ok(!await page.locator('#compView [data-take-sort="median"]').isVisible());
    await scrollRegion.evaluate(el=>{el.scrollLeft=0;});
    await page.screenshot({path:path.join(output,`station-expanded-${label}.png`)});
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await page.locator('.take-review-pane > .take-table-workspace .take-review').waitFor({state:'visible'});
    assert.ok(Math.abs((await scrollRegion.boundingBox()).height - compact.height) < 1);
    await page.locator('.take-review').evaluate(node => { node.scrollLeft = 0; });
    await page.locator('.take-review').screenshot({path: path.join(output, `station-table-${label}.png`)});

    await input.click();
    await input.fill('');
    await input.blur();
    await page.evaluate(() => __qa.refreshComp());
    assert.equal(await slot(page), null, 'clearing the field returns to the ordinary track');

    // Each singer keeps manual adjustments; a newcomer gets their assigned guide.
    assert.equal(await page.locator('[data-settings-section="practice"] #stationPicker').count(), 1, 'the picker is a practice setting');
    // It fills Practice's free third row, so station mode adds no height.
    const placed = await page.evaluate(() => Object.fromEntries(['.practice-metronome-volume', '#stationPicker', '#loopControls']
      .map(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return [selector, {top: box.top, bottom: box.bottom}]; })));
    assert.ok(placed['#stationPicker'].bottom > placed['#stationPicker'].top
      && placed['#stationPicker'].top >= placed['.practice-metronome-volume'].bottom
      && placed['#stationPicker'].bottom <= placed['#loopControls'].top, `the picker sits between Vol and the loop: ${JSON.stringify(placed)}`);
    const mix = () => page.evaluate(() => {
      const state = __qa.pitchbar.captureSettingsState();
      return {tempo: state.tempo, audible: state.audible, volumes: state.volumes, pans: state.pans};
    });
    const atTempo = (tab, tempo) => tab.waitForFunction(expected => __qa.pitchbar.captureSettingsState().tempo === expected, tempo);
    const ordinary = await mix(), last = ordinary.volumes.length - 1;
    await pick(page, 'demoa');
    const initialA=await mix(); assert.deepEqual(initialA.volumes,[35,150,35]); assert.deepEqual(initialA.pans,[-35,100,-35]);
    await page.locator(`[data-volume-index="${last}"]`).press('ArrowUp');
    await page.locator(`[data-pan-index="${last}"]`).press('ArrowRight');
    await page.locator('[data-audio-index="0"]').click();
    await page.locator('#tempo').press('ArrowDown');
    const plain = await context.newPage();
    try {
      await open(plain, origin);
      await atTempo(plain, ordinary.tempo);
      await page.bringToFront();
      await page.locator('#tempo').press('ArrowDown');
      await plain.reload();
      await plain.waitForFunction(() => window.__qa && document.querySelector('#playPause:not(:disabled)'));
      await atTempo(plain, ordinary.tempo);
    } finally { await plain.close(); }
    const demoa = await mix();
    assert.deepEqual([demoa.tempo < ordinary.tempo, demoa.volumes[last] > initialA.volumes[last], demoa.pans[last] > initialA.pans[last],
      demoa.audible[0] !== initialA.audible[0]], [true, true, true, true], JSON.stringify({ordinary, demoa}));
    await pick(page, 'DemoS');
    assert.deepEqual((await mix()).volumes,[150,35,demoa.volumes[last]]); assert.deepEqual((await mix()).pans,[100,-35,demoa.pans[last]]);
    await page.locator(`[data-pan-index="${last}"]`).press('ArrowLeft');
    const demos = await mix();
    await pick(page, 'demoa');
    assert.deepEqual(await mix(), {...demoa,pans:[...demoa.pans.slice(0,last),demos.pans[last]]}, 'tempo belongs to the singer; a backing edit belongs to the mix');
    await pick(page, 'DemoS');
    assert.deepEqual(await mix(), demos);
    await open(page, origin);
    await atTempo(page, ordinary.tempo);
    assert.deepEqual(await mix(), ordinary, 'the plain page plays the ordinary mix');
    await open(page, `${origin}?station`);
    await atTempo(page, demos.tempo);
    assert.ok(!await page.locator('#compView [data-take-sort="created"]').isVisible(), 'column prefs survive reload');
    assert.equal(await input.inputValue(), 'DemoS');
    assert.deepEqual(await mix(), demos, 'a reload keeps the chosen singer\'s mix');
    await input.click();
    await input.fill('');
    await input.blur();
    await page.evaluate(() => __qa.refreshComp());
    assert.deepEqual(await mix(), ordinary, 'clearing the singer puts the ordinary mix back');

    // Without the parameter: nothing lost, nothing new can reach a named track.
    const saved = (await rows(page)).filter(row => row.singer !== '—' && row.mean !== '—');
    await open(page, origin);
    assert.equal(await page.locator('[data-take-sort="singer"]').isVisible(), true, 'the column is a one-way valve');
    assert.equal(await page.locator('#stationExport').isVisible(), true);
    assert.equal(await page.locator('#stationPicker').isVisible(), false);
    assert.equal(await page.locator('#stationStage').count(), 0);
    assert.deepEqual((await rows(page)).filter(row => row.singer !== '—'), saved);
    await page.locator('#compRows .comp-row', {hasText: 'DemoA'}).first().locator('.comp-review').click();
    await page.waitForFunction(() => document.querySelector('#compRows .comp-row.is-selected, #compRows .comp-review[aria-pressed="true"]'));
    assert.equal(await slot(page), null, 'reviewing a named track does not arm it');
    await seed(page, 25);
    const after = await rows(page);
    assert.deepEqual(after.filter(row => row.singer !== '—'), saved, 'new recordings leave named tracks alone');
    assert.deepEqual(after.filter(row => row.singer === '—').map(row => [cents(row.mean), row.upload]), [[25, true]]);

    const exported = async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#stationExport').click()]);
      assert.match(download.suggestedFilename(), /-summary-stats-\d{4}-\d{2}-\d{2}\.csv$/u);
      const [header, ...lines] = (await fs.readFile(await download.path(), 'utf8')).trim().split('\r\n').map(line => line.split(','));
      return lines.map(line => Object.fromEntries(header.map((name, index) => [name, line[index]])));
    };
    const table = await exported();
    assert.deepEqual(table.map(row => [row.singer, row.voice_part, row.stage, Math.round(Number(row.mean_cents))]), [
      ['DemoA', 'Alto', 'Start', 30], ['DemoA', 'Alto', 'Scratchpad', 10], ['DemoA', 'Alto', 'Final', 12],
      ['DemoZ', 'Alto', 'Start', 40], ['', '', '', 25]]);
    assert.equal(table[1].recordings, '2');
    assert.equal(table.every(row => row.bars && Number(row.tracked_of_passage_percent) >= Number(row.tracked_percent) && row.created), true);

    if (!mobile) {
      await page.evaluate(() => { __qa.engine.setRate(.75); return __qa.refreshComp(); });
      assert.equal((await rows(page)).some(row => row.singer === 'DemoA'), false, 'the table shows one speed');
      await seed(page, 15);
      assert.deepEqual((await exported()).map(row => row.speed_percent).sort(), ['100', '100', '100', '100', '100', '75'], 'the export covers every speed');
    }

    await open(page, `${origin}?station`);
    await pick(page,'DemoZ');
    const newRow=page.locator('#compRows .comp-row.is-new').first();
    if (mobile) { await newRow.locator('.edit-take-singer').tap(); await newRow.locator('.edit-take-singer').tap(); }
    else await newRow.locator('.edit-take-singer').dblclick();
    await page.locator('#takeSingerName').fill('DemoS');
    await page.locator('#takeSingerDialog button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#compRows .comp-row:first-child .take-singer')?.textContent==='DemoS');
    assert.deepEqual(await page.locator('[data-visible-index][aria-pressed=true]').allTextContents(),['S']);
    await pick(page,'DemoZ');
    const capture=async(who,source)=>page.evaluate(async({who,source})=>{
      const q=__qa, store=q.takeStore, states=await store.comps(q.takeSong), takes=await store.list(q.takeSong);
      const state=states.find(s=>s.descriptor.station?.id===who && s.descriptor.station.stage==='start' && s.segments.length &&
        (!source || s.segments.some(v=>v.takeId===source)));
      if (!state) return null;
      const take=takes.find(t=>t.id===state.segments[0].takeId);
      const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).join('.');
      return {oldKey:state.key,id:take.id,audio:await digest(await (await store.wav(take.id)).arrayBuffer()),
        contour:await digest(take.pitchContour.pitches), score:take.pitchScore,ref:state.descriptor.reference,created:take.createdAt,
        segments:state.segments,owner:take.station?.id,slot:take.trackSlot,history:(await store.compHistory(q.takeSong)).past.map(e=>e.key)};
    },{who,source});
    const before=await capture('demoz'), other=await capture('demoa');
    const oldRow=page.locator(`#compRows [data-comp-key=${JSON.stringify(before.oldKey)}]`);
    await oldRow.locator('.edit-take-singer').dblclick();
    assert.match(await page.locator('#takeSingerPart').innerText(),/ · A$/);
    await page.locator('#takeSingerName').fill('DemoA');
    await page.locator('#takeSingerDialog button[type=submit]').click();
    await page.locator('#takeSingerDialog').waitFor({state:'hidden'});
    const afterCredit=await capture('demoa',before.id);
    assert.equal(afterCredit.owner,'demoa'); assert.match(afterCredit.slot,/^station:demoa:start:/);
    for(const k of ['audio','contour','score','ref','created','segments']) assert.deepEqual(afterCredit[k],before[k],k);
    assert.equal((await capture('demoa',other.id)).oldKey,other.oldKey,'an existing baseline is never overwritten');
    assert.ok(!afterCredit.history.includes(before.oldKey) && afterCredit.history.includes(afterCredit.oldKey),'Undo follows the recredited track');
    await open(page,`${origin}?station`);
    assert.ok((await capture('demoa',before.id)) && !await capture('demoz',before.id),'correction survives reload');
    await pick(page, 'DemoN');
    assert.equal(await stage(page), 'Start');
    assert.equal((await record(page)).trackSlot, 'station:demon:start', 'a real recording lands on the chosen track');
    assert.equal(await stage(page), 'Scratchpad');
    assert.equal((await record(page)).trackSlot, 'station:demon:scratchpad');
    assert.equal(await stage(page), 'Scratchpad', 'Scratchpad stays put for repeated comping');
    await page.waitForFunction(()=>__qa.recording.takes.filter(t=>t.station?.id==='demon' && t.pitchScore?.trackedSeconds>0).length>=2);
    await page.evaluate(()=>__qa.refreshComp());
    assert.deepEqual((await rows(page)).filter(row => row.singer === 'DemoN' && row.mean !== '—').map(row => row.part).sort(), ['Scratchpad','Start'],
      JSON.stringify(await page.evaluate(()=>__qa.recording.takes.filter(t=>t.station?.id==='demon').map(t=>[t.trackSlot,t.start,t.end,t.pitchScore?.trackedSeconds]))));
    await open(page, `${origin}?station&loop=1-2`);
    await pick(page, 'Loop Fixture');
    await page.waitForFunction(() => __qa.engine.hasLoop());
    await toggleRecording(page);
    await page.waitForFunction(() => __qa.recording.takes.filter(t => t.station?.id === 'loop-fixture'
      && t.complete && t.finalized).length >= 2, null, {timeout:30000});
    await toggleRecording(page);
    await page.waitForFunction(() => __qa.recording.takes.filter(t => t.station?.id === 'loop-fixture'
      && t.complete && t.pitchScore?.trackedSeconds > 0).length >= 2, null, {timeout:30000});
    await page.evaluate(() => __qa.refreshComp());
    const loop = await page.evaluate(async () => {
      const passes = __qa.recording.takes.filter(t => t.station?.id === 'loop-fixture' && t.complete);
      const states = await __qa.takeStore.comps(__qa.takeSong);
      const plays = stage => [...new Set(states.find(s => s.descriptor.slot === 'station:loop-fixture:' + stage)
        ?.segments.map(s => s.takeId))];
      return {first:passes[0].id, later:passes.slice(1).map(t=>t.id), start:plays('start'), scratch:plays('scratchpad')};
    });
    assert.deepEqual(loop.start, [loop.first], 'Start still plays only the first recorded source');
    assert.ok(loop.scratch.length && loop.scratch.every(id => loop.later.includes(id)), 'later passes play from Scratchpad');
    assert.equal(await stage(page), 'Scratchpad');
    await page.locator('#tempo').press('ArrowDown');
    const savedTempo = await page.locator('#tempo').getAttribute('data-value');
    await page.goto(`${origin}?station&part=Alto`);
    await page.waitForFunction(() => window.__qa?.recording.ready && document.querySelector('#playPause:not(:disabled)'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    assert.deepEqual(await page.locator('[data-visible-index][aria-pressed="true"]').evaluateAll(nodes => nodes.map(n=>n.dataset.visibleIndex)), ['1'],
      'an explicit linked part wins over a returning singer\'s previously saved See row');
    assert.equal(await page.locator('#tempo').getAttribute('data-value'), savedTempo, 'the linked part still gets the singer\'s saved tempo');
    await page.close();
  } finally { await context.close(); }

  // One visit with the parameter keeps the column on, even with no named data.
  const fresh = await newContext(mobile);
  await fresh.route('**/station-roster.json', route => route.fulfill({status: 404}));
  try {
    const page = await fresh.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await open(page, `${origin}?station`);
    await open(page, origin);
    assert.equal(await page.locator('[data-take-sort="singer"]').isVisible(), true);
    assert.equal(await page.locator('#stationPicker').isVisible(), false);
    await open(page,origin+'?part=Alto');
    await seed(page,12,false,{id:'demo-archive',name:'Demo Archive'});
    const personal=page.locator('#compRows .comp-row').filter({hasText:'Demo Archive'});
    assert.equal(await personal.count(),1);
    const stableKey=await personal.getAttribute('data-comp-key');
    await open(page,origin+'?station&part=Alto');
    await personal.locator('.edit-take-singer').dblclick();
    await page.locator('#takeSingerName').fill('Demo Corrected');
    await page.locator('#takeSingerDialog button[type=submit]').click();
    assert.equal(await page.locator('#takeSingerDialog').isVisible(),true,'missing directory cannot create a singer');
    assert.match(await page.locator('#takeSingerName').evaluate(el=>el.validationMessage),/directory/);
    await page.keyboard.press('Escape');
    await fresh.route('**/station-roster.json', route => route.fulfill({json:{singers:[{name:'Demo Corrected',discord:'corrected'}]}}));
    await open(page,origin+'?station&part=Alto');
    await personal.locator('.edit-take-singer').dblclick();
    await page.locator('#takeSingerName').fill('@corrected');
    await page.locator('#takeSingerDialog button[type=submit]').click();
    await page.locator('#takeSingerDialog').waitFor({state:'hidden'});
    await open(page,origin+'?part=Alto');
    const corrected=page.locator('#compRows .comp-row').filter({hasText:'Demo Corrected'});
    assert.equal(await corrected.getAttribute('data-comp-key'),stableKey,'archival credit does not reroute the personal comp');
    assert.equal(await slot(page),null);
    await page.close();
  } finally { await fresh.close(); }
  return {viewport: label, beginnerGuide:150, backing:35, pendingRowFirst:true, expandsInPlace:true,
    sameAudioAfterSingerCorrection:true, samePitchAndScoreAfterCorrection:true, collisionPreservesBothTracks:true, archivalCreditKeepsSlot:true, geometry};
}

module.exports = {checkStation, seed, pick};
