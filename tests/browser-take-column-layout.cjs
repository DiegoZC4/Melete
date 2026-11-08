const assert = require('node:assert/strict');
const path = require('node:path');

async function checkTakeColumnLayout(page, frame, row, {output, label}) {
  const octave = row.locator('.take-octave');
  const initial = await octave.getAttribute('data-value');
  const measurements = [];
  for (const expected of ['-', '8va', '8vb']) {
    assert.equal(await octave.textContent(), expected);
    await octave.scrollIntoViewIfNeeded();
    const geometry = await octave.evaluate(el => {
      const rect = node => node.getBoundingClientRect();
      const center = box => box.left + box.width / 2;
      const text = node => { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect(); };
      const heading = el.closest('#compView, .take-loose-section').querySelector('.take-octave-heading');
      const hearHeading = heading.parentElement.querySelector('.take-hear-heading');
      const hear = el.parentElement.querySelector('.take-hear');
      const hearCell = hear.parentElement, modified = el.parentElement.querySelector('.take-modified');
      const actions = [...el.parentElement.querySelectorAll('.take-row-actions button:not([hidden])')].map(rect);
      const style = getComputedStyle(el), b = rect(el), h = rect(heading), t = text(el), ht = text(heading), hearText = text(hearHeading);
      return {label: el.textContent, width: b.width, headerWidth: h.width,
        visibleCenterOffset: center(t) - (rect(modified).right + b.right) / 2,
        spacerBeforeOctave: b.left - rect(modified).right, spacerBeforeHear: rect(hearCell).left - b.right,
        headerLeftOffset: b.left - h.left, headerRightOffset: b.right - h.right,
        octaveDivider: style.boxShadow, hearDivider: getComputedStyle(hearCell).boxShadow,
        dividerHeight: rect(hearCell).height, rowHeight: el.closest('.take-row').getBoundingClientRect().height,
        actionOffset: actions[0].left - rect(hearCell).right,
        actionGaps: actions.slice(1).map((box,i) => box.left - actions[i].right),
        actionHeights: actions.map(box => box.height),
        textOffset: center(t) - center(h), headingOffset: center(ht) - center(h),
        verticalOffset: t.top + t.height / 2 - b.top - b.height / 2,
        hearOffset: center(rect(hear)) - center(rect(hearHeading)),
        hearLeft: hearText.left - rect(hearHeading).left, hearRight: rect(hearHeading).right - hearText.right,
        border: style.borderTopWidth, radius: style.borderRadius, background: style.backgroundColor,
        font: style.fontFamily};
    });
    assert.ok(Math.abs(geometry.textOffset) < .75 && Math.abs(geometry.headingOffset) < .75, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.visibleCenterOffset) < .75, JSON.stringify(geometry));
    for (const key of ['spacerBeforeOctave','spacerBeforeHear','headerLeftOffset','headerRightOffset']) assert.ok(Math.abs(geometry[key]) < .1, `${key}: ${JSON.stringify(geometry)}`);
    for (const key of ['octaveDivider','hearDivider']) assert.match(geometry[key], /-1px 0px/, JSON.stringify(geometry));
    assert.equal(geometry.dividerHeight, geometry.rowHeight, 'column dividers continue through the entire row');
    assert.ok(geometry.actionOffset >= 6 && geometry.actionGaps.every(gap => gap >= 4), JSON.stringify(geometry));
    assert.ok(geometry.actionHeights.every(height => height === 22), JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.verticalOffset) <= 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.hearOffset) < .75, JSON.stringify(geometry));
    assert.ok(geometry.hearLeft >= 4.5 && geometry.hearRight >= 4.5, JSON.stringify(geometry));
    assert.equal(geometry.width, geometry.headerWidth);
    assert.equal(geometry.border, '0px'); assert.equal(geometry.radius, '0px');
    assert.equal(geometry.background, 'rgba(0, 0, 0, 0)');
    measurements.push(geometry);
    if (expected === '-') await octave.click();
    else if (expected === '8va') await octave.press('Enter');
    else await octave.press('Enter');
  }
  assert.equal(await octave.getAttribute('data-value'), initial);
  assert.equal(new Set(measurements.map(m => m.width)).size, 1, 'cycling never changes the column width');
  await octave.evaluate(el => el.blur());
  await frame.locator('.take-review').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await frame.locator('.take-review').screenshot({path: path.join(output, `${label}-take-columns.png`)});
  return measurements;
}
module.exports = {checkTakeColumnLayout};
