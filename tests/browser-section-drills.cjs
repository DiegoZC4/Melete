const assert = require('node:assert/strict');

async function checkSectionDrills(frame, expected, {touch = false} = {}) {
  await frame.waitForSelector('#playPause:not(:disabled)');
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  const switchView = frame.locator('#scoreViewToggle');
  if (await switchView.locator('[data-view="bars"]').getAttribute('aria-selected') !== 'true')
    await switchView.evaluate(el => el.click());
  const selector = '.bar-section-badge', buttons = frame.locator(selector);
  await buttons.first().waitFor();
  const read = () => buttons.evaluateAll(items => items.map(b =>
    [b.textContent, Number(b.dataset.sectionStart), Number(b.dataset.sectionEnd)]));
  assert.deepEqual(await read(), expected);

  const layoutErrors = () => buttons.evaluateAll(items => items.flatMap(b => {
    const shell = b.closest('.bar-system'), box = b.getBoundingClientRect(), bounds = shell.getBoundingClientRect();
    const number = [...shell.querySelectorAll('.bar-measure-number:not(.bar-count-in-label)')].find(n => n.textContent === b.dataset.sectionStart);
    const num = number?.getBoundingClientRect(), style = getComputedStyle(b);
    const crowded = items.some(s => {
      const r = s.getBoundingClientRect();
      return s !== b && box.top < r.bottom-.5 && r.top < box.bottom-.5 && box.left < r.right-.5 && r.left < box.right-.5;
    });
    return !num || box.left < bounds.left-1 || box.right > bounds.right+1 || box.bottom > num.top+1
      || Math.abs(num.left-box.left) > 32 || crowded || parseInt(style.fontWeight) < 600 || !parseFloat(style.borderTopWidth)
      ? [b.textContent] : [];
  }));
  assert.deepEqual(await layoutErrors(), [], 'boxed headings must line up with the right measures without colliding');
  const mix = () => frame.locator('#practicePart, #mixer [aria-pressed], #mixer [aria-valuenow]').evaluateAll(items =>
    items.map(i => [i.textContent, i.getAttribute('aria-pressed'), i.getAttribute('aria-valuenow')]));
  const before = await mix();
  for (const [index, [label, first, last]] of expected.entries()) {
    const badge = buttons.nth(index);
    if (touch) await badge.tap();
    else if (index % 2) await badge.press('Enter');
    else await badge.click();
    await frame.waitForFunction(({first,last}) =>
      document.querySelector('#loopStart').textContent === String(first) &&
      document.querySelector('#loopEnd').textContent === String(last) &&
      document.querySelector('#loopToggle').getAttribute('aria-pressed') === 'true' &&
      document.querySelector('.bar-section-badge[aria-current="true"]')?.dataset.sectionStart === String(first), {first,last});
    assert.equal(await frame.locator('#playPause').getAttribute('aria-label'), 'Play score', label + ' must cue, not autoplay');
    const clock = await frame.evaluate(({first,last}) => {
      if (!window.__qa) return null;
      const {engine,pitchbar} = window.__qa, measures = pitchbar.sequence.measures;
      const start = measures[first-1][0], [at,length] = measures[last-1];
      return [engine.loopStartSeconds-engine.secondsAtTick(start), engine.loopEndSeconds-engine.secondsAtTick(at+length),
        engine.currentSeconds()-engine.secondsAtTick(start)];
    },{first,last});
    if (clock) assert.ok(clock.every(s => Math.abs(s)<.001),label+' must cue the actual playback clock at the exact barline');
  }
  assert.deepEqual(await mix(), before);
  const tick = () => frame.evaluate(() => new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const scale = frame.locator('#horizontalScale'), initial = await scale.getAttribute('data-value');
  const change = key => scale.evaluate((el,key) => el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})),key);
  await change('Home'); await tick();
  assert.deepEqual(await read(),expected);
  assert.deepEqual(await layoutErrors(),[],'headings at minimum stretch');
  await frame.locator('#flowToggle').evaluate(el=>el.click()); await tick();
  assert.equal(await frame.locator('#barScore .bar-system').count(),1,'one continuous system');
  assert.deepEqual(await read(),expected);
  assert.deepEqual(await layoutErrors(),[],'headings in continuous mode');
  await frame.locator('#flowToggle').evaluate(el=>el.click()); await tick();
  for (let i=0;i<100 && Number(await scale.getAttribute('data-value'))<Number(initial);i++) await change('ArrowUp');
  await tick();
  return {touch, sections: await read()};
}

module.exports = {checkSectionDrills};
