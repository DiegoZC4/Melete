const assert = require('node:assert/strict');
const path = require('node:path');

const loopReloadProbe = `loopReload: { get pending() { return pendingLoopRevealTick; },
  get restored() { return initialLoopRestored; }, bounds: playbackCursorBounds, scheduleRender },`;

async function checkLoopReload(frame, page, {probe = '__qa', reload, output, label}) {
  if (await frame.locator('#partChooser').isVisible()) await frame.locator('#partChooserDismiss').click();
  const initial = await frame.evaluate(name => window[name].pitchbar.captureSettingsState(), probe);
  const results = [];
  try {
    for (const view of ['standard', 'bars']) for (const flow of ['wrap', 'continuous']) {
      const expected = await frame.evaluate(({name, view, flow}) => {
        const q = window[name], seq = q.pitchbar.sequence;
        q.engine.pause();
        const state = q.pitchbar.captureSettingsState();
        const first = Math.min(18, seq.measures.length - 2), last = Math.min(first + 4, seq.measures.length - 1);
        q.pitchbar.applySettingsState({...state, scoreView: view, flow, vertical: 160, horizontal: 400,
          loopEnabled: true, loopStart: first, loopEnd: last, loopStartTick: null, loopEndTick: null});
        return seq.measures[first][0];
      }, {name: probe, view, flow});
      await frame.waitForFunction(name => !window[name].busy, probe);
      // Deliberately reload from the wrong end, rather than accidentally pass
      // because the browser restored an already-correct scroll offset.
      await frame.evaluate(() => {
        window.scrollTo({top: 0, behavior: 'instant'});
        document.getElementById('score').scrollLeft = 0;
        document.getElementById('barScore').scrollLeft = 0;
      });
      frame = await reload();
      await frame.waitForFunction(({name, tick}) => {
        const q = window[name];
        return q && !q.busy && q.loopReload.restored && q.loopReload.pending === null
          && Math.abs(q.engine.tickAtSeconds(q.engine.currentSeconds()) - tick) < .01;
      }, {name: probe, tick: expected});
      const actual = await frame.evaluate(name => {
        const q = window[name], bounds = q.loopReload.bounds();
        return {bounds, top: document.querySelector('.transport').getBoundingClientRect().bottom,
          height: innerHeight, width: innerWidth, scrollY, scoreX: document.getElementById('score').scrollLeft,
          barsX: document.getElementById('barScore').scrollLeft, playing: q.engine.playing,
          settings: q.pitchbar.captureSettingsState()};
      }, probe);
      assert.equal(actual.playing, false, 'restore never starts audio');
      assert.ok(actual.bounds.top >= actual.top - 2 && actual.bounds.top < actual.height - 20,
        JSON.stringify({view, flow, actual}));
      assert.ok(actual.bounds.bottom > actual.top, 'loop start stays below sticky controls');
      if (flow === 'continuous') {
        assert.ok(actual.bounds.left >= -2 && actual.bounds.left < actual.width - 20,
          JSON.stringify({view, flow, actual}));
        assert.ok((view === 'bars' ? actual.barsX : actual.scoreX) > 0, 'horizontal reload leaves measure one');
      }
      assert.equal(actual.settings.scoreView, view);
      assert.equal(actual.settings.flow, flow);
      assert.deepEqual(actual.settings.volumes, initial.volumes);
      assert.deepEqual(actual.settings.pans, initial.pans);
      assert.equal(actual.settings.practicePart, initial.practicePart);
      await page.screenshot({path: path.join(output, `loop-reload-${label}-${view}-${flow}.png`)});
      // A subsequent reflow must not snap back to the saved loop again.
      const away = await frame.evaluate(name => {
        const q = window[name];
        q.engine.seek(0);
        window.scrollTo({top: 0, behavior: 'instant'});
        document.getElementById('score').scrollLeft = 0;
        document.getElementById('barScore').scrollLeft = 0;
        q.loopReload.scheduleRender();
        return q.engine.currentSeconds();
      }, probe);
      await frame.waitForFunction(name => !window[name].busy, probe);
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await frame.evaluate(name => window[name].engine.currentSeconds(), probe), away);
      assert.equal(await frame.evaluate(() => scrollY), 0, 'ordinary reflows do not repeat startup scrolling');
      results.push({view, flow, expectedTick: expected, ...actual});
    }
    await frame.evaluate(name => {
      const q = window[name], state = q.pitchbar.captureSettingsState();
      q.pitchbar.applySettingsState({...state, loopStart: null, loopEnd: null, loopStartTick: null, loopEndTick: null});
    }, probe);
    frame = await reload();
    await frame.waitForFunction(name => window[name]?.loopReload.restored && !window[name].busy, probe);
    assert.ok(await frame.evaluate(name => window[name].engine.currentSeconds() < .01, probe), 'no loop opens at piece start');
  } finally {
    await frame.evaluate(({name, state}) => window[name].pitchbar.applySettingsState(state), {name: probe, state: initial});
  }
  return {cases: results, noAutoplay: true, noReflowSnapback: true, clearedLoop: true};
}

module.exports = {loopReloadProbe, checkLoopReload};
