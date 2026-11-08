const assert = require('node:assert/strict');
const path = require('node:path');
const {compareParts} = require('../template/take_pitch.js');
const {checkTakeStore} = require('./browser-local-takes.cjs');
const {checkTakeReview, checkCachedTakeReview} = require('./browser-take-review.cjs');
const {checkMetronome} = require('./browser-volume-drag.cjs');

async function checkTakeDominance(frame, page, {mobile, output, label, reload}) {
  const fixtures = await frame.evaluate(async () => {
    const qa = window.__qa || window.__probe;
    const reference = {version: 1, fingerprint: 'qa-pareto-score', part: 0, line: null,
      start: 0, end: 1920, rate: 1, seconds: 2, latency: 0, notes: [[0, 2, [69]]]};
    const fixtures = {};
    for (const [name, mean, median, coverage, part] of [['better', 20, 15, .86, 0],
      ['dominated', 22, 17, .84, 0], ['tradeoff', 19, 14, .83, 0], ['other-part', 10, 10, 1, 1]]) {
      const id = crypto.randomUUID(), ref = {...reference, part};
      const record = await qa.takeStore.append({id, song: qa.takeSong, sampleRate: 8000, part: 'QA',
        label: '1-2', rate: 1, createdAt: Date.now(), peak: .15, pitchReference: ref}, 0,
        new Int16Array(16000), {finalized: true, complete: true});
      await qa.takeStore.pitchScore(id, record.frames, ref, {version: MeleteTakePitch.ANALYSIS_VERSION, scoringVersion: MeleteTakePitch.SCORING_VERSION,
        meanAbsCents: mean, medianAbsCents: median, coverage, expectedSeconds: 2, trackedSeconds: 2 * coverage});
      fixtures[name] = {id, number: record.number};
    }
    await qa.reloadTakes();
    return fixtures;
  });
  const assertHints = async dominated => {
    for (const [name, item] of Object.entries(fixtures)) {
      const row = frame.locator(`.take-row[data-take-id="${item.id}"]`);
      const expected = dominated && name === 'dominated';
      assert.equal(await row.evaluate(el => el.classList.contains('is-dominated')), expected, name);
      assert.equal(await row.locator('.take-dominance').count(), 0, 'no rank glyph');
      const tooltip = await row.locator('.take-select').getAttribute('title');
      if (expected) {
        const text = `Outscored by take ${fixtures.better.number}`;
        assert.ok(tooltip.startsWith(text));
        assert.ok((await row.locator('.take-detail').getAttribute('title')).startsWith(text));
        assert.ok((await row.locator('.take-select').getAttribute('aria-description')).includes(text));
      } else assert.doesNotMatch(tooltip, /Outscored/);
      assert.equal(await row.locator('.take-select').getAttribute('aria-label'), `Review take ${item.number}`);
    }
  };
  const saved = await frame.evaluate(() => (window.__qa || window.__probe).recording.takes);
  await assertHints(true);
  frame = await reload();
  await frame.waitForFunction(() => (window.__qa || window.__probe)?.recording.ready);
  // enableAudition does not redraw, and a song player has already listed its takes by now.
  await frame.evaluate(() => (window.__qa || window.__probe).reloadTakes());
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  await assertHints(true);
  const themes = [];
  const originalTheme = await frame.locator('html').getAttribute('data-theme');
  for (const theme of ['light', 'dark']) {
    await frame.locator('html').evaluate((el, theme) => {el.dataset.theme = theme;}, theme);
    const row = frame.locator(`.take-row[data-take-id="${fixtures.dominated.id}"]`);
    await row.scrollIntoViewIfNeeded();
    const style = await row.evaluate(el => {
      const before = getComputedStyle(el).outline;
      const background = getComputedStyle(el).backgroundImage;
      el.classList.add('is-selected');
      const selected = getComputedStyle(el).outline, border = getComputedStyle(el).boxShadow;
      el.classList.remove('is-selected');
      return {before, selected, background, border, height: el.getBoundingClientRect().height};
    });
    assert.match(style.before, /solid 1px|1px solid/);
    assert.equal(style.background, 'none', 'dominance is an outline, not a row tint');
    assert.equal(style.selected, style.before, 'the comparison outline survives selection');
    assert.notEqual(style.border, 'none', 'selection still has its own accent indicator');
    assert.equal(style.height, 24, 'the indicator never adds row height');
    await page.screenshot({path: path.join(output, `take-dominance-${label}-${theme}.png`)});
    themes.push({theme, ...style});
  }
  await frame.locator('html').evaluate((el, value) => {
    if (value === null) delete el.dataset.theme; else el.dataset.theme = value;
  }, originalTheme);
  await frame.locator(`.take-row[data-take-id="${fixtures.better.id}"] .take-delete`).click();
  await frame.locator(`.take-row[data-take-id="${fixtures.better.id}"] .take-delete.is-delete-armed`).click();
  await frame.waitForFunction(id => !document.querySelector(`[data-take-id="${id}"]`), fixtures.better.id);
  assert.equal(await frame.locator(`.take-row[data-take-id="${fixtures.dominated.id}"]`).evaluate(el => el.classList.contains('is-dominated')), false,
    'deleting the only dominator immediately clears the hint');
  await frame.locator('#undoTakeDelete').click();
  await frame.waitForFunction(id => document.querySelector(`[data-take-id="${id}"]`), fixtures.better.id);
  await assertHints(true);
  const restored = await frame.evaluate(() => (window.__qa || window.__probe).recording.takes);
  for (const take of saved.filter(t => Object.values(fixtures).some(item => item.id === t.id))) {
    const copy = restored.find(t => t.id === take.id);
    assert.deepEqual(copy.pitchScore, take.pitchScore);
    assert.deepEqual(copy.pitchReference, take.pitchReference);
    assert.equal(copy.frames, take.frames);
  }
  await frame.evaluate(async fixtures => {
    const qa = window.__qa || window.__probe;
    await qa.takeStore.deleteUnstarred(qa.takeSong, Object.values(fixtures).map(item => item.id));
    await qa.reloadTakes();
  }, fixtures);
  return {themes, persisted: true, deletionAndUndo: true, neutralTradeoffs: true, mobile};
}

async function checkTakePitch(frame, page, {mobile, output, label, reload}) {
  await frame.evaluate(()=>(window.__qa||window.__probe).enableAudition());
  const reloadPlayer = reload;
  reload = async () => { const target = await reloadPlayer(); await target.evaluate(()=>(window.__qa||window.__probe).enableAudition()); return target; };
  const storage = await checkTakeStore(frame);
  // Transport tests can leave the document scrolled beneath its sticky toolbar.
  await frame.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();

  const metronome = await checkMetronome(frame);
  const layout = await frame.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect().toJSON();
    const panel = document.getElementById('takePanel');
    return {inside: document.getElementById('settingsPanel').contains(panel),
      practice: document.querySelector('.practice-group').getBoundingClientRect().toJSON(),
      controlHeight: box('takeMicrophone').height, referenceHeight: box('tempo').height,
      toggle: Boolean(document.getElementById('loopRecorder') || document.getElementById('closeTakes')),
      panel: box('takePanel'), narrow: getComputedStyle(document.querySelector('.take-layout')).gridTemplateRows.split(' ').length===5,
      score: box('scoreShell'), toolbar: document.querySelector('.transport').getBoundingClientRect().toJSON(),
      overflow: document.documentElement.scrollWidth > innerWidth};
  });
  assert.equal(layout.inside, true, 'Takes is a permanent settings group on every viewport');
  assert.equal(layout.toggle, false, 'no separate open/close tools');
  assert.equal(layout.overflow, false);
  assert.equal(layout.panel.height, layout.practice.height+(layout.narrow?27:0), 'desktop uses four rows; narrow controls wrap to five');
  assert.equal(layout.controlHeight, layout.referenceHeight);
  if (!mobile) {
    assert.ok(layout.panel.bottom <= layout.toolbar.bottom + 1);
    assert.ok(layout.score.top >= layout.panel.bottom, 'take review does not overlay the score');
  }
  const ids = await frame.evaluate(async () => {
    const qa = window.__qa || window.__probe;
    const sr = 48000, seconds = 2;
    const reference = {version: 1, fingerprint: 'qa-synthetic-score', part: 0, line: null,
      start: 0, end: 1920, rate: 1, seconds, latency: 0, notes: [[0, seconds, [69]]],
      chapters: [{measure: 1, seconds: 0}, {measure: 2, seconds: 1}]};
    const ids = {};
    for (const [name, cents] of [['accurate', 0], ['sharp', 30.123456], ['octave', 1200], ['silent', null],
      ['partial', 0], ['legacy', 0], ['sparse', 0], ['previously-scored', 20], ['current-score', 25],
      ['cached-summary', 7.123456], ['cached-band', 9.123456], ['cached-octave', -1200],
      ['cached-island', 25], ['cached-dropout', 25], ['low-bass', 0]]) {
      const id = crypto.randomUUID();
      ids[name] = id;
      const pcm = Int16Array.from({length: sr * seconds}, (_, i) => cents === null || (name === 'sparse' && i > sr * .3) ? 0
        : name === 'low-bass' ? Math.round(32768 * (.01 * Math.sin(2 * Math.PI * 117 * i / sr)
          + .005 * Math.sin(4 * Math.PI * 117 * i / sr) + .01 * Math.sin(2 * Math.PI * 23 * i / sr)))
          : Math.round(5000 * Math.sin(2 * Math.PI * 440 * 2 ** (cents / 1200) * i / sr)));
      const ref = name === 'low-bass' ? {...reference, notes: [[0, seconds, [46]]]} : reference;
      await qa.takeStore.append({id, song: qa.takeSong, sampleRate: sr, part: 'QA', label: '1-2', rate: 1,
        createdAt: Date.now(), favorite: name === 'previously-scored', peak: cents === null ? 0 : .15,
        ...(name === 'legacy' ? {} : {pitchReference: ref})}, 0, pcm,
      {finalized: true, complete: name !== 'partial'});
      if (name === 'previously-scored') await qa.takeStore.pitchScore(id, pcm.length, reference,
        {version: 1, score: 100, coverage: .975, meanAbsCents: 21.234567,
          expectedSeconds: seconds, trackedSeconds: seconds * .975});
      if (name === 'current-score') await qa.takeStore.pitchScore(id, pcm.length, reference,
        {version: window.MeleteTakePitch.ANALYSIS_VERSION, scoringVersion: MeleteTakePitch.SCORING_VERSION, coverage: .975, meanAbsCents: 25.234567, medianAbsCents: 23.456789,
          expectedSeconds: seconds, trackedSeconds: seconds * .975});
      if (['cached-summary', 'cached-band', 'cached-octave', 'cached-island', 'cached-dropout'].includes(name)) {
        const frames = Array.from({length: 200}, (_, i) => ({start: i * 480 / sr, end: (i + 1) * 480 / sr,
          cents: name === 'cached-dropout' && i >= 52 && i < 72 ? null
            : 6900 + cents + ((name === 'cached-island' && i >= 50 && i < 53)
              || (name === 'cached-dropout' && [50,72,73].includes(i)) ? 1200 : 0)}));
        const {within50CentsSeconds, ...oldSummary} = MeleteTakePitch.scoreFrames(frames, ref, seconds);
        if (name === 'cached-summary') delete oldSummary.medianAbsCents;
        if (name === 'cached-octave') {
          delete oldSummary.scoringVersion;
          oldSummary.meanAbsCents = oldSummary.medianAbsCents = 1200;
          oldSummary.within50CentsSeconds = 0;
        }
        const contour = MeleteTakePitch.packContour(frames, {frames: pcm.length, sampleRate: sr, pitchReference: ref});
        await qa.takeStore.pitchScore(id, pcm.length, ref, oldSummary, contour);
      }
    }
    const wav = await (await qa.takeStore.wav(ids['previously-scored'])).arrayBuffer();
    window.__pitchMigrationProof = {reference, digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', wav)))};
    const readWav = qa.takeStore.wav;
    window.__medianMigrationProof = {readWav, reads: []};
    qa.takeStore.wav = function(id) { __medianMigrationProof.reads.push(id); return readWav.call(this, id); };
    await qa.reloadTakes();
    return ids;
  });
  await frame.waitForFunction(ids => {
    const qa = window.__qa || window.__probe;
    return Object.entries(ids).every(([name, id]) => name === 'legacy'
      || (window.MeleteTakePitch.currentScore(qa.recording.takes.find(t => t.id === id)?.pitchScore)
        && (name === 'current-score' || MeleteTakePitch.hasPitchBand(qa.recording.takes.find(t => t.id === id)?.pitchScore))));
  }, ids, {timeout: 60000});
  const medianMigration = await frame.evaluate(ids => {
    const qa = window.__qa || window.__probe, proof = window.__medianMigrationProof;
    const result = {cachedAudioRead: proof.reads.includes(ids['cached-summary']),
      bandAudioRead: proof.reads.includes(ids['cached-band']), octaveAudioRead: proof.reads.includes(ids['cached-octave']),
      islandAudioRead: proof.reads.includes(ids['cached-island']), dropoutAudioRead: proof.reads.includes(ids['cached-dropout']),
      oldAudioRead: proof.reads.includes(ids['previously-scored'])};
    qa.takeStore.wav = proof.readWav;
    delete window.__medianMigrationProof;
    return result;
  }, ids);
  assert.deepEqual(medianMigration, {cachedAudioRead: false, bandAudioRead: false, octaveAudioRead: false,
    islandAudioRead: false, dropoutAudioRead: false, oldAudioRead: true},
    'median, pitch band and octave scoring reuse cached pitch without reading or analysing audio');
  const scores = await frame.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) =>
    [name, (window.__qa || window.__probe).recording.takes.find(t => t.id === id)?.pitchScore || null])), ids);
  const contours = await frame.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) => {
    const take = (window.__qa || window.__probe).recording.takes.find(t => t.id === id);
    const frames = MeleteTakePitch.readContour(take);
    return [name, frames ? {count: frames.length, score: MeleteTakePitch.scoreFrames(frames, take.pitchReference,
      take.frames / take.sampleRate)} : null];
  })), ids);
  for (const [name, contour] of Object.entries(contours)) {
    if (name === 'legacy' || name === 'current-score') assert.equal(contour, null, 'previously scored takes migrate only when selected');
    else {
      assert.equal(contour.count, 200, 'background scoring stores the entire 100 Hz contour');
      assert.deepEqual(contour.score, scores[name], 'one analysis supplies both statistics and contour');
    }
  }
  assert.ok(scores.accurate.meanAbsCents < 1 && scores.accurate.coverage > .98, JSON.stringify(scores));
  assert.ok(scores.sharp.meanAbsCents > 30 && scores.sharp.meanAbsCents < 31, JSON.stringify(scores));
  assert.ok(scores.octave.meanAbsCents < 1, 'octave equivalents count as accurate');
  assert.equal(scores.silent.meanAbsCents, null);
  assert.equal(scores.silent.coverage, 0);
  assert.ok(scores.sparse.coverage < .3 && scores.sparse.meanAbsCents < 1, 'a few clean notes keep low error but low coverage');
  assert.ok(scores['previously-scored'].version === 2 && scores['previously-scored'].meanAbsCents > 19
    && scores['previously-scored'].meanAbsCents < 21, 'old detector results are automatically refreshed');
  assert.deepEqual(scores['current-score'], {version: 2, scoringVersion: require('../template/take_pitch.js').SCORING_VERSION, coverage: .975,
    meanAbsCents: 25.234567, medianAbsCents: 23.456789, expectedSeconds: 2, trackedSeconds: 1.95}, 'current analysis is reused, not recomputed');
  assert.ok(Math.abs(scores['cached-summary'].medianAbsCents - 7.123456) < 1e-8);
  assert.ok(Math.abs(scores['cached-band'].medianAbsCents - 9.123456) < 1e-8);
  assert.equal(scores['cached-band'].within50CentsSeconds, 2);
  assert.ok(scores.octave.within50CentsSeconds > 1.98);
  assert.equal(scores['cached-octave'].meanAbsCents, 0);
  assert.equal(scores['cached-octave'].medianAbsCents, 0);
  assert.equal(scores['cached-octave'].within50CentsSeconds, 2);
  assert.equal(await frame.evaluate(id => MeleteTakePitch.readContour((window.__qa || window.__probe).recording.takes.find(t => t.id === id))[0].cents, ids['cached-octave']), 5700, 'rescoring preserves the actual lower octave in the cache');
  assert.ok(scores['low-bass'].coverage > .95 && scores['low-bass'].meanAbsCents < 15,
    'real bundled worker recovers low singing masked by sub-bass rumble');
  const preserved = await frame.evaluate(async id => {
    const qa = window.__qa || window.__probe, record = qa.recording.takes.find(t => t.id === id);
    const wav = await (await qa.takeStore.wav(id)).arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', wav)));
    const result = {favorite: record.favorite, frames: record.frames,
      sameReference: JSON.stringify(record.pitchReference) === JSON.stringify(window.__pitchMigrationProof.reference),
      sameAudio: JSON.stringify(digest) === JSON.stringify(window.__pitchMigrationProof.digest)};
    await qa.takeStore.favorite(id, false);
    await qa.reloadTakes();
    delete window.__pitchMigrationProof;
    return result;
  }, ids['previously-scored']);
  assert.deepEqual(preserved, {favorite: true, frames: 96000, sameReference: true, sameAudio: true},
    'reanalysis updates only metrics, not favorites, timing references or WAV bytes');
  assert.equal(scores.legacy, null, 'old takes are never graded against guessed historical music');
  assert.equal(await frame.locator('.take-star, #takeFavorites, .take-state, .is-best-pitch').count(), 0);
  const ordering = await frame.evaluate(() => {
    const qa = window.__qa || window.__probe;
    return [...document.querySelectorAll('#takeList .take-row')].map(row => qa.recording.takes.find(t => t.id === row.dataset.takeId));
  });
  const errors = ordering.map(take => Number.isFinite(take.pitchScore?.meanAbsCents) ? take.pitchScore.meanAbsCents : Infinity);
  assert.deepEqual(errors, [...errors].sort((a, b) => a - b), 'all measured takes sort by actual cents, regardless of coverage');
  for (const [name, score] of Object.entries(scores)) {
    const row = frame.locator(`.take-row[data-take-id="${ids[name]}"]`);
    assert.equal(await row.locator('.take-segments').innerText(),'1');
    const tracked=await frame.evaluate(id=>{
      const q=window.__qa||window.__probe,t=q.recording.takes.find(t=>t.id===id),s=t.pitchScore;
      const r=q.pitchReference({start:0,end:q.scoreMeasures.at(-1)[0]+q.scoreMeasures.at(-1)[1],rate:t.rate},t.pitchReference?.part,t.pitchReference?.line);
      const total=r?.notes.reduce((sum,n)=>sum+n[1]-n[0],0) || s?.expectedSeconds;
      return s?(100*s.trackedSeconds/total).toFixed(1):'\u2014';
    },ids[name]);
    assert.equal(await row.locator('.take-tracked strong').innerText(),tracked);
    assert.equal(await row.locator('.take-error strong').innerText(), Number.isFinite(score?.meanAbsCents) ? score.meanAbsCents.toFixed(1) : '\u2014');
    assert.equal(await row.locator('.take-median strong').innerText(), Number.isFinite(score?.medianAbsCents) ? score.medianAbsCents.toFixed(1) : '\u2014');
    const within = score && Number.isFinite(score.within50CentsSeconds) && score.trackedSeconds > 0
      ? (score.within50CentsSeconds / score.trackedSeconds * 100).toFixed(1) : '\u2014';
    assert.equal(await row.locator('.take-within strong').innerText(), within, name);
    assert.equal(await row.locator('.take-detail small').count(), 0, 'labels appear only once in the header');
    assert.doesNotMatch(await row.innerText(), /% pitch/);
    const band = score && Number.isFinite(score.within50CentsSeconds) && score.trackedSeconds > 0;
    const tooltip = await row.locator('.take-detail').getAttribute('title');
    if (band) {
      const text = `Within \u00b150 cents: ${(score.within50CentsSeconds / score.trackedSeconds * 100).toFixed(1)}% of tracked singing; `
        + `${(score.within50CentsSeconds / score.trackedSeconds * Number(tracked)).toFixed(1)}% of written singing.`;
      assert.ok(tooltip.includes(text), `${name}: ${tooltip}`);
      assert.ok((await row.locator('.take-select').getAttribute('aria-description')).includes(text));
    } else assert.doesNotMatch(tooltip, /Within \u00b150 cents:/);
  }
  assert.deepEqual(await frame.locator('#takeColumns > span').allTextContents(),
    ['Take', 'Part', 'Segments', 'Tracked (%)', 'Mean (\u00a2)', 'Median (\u00a2)', '\u226450\u00a2 (%)', 'Created', 'Modified', 'Oct', 'Hear']);
  assert.equal(await frame.locator('#takeColumns > span').nth(6).getAttribute('aria-label'),
    'Within 50 cents, percent of tracked singing');
  assert.match(await frame.locator(`.take-row[data-take-id="${ids.sharp}"] .take-detail`).getAttribute('title'), /% tracked; 30\.1 cents/);
  assert.match(await frame.locator(`.take-row[data-take-id="${ids['current-score']}"] .take-detail`).getAttribute('title'), /25\.235 cents/);
  assert.doesNotMatch(await frame.locator(`.take-row[data-take-id="${ids.accurate}"] .take-detail`).getAttribute('title'), /90%/);
  assert.equal((await frame.locator('#takePanel').boundingBox()).height, layout.panel.height, 'populating takes never grows settings');
  const scroll = await frame.locator('.take-review').evaluate(el => ({height: el.clientHeight, content: el.scrollHeight,
    overflow: getComputedStyle(el).overflowY}));
  assert.equal(scroll.overflow, 'auto');
  assert.ok(scroll.content > scroll.height, 'saved takes use their own scroll area');
  await frame.locator(`.take-row[data-take-id="${ids.legacy}"]`).scrollIntoViewIfNeeded();
  assert.ok(await frame.locator('.take-review').evaluate(el => el.scrollTop > 0), 'unscored takes at the end remain reachable');
  const stableHeight = (await frame.locator('#takePanel').boundingBox()).height;
  const previewLayout = await checkTakeReview(frame, page, {output, label});
  assert.equal((await frame.locator('#takePanel').boundingBox()).height, stableHeight, 'review does not grow settings');
  assert.equal(await frame.locator('.take-player, .take-seek, #takePreview').count(), 0);
  await frame.locator(`.take-row[data-take-id="${ids.accurate}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(output, `take-pitch-${label}.png`)});
  const responsive = [];
  if (!mobile) {
    const viewport = page.viewportSize();
    for (const width of [320, 375, 820, 1280, 1920]) {
      await page.setViewportSize({width, height: viewport.height});
      await frame.locator('#takeMicrophone').scrollIntoViewIfNeeded();
      await frame.waitForFunction(() => !(window.__qa || window.__probe).busy);
      const dimensions = await frame.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {panel: box('#takePanel'), practice: box('.practice-group'), record: box('#takeMicrophone'),
          narrow:getComputedStyle(document.querySelector('.take-layout')).gridTemplateRows.split(' ').length===5,
          review: box('.take-review'), overflow: document.documentElement.scrollWidth > innerWidth,
          overflowElements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 10).map(el => ({tag: el.tagName, class: el.className?.baseVal ?? el.className})),
          headers: [...document.querySelectorAll('#takeColumns > span')].map(cell => cell.getBoundingClientRect().toJSON()),
          headersFit: [...document.querySelectorAll('#takeColumns > span')].every(cell => cell.scrollWidth <= cell.clientWidth),
          headerTop: box('#takeColumns').top,
          tableScroll: getComputedStyle(document.querySelector('.take-review')).overflowX,
          metricsVisible: [...document.querySelectorAll('#takeColumns > span')].every(cell => {
            const bounds = cell.getBoundingClientRect(), scroll = document.querySelector('.take-review').getBoundingClientRect();
            return bounds.left >= scroll.left - 1 && bounds.right <= scroll.right + 1;
          }),
          metrics: [...document.querySelectorAll('#takeList .take-detail')].map(el => {
            const cells = [...el.children].map(child => child.getBoundingClientRect().toJSON());
            return {cells, values: [...el.querySelectorAll('strong')].map(cell => cell.getBoundingClientRect().toJSON()),
              cellsFit: [...el.children].every(cell => cell.scrollWidth <= cell.clientWidth)};
          }), rows: [...document.querySelectorAll('#takeList .take-row')].map(row => ({
            summary: row.querySelector('.take-summary').getBoundingClientRect().toJSON(),
            overflow: row.querySelector('.take-summary').scrollWidth > row.clientWidth,
            height: row.getBoundingClientRect().height, number: row.querySelector('.take-number').getBoundingClientRect().toJSON(),
          }))};
      });
      assert.equal(dimensions.overflow, false, `no page overflow at ${width}: ${JSON.stringify(dimensions.overflowElements)}`);
      assert.equal(dimensions.panel.height, dimensions.practice.height+(dimensions.narrow?27:0));
      assert.equal(dimensions.record.height, 24);
      assert.equal(dimensions.headersFit, true, `column labels fit at ${width}`);
      if (!dimensions.metricsVisible) assert.equal(dimensions.tableScroll, 'auto',
        `the extra boundary columns remain reachable inside the table at ${width}`);
      if (width >= 1280) assert.equal(dimensions.panel.top, dimensions.practice.top,
        'the extra column must not force the Takes group onto another settings row');
      assert.ok(dimensions.review.height >= 48, `at least one take row fits at ${width}`);
      for (const metric of dimensions.metrics) {
        assert.equal(metric.cellsFit, true, `metric labels/values fit at ${width}`);
        assert.equal(metric.cells.length, 4, 'keep tracking, mean and median alongside the pitch-band column');
        assert.equal(new Set(metric.cells.map(cell => cell.y)).size, 1, 'four side-by-side metric columns');
        for (const [index, cell] of metric.cells.entries()) {
          const header = dimensions.headers[index + 3], value = metric.values[index];
          assert.ok(Math.abs(cell.x + cell.width / 2 - header.x - header.width / 2) < .5, 'values align beneath the shared header');
          assert.ok(Math.abs(value.x + value.width / 2 - cell.x - cell.width / 2) < .5, 'numeric values are centered in their column');
          assert.ok(Math.abs(value.y + value.height / 2 - cell.y - cell.height / 2) < .5, 'values are vertically centered within the row');
        }
      }
      assert.ok(dimensions.rows.every(row => Math.abs(row.number.x - dimensions.headers[0].x) < .5), 'take numbers share one fixed column');
      assert.ok(Math.abs(dimensions.headerTop - dimensions.review.top) < 1, 'column labels stay pinned while the list scrolls');
      assert.ok(dimensions.rows.every(row => !row.overflow && row.height <= 24), `one compact selectable row at ${width}`);
      const horizontal = await frame.locator('.take-review').evaluate(el => {
        const initial = el.scrollLeft;
        el.scrollLeft = el.scrollWidth;
        const right = el.getBoundingClientRect().right;
        const reachable = [...el.querySelectorAll('.take-delete')].every(button => button.getBoundingClientRect().right <= right + 1);
        const cells = [...el.querySelector('#takeList .take-detail').children];
        const headings = [...el.querySelectorAll('#takeColumns > span')];
        const aligned = cells.every((cell, i) => {
          const a = cell.getBoundingClientRect(), b = headings[i + 3].getBoundingClientRect();
          return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < .5;
        });
        const result = {reachable, aligned, scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth};
        el.scrollLeft = initial;
        return result;
      });
      assert.equal(horizontal.reachable, true, `all row actions remain reachable at ${width}`);
      assert.equal(horizontal.aligned, true, 'headers and values scroll horizontally together');
      if (width <= 375) assert.ok(horizontal.scrollWidth >= horizontal.clientWidth, `boundary columns scroll within Takes at ${width}px`);
      responsive.push({width, ...dimensions, horizontal});
      await frame.locator('#takePanel').scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(output, `takes-layout-${label}-${width}.png`)});
    }
    await page.setViewportSize(viewport);
  }
  await frame.locator('#settingsToggle').click();
  frame = await reload();
  await frame.waitForFunction(() => (window.__qa || window.__probe)?.recording.ready);
  const restored = await frame.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) =>
    [name, (window.__qa || window.__probe).recording.takes.find(t => t.id === id)?.pitchScore || null])), ids);
  assert.deepEqual(restored, scores, 'per-take scores survive reload byte-for-byte');
  const octaveIsland = await frame.evaluate(id => {
    const take = (window.__qa || window.__probe).recording.takes.find(t => t.id === id);
    const frames = MeleteTakePitch.readContour(take);
    return {raw: Array.from(take.pitchContour.pitches.slice(50, 53)),
      repaired: frames.slice(50, 53).map(f => f.cents), frameCount: frames.length,
      score: MeleteTakePitch.scoreFrames(frames, take.pitchReference, 2)};
  }, ids['cached-island']);
  assert.deepEqual(octaveIsland.raw, [8125, 8125, 8125], 'reload preserves original detector evidence');
  assert.deepEqual(octaveIsland.repaired, [6925, 6925, 6925], 'cached octave islands clean up without FFT');
  assert.equal(octaveIsland.frameCount, 200);
  assert.deepEqual(octaveIsland.score, scores['cached-island'], 'octave-equivalent grades and coverage stay unchanged');
  const dropoutIsland = await frame.evaluate(id => {
    const take = (window.__qa || window.__probe).recording.takes.find(t => t.id === id);
    const frames = MeleteTakePitch.readContour(take);
    return {raw: [50,72,73].map(i=>take.pitchContour.pitches[i]),
      repaired: [50,72,73].map(i=>frames[i].cents), gap:frames.slice(52,72).map(f=>f.cents),
      score:MeleteTakePitch.scoreFrames(frames,take.pitchReference,2)};
  }, ids['cached-dropout']);
  assert.deepEqual(dropoutIsland.raw, [8125,8125,8125]);
  assert.deepEqual(dropoutIsland.repaired, [6925,6925,6925], 'the m4 dropout-edge case repairs across reload');
  assert.deepEqual(dropoutIsland.gap, Array(20).fill(null), 'the 200 ms gap remains untracked');
  assert.deepEqual(dropoutIsland.score, scores['cached-dropout'], 'cleanup cannot improve coverage or the pitch-class score');
  const cachedAfterReload = await checkCachedTakeReview(frame, previewLayout.id);
  const sorting = await checkTakeSorting(frame, reload);
  frame = sorting.frame;
  await frame.evaluate(async ids => {
    const qa = window.__qa || window.__probe;
    await qa.takeStore.deleteUnstarred(qa.takeSong, Object.values(ids));
    await qa.reloadTakes();
  }, {...ids, review: previewLayout.id});
  const dominance = await checkTakeDominance(frame, page, {mobile, output, label, reload});
  return {layout, scroll, previewLayout, responsive, scores, preserved, persisted: true,
    mainPlayerReview: true, storage, worker: true, cachedAfterReload, medianMigration, octaveIsland, dropoutIsland,
    dominance, sorting: sorting.proof, metronome};
}

async function checkTakeSorting(frame, reload) {
  const open = async () => {
    if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
    await frame.locator('.take-review').evaluate(el => { el.scrollTop = 0; });
  };
  await open();
  const initial = await frame.evaluate(() => {
    const q = window.__qa || window.__probe;
    return {preferences: q.savedPractice, selected: q.takeReview?.id,
      takes: q.recording.takes.map(t => [t.id, t.pitchScore, t.frames])};
  });
  const check = async (column, direction) => {
    assert.equal(await frame.locator(`#takeColumns [data-take-sort="${column}"]`).getAttribute('data-sorted'), direction);
    assert.equal(await frame.locator('#takeColumns [data-sorted]').count(), 1);
    const rows = await frame.evaluate(column => {
      const q = window.__qa || window.__probe;
      return [...document.querySelectorAll('#takeList .take-row')].map(el => {
        const t = q.recording.takes.find(t => t.id === el.dataset.takeId), p = t.pitchScore;
        const ref=t.pitchReference&&q.pitchReference({start:0,end:q.scoreMeasures.at(-1)[0]+q.scoreMeasures.at(-1)[1],rate:t.rate},t.pitchReference.part,t.pitchReference.line);
        const total=ref?.notes.reduce((sum,n)=>sum+n[1]-n[0],0)||p?.expectedSeconds;
        const value = column === 'number' ? t.number : column === 'part' ? t.part
          : column === 'segments' ? 1
          : column === 'tracked' ? total > 0 ? Math.min(1,p.trackedSeconds/total) : null
          : column === 'mean' ? p?.meanAbsCents : column === 'median' ? p?.medianAbsCents
          : p?.trackedSeconds > 0 && Number.isFinite(p.within50CentsSeconds) ? p.within50CentsSeconds / p.trackedSeconds : null;
        return {id: t.id, value: value ?? null, createdAt: t.createdAt, number: t.number};
      });
    }, column);
    const expected = [...rows].sort((a, b) => {
      if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
      const primary = column === 'part' ? compareParts(a.value,b.value)
        : typeof a.value === 'string' ? a.value.localeCompare(b.value, undefined, {numeric: true})
        : a.value === b.value ? 0 : a.value < b.value ? -1 : 1;
      return primary * (direction === 'ascending' ? 1 : -1) || a.createdAt - b.createdAt || a.number - b.number;
    });
    assert.deepEqual(rows.map(t => t.id), expected.map(t => t.id), `${column} ${direction}`);
  };
  assert.equal(await frame.locator('#takeColumns [data-take-sort="mean"]').getAttribute('data-sorted'), 'ascending', 'default is ascending mean');
  for (const column of ['mean', 'median', 'tracked', 'within', 'part', 'segments', 'number']) {
    const first = column === 'mean' || ['tracked', 'within'].includes(column) ? 'descending' : 'ascending';
    const button = frame.locator(`#takeColumns [data-take-sort="${column}"]`);
    await button.click();
    await check(column, first);
    await frame.evaluate(() => new Promise(requestAnimationFrame));
    await button.press('Enter');
    await check(column, first === 'ascending' ? 'descending' : 'ascending');
  }
  const after = await frame.evaluate(() => {
    const q = window.__qa || window.__probe;
    return {preferences: q.savedPractice, selected: q.takeReview?.id,
      takes: q.recording.takes.map(t => [t.id, t.pitchScore, t.frames])};
  });
  assert.deepEqual(after, initial, 'sorts change neither practice settings, selection nor stored takes');
  await frame.locator('#takeColumns [data-take-sort="tracked"]').click();
  frame = await reload();
  await frame.waitForFunction(() => (window.__qa || window.__probe)?.recording.ready);
  await open();
  await check('tracked', 'descending');
  await frame.locator('#takeColumns [data-take-sort="mean"]').click();
  await check('mean', 'ascending');
  return {frame, proof: {columns: 7, reversible: true, keyboard: true, missingLast: true, persisted: true, dataUnchanged: true}};
}

module.exports = {checkTakePitch};
