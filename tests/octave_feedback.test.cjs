const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pitch = require('../template/take_pitch.js');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}

test('live and review colors agree on octave equivalents without forgiving another pitch class', () => {
  const c = vm.createContext({window: {MeleteTakePitch: pitch}, practicePartIndex: 0, practiceDivisi:[null],
    pitchRestState: () => 'sing',
    liveTraceVisible: () => false,
    expectedPitchAt: () => [[0, 0, 1, 69]], clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    PITCH_TRACE_GREEN_TOLERANCE_CENTS: 10, PITCH_TRACE_RED_CENTS: 50});
  for (const fn of ['expectedPitchErrorCents', 'pitchTraceColor']) vm.runInContext(source(fn), c);
  for (const octave of [-2, -1, 0, 1, 2]) {
    assert.equal(c.expectedPitchErrorCents(0, 6900 + octave * 1200), 0);
    assert.equal(c.pitchTraceColor(octave * 1200), 'rgb(0 255 0)');
    assert.equal(c.pitchTraceColor(octave * 1200 + 50), 'rgb(255 0 0)');
  }
  c.expectedPitchAt = () => [[0, 0, 1, 69], [0, 0, 1, 65]];
  assert.equal(c.expectedPitchErrorCents(0, 5700), 0, 'All Div compares pitch classes before choosing the closest target');
  c.expectedPitchAt = () => [[0, 0, 1, 65]];
  assert.equal(c.expectedPitchErrorCents(0, 5700), 400, 'a selected divisi retains its own target');
});

test('pitchbar bounds include the sung register but not a hidden practice contour', () => {
  const c = vm.createContext({
    liveTraceVisible: () => false,
    window: {MeleteTakeRender: require('../template/take_render.js')},
    engine: {secondsAtTick: tick => tick},
    pitchRestState: () => 'sing',
    pitchTraceLaneList: () => [[0, {pitches: [6000, 3600, 8400, 6200]}]],
    occupiedPitchBinsForSystem: () => [0, 1, 2, 3],
    pitchTraceTickAtBin: bin => bin,
    takeReview: {start: 1, end: 3, rate: 1,
      frames: [{start: 0, end: 1, cents: 5500}, {start: 1, end: 2, cents: 5700}]},
  });
  vm.runInContext(source('pitchTraceRange'), c);
  c.audibleTraceReviews=()=>c.takeReview?[c.takeReview]:[];
  const range = () => ({...c.pitchTraceRange(0, 4)});
  assert.deepEqual(range(), {min: 55, max: 57}, 'only the selected saved contour contributes while not recording');
  c.takeReview.ranges = [[2, 3]];
  assert.deepEqual(range(), {min: 55, max: 57}, 'comp gaps never reveal an obsolete standalone contour');
  c.liveTraceVisible=()=>true;
  assert.deepEqual(range(), {min:36,max:84}, 'recording over a selected take still makes room for the live sung register');
  c.liveTraceVisible=()=>false;
  c.takeReview = null;
  assert.deepEqual(range(), {min: Infinity, max: -Infinity}, 'deselection removes the contour instead of resurrecting raw data');
  c.liveTraceVisible=()=>true;
  assert.deepEqual(range(), {min:36,max:84}, 'active recording still contributes its actual sung register');
});
