const {toggleRecording, startRecording, stopRecording, deleteUnused} = require('./browser-sing.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');

const sectionsKey = 'choir-practice:mobile-sections:v1';
const sectionNames = ['parts', 'practice', 'display', 'tools', 'takes'];

// Existing interaction suites exercise every control. Keep their fixture expanded;
// checkSettingsSections separately tests the actual fresh-device defaults.
async function expandSettingsFixture(context) {
  await context.addInitScript(({key, names}) => {
    try {
      if (!localStorage.getItem('melete:take-history')) localStorage.setItem('melete:take-history', 'open');
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(Object.fromEntries(names.map(name => [name, true]))));
    } catch { /* Some download/error fixtures deliberately have no storage origin. */ }
  }, {key: sectionsKey, names: sectionNames});
}

async function checkSettingsSections(frame, page, {mobile, output, label, probe = '__qa', reload}) {
  const group = key => frame.locator(`[data-settings-section="${key}"]`);
  const toggle = key => group(key).locator('.settings-section-toggle');
  const collapsed = key => group(key).evaluate(node => node.classList.contains('is-collapsed'));
  const snapshot = () => frame.evaluate(probe => window[probe].recording, probe);
  const resize = async viewport => {
    await page.setViewportSize(viewport);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await frame.waitForFunction(probe => !window[probe].busy, probe);
  };
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  assert.equal((await snapshot()).microphone, false, 'opening/folding sections never requests the microphone');
  if (!mobile) {
    for (const key of sectionNames) {
      assert.equal(await collapsed(key), false);
      assert.equal(await toggle(key).isVisible(), false, 'desktop retains its existing labels and grid');
    }
    await page.screenshot({path: path.join(output, `sections-${label}-desktop.png`)});
    await resize({width: 390, height: 844});
    await frame.waitForFunction(() => document.querySelector('.parts-group.is-collapsed'));
  }
  for (const key of sectionNames) assert.equal(await collapsed(key), key !== 'practice', `default ${key}`);
  assert.equal(await frame.locator('#recordTakeCompact').count(), 0);
  assert.equal(await frame.locator('#pitchCapture').isVisible(), true);
  const defaultHeight = await frame.locator('.settings-strip').evaluate(node => node.getBoundingClientRect().height);
  const viewport = page.viewportSize();
  for (const width of [320, viewport.width]) {
    await resize({width, height: viewport.height});
    const boxes = await frame.locator('.control-group').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return {key: node.dataset.settingsSection, x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom};
    }));
    for (const a of boxes) {
      assert.ok(a.x >= 0 && a.right <= width, JSON.stringify(a));
      for (const b of boxes) if (a.key !== b.key) {
        assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `overlap ${a.key}/${b.key}`);
      }
    }
    await page.screenshot({path: path.join(output, `sections-${label}-${width}.png`)});
  }
  await toggle('parts').click();
  assert.equal(await collapsed('parts'), false);
  assert.equal(await collapsed('display'), true, 'sections fold independently');
  const expandedHeight = await frame.locator('.settings-strip').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(expandedHeight > defaultHeight + 80, 'folding eight/three mixer rows saves substantial space');
  await group('parts').screenshot({path: path.join(output, `sections-${label}-parts.png`)});
  await toggle('parts').evaluate(node => new Promise(resolve => requestAnimationFrame(() => {node.focus(); resolve();})));
  await toggle('parts').press('Enter');
  assert.equal(await collapsed('parts'), true, 'keyboard activation toggles once');
  assert.equal(await group('parts').locator('.settings-section-content').evaluate(node => node.inert), true);
  await frame.locator('[data-visible-index="0"]').evaluate(node => node.focus());
  assert.notEqual(await frame.evaluate(() => document.activeElement?.dataset.visibleIndex), '0', 'hidden controls cannot receive focus');
  await toggle('tools').click();
  await toggle('takes').click();
  await toggle('practice').click();
  const saved = await frame.evaluate(key => JSON.parse(localStorage.getItem(key)), sectionsKey);
  assert.equal(saved.practice, false);
  assert.equal(saved.takes, true);
  frame = await reload();
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  for (const key of sectionNames) assert.equal(await collapsed(key), !saved[key], `${key} survives reload`);

  if (!mobile) {
    await resize({width: 1440, height: 900});
    await frame.waitForFunction(() => !document.querySelector('.control-group.is-collapsed'));
    assert.equal(await frame.locator('#recordTakeCompact').count(), 0);
    assert.equal(await group('parts').locator('.settings-section-content').evaluate(node => node.inert), false);
    await resize({width: 390, height: 844});
    await frame.waitForFunction(() => document.querySelector('.practice-group.is-collapsed'));
  } else {
    await resize({width: 844, height: 390});
    assert.equal(await collapsed('practice'), true, 'touch landscape keeps the compact mode');
    await resize(viewport);
  }
  await toggle('practice').click();
  if (await frame.locator('#practicePart').getAttribute('data-value') === '') await frame.locator('#practicePart').press('ArrowDown');
  await frame.waitForFunction(() => document.getElementById('practicePart').dataset.value !== '');
  await toggle('takes').click();
  await frame.waitForFunction(probe => window[probe].recording.ready && !document.getElementById('pitchCapture').disabled, probe);
  assert.equal((await snapshot()).pitch, 'off');
  await toggleRecording(frame);
  try {await frame.waitForFunction(probe => ['counting','recording'].includes(window[probe].recording.state), probe);}
  catch (error) {
    console.error('Collapsed recorder failure', await snapshot(), await frame.locator('#toastMessage').textContent());
    await page.screenshot({path: path.join(output, `sections-${label}-failure.png`)});
    throw error;
  }
  assert.equal(await frame.locator('#pitchCapture').getAttribute('aria-pressed'), 'true');
  assert.equal(await frame.locator('#takePanel').evaluate(node => node.classList.contains('has-recording')), true);
  await toggle('takes').click();
  await frame.waitForFunction(probe => window[probe].recording.takes.some(take => take.number && take.length > 4000), probe);
  const id = await frame.evaluate(async probe => {
    const qa = window[probe], sample = qa.recording.takes.at(-1);
    const id = crypto.randomUUID();
    await qa.takeStore.append({...sample, id, createdAt: Date.now() - 1000, favorite: true}, 0,
      new Int16Array(sample.sampleRate), {finalized: true, complete: true});
    await qa.reloadTakes();
    return id;
  }, probe);
  const number = (await snapshot()).takes.find(take => take.id === id).number;
  await toggle('takes').click();
  assert.equal((await snapshot()).microphone, true, 'folding Takes keeps the microphone and recording active');
  assert.equal(await frame.evaluate(probe => window[probe].engine.playing, probe), true);
  await toggleRecording(frame);
  await frame.waitForFunction(probe => window[probe].recording.state === 'off', probe);
  const stopped = await snapshot();
  assert.equal(stopped.microphone, false);
  assert.ok(stopped.takes.some(take => take.id === id && !take.unsaved), 'compact Stop preserves existing saved audio');
  frame = await reload();
  await frame.waitForFunction(probe => window[probe].recording.ready, probe);
  assert.equal(await collapsed('takes'), true);
  await toggle('takes').click();
  // The silent favourite stays outside the track, so it is reviewed as a loose take.
  await group('takes').screenshot({path: path.join(output, `sections-${label}-takes.png`)});
  await frame.getByRole('button', {name: `Review take ${number}`, exact: true}).click();
  await frame.waitForFunction(probe => window[probe].takeReview, probe);
  await frame.locator('#playPause').click();
  await frame.waitForFunction(probe => window[probe].engine.playing, probe);
  await toggle('takes').click();
  assert.equal(await frame.evaluate(probe => window[probe].engine.playing, probe), true, 'folding Takes leaves the main player running');
  await frame.locator('#exitTakeReview').click();

  // A denied microphone must expose its error and input selection, not hide them.
  await frame.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Test microphone denied', 'NotAllowedError'));
  });
  await toggleRecording(frame);
  await frame.waitForFunction(probe => window[probe].recording.state === 'off' && !document.querySelector('#takePanel.is-collapsed'), probe);
  assert.equal(await frame.locator('#takeMicrophone').isVisible(), true);
  assert.match((await snapshot()).notice, /permission|allowed|denied|microphone/i);
  return {defaultHeight, expandedHeight, independent: true, persisted: true, responsive: true,
    singleSingToggle: true, microphoneUntouchedByFolding: true, savedAudioPreserved: true, errorRevealed: true};
}

module.exports = {sectionsKey, expandSettingsFixture, checkSettingsSections};
