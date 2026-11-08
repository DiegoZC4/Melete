const assert = require('node:assert/strict');
const path = require('node:path');
const {choosePart} = require('./browser-sing.cjs');

async function checkCompMetrics(page, frame, {output, label}) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  await choosePart(frame, 0);
  const toggle = frame.locator('[data-settings-section="takes"] .settings-section-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await frame.waitForFunction(() => (window.__qa || window.__probe).compState);
  const seed = (error, coverage, outliers = false) => frame.evaluate(async ({error, coverage, outliers}) => {
    const q = window.__qa || window.__probe, d = q.compDescriptor, rate = d.reference.rate;
    const from = d.reference.notes[0][0], to = Math.min(from + 8, d.reference.seconds);
    const start = q.engine.tickAtSeconds(from * rate), end = q.engine.tickAtSeconds(to * rate);
    const ref = q.pitchReference({start, end, rate}); ref.latency = 0;
    const sampleRate = 8000, frames = Math.ceil(ref.seconds * sampleRate), id = crypto.randomUUID();
    window.__metricCreated = Math.max(Date.now(), (window.__metricCreated || 0) + 1);
    const take = await q.takeStore.append({id, song:q.takeSong, createdAt:window.__metricCreated,
      sampleRate, replaces:true, part:d.label, rate, start, end, pitchReference:ref},
    0, new Int16Array(frames), {finalized:true, complete:true});
    const contour = Array.from({length:Math.ceil(frames / 80)}, (_, i) => {
      const start = i / 100, end = Math.min((i + 1) / 100, frames / sampleRate);
      const note = ref.notes.find(n => n[0] <= start && n[1] > start);
      return {start, end, cents:note && i % 100 < coverage * 100
        ? note[2][0] * 100 + (outliers && i % 5 === 0 ? 70 : error) : null};
    });
    await q.takeStore.pitchScore(id, frames, ref, MeleteTakePitch.scoreFrames(contour, ref, frames / sampleRate), MeleteTakePitch.packContour(contour, take));
    await q.reloadTakes(); await q.refreshComp();
    return q.compState.key;
  }, {error, coverage, outliers});
  const key = await seed(30, .6, true);
  const row = frame.locator('#compRows .is-armed');
  const read = () => row.evaluate(row => Object.fromEntries(['tracked','mean','median','within'].map(name => {
    const cell = row.querySelector(`.comp-${name}`), box = cell.getBoundingClientRect(), parent = cell.parentElement.getBoundingClientRect();
    const style = getComputedStyle(cell, '::after');
    return [name, {value:Number(cell.textContent), direction:cell.dataset.direction, change:cell.dataset.change, title:cell.title,
      width:parent.width, centered:Math.abs((box.left + box.right - parent.left - parent.right) / 2),
      arrowSpace:parent.right - box.right, color:style.color, content:style.content,
      top:parseFloat(style.borderTopWidth), bottom:parseFloat(style.borderBottomWidth)}];
  })));
  await seed(10, .9);
  const improved = await read();
  for (const name of Object.keys(improved)) {
    const metric = improved[name], direction = ['mean','median'].includes(name) ? 'down' : 'up';
    assert.equal(metric.direction, direction, JSON.stringify(improved));
    assert.equal(metric.change, 'better'); assert.match(metric.title, /improved by/);
    assert.ok(metric.centered < .75 && metric.arrowSpace >= 10, JSON.stringify(metric));
    assert.equal(direction === 'up' ? metric.bottom : metric.top, 5);
  }
  const withoutArrows = await row.evaluate(row => {
    const cells = [...row.querySelectorAll('.take-metric')], directions = cells.map(c => c.dataset.direction);
    cells.forEach(c => c.dataset.direction = '');
    MeleteTakeControls.fitTable(row.closest('.take-review'));
    const widths = cells.map(c => c.parentElement.getBoundingClientRect().width);
    cells.forEach((c,i) => c.dataset.direction = directions[i]);
    return widths;
  });
  assert.deepEqual(withoutArrows, Object.values(improved).map(m => m.width), 'triangles do not resize columns');
  assert.match(await row.locator('.comp-review').getAttribute('aria-description'), /Mean pitch error improved/);
  await frame.evaluate(async () => {const q=window.__qa||window.__probe;await q.refreshComp();await q.refreshComp();});
  await frame.locator('#compView [data-take-sort="mean"]').click();
  assert.deepEqual(await read(), improved, 'refresh and sorting retain the last edit comparison');
  await frame.locator('.take-review').evaluate(el => {el.scrollLeft=80;});
  await frame.locator('.take-review').screenshot({path:path.join(output, `${label}-comp-metrics-better.png`)});
  await seed(40, .7, true);
  const worsened = await read();
  for (const name of Object.keys(worsened)) {
    assert.equal(worsened[name].change, 'worse');
    assert.notEqual(worsened[name].direction, improved[name].direction);
    assert.notEqual(worsened[name].color, improved[name].color);
  }
  await seed(40, 0);
  assert.deepEqual(await read(), worsened, 'a rejected silent capture does not replace the comparison');
  await frame.locator('#undoComp').click();
  await frame.waitForFunction(() => [...document.querySelectorAll('#compRows .is-armed .take-metric')].every(m => m.dataset.change === 'better'));
  assert.ok(Object.values(await read()).every(m => m.change === 'better'), 'Undo compares against the state it replaced');
  await frame.locator('#redoComp').click();
  await frame.waitForFunction(() => [...document.querySelectorAll('#compRows .is-armed .take-metric')].every(m => m.dataset.change === 'worse'));
  assert.ok(Object.values(await read()).every(m => m.change === 'worse'), 'Redo reverses the metric changes');
  await frame.locator('.take-review').screenshot({path:path.join(output, `${label}-comp-metrics-worse.png`)});
  await seed(40, .7, true);
  const unchanged = await read();
  assert.ok(Object.values(unchanged).every(m => !m.direction && !m.change), 'an equal-scoring edit clears old arrows');
  assert.equal(await row.locator('.comp-review').getAttribute('aria-description'), '');
  await choosePart(frame, 1); await seed(20, .9);
  assert.ok(Object.entries(await read()).filter(([name]) => name !== 'tracked').every(([,m]) => !m.direction),
    'a new part is never compared with another part');
  await choosePart(frame, 0);
  await frame.waitForFunction(key => document.querySelector('#compRows .is-armed')?.dataset.compKey === key, key);
  assert.equal(await row.getAttribute('data-comp-key'), key);
  assert.ok(Object.values(await read()).every(m => !m.direction));
  return {improved, worsened, unchanged, independentParts:true, undoRedo:true, stableColumns:true};
}
module.exports = {checkCompMetrics};
