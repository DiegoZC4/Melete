const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');

function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}

function fixture() {
  let now = 0, id = 0;
  const timers = new Map(), classes = new Set(), draws = [];
  const context = vm.createContext({
    scoreView: 'bars', barTraceResumeTimer: 0, barRenderFrame: 0,
    barSystems: ['current'], elements: {barScore: {classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
    }}},
    window: {clearTimeout: key => timers.delete(key), setTimeout: (fn, ms) => {
      timers.set(++id, {fn, at: now + ms}); return id;
    }},
    renderPitchTrace: systems => draws.push([...systems]),
  });
  vm.runInContext(source('deferBarPitchTrace'), context);
  return {context, classes, draws, timers, advance(ms) {
    now += ms;
    for (const [key, timer] of [...timers]) if (timer.at <= now) {
      timers.delete(key); timer.fn();
    }
  }};
}

test('horizontal scaling hides the overlay immediately and redraws only after the latest edit settles', () => {
  const f = fixture(), c = f.context;
  c.deferBarPitchTrace();
  assert.equal(f.classes.has('is-rescaling'), true);
  f.advance(150);
  c.deferBarPitchTrace();
  c.barSystems = ['new scale'];
  f.advance(199);
  assert.equal(f.draws.length, 0);
  assert.equal(f.timers.size, 1);
  f.advance(1);
  assert.deepEqual(f.draws, [['new scale']]);
  assert.equal(f.classes.has('is-rescaling'), false);
  assert.equal(c.barTraceResumeTimer, 0);
});

test('a pending bar reflow owns the final draw and standard notation is never deferred', () => {
  const f = fixture(), c = f.context;
  c.deferBarPitchTrace(); c.barRenderFrame = 42;
  f.advance(200);
  assert.equal(f.draws.length, 0, 'avoid painting old geometry before the pending bar frame');
  assert.equal(c.barTraceResumeTimer, 0, 'the pending bar frame can paint normally');
  c.barRenderFrame = 0; c.deferBarPitchTrace(); c.scoreView = 'standard';
  f.advance(200);
  assert.equal(f.draws.length, 0, 'a view switch cannot revive an obsolete bar overlay');
  assert.equal(f.classes.has('is-rescaling'), false);
  c.deferBarPitchTrace();
  assert.equal(f.timers.size, 0);
});

test('both full and incremental bar-contour painting are suspended without clearing data', () => {
  const f = fixture(), c = f.context;
  const painted = [], dirty = new Map([[0, new Set([5])]]);
  const system = (name, staff = false) => ({
    pointAtPitch: staff ? () => null : null, minPitch: 40, maxPitch: 80,
    traceLayer: {replaceChildren: () => painted.push(name)},
    traceEdges: new Map(), traceEdgesByBin: new Map(),
  });
  Object.assign(c, {barSystems: [system('bars')], staffTraceSystems: [system('staff', true)],
    pitchTraceDirty: dirty, pitchTraceLaneList: () => [], takeReview: null, visibleChannels:new Set([0]), audibleTraceReviews:()=>[], liveTraceVisible:()=>false,
    pitchTraceRange: () => ({min: 48, max: 60}), updatePitchCaptureAppearance() {},
    scheduleBarRender() { throw new Error('unexpected reflow'); },
  });
  vm.runInContext(source('renderPitchTrace') + '\n' + source('updatePitchTraceIncrementally'), c);
  c.deferBarPitchTrace();
  c.renderPitchTrace(c.barSystems);
  c.updatePitchTraceIncrementally(dirty);
  assert.deepEqual(painted, []);
  assert.equal(dirty.size, 1, 'render deferral does not erase captured observations');
  f.advance(200);
  assert.deepEqual(painted, ['bars']);
  assert.equal(dirty.size, 0);
});

test('the shared horizontal control enables deferral before scheduling geometry', () => {
  assert.match(app, /horizontalScale\.addEventListener\("input", \(\) => \{ deferBarPitchTrace\(\); savePreferences\(\); scheduleRender\(\); \}\)/);
  const css = fs.readFileSync(path.join(__dirname, '../template/styles.css'), 'utf8');
  assert.match(css, /#barScore\.is-rescaling \.bar-pitch-trace-layer\s*\{ display: none; \}/);
});
