const {test} = require('node:test');
const assert = require('node:assert/strict');
const vocal = require('../template/vocal_pitch.js');
const pitch = require('../template/take_pitch.js');

function contour(values, hop = .01) {
  return values.map((cents, i) => ({start: i * hop, end: (i + 1) * hop, cents}));
}
const flat = (count, cents = 5700) => Array(count).fill(cents);
const movingOnset = [4592,4607,4630,4676,4645,null,4728,null,4722,3505,3500,
  4649,4545,4496,4492,4501,4528,4547,4557,4563,4558,4560];
test('m15 moving onset: brief octave dip survives neither capture nor saved-grid loading', () => {
  const frames = contour(movingOnset, 1 / 64);
  const result = vocal.repairOctaveIslands(frames);
  result.forEach((frame, i) => {
    assert.equal(frame.cents, frames[i].cents === null ? null : frames[i].cents + (i === 9 || i === 10 ? 1200 : 0));
    assert.equal(frame.start, frames[i].start);
    assert.equal(frame.end, frames[i].end);
  });
  assert.equal(vocal.repairOctaveIslands(result), result);
});
test('moving-onset rule needs support on both sides and never repairs other intervals or long islands', () => {
  for (const values of [
    movingOnset.map((v,i)=>i===9||i===10?v+500:v),
    [...movingOnset.slice(0,9), ...flat(6,3505), ...movingOnset.slice(11)],
    [...movingOnset.slice(0,11), ...flat(10,4800)],
    [...movingOnset.slice(0,11),4649,4545],
    [...flat(7,null),4722,4722,...movingOnset.slice(9)],
    [...movingOnset.slice(0,10),...flat(4,null),...movingOnset.slice(10)],
  ]) {
    const frames=contour(values,1/64);
    assert.equal(vocal.repairOctaveIslands(frames),frames);
  }
  const upper=contour(movingOnset.map((v,i)=>i===9||i===10?v+2400:v),1/64);
  assert.equal(vocal.repairOctaveIslands(upper)[9].cents,4705);
  const missing=contour(movingOnset,1/64);missing.splice(10,1);
  assert.equal(vocal.repairOctaveIslands(missing),missing);
});
test('legacy grid repair requires known timing or explicit raw-matched repair annotations', () => {
  const raw=Uint16Array.from(movingOnset,v=>v||0);
  assert.equal(vocal.repairPitchGrid(raw).pitches,raw,'score ticks alone are not elapsed recording time');
  const restored=vocal.restorePitchGrid(raw,[[9,3505,4705],[10,3500,4700]]);
  assert.equal(restored.pitches[9],4705);
  assert.deepEqual(vocal.rawPitchGrid(restored.pitches,restored.rawOctaves),raw);
  assert.equal(vocal.restorePitchGrid(raw,[[9,3500,4700],[10,3500,5500],[-1,3500,4700],null]).pitches,raw);
  const slow=vocal.repairPitchGrid(raw,i=>i/64/.25);
  assert.equal(slow.pitches[9],0,'a 125 ms excursion is omitted, not guessed into the other octave');
  assert.deepEqual(vocal.rawPitchGrid(slow.pitches,slow.rawOctaves),raw);
  assert.equal(vocal.repairPitchGrid(raw,i=>i/64/.1).pitches,raw,'a sustained register change is retained');
});
test('brief octave islands repair up and down, preserving cents deviations and every timestamp', () => {
  for (const shift of [-1200, 1200]) for (const hop of [.005, .01, .02]) {
    const n = Math.ceil(.04 / hop) + 1, count = Math.round(.04 / hop);
    const values = [...flat(n), ...Array.from({length: count}, (_, i) => 5713.123456 + i + shift), ...flat(n, 5710)];
    const input = contour(values, hop), copy = structuredClone(input), result = vocal.repairOctaveIslands(input);
    assert.deepEqual(input, copy, 'raw estimates are not mutated');
    result.forEach((frame, i) => {
      assert.equal(frame.start, input[i].start); assert.equal(frame.end, input[i].end);
      if (i >= n && i < n + count) {
        assert.equal(frame.cents, input[i].cents - shift);
        assert.equal(frame.rawCents, input[i].cents);
      } else assert.equal(frame, input[i]);
    });
    assert.equal(vocal.repairOctaveIslands(result), result, 'cleanup is idempotent');
  }
});
test('sustained octaves, other intervals, unstable flanks, glides and unbounded edges stay real', () => {
  for (const values of [
    [...flat(10), ...flat(9, 6900), ...flat(10)],
    [...flat(10), ...flat(20, 6900)],
    [...flat(10, 6900), ...flat(20)],
    [...flat(10), ...flat(3, 6400), ...flat(10)],
    [...flat(10), 6000, 6300, 6600, 6900, 6600, 6300, 6000, ...flat(10)],
    [...flat(10), ...flat(3, 6900), ...flat(10, 5800)],
    [5700, 5800, 5650, 5750, 5700, ...flat(3, 6900), ...flat(10)],
    [...flat(10), ...flat(3, 6900), 5700, 5800, 5650, 5750, 5700],
    [...flat(2), ...flat(3, 6900), ...flat(10)],
    [...flat(10), ...flat(3, 6900), ...flat(2)],
    [...flat(30, 4500)],
    Array.from({length: 60}, (_, i) => 5700 + 60 * Math.sin(i * .4)),
  ]) {
    const frames = contour(values);
    assert.equal(vocal.repairOctaveIslands(frames), frames, JSON.stringify(values));
  }
});
test('take 84 m19 seven-frame dropout is repaired, while a sustained octave stays intact', () => {
  const wrong = [4088.541354249925,4082.1037489754012,4078.5866491311062,
    4076.3612328455465,4076.7744806257283,4076.9214705117947,4084.3428005027135];
  const frames = contour([...flat(10,5310),...wrong,...flat(10,5312)]);
  const result = vocal.repairOctaveIslands(frames);
  wrong.forEach((cents,i)=>assert.equal(result[10+i].cents,cents+1200));
  assert.ok(result.slice(10,17).every((f,i)=>f.rawCents===wrong[i]));
  const ref={version:1,fingerprint:'take84-regression',part:0,line:null,start:0,end:960,
    rate:1,seconds:frames.at(-1).end,latency:0,notes:[[0,frames.at(-1).end,[53]]]};
  const after=pitch.scoreFrames(result,ref,ref.seconds),before=pitch.scoreFrames(frames,ref,ref.seconds);
  assert.ok(Math.abs(after.meanAbsCents-before.meanAbsCents)<1e-10);
  assert.deepEqual({...after,meanAbsCents:0},{...before,meanAbsCents:0});
});
test('short dropouts supply context, not invented tracking or changed pitch-class scores', () => {
  for (const index of [9, 10, 11, 13, 14, 15]) {
    const frames = contour([...flat(10), ...flat(3, 6900), ...flat(10)]);
    frames[index].cents = null;
    const result = vocal.repairOctaveIslands(frames);
    assert.equal(result[index], frames[index], 'unvoiced observation remains unchanged');
    assert.ok(result.every(f => f.cents === null || f.cents === 5700));
  }
  // The actual m4 failure: one wrong sample, one correct sample, a 200 ms
  // dropout, then two wrong samples before the steady note returns.
  for (const gap of [1, 20, 25]) for (const shift of [-1200, 1200]) {
    const frames = contour([...flat(10), 5711.25 + shift, 5710, ...flat(gap, null),
      5712.25 + shift, 5713.25 + shift, ...flat(10, 5710)]);
    const result = vocal.repairOctaveIslands(frames);
    assert.equal(result[10].cents, 5711.25);
    assert.equal(result[12 + gap].cents, 5712.25);
    assert.equal(result[13 + gap].cents, 5713.25);
    for (let i = 12; i < 12 + gap; i++) assert.equal(result[i], frames[i]);
    assert.equal(vocal.repairOctaveIslands(result), result);
    const seconds = frames.at(-1).end;
    const ref = {version: 1, fingerprint: 'dropout', part: 0, line: null, start: 0, end: 960,
      rate: 1, seconds, latency: 0, notes: [[0, seconds, [57]]]};
    assert.deepEqual(pitch.scoreFrames(frames, ref, seconds), pitch.scoreFrames(result, ref, seconds));
  }
});
test('long dropouts, conflicting pitches, missing observations and slow sampling block repairs', () => {
  for (const middle of [flat(26, null), [...flat(10, null), 6000, ...flat(10, null)],
    [...flat(10, null), ...flat(7, 6900)]]) {
    const frames = contour([...flat(10), 6900, 5700, ...middle, 6900, 6900, ...flat(10)]);
    assert.equal(vocal.repairOctaveIslands(frames), frames);
  }
  for (const hop of [.03, .05, .1]) {
    const frames = contour([...flat(10), ...flat(3, 6900), ...flat(10)], hop);
    assert.equal(vocal.repairOctaveIslands(frames), frames, 'three samples is not a fixed duration');
  }
  const frames = contour([...flat(10), ...flat(3, 6900), ...flat(10)]);
  frames.splice(11, 1);
  assert.equal(vocal.repairOctaveIslands(frames), frames);
});
test('old caches get repaired without FFT, raw cache survives repacking and pitch-class scores stay equal', () => {
  const sr = 48000, values = [...flat(10), ...flat(3, 6907.25), ...flat(10)];
  const ref = {version: 1, fingerprint: 'octaves', part: 0, line: null, start: 0, end: 960,
    rate: 1, seconds: values.length / 100, latency: 0, notes: [[0, values.length / 100, [57]]]};
  const take = {sampleRate: sr, frames: values.length * 480, pitchReference: ref};
  const raw = values.map((cents, i) => ({start: i * 480 / sr, end: (i + 1) * 480 / sr, cents}));
  take.pitchContour = pitch.packContour(raw, take);
  const decoded = pitch.readContour(take);
  assert.equal(decoded[11].cents, 5707.25);
  assert.equal(take.pitchContour.pitches[11], 6907.25);
  assert.deepEqual(pitch.packContour(decoded, take), take.pitchContour);
  assert.deepEqual(pitch.scoreFrames(raw, ref, ref.seconds), pitch.scoreFrames(decoded, ref, ref.seconds));
});
test('new take analysis uses the same filter without changing confidence or silence coverage', () => {
  const values = [...flat(10), ...flat(3, 6907.25), ...flat(10), null, ...flat(10, 4500)];
  let index = 0;
  const detector = {forFloat32Array() { return {findPitch() {
    const cents = values[index++];
    return cents === null ? [0, 0] : [440 * 2 ** ((cents - 6900) / 1200), 1];
  }}; }};
  // A null result triggers a rumble retry; include a duplicate in that stub.
  values.splice(24, 0, null);
  const count = values.length - 1, seconds = count / 100;
  const ref = {version: 1, fingerprint: 'octaves', part: 0, line: null, start: 0, end: 960,
    rate: 1, seconds, latency: 0, notes: [[0, seconds, [57]]]};
  const pcm = new Int16Array(count * 480).fill(1000);
  const result = pitch.analyse(pcm, 48000, ref, detector, {includeFrames: true});
  assert.ok(Math.abs(result.frames[11].cents - 5707.25) < 1e-9);
  assert.ok(Math.abs(result.frames[11].rawCents - 6907.25) < 1e-9);
  assert.equal(result.frames[23].cents, null);
  assert.equal(result.frames.at(-1).cents, 4500, 'genuine octave-down singing stays in its octave');
  assert.ok(Math.abs(result.trackedSeconds - (seconds - .01)) < 1e-8);
});
