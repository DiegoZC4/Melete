const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {PitchDetector} = require('./pitch-fixture.cjs');
const vocal = require('../template/vocal_pitch.js');
const take = require('../template/take_pitch.js');
const live = require('../template/live_pitch.js');
const usable = ([f, clarity]) => f >= 55 && f <= 1200 && clarity >= .85;
const waveform = (sr, hz, size = 4096, rumble = 0, offset = 0) => Float32Array.from({length: size}, (_, i) => {
  const t = (i + offset) / sr;
  return .01 * Math.sin(2 * Math.PI * hz * t) + .005 * Math.sin(4 * Math.PI * hz * t)
    + rumble * Math.sin(2 * Math.PI * 23 * t);
});

test('sub-bass rumble no longer hides a clear bass fundamental; input stays unchanged', () => {
  for (const sr of [44100, 48000]) {
    const input = waveform(sr, 117, 4096, .01), original = input.slice();
    const raw = PitchDetector.forFloat32Array(4096).findPitch(input, sr);
    assert.ok(raw[0] < 55 && raw[1] > .85, JSON.stringify(raw));
    const fixed = vocal.createDetector(PitchDetector, 4096).findPitch(input, sr);
    assert.ok(usable(fixed) && Math.abs(1200 * Math.log2(fixed[0] / 117)) < 8, JSON.stringify(fixed));
    assert.deepEqual(input, original);
  }
});

test('already confident pitches stay exactly unchanged across bass and soprano ranges', () => {
  for (const sr of [16000, 44100, 48000, 96000]) {
    const raw = PitchDetector.forFloat32Array(4096), fixed = vocal.createDetector(PitchDetector, 4096);
    for (const hz of [55.01, 65.406, 82.407, 116.541, 220, 440, 880, 1174.659]) {
      const input = waveform(sr, hz);
      const before = raw.findPitch(input, sr);
      assert.ok(usable(before), `${sr}: ${hz}: ${before}`);
      assert.deepEqual(fixed.findPitch(input, sr), before);
    }
  }
});

test('silence, DC, unpitched noise, and out-of-range rumble do not become singing', () => {
  let seed = 5;
  const noise = () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed / 2 ** 32 - .5) * .1; };
  const detector = vocal.createDetector(PitchDetector, 4096);
  const cases = [new Float32Array(4096), new Float32Array(4096).fill(.1)];
  for (let i = 0; i < 20; i++) cases.push(Float32Array.from({length: 4096}, noise));
  for (const hz of [23, 35, 45]) {
    cases.push(Float32Array.from({length: 4096}, (_, i) => .1 * Math.sin(2 * Math.PI * hz * i / 48000)));
  }
  for (const input of cases) assert.equal(usable(detector.findPitch(input, 48000)), false);
});

test('rumble recovery uses waveform evidence, not the expected score pitch or octave', () => {
  const sr = 48000;
  const pcm = Int16Array.from(waveform(sr, 117, sr * 2, .01), x => Math.round(x * 32768));
  const ref = {version: 1, fingerprint: 'rumble', part: 0, line: null, start: 0, end: 2,
    rate: 1, seconds: 2, latency: 0, notes: [[0, 2, [46]]]};
  const score = take.analyse(pcm, sr, ref, PitchDetector, {includeFrames: true});
  const wrongOctave = take.analyse(pcm, sr, {...ref, notes: [[0, 2, [58]]]}, PitchDetector, {includeFrames: true});
  assert.ok(score.coverage > .95 && score.meanAbsCents < 15, JSON.stringify(score));
  assert.equal(wrongOctave.coverage, score.coverage);
  assert.ok(wrongOctave.meanAbsCents < 15, JSON.stringify(wrongOctave));
  assert.deepEqual(wrongOctave.frames, score.frames, 'octave-aware grading never shifts detector output to the score');
  assert.ok(wrongOctave.frames.some(f => f.cents > 4550 && f.cents < 4650));
});

test('live and take workers bundle the shared detector without network dependencies', () => {
  const results = [], context = {Pitchy: {PitchDetector}, performance: {now: () => 0},
    postMessage: value => results.push(value)};
  context.self = context;
  vm.runInNewContext(live.workerSource(''), context);
  context.onmessage({data: {input: waveform(48000, 117, 4096, .01), sampleRate: 48000,
    previous: null, minimum: 55, maximum: 1200}});
  assert.ok(usable(results[0].result));
  assert.ok(Math.abs(results[0].result[0] - 117) < 1);
  assert.match(take.workerSource(''), /MeleteVocalPitch/);
  assert.doesNotMatch(take.workerSource(''), /fetch\(|importScripts/);
});
