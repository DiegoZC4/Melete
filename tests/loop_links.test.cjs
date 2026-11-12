const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(href = 'https://example.test/song/') {
  let tick = 0;
  const messages = [], saved = [], loops = [], scrolls = [];
  const element = () => ({classList: {toggle() {}, add() {}, remove() {}, contains: () => false}, setAttribute() {}, dataset: {}, style: {}});
  const c = vm.createContext({
    URL, URLSearchParams, ready: true, pendingLoopLink: undefined, takePreviewId: null,
    compPanel:null, initialLoopRestored: false, pendingLoopRevealTick: null, pendingNotationReload: null,
    barRenderFrame: 0, renderTimer: 0, notationRenderInFlight: false, notationRenderQueued: false, flow: 'wrap',
    sequence: {division: 960, endTick: 14400,
      measures: [[0,3840,4,4], [3840,2880,6,8], [6720,6720,7,4], [13440,960,4,4]]},
    loopStartMeasure: null, loopEndMeasure: null, loopStartTick: null, loopEndTick: null, loopEnabled: true,
    scoreView: 'standard', clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    elements: Object.fromEntries(['loopToggle', 'loopStart', 'loopEnd', 'loopControls', 'loopBand', 'score', 'barScore'].map(key => [key, element()])),
    showToast: message => messages.push(message),
    requestAnimationFrame: callback => callback(), playbackDirection: () => null,
    syncNotationOverflow() {},
    playbackCursorBounds: () => null, updateTransportHeight() {}, scrollToPlayback: (...args) => scrolls.push(args),
    savePreferences: () => saved.push({loopStart:c.loopStartMeasure, loopEnd:c.loopEndMeasure,
      loopStartTick:c.loopStartTick, loopEndTick:c.loopEndTick}),
    config: {}, engine: {duration:14.4, playing: false, pause() { this.playing = false; }, seek(s) { tick = s * 1000; },
      secondsAtTick: t => t / 1000, tickAtSeconds: s => s * 1000, currentSeconds: () => tick / 1000,
      setLoop(...values) { loops.push(values); this.loopEndSeconds = values[1] === null ? null : values[1] / 1000; }},
    api: {pause() {}},
    window: {MeleteTakePitch: require('../template/take_pitch.js'), location: {href}, history: {state: null, replaceState(_state, _title, url) { c.window.location.href = url; }}},
  });
  c.engine.hasLoop = () => Number.isFinite(loops.at(-1)?.[1]);
  for (const name of ['measureIndexAtTick', 'currentMeasureIndex', 'scoreLocationAtTick', 'takeBoundaryLabel', 'loopLinkValue',
    'loopAddressTick', 'parseLoopLink', 'consumeLoopLink', 'loopTickRange', 'restoreLoopState',
    'applyLoopLink', 'seekLoopStart', 'restoreStartupLoop', 'revealPendingLoopStart',
    'countInBeats', 'pitchTraceOriginTick', 'timelineFraction',
    'updateLoopState', 'setLoopPoint', 'clearLoop', 'toggleLoop']) vm.runInContext(source(name), c);
  return {c, messages, saved, loops, scrolls, tick: () => tick};
}

test('loop can be suspended and restored without erasing endpoints or seeking on reload', () => {
  const {c, loops, tick} = fixture();
  c.applyLoopLink('2-4');
  c.toggleLoop();
  assert.equal(c.loopEnabled, false);
  assert.deepEqual(loops.at(-1), [null, null]);
  assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:13440});
  c.toggleLoop();
  assert.deepEqual(loops.at(-1), [3840,13440]);
  c.restoreLoopState({loopStart:1,loopEnd:2,loopEnabled:false});
  c.updateLoopState(); c.engine.seek(0); c.restoreStartupLoop();
  assert.equal(tick(),0);
  c.clearLoop();
  assert.equal(c.elements.loopToggle.disabled,false);
  c.toggleLoop();
  assert.equal(c.loopStartMeasure,0);
  assert.equal(c.loopEndMeasure,c.sequence.measures.length-1);
  assert.equal(c.loopEnabled,true);
});

test('reload starts at a complete saved loop once; URL endpoints take priority', () => {
  for (const link of [undefined, '3-5', 'invalid']) {
    const {c, tick} = fixture();
    c.restoreLoopState({loopStart: 1, loopEnd: 2}); c.updateLoopState();
    c.pendingLoopLink = link;
    c.restoreStartupLoop();
    assert.equal(tick(), link === '3-5' ? 6720 : 3840);
    assert.equal(c.engine.playing, false);
    c.engine.seek(8);
    c.restoreStartupLoop();
    assert.equal(tick(), 8000, 'later playerReady events cannot rewind the user');
  }
  for (const state of [{}, {loopStart: 1}, {loopEnd: 2}]) {
    const {c, tick} = fixture();
    c.restoreLoopState(state); c.updateLoopState(); c.restoreStartupLoop();
    assert.equal(tick(), 0, 'empty/partial loops do not seek; end-only loops start at zero');
  }
});

test('loop reveal waits for active final layout, then stops following', () => {
  const {c, scrolls} = fixture();
  c.applyLoopLink('2-4');
  assert.equal(scrolls.length, 0, 'no premature scroll before bounds exist');
  c.playbackCursorBounds = () => ({width: 100, height: 200});
  c.window.frameElement = {inert: true, getAttribute: () => 'true'};
  c.revealPendingLoopStart(); assert.equal(scrolls.length, 0);
  c.window.frameElement = null;
  c.notationRenderInFlight = true;
  c.revealPendingLoopStart(); assert.equal(scrolls.length, 0);
  c.notationRenderInFlight = false;
  c.flow = 'continuous';
  c.revealPendingLoopStart();
  assert.deepEqual(scrolls, [['down', 'auto', true], ['left', 'auto', true]]);
  assert.equal(c.pendingLoopRevealTick, null);
  c.revealPendingLoopStart(); assert.equal(scrolls.length, 2);
  c.applyLoopLink('2-4');
  c.pendingLoopRevealTick = 3840;
  c.engine.seek(9);
  c.revealPendingLoopStart();
  assert.equal(c.pendingLoopRevealTick, null, 'a manual seek cancels delayed restoration');
});

test('loop reveal synchronizes extent and paused cursor before reading scroll geometry', () => {
  const {c} = fixture(), calls = [];
  c.flow = 'continuous';
  c.syncNotationOverflow = () => calls.push('extent');
  c.api.customCursorHandler = {
    sync: tick => calls.push(['cursor', tick]), release: () => calls.push('release'),
  };
  c.playbackCursorBounds = () => { calls.push('bounds'); return {width: 3, height: 200}; };
  c.scrollToPlayback = direction => calls.push(direction);
  c.applyLoopLink('2-4');
  assert.deepEqual(calls, ['extent', ['cursor', 3840], 'release', 'bounds', 'down', 'left']);
  assert.equal(c.pendingLoopRevealTick, null);
});

test('loop reveal retains its target until notation cursor objects are attached', () => {
  const {c, scrolls} = fixture();
  c.playbackCursorBounds = () => ({width: 3, height: 200});
  c.api.customCursorHandler = {sync: () => false, release() {}};
  c.applyLoopLink('2-4');
  assert.equal(c.pendingLoopRevealTick, 3840);
  assert.equal(scrolls.length, 0);
  c.api.customCursorHandler.sync = () => true;
  c.revealPendingLoopStart();
  assert.equal(c.pendingLoopRevealTick, null);
  assert.equal(scrolls.length, 1);
});

test('URL endpoints are exclusive positions with optional beat and fraction precision', () => {
  const {c} = fixture();
  for (const link of ['2-4', '2.1.0-4.1.0', '2.1-4.1', ' 2 - 4 ']) {
    assert.deepEqual(plain(c.parseLoopLink(link)), {start:3840, end:13440}, link);
  }
  assert.deepEqual(plain(c.parseLoopLink('4-5')), {start:13440, end:14400});
  assert.deepEqual(plain(c.parseLoopLink('1.1.0-5.1.0')), {start:0, end:14400});
});

test('fractional addresses stay exact for entrances, but loop links expand to whole measures', () => {
  const {c} = fixture();
  assert.equal(c.loopAddressTick('2.2.75'), 4680);
  assert.equal(c.loopAddressTick('3.6.5'), 12000);
  assert.equal(c.loopAddressTick('2.2.05'), 4344);
  assert.equal(c.loopAddressTick('2.2.125'), 4380);
  assert.deepEqual(plain(c.parseLoopLink('2.2.75-3.6.5')), {start:3840, end:13440});
  assert.deepEqual(plain(c.parseLoopLink('2.2.05-2.2.125')), {start:3840, end:6720});
  for (const link of ['0-1','2-1','2-2','2.1.0-2.1.0','1-6','1-5.2.0','1-4.2.0','4.1.5-4.2',
    '1.5.0-2.2','2.7.0-3.1','1.0.5-2','-1-2','1-2-3','1e1-2','NaN-2','Infinity-2',
    '1.1.-1-2','1.1.x-2','1..5-2','',undefined,null,{},'9'.repeat(101)]) {
    assert.equal(c.parseLoopLink(link), null, String(link));
  }
});

test('query and hash loop fields accept encoded values, prefer hash, and consume only loop', () => {
  const {c} = fixture('https://example.test/song/?part=B2&%6coop=2-3&keep=1#the-seed&LOOP=2.2.75-3.6.5');
  assert.equal(c.loopLinkValue('?loop=1-2', '#the-seed&loop=2.2.75%2D3.6.5'), '2.2.75-3.6.5');
  assert.equal(c.loopLinkValue('?part=B2', '#the-seed'), undefined);
  assert.equal(c.loopLinkValue('?loop=1-2', '#loop='), '');
  assert.equal(c.parseLoopLink(c.loopLinkValue('?loop=%E0%A4%A')), null);
  c.consumeLoopLink();
  assert.equal(c.window.location.href, 'https://example.test/song/?part=B2&keep=1#the-seed');
});

test('loop arrival waits for readiness, then overrides a saved loop without autoplay', () => {
  const {c, saved, loops, tick} = fixture();
  c.ready = false;
  assert.equal(c.applyLoopLink('2.2.75-3.6.5'), true);
  assert.equal(c.pendingLoopLink, '2.2.75-3.6.5');
  assert.equal(saved.length, 0);
  c.ready = true;
  c.engine.playing = true;
  c.applyLoopLink(c.pendingLoopLink);
  assert.equal(c.engine.playing, false);
  assert.equal(tick(), 3840);
  assert.deepEqual(loops.at(-1), [3840,13440]);
  assert.deepEqual(saved.at(-1), {loopStart:1,loopEnd:2,loopStartTick:null,loopEndTick:null});
  assert.equal(c.elements.loopStart.textContent, '2');
  assert.equal(c.elements.loopEnd.textContent, '3');
  assert.match(c.elements.loopEnd.title, /inclusive/);
  assert.equal(c.applyLoopLink('2-4'), true);
  assert.deepEqual(saved.at(-1), {loopStart:1,loopEnd:2,loopStartTick:null,loopEndTick:null});
  assert.equal(c.elements.loopEnd.textContent, '3');
  assert.match(c.elements.loopEnd.title, /inclusive/);
});

test('invalid links do not overwrite a saved loop, seek, pause, or save', () => {
  const {c, saved, loops, tick, messages} = fixture();
  c.applyLoopLink('2-4');
  c.engine.playing = true;
  assert.equal(c.applyLoopLink('3.7.9-2.1.0'), false);
  assert.equal(c.engine.playing, true);
  assert.equal(tick(), 3840);
  assert.equal(saved.length, 1);
  assert.equal(loops.length, 1);
  assert.match(messages.at(-1), /unchanged/);
});

test('saved fractional loops migrate to whole measures, and corrupt ranges are rejected', () => {
  const {c, saved} = fixture();
  c.applyLoopLink('2.2.75-3.6.5');
  const state = saved.at(-1);
  c.clearLoop();
  c.restoreLoopState(state);
  assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:13440});
  c.restoreLoopState({loopStart:1,loopEnd:2,loopStartTick:4680,loopEndTick:12000});
  assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:13440});
  assert.equal(c.loopStartTick, null);
  assert.equal(c.loopEndTick, null);
  c.restoreLoopState({loopStart:1,loopEnd:2});
  assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:13440});
  c.restoreLoopState({loopStart:null,loopEnd:1});
  assert.deepEqual(plain(c.loopTickRange()), {start:0,end:6720});
  c.restoreLoopState({loopStart:1,loopEnd:null});
  assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:null});
  for (const invalid of [{...state,loopStartTick:-1}, {...state,loopEndTick:14400},
    {...state,loopEndTick:'12000'}, {...state,loopStart:99}, {loopStart:2,loopEnd:1}]) {
    c.restoreLoopState(invalid);
    assert.equal(c.loopStartMeasure, null);
    assert.equal(c.loopEndMeasure, null);
  }
});

test('manual endpoints and restored links use whole measures; clear resets both', () => {
  const {c, saved, loops} = fixture();
  c.applyLoopLink('2.2.75-3.6.5');
  c.setLoopPoint('start');
  assert.deepEqual(loops.at(-1), [3840,13440]);
  c.engine.seek(7);
  c.setLoopPoint('end');
  assert.deepEqual(loops.at(-1), [3840,13440]);
  c.clearLoop();
  assert.deepEqual(loops.at(-1), [null,null]);
  assert.deepEqual(saved.at(-1), {loopStart:null,loopEnd:null,loopStartTick:null,loopEndTick:null});
});

test('a saved loop can render its controls before the playback clock exists', () => {
  const {c} = fixture();
  c.restoreLoopState({loopStart:1,loopEnd:2});
  const engine=c.engine;
  c.engine=null;
  assert.doesNotThrow(()=>c.updateLoopState());
  assert.equal(c.elements.loopStart.textContent,'2');
  c.engine=engine;
  c.updateLoopState();
  assert.equal(c.elements.loopEnd.textContent,'3');
});

test('recording entrance metadata never changes repeat boundaries, at any practice speed', () => {
  const {c} = fixture();
  c.window.MeleteRecording = require('../template/loop_recorder.js');
  c.recordCountIn = false;
  c.parts = [{short:'B2'}, {short:'S1'}, {short:'A2'}];
  c.config = {recordingEntrances:[{loop:'2-4',parts:{B2:'2.3',S1:'1.4',A2:'2'}}]};
  c.engine.hasLoop = () => true;
  vm.runInContext(source('recordingLoopSpec'), c);
  c.applyLoopLink('2-4');
  for (const rate of [.5, 1, 1.5]) for (const part of [0, 1, 2]) {
    c.engine.rate = rate;
    c.practicePartIndex = part;
    const spec = plain(c.recordingLoopSpec());
    assert.equal(spec.label, '2-4');
    assert.equal(spec.start, 3840);
    assert.equal(spec.end, 13440);
    assert.ok(Math.abs(spec.seconds - 9.6 / rate) < 1e-9);
    const entry = [4800, 2880, 3840][part];
    const preparation = [3840, 960, 960][part];
    assert.equal(spec.initial.entry, entry);
    assert.equal(spec.initial.start, preparation);
    assert.equal(spec.initial.label, part === 0 ? '2-4' : '1.2-4');
    assert.ok(Math.abs(spec.initial.seconds - (13440 - preparation) / 1000 / rate) < 1e-9);
    assert.deepEqual(plain(c.loopTickRange()), {start:3840,end:13440});
  }
});

test('free recording uses the exact playhead, and archived audition entries stay dormant', () => {
  const {c} = fixture();
  c.recordCountIn = false;
  c.window.MeleteRecording = require('../template/loop_recorder.js');
  c.parts = [{short:'B2'}]; c.practicePartIndex = 0; c.engine.rate = 1;
  c.config = {audition: {enabled:false,recordingEntrances:[{loop:'2-4',parts:{B2:'2.3'}}]}};
  vm.runInContext(source('recordingLoopSpec'), c);
  for (const seconds of [0, 4.32, 7.125, 13.7]) {
    c.engine.seek(seconds);
    const spec = plain(c.recordingLoopSpec());
    assert.equal(spec.mode, 'segment');
    assert.equal(spec.start, seconds * 1000);
    assert.equal(spec.initial.entry, spec.start);
    assert.equal(spec.initial.start, spec.start);
    assert.equal(spec.initial.leadInSeconds, 0);
    assert.ok(Math.abs(spec.seconds - (14.4 - seconds)) < 1e-9);
  }
  c.engine.seek(14.4);
  assert.equal(c.recordingLoopSpec(), null, 'end-of-song cannot silently rewind');
  c.engine.seek(.001);
  assert.equal(c.recordingLoopSpec().start, 0, 'opening cursor rounding must not exclude the first note from a full take');
  c.applyLoopLink('2-4');
  assert.equal(c.recordingLoopSpec().initial.entry, 3840, 'disabled audition uses ordinary loop entry');
  for (const rate of [.5,1,1.5]) for (const position of [2.123,4.321,7.125,13.1]) {
    c.engine.rate=rate;c.engine.seek(position);
    const spec=plain(c.recordingLoopSpec());
    assert.equal(spec.initial.start,position*1000,'manual starts are never snapped to beats or loop start');
    assert.equal(spec.initial.entry,spec.initial.start);
    assert.equal(spec.initial.leadInSeconds,0);
    assert.ok(Math.abs(spec.initial.seconds-(13.44-position)/rate)<1e-9);
    assert.equal(spec.start,3840,'repeats retain their original start');
    assert.equal(spec.end,13440);
  }
  c.engine.seek(13.7);
  const afterLoop=plain(c.recordingLoopSpec());
  assert.equal(afterLoop.mode,'segment','starting after a loop records onward, not backward');
  assert.equal(afterLoop.start,13700);
  assert.equal(afterLoop.end,14400);
  assert.equal(afterLoop.initial.leadInSeconds,0);
  c.engine.seek(3.84);
  c.config.audition.enabled = true;
  assert.equal(c.recordingLoopSpec().initial.entry, 4800, 'same stored preset works when enabled');
  assert.equal(c.recordingLoopSpec().mode, 'loop');
});
