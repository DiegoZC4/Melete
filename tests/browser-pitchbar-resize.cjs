const assert = require('node:assert/strict');

async function checkPitchbarResize(frame, page) {
  const before = await frame.evaluate(() => {
    const qa = window.__qa || window.__probe;
    const scale = document.getElementById('horizontalScale');
    const proof = window.__resizeProof = {samples: [], state: qa.pitchbar.captureSettingsState(),
      points: JSON.stringify(qa.pitchResolution.snapshot().points), review: JSON.stringify(qa.takeReview),
      edges: document.querySelectorAll('#barScore .bar-pitch-trace-edge').length};
    proof.listen = () => requestAnimationFrame(() => {
      const bars = document.getElementById('barScore');
      // Live updates must not put the expensive overlay back during resizing.
      qa.pitchResolution.redrawIncrementally();
      proof.samples.push({scale: Number(scale.dataset.value), deferred: bars.classList.contains('is-rescaling'),
        edges: bars.querySelectorAll('.bar-pitch-trace-edge').length,
        notes: bars.querySelectorAll('.bar-note').length,
        width: Number(bars.querySelector('.bar-note').getAttribute('width'))});
    });
    scale.addEventListener('input', proof.listen);
    return {scale: Number(scale.dataset.value), edges: proof.edges};
  });
  assert.ok(before.edges > 20, 'exercise an existing live/saved contour, not an empty score');
  try {
    const control = frame.locator('#horizontalScale');
    const box = await control.boundingBox(), direction = before.scale < 350 ? -1 : 1;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + direction * 8 * step);
    }
    await page.mouse.up();
    await frame.waitForFunction(() => !document.getElementById('barScore').classList.contains('is-rescaling')
      && document.querySelectorAll('#barScore .bar-pitch-trace-edge').length > 0);
    const proof = await frame.evaluate(() => {
      const qa = window.__qa || window.__probe, p = window.__resizeProof;
      return {samples: p.samples, pointsIntact: JSON.stringify(qa.pitchResolution.snapshot().points) === p.points,
        reviewIntact: JSON.stringify(qa.takeReview) === p.review,
        reviewVisible: !!document.querySelector('#barScore .take-pitch-trace-edge'),
        scale: Number(document.getElementById('horizontalScale').dataset.value)};
    });
    assert.notEqual(proof.scale, before.scale);
    assert.ok(proof.samples.length >= 2, 'multiple drag steps reached the shared control');
    assert.ok(proof.samples.every(s => s.deferred && s.edges === 0 && s.notes > 0), JSON.stringify(proof.samples));
    assert.ok(new Set(proof.samples.map(s => s.width)).size > 1, 'pitchbars resize during the drag');
    assert.equal(proof.pointsIntact, true);
    assert.equal(proof.reviewIntact, true);
    assert.equal(proof.reviewVisible, true);
    return proof;
  } finally {
    await page.mouse.up();
    await frame.evaluate(() => {
      const qa = window.__qa || window.__probe, p = window.__resizeProof;
      document.getElementById('horizontalScale').removeEventListener('input', p.listen);
      qa.pitchbar.applySettingsState(p.state);
      delete window.__resizeProof;
    });
  }
}

module.exports = {checkPitchbarResize};
