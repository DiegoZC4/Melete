const assert = require('node:assert/strict');
const test = require('node:test');
const pitch = require('../template/take_pitch.js');
const {TakeJournal} = require('../template/loop_recorder.js');

const reference = overrides => ({version: 1, fingerprint: 'score-one', part: 0, line: null,
  start: 0, end: 4, rate: 1, seconds: 4, latency: 0, notes: [[0, 4, [69]]], ...overrides});
const frame = (start, end, cents) => ({start, end, cents});

test('cloud display metrics sort alongside local analysis without percent/unit mismatches', () => {
  const local = {id:'local',pitchScore:pitch.scoreFrames([frame(0,2,6920),frame(2,4,null)],reference(),4)};
  const cloud = {id:'cloud',metrics:{tracked:80,mean:15,median:12,within:90}};
  const missing = {id:'pending',metrics:{tracked:null,mean:null,median:null,within:null}};
  for(const column of ['tracked','mean','median','within']) {
    const rows=[cloud,missing,local].sort((a,b)=>pitch.compareTakes(a,b,{column,direction:'ascending'}));
    assert.equal(rows.at(-1).id,'pending');
    assert.deepEqual(rows.slice(0,2).map(r=>r.id),column==='tracked'?['local','cloud']:['cloud','local']);
  }
  assert.ok(pitch.compareTakes(cloud,{...local,segmentCount:2},{column:'segments',direction:'ascending'})>0,
    'source take count is not a segment count; unavailable segments stay last');
});

test('mean absolute cents error is time-weighted, not note-weighted or signed', () => {
  const ref = reference({notes: [[0, 1, [69]], [1, 4, [72]]]});
  const result = pitch.scoreFrames([frame(0, 1, 6870), frame(1, 4, 7210)], ref, 4);
  assert.equal('score' in result, false, 'no percentage-grade formula remains');
  assert.equal(result.coverage, 1);
  assert.equal(result.meanAbsCents, 15, 'opposite pitch errors must not cancel');
  assert.equal(pitch.validScore(result), true);
  assert.equal(pitch.scoreFrames([frame(0, 4, 6910)], reference(), 4).meanAbsCents, 10);
  assert.equal(pitch.scoreFrames([frame(0, 4, 6950)], reference(), 4).meanAbsCents, 50);
  const precise = pitch.scoreFrames([frame(0, .7, 6901.234567), frame(.7, 4, 6897.654321)], reference(), 4);
  assert.ok(Math.abs(precise.meanAbsCents - (1.234567 * .7 + 2.345679 * 3.3) / 4) < 1e-9);
});

test('median absolute cents error is time-weighted and averages exact halfway bounds', () => {
  const ref = reference();
  const weighted = pitch.scoreFrames([frame(0, 3, 6890), frame(3, 3.5, 6930), frame(3.5, 4, 7100)], ref, 4);
  assert.equal(weighted.medianAbsCents, 10, 'long tracked intervals count more than short ones');
  assert.equal(weighted.meanAbsCents, 36.25);
  const even = pitch.scoreFrames([frame(0, 2, 6890), frame(2, 4, 6930)], ref, 4);
  assert.equal(even.medianAbsCents, 20, 'use magnitudes, not the signed pitch offset');
  assert.equal(pitch.scoreFrames([frame(0, 4, 8100)], ref, 4).medianAbsCents, 0, 'practice accepts octave-equivalent pitches');
  assert.equal(pitch.scoreFrames([frame(0, 4, 6901.234567)], ref, 4).medianAbsCents, Math.abs(6901.234567 - 6900));
});

test('median excludes gaps, rests and count-in, and splits intervals at note changes', () => {
  const ref = reference({leadInSeconds: 1, notes: [[1, 2, [69]], [3, 4, [72]]]});
  const result = pitch.scoreFrames([frame(0, 1, 9999), frame(1, 1.8, 6895), frame(1.8, 2, null),
    frame(2, 3, 9999), frame(3, 3.2, 7220), frame(3.2, 4, null)], ref, 4);
  assert.ok(Math.abs(result.coverage - .5) < 1e-9);
  assert.equal(result.medianAbsCents, 5);
  const crossed = pitch.scoreFrames([frame(0, 4, 6910)], reference({notes: [[0, 1, [69]], [1, 4, [72]]]}), 4);
  assert.equal(crossed.medianAbsCents, 290);
  assert.equal(pitch.scoreFrames([], ref, 4).medianAbsCents, null);
  assert.equal(pitch.scoreFrames([], reference({notes: []}), 4).medianAbsCents, null);
});

test('playbar tracking excludes rests and count-in and maps recorded speed to score time', () => {
  const ref = reference({rate: 2, leadInSeconds: 1, notes: [[1, 2, [69]], [3, 4, [72]]]});
  const result = pitch.reviewTimeline({id: 'take', label: 'Take 1', ref, start: 10, end: 18, rate: 2,
    frames: [frame(0, 1.5, 6900), frame(1.5, 2, null), frame(2, 4, 7200)]}, 30);
  assert.deepEqual(result.segments.map(s => [s.from, s.to]), [[12, 18]]);
  assert.deepEqual(result.expected, [[12, 14], [16, 18]]);
  assert.deepEqual(result.tracked, [[12, 13], [16, 18]]);
  assert.deepEqual(result.missing, [[13, 14]]);
  assert.equal(result.coverage, .75, 'not tracked time divided by total runtime');
  assert.deepEqual(result.seams, []);
});

test('comp playbar preserves source boundaries and unfilled gaps without false tracking', () => {
  const result = pitch.reviewTimeline({ref: reference(), start: 0, end: 4, rate: 1,
    timelineSegments: [{from: 0, to: 1, takeId: 'a'}, {from: 2, to: 3, takeId: 'b'}, {from: 3, to: 4, takeId: 'c'}],
    frames: [frame(0, 4, 6900)]}, 4);
  assert.deepEqual(result.expected, [[0, 1], [2, 4]]);
  assert.deepEqual(result.tracked, [[0, 1], [2, 4]]);
  assert.deepEqual(result.seams, [2, 3]);
  assert.equal(result.segments.length, 3, 'adjacent different sources stay distinct');
  assert.equal(result.coverage, 1, 'unfilled singing is completion, not tracking');
});

test('playbar clips recovery audio and song edges and leaves untracked singing explicit', () => {
  const result = pitch.reviewTimeline({id: 'take', ref: reference(), start: -1, end: 3, rate: 1,
    buffer: {duration: 3}, frames: [frame(0, 4, null)]}, 4);
  assert.deepEqual(result.segments.map(s => [s.from, s.to]), [[0, 2]]);
  assert.deepEqual(result.tracked, []);
  assert.deepEqual(result.missing, [[0, 2]]);
  assert.equal(result.coverage, 0);
  assert.equal(pitch.reviewTimeline(null, 4), null);
  assert.equal(pitch.reviewTimeline({ref: reference()}, 0), null);
});

test('playbar merges detector frames without filling a genuine missing interval', () => {
  const result = pitch.reviewTimeline({ref: reference(), start: 0, end: 4, rate: 1,
    frames: [frame(0, 1, 6900), frame(1, 2, 6901), frame(2, 2.01, null), frame(2.01, 4, 6900)]}, 4);
  assert.deepEqual(result.tracked, [[0, 2], [2.01, 4]]);
  assert.deepEqual(result.missing, [[2, 2.01]]);
  assert.deepEqual(result.covered, [[0, 4]], 'overview ignores a tiny gap without changing exact tracking');
});

test('playbar overview unions rests and breath-sized gaps but retains two-second singing gaps', () => {
  const ref=reference({end:20,seconds:20,notes:[[0,3,[69]],[8,13,[69]],[15,20,[69]]]});
  const frames=[frame(0,1,6900),frame(1,2.5,null),frame(2.5,3,6900),frame(8,9,6900),
    frame(9,11.2,null),frame(11.2,13,6900),frame(15,16.8,null),frame(16.8,20,6900)];
  const before=JSON.stringify(frames), score=pitch.scoreFrames(frames,ref,20);
  const result=pitch.reviewTimeline({id:'a',ref,start:0,end:20,rate:1,frames},20);
  assert.deepEqual(result.gaps,[[9,11.2]]);
  assert.deepEqual(result.covered,[[0,9],[11.2,20]]);
  assert.deepEqual(result.seams,[], 'a continuous take has no artificial endpoint seams');
  assert.deepEqual(result.missing,[[1,2.5],[9,11.2],[15,16.8]]);
  assert.equal(JSON.stringify(frames),before);
  assert.deepEqual(pitch.scoreFrames(frames,ref,20),score, 'overview forgiveness never changes scoring');
});

test('overview includes genuinely unrecorded singing and marks only changes of source take', () => {
  const ref=reference({end:8,seconds:8,notes:[[0,8,[69]]]});
  const result=pitch.reviewTimeline({ref,start:0,end:8,rate:1,
    timelineSegments:[{from:0,to:1,takeId:'a'},{from:1,to:2,takeId:'a'},
      {from:4.5,to:6,takeId:'b'},{from:6,to:8,takeId:'b'}],frames:[frame(0,8,6900)]},8);
  assert.deepEqual(result.gaps,[[2,4.5]]);
  assert.deepEqual(result.covered,[[0,2],[4.5,8]]);
  assert.deepEqual(result.seams,[4.5]);
  assert.equal(result.coverage,1,'tracking remains separate from unfilled song territory');
});

test('rests neither create nor extend a missing-singing gap', () => {
  const ref=reference({end:10,seconds:10,notes:[[0,1.5,[69]],[6,7.5,[69]],[8,10,[69]]]});
  const result=pitch.reviewTimeline({id:'a',ref,start:0,end:10,rate:1,frames:[]},10);
  assert.deepEqual(result.gaps,[[8,10]], 'separate breaths do not accumulate through a long rest');
  assert.deepEqual(result.covered,[[0,8]]);
  assert.equal(result.coverage,0,'a forgiving overview is not a perfect tracking grade');
});

test('gap threshold is two recorded seconds, respects count-in, scope, and adjacent note boundaries', () => {
  for(const rate of [.5,1,2]){
    const ref=reference({rate,leadInSeconds:1,notes:[[1,2,[69]],[2,4,[72]]]});
    const result=pitch.reviewTimeline({id:'a',ref,start:10,end:10+4*rate,rate,
      frames:[frame(0,1,6900),frame(1,3,null),frame(3,4,7200)]},30);
    assert.deepEqual(result.scope,[10+rate,10+4*rate]);
    assert.deepEqual(result.gaps,[[10+rate,10+3*rate]],'a note change does not break a missing-singing run');
    assert.deepEqual(result.covered,[[10+3*rate,10+4*rate]]);
  }
});

test('adding median does not invalidate the detector cache or hide older mean scores', () => {
  const score = pitch.scoreFrames([frame(0, 4, 6910)], reference(), 4);
  assert.equal(pitch.hasMedian(score), true);
  const {medianAbsCents, ...old} = score;
  assert.equal(pitch.validScore(old), true);
  assert.equal(pitch.hasMedian(old), false);
  assert.equal(old.version, pitch.ANALYSIS_VERSION);
  for (const medianAbsCents of [null, NaN, Infinity, -1]) assert.equal(pitch.hasMedian({...score, medianAbsCents}), false);
  const silence = pitch.scoreFrames([], reference(), 4);
  assert.equal(pitch.hasMedian(silence), true);
  assert.equal(pitch.hasMedian({...silence, medianAbsCents: 0}), false);
});

test('octave-aware grading keeps actual pitch, timing, coverage and non-octave errors intact', () => {
  const ref = reference(), frames = [frame(0, 1, 5720), frame(1, 2, 8080), frame(2, 3, 9400), frame(3, 4, null)];
  const before = JSON.stringify(frames), result = pitch.scoreFrames(frames, ref, 4);
  assert.equal(result.coverage, .75);
  assert.equal(result.meanAbsCents, 140 / 3);
  assert.equal(result.medianAbsCents, 20);
  assert.equal(result.within50CentsSeconds, 2);
  assert.equal(JSON.stringify(frames), before);
  assert.equal(pitch.currentScore(result), true);
  assert.equal(pitch.currentScore({...result, scoringVersion: undefined}), false);
  for (const octave of [-2, -1, 0, 1, 2]) {
    assert.equal(pitch.octaveError(octave * 1200 + 25), 25);
    assert.equal(pitch.octaveError(octave * 1200 - 25), -25);
    assert.equal(pitch.scoreFrames([frame(0, 4, 6900 + octave * 1200)], ref, 4).meanAbsCents, 0);
  }
  assert.equal(pitch.scoreFrames([frame(0, 4, 5800)], ref, 4).meanAbsCents, 100, 'a semitone off is still a wrong note');
});

test('50-cent time distinguishes brief large jumps from longer wrong notes with identical mean and median', () => {
  const ref = reference();
  const brief = pitch.scoreFrames([frame(0, 3.8, 6910), frame(3.8, 4, 7390)], ref, 4);
  const longer = pitch.scoreFrames([frame(0, 3.5, 6910), frame(3.5, 4, 7102)], ref, 4);
  assert.ok(Math.abs(brief.meanAbsCents - longer.meanAbsCents) < 1e-9);
  assert.equal(brief.medianAbsCents, longer.medianAbsCents);
  assert.equal(brief.within50CentsSeconds / brief.trackedSeconds, .95);
  assert.equal(longer.within50CentsSeconds / longer.trackedSeconds, .875);
  assert.equal(pitch.scoreFrames([frame(0, 4, 8100)], ref, 4).within50CentsSeconds, 4,
    'octave-equivalent notes count as in tune without changing the recorded pitch');
});

test('pitch band uses elapsed time, splits note boundaries and keeps missing tracking distinct', () => {
  const ref = reference({leadInSeconds: 1, notes: [[1, 2, [69]], [3, 4, [72]]]});
  const result = pitch.scoreFrames([frame(0, 1, 6900), frame(1, 1.5, 6950), frame(1.5, 2, 6950.001),
    frame(2, 3, 7200), frame(3, 3.5, 7150), frame(3.5, 4, null)], ref, 4);
  assert.equal(result.within50CentsSeconds, 1, 'both signed 50-cent edges included, rest/count-in excluded');
  assert.equal(result.trackedSeconds, 1.5);
  assert.equal(result.expectedSeconds, 2);
  assert.equal(pitch.scoreFrames([], ref, 4).within50CentsSeconds, 0);
  const crossed = pitch.scoreFrames([frame(0, 1.12, 6900), frame(1.12, 4, 7200)],
    reference({notes: [[0, 1, [69]], [1, 4, [72]]]}), 4);
  assert.equal(crossed.within50CentsSeconds, 3.88, 'late entrances are not erased by an onset grace period');
  const partial = pitch.scoreFrames([frame(0, 4, 6900)], ref, 1.25);
  assert.equal(partial.within50CentsSeconds, .25);
});

test('pitch-band summary is optional for old scores and does not version out their cached contours', () => {
  const score = pitch.scoreFrames([frame(0, 4, 6910)], reference(), 4);
  const {within50CentsSeconds, ...old} = score;
  assert.equal(pitch.validScore(old), true);
  assert.equal(pitch.hasMedian(old), true);
  assert.equal(pitch.hasPitchBand(old), false);
  assert.equal(pitch.hasPitchBand(score), true);
  assert.equal(score.version, 2);
  for (const value of [null, NaN, Infinity, -1, 4.001]) {
    assert.equal(pitch.hasPitchBand({...score, within50CentsSeconds: value}), false);
  }
  const silence = pitch.scoreFrames([], reference(), 4);
  assert.equal(pitch.hasPitchBand(silence), true);
  assert.equal(silence.meanAbsCents, null);
  assert.equal(pitch.hasPitchBand({...silence, within50CentsSeconds: .001}), false);
});

test('real detector windows are centered at note changes, not delayed by a full window', () => {
  const {PitchDetector} = require('./pitch-fixture.cjs');
  for (const sampleRate of [44100, 48000]) {
    for (const notes of [[69, 72, 67, 69], [41, 48, 43, 46]]) {
      let phase = 0;
      const pcm = Int16Array.from({length: sampleRate * 4}, (_, i) => {
        phase += 2 * Math.PI * 440 * 2 ** ((notes[Math.floor(i / sampleRate)] - 69) / 12) / sampleRate;
        return Math.round(10000 * Math.sin(phase));
      });
      const ref = reference({notes: notes.map((note, i) => [i, i + 1, [note]])});
      const {frames} = pitch.analyse(pcm, sampleRate, ref, PitchDetector, {includeFrames: true});
      notes.slice(1).forEach((note, i) => {
        const boundary = i + 1;
        const near = frames.filter(f => f.start >= boundary - .2 && f.end <= boundary + .2);
        const first = near.find(f => f.cents !== null && Math.abs(f.cents - note * 100) <= 50);
        const last = near.filter(f => f.cents !== null && Math.abs(f.cents - notes[i] * 100) <= 50).at(-1);
        assert.ok(first && Math.abs(first.start - boundary) <= .05, JSON.stringify({sampleRate, notes, first}));
        assert.ok(last && Math.abs(last.end - boundary) <= .05, JSON.stringify({sampleRate, notes, last}));
      });
    }
  }
});

test('silence cannot win and rests are excluded while octaves count as equivalent', () => {
  const ref = reference({notes: [[0, 1, [69]], [2, 4, [69]]]});
  const result = pitch.scoreFrames([frame(0, 1, 6900), frame(1, 2, 8000), frame(2, 4, null)], ref, 4);
  assert.equal(result.coverage, 1 / 3);
  assert.equal(result.expectedSeconds, 3);
  assert.equal(result.meanAbsCents, 0);
  assert.equal(pitch.scoreFrames([frame(0, 4, 8100)], reference(), 4).meanAbsCents, 0);
  for (const ref of [reference(), reference({notes: []})]) {
    const silence = pitch.scoreFrames([], ref, 4);
    assert.equal(silence.meanAbsCents, null, 'missing pitch is not zero error');
    assert.equal(silence.coverage, 0);
    assert.equal(pitch.validScore(silence), true);
  }
});

test('frame intervals split at note boundaries and only actual partial duration is graded', () => {
  const ref = reference({notes: [[0, 1, [69]], [1, 4, [72]]]});
  const result = pitch.scoreFrames([frame(0, 1.2, 6900), frame(1.2, 2, 7200)], ref, 2);
  assert.ok(Math.abs(result.meanAbsCents - 30) < 1e-8);
  assert.equal(result.expectedSeconds, 2);
  assert.equal(result.coverage, 1);
});

test('offline analysis compensates latency without shifting the saved audio', () => {
  const sampleRate = 16000;
  const pcm = new Int16Array(2 * sampleRate).fill(5000);
  const original = pcm.slice();
  const detector = {forFloat32Array: () => {
    let frame = 0;
    return {findPitch: () => [frame++ < 110 ? 440 : 523.251, 1]};
  }};
  const ref = reference({seconds: 2, notes: [[0, 1, [69]], [1, 2, [72]]]});
  const raw = pitch.analyse(pcm, sampleRate, ref, detector);
  const corrected = pitch.analyse(pcm, sampleRate, {...ref, latency: .1}, detector);
  assert.ok(corrected.coverage > .85 && corrected.coverage <= .95, JSON.stringify(corrected));
  assert.ok(corrected.meanAbsCents < 1, JSON.stringify(corrected));
  assert.ok(corrected.meanAbsCents < raw.meanAbsCents - 10);
  assert.deepEqual(pcm, original);
});

test('reference snapshots exact tempo/speed mapping, clipped entry, and divisi pitches', () => {
  const spans = [{start: 0, end: 2, pitches: [72]}, {start: 2, end: 4, pitches: [74]}];
  const ref = pitch.reference({spans, secondsAtTick: tick => tick < 2 ? tick * .5 : 1 + tick - 2,
    start: 1, end: 3, rate: 2, fingerprint: 'snapshot', part: 2, line: 0, latency: .06});
  assert.deepEqual(ref.notes, [[0, .25, [72]], [.25, .75, [74]]]);
  assert.equal(ref.seconds, .75);
  assert.equal(ref.latency, .06);
  assert.equal(pitch.validReference(ref), true);
  spans[0].pitches[0] = 30;
  assert.equal(ref.notes[0][2][0], 72, 'later score edits cannot mutate a take');
  assert.equal(pitch.scoreFrames([frame(0, 4, 6700)], reference({notes: [[0, 4, [72, 67]]]}), 4).meanAbsCents, 0);
  assert.equal(pitch.scoreFrames([frame(0, 4, 6700)], reference({line: 0, notes: [[0, 4, [72]]]}), 4).meanAbsCents, 500);
});

test('fractional recording boundaries do not create phantom notes before or after the passage', () => {
  const spans = [{start: 96000, end: 98880, pitches: [54]},
    {start: 98880, end: 99840, pitches: [50]}, {start: 99840, end: 100800, pitches: [52]}];
  for (const rate of [.75, 1, 1.3]) {
    const args = {spans, secondsAtTick: tick => tick / 768, start: 98879.99999999997,
      end: 99840.00000000003, rate, fingerprint: 'boundary', part: 2, line: 1};
    const ref = pitch.reference(args);
    assert.deepEqual(ref.notes.map(n => n[2]), [[50]]);
    assert.ok(Math.abs(ref.notes[0][1] - ref.notes[0][0] - 1.25 / rate) < 1e-9);
    assert.equal(ref.start, args.start, 'capture position and tempo mapping are not quantized');
    const longer = pitch.reference({...args, end: 100800});
    const trimmed = pitch.trimReference(longer, args.end, ref.seconds);
    assert.deepEqual(trimmed.notes, ref.notes, 'stopping just after a boundary drops the same phantom');
  }
  const ref = pitch.reference({spans, secondsAtTick: tick => tick / 768, start: 98879.9,
    end: 98880.1, rate: 1, fingerprint: 'short', part: 2, line: 1});
  assert.deepEqual(ref.notes.map(n => n[2]), [[54], [50]], 'real sub-millisecond overlaps remain');
});

test('legacy phantom fragments do not invalidate review or rewrite saved observations', () => {
  const fragment = 2.842170943040401e-14;
  const current = reference({notes: [[fragment, 4, [69]]]});
  const saved = {...current, notes: [[0, fragment, [54]], ...current.notes]};
  const before = JSON.stringify(saved);
  assert.equal(pitch.samePassage(saved, current), true);
  assert.equal(pitch.sameTimeline(saved, current), true);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(pitch.samePassage(saved, {...current, notes: [[fragment, 4, [70]]]}), false);
  assert.equal(pitch.samePassage(reference({notes: [[0, .0001, [54]], [.0001, 4, [69]]]}), current), false);
});

test('review returns the exact scoring frames, including silence, without modifying audio', () => {
  const sr = 16000, pcm = new Int16Array(sr * 4).fill(5000);
  pcm.fill(0, sr, sr * 2);
  const original = pcm.slice();
  const detector = {forFloat32Array: () => ({findPitch: () => [440, 1]})};
  const result = pitch.analyse(pcm, sr, reference(), detector, {includeFrames: true});
  const {frames, ...metrics} = result;
  assert.deepEqual(metrics, pitch.analyse(pcm, sr, reference(), detector));
  assert.equal(frames.length, 400);
  assert.ok(frames.some(frame => frame.cents === null));
  assert.deepEqual(metrics, pitch.scoreFrames(frames, reference(), 4));
  assert.deepEqual(pcm, original);
});

test('packed take contours preserve full precision, gaps and exact sample-hop timing', () => {
  for (const sampleRate of [8000, 11025, 44100, 48000]) {
    const ref = reference({seconds: 2, latency: .06317, notes: [[0, 2, [69]]]});
    const pcm = new Int16Array(sampleRate * 2 - 7).fill(5000);
    pcm.fill(0, Math.round(sampleRate * .25), Math.round(sampleRate * 1.3));
    const detector = {forFloat32Array: () => ({findPitch: () => [440.123456789, 1]})};
    const result = pitch.analyse(pcm, sampleRate, ref, detector, {includeFrames: true});
    const take = {frames: pcm.length, sampleRate, pitchReference: ref};
    const saved = structuredClone({...take, pitchContour: pitch.packContour(result.frames, take)});
    const restored = pitch.readContour(saved);
    assert.deepEqual(restored, result.frames, 'implicit timestamps reconstruct even at non-integer 10 ms hops');
    assert.deepEqual(pitch.scoreFrames(restored, ref, pcm.length / sampleRate),
      pitch.scoreFrames(result.frames, ref, pcm.length / sampleRate), 'no rounding of saved scores');
    assert.ok(restored.some(frame => frame.cents === null));
    assert.equal(saved.pitchContour.pitches.byteLength, result.frames.length * 8);
  }
});

test('missing, stale or malformed contour caches fall back to the original recording', () => {
  const ref = reference({seconds: .02, notes: [[0, .02, [69]]]});
  const frames = [{start: 0, end: .01, cents: 6901.23456789}, {start: .01, end: .02, cents: null}];
  const take = {sampleRate: 48000, frames: 960, pitchReference: ref};
  const saved = {...take, pitchContour: pitch.packContour(frames, take)};
  assert.equal(pitch.readContour(take), null, 'existing audio-only takes remain usable');
  for (const change of [
    {sampleRate: 44100}, {frames: 961}, {pitchReference: {...ref, latency: .01}},
    {pitchReference: {...ref, notes: [[0, .02, [70]]]}},
    ...[{version: 0}, {analysisVersion: 0}, {pitches: new Float32Array(2)},
      {pitches: new Float64Array(1)}, {pitches: new Float64Array([Infinity, NaN])}]
      .map(change => ({pitchContour: {...saved.pitchContour, ...change}})),
  ]) assert.equal(pitch.readContour({...saved, ...change}), null);
  assert.throws(() => pitch.packContour([{...frames[0], start: .001}, frames[1]], take), /frame/);
  assert.throws(() => pitch.packContour(frames.slice(1), take), /contour/);
  assert.deepEqual(pitch.readContour(saved), frames, 'rejected copies do not damage the valid cache');
});

test('review matches saved passage notes and timing, not unrelated score changes', () => {
  const ref = reference();
  assert.equal(pitch.samePassage(ref, {...ref, fingerprint: 'new-build'}), true);
  for (const change of [{part: 1}, {line: 1}, {start: 1}, {end: 5}, {seconds: 5},
    {notes: [[0, 4, [68]]]}, {notes: [[.1, 4, [69]]]}]) {
    assert.equal(pitch.samePassage(ref, {...ref, ...change}), false);
  }
  assert.equal(pitch.samePassage(null, ref), false);
});

test('invalid, overlapping, or missing references are not guessed', () => {
  for (const ref of [null, {}, reference({rate: 0}), reference({latency: -1}), reference({seconds: Infinity}),
    reference({notes: [[0, 2, [69]], [1, 4, [69]]]}), reference({notes: [[0, 4, []]]})]) {
    assert.equal(pitch.validReference(ref), false);
    assert.throws(() => pitch.scoreFrames([], ref, 4));
  }
});

test('barline chapters snapshot tempo, speed and the recorded count-in', () => {
  const args = {spans: [{start: 2, end: 12, pitches: [60]}],
    secondsAtTick: tick => tick < 8 ? tick / 2 : 4 + tick - 8,
    start: 4, captureStart: 2, end: 12, rate: 2, fingerprint: 'chapters', part: 0,
    measures: [[0], [4], [8], [12]]};
  const ref = pitch.reference(args);
  assert.deepEqual(ref.chapters, [{measure: 2, seconds: .5}, {measure: 3, seconds: 1.5}]);
  assert.equal(ref.seconds, 3.5);
  args.measures[1][0] = 3;
  assert.equal(ref.chapters[0].seconds, .5, 'later score changes cannot move saved chapters');
  assert.deepEqual(pitch.reference({...args, measures: [[0], [4], [8]], captureStart: -2}).chapters,
    [{measure: 1, seconds: .5}, {measure: 2, seconds: 1.5}, {measure: 3, seconds: 2.5}]);
});

test('recorded count-in shifts reference timing but is excluded from both pitch metrics', () => {
  const ref = pitch.reference({spans: [{start: -2, end: 0, pitches: [60]}, {start: 0, end: 4, pitches: [69]}],
    secondsAtTick: tick => tick * .5, start: 0, captureStart: -4, end: 4, rate: 1,
    fingerprint: 'with-count-in', part: 0, line: null});
  assert.equal(ref.seconds, 4);
  assert.deepEqual(ref.notes, [[2, 4, [69]]]);
  assert.equal(pitch.validReference(ref), true);
  const result = pitch.scoreFrames([frame(0, 2, 6000), frame(2, 4, 6900)], ref, 4);
  assert.equal(result.meanAbsCents, 0);
  assert.equal(result.coverage, 1);
  assert.equal(result.expectedSeconds, 2);
  assert.equal(pitch.scoreFrames([frame(0, 1, 6000)], ref, 1).meanAbsCents, null);
  const repeat = pitch.reference({spans: [{start: 0, end: 4, pitches: [69]}],
    secondsAtTick: tick => tick * .5, start: 0, end: 4, rate: 1,
    fingerprint: 'with-count-in', part: 0, line: null});
  assert.equal(pitch.comparisonKey({pitchReference: ref}), pitch.comparisonKey({pitchReference: repeat}),
    'a retained count-in must not exclude an otherwise comparable first take from Best');
});

const take = (id, meanAbsCents, coverage = 1, overrides = {}) => ({id, complete: true, finalized: true,
  pitchReference: reference(), pitchScore: {version: pitch.ANALYSIS_VERSION, meanAbsCents, coverage,
    expectedSeconds: 4, trackedSeconds: 4 * coverage}, ...overrides});

const scoredTake = (id, mean = 20, median = 15, coverage = .8, overrides = {}) => {
  const result = take(id, mean, coverage, {createdAt: 1, number: 1});
  result.pitchScore.medianAbsCents = median;
  return {...result, ...overrides};
};
const dominatedIds = takes => [...pitch.dominatedBy(takes).keys()];

test('Pareto hints require no worse metrics and a meaningful improvement on at least one', () => {
  const baseline = scoredTake('baseline');
  for (const better of [scoredTake('mean', 18), scoredTake('median', 20, 13),
    scoredTake('tracking', 20, 15, .82), scoredTake('all', 18, 13, .82)]) {
    assert.deepEqual(dominatedIds([baseline, better]), ['baseline'], better.id);
    assert.equal(pitch.dominatedBy([baseline, better]).get('baseline'), better);
  }
  for (const nearby of [scoredTake('equal'), scoredTake('near', 18.001, 13.001, .81999)]) {
    assert.deepEqual(dominatedIds([baseline, nearby]), [], 'tiny differences are not a meaningful win');
  }
  assert.deepEqual(dominatedIds([baseline]), []);
});

test('Pareto tradeoffs stay neutral, including a better mean with poorer coverage or median', () => {
  const baseline = scoredTake('baseline');
  for (const tradeoff of [scoredTake('less-tracked', 10, 10, .7999),
    scoredTake('worse-median', 10, 15.001, .9), scoredTake('worse-mean', 20.001, 10, .9)]) {
    assert.deepEqual(dominatedIds([baseline, tradeoff]), [], tradeoff.id);
  }
  assert.deepEqual(dominatedIds([scoredTake('low', 10, 10, .4), scoredTake('lower', 12, 12, .38)]),
    ['lower'], 'no absolute tracking cutoff');
});

test('Pareto hints compare only identical score, part, divisi, passage, tempo and notes', () => {
  const baseline = scoredTake('baseline');
  const changes = {fingerprint: 'other', part: 1, line: 1, start: 1, end: 5, rate: 1.1,
    notes: [[0, 4, [70]]]};
  for (const [field, value] of Object.entries(changes)) {
    assert.deepEqual(dominatedIds([baseline, scoredTake('other', 1, 1, 1,
      {pitchReference: reference({[field]: value})})]), [], field);
  }
  assert.deepEqual(dominatedIds([baseline, scoredTake('retimed', 1, 1, 1,
    {pitchReference: reference({notes: [[.01, 4, [69]]]})})]), []);
  const countIn = scoredTake('count-in', 10, 10, .9,
    {pitchReference: reference({seconds: 5, leadInSeconds: 1, notes: [[1, 5, [69]]]})});
  assert.deepEqual(dominatedIds([baseline, countIn]), ['baseline'], 'count-in is not graded');
});

test('Pareto hints exclude unfinished, damaged, unscored, silent and stale takes on both sides', () => {
  const incomplete = [{complete: false}, {finalized: false}, {active: true}, {unsaved: true},
    {gap: true}, {deleteAfter: 1}, {pitchReference: null}, {pitchScore: null},
    {pitchScore: {...scoredTake('x').pitchScore, medianAbsCents: undefined}},
    {pitchScore: {...scoredTake('x').pitchScore, version: 1}},
    {pitchScore: {...scoredTake('x').pitchScore, coverage: NaN}},
    {pitchScore: {...scoredTake('x').pitchScore, trackedSeconds: 0, coverage: 0, meanAbsCents: null, medianAbsCents: null}}];
  for (const patch of incomplete) {
    assert.deepEqual(dominatedIds([scoredTake('good', 10, 10, .9), scoredTake('bad', 30, 30, .8, patch)]), []);
    assert.deepEqual(dominatedIds([scoredTake('good', 10, 10, .9, patch), scoredTake('bad', 30, 30, .8)]), []);
  }
});

test('Pareto witnesses are stable, do not mutate data, and disappear after deletion', () => {
  const takes = [scoredTake('worst', 30, 30), scoredTake('better', 20, 20), scoredTake('best', 10, 10)];
  const before = JSON.stringify(takes);
  const witnesses = rows => [...pitch.dominatedBy(rows)].map(([id, better]) => [id, better.id]);
  assert.deepEqual(witnesses(takes), [['better', 'best'], ['worst', 'best']]);
  assert.deepEqual(witnesses([...takes].reverse()), witnesses(takes));
  assert.equal(JSON.stringify(takes), before);
  assert.deepEqual(witnesses(takes.map(t => t.id === 'best' ? {...t, deleteAfter: 1} : t)), [['worst', 'better']]);
  assert.deepEqual(dominatedIds(takes.slice(0, 1)), []);
});

test('take rows sort by exact average cents regardless of coverage, stars or completion flags', () => {
  const takes = [take('wide', 40, 1, {favorite: true}), take('near', 10.11, .8),
    take('lower', 10.09, .79), take('sparse', 1, .2), take('silent', null, 0),
    take('pending', 0, 1, {pitchScore: null}), take('recovered', 20, 1, {complete: false})];
  const before = JSON.stringify(takes);
  assert.deepEqual([...takes].sort(pitch.compareTakes).map(item => item.id),
    ['sparse', 'lower', 'near', 'recovered', 'wide', 'silent', 'pending']);
  assert.equal(JSON.stringify(takes), before, 'sorting does not mutate stored audio or metadata');
  const tied = [take('later', 10, .9, {createdAt: 2}), take('earlier', 10, .5, {createdAt: 1})];
  assert.deepEqual(tied.sort(pitch.compareTakes).map(item => item.id), ['earlier', 'later']);
});

test('take column sorting chooses useful defaults and reverses repeated clicks', () => {
  assert.deepEqual(pitch.takeSort(), {column: 'mean', direction: 'ascending'});
  assert.deepEqual(pitch.takeSort({column: '__proto__', direction: 'broken'}), pitch.takeSort());
  let sort = pitch.nextTakeSort(pitch.takeSort(), 'mean');
  assert.deepEqual(sort, {column: 'mean', direction: 'descending'});
  assert.deepEqual(pitch.nextTakeSort(sort, 'mean'), pitch.takeSort());
  for (const column of ['number', 'part', 'mean', 'median', 'tracked', 'within']) {
    const next = pitch.nextTakeSort({column: 'other'}, column);
    assert.equal(next.direction, ['tracked', 'within'].includes(column) ? 'descending' : 'ascending');
    assert.notEqual(pitch.nextTakeSort(next, column).direction, next.direction);
  }
});

test('every take column sorts actual values with missing metrics last in either direction', () => {
  const a = scoredTake('a', 10.09, 20, .8, {number: 2, part: 'S2', createdAt: 1});
  const b = scoredTake('b', 10.11, 10, .9, {number: 10, part: 'S10', createdAt: 2});
  a.pitchScore.within50CentsSeconds = a.pitchScore.trackedSeconds * .9;
  b.pitchScore.within50CentsSeconds = b.pitchScore.trackedSeconds * .8;
  const unscored = {id: 'pending', createdAt: 3};
  const rows = [b, unscored, a], before = JSON.stringify(rows);
  for (const [column, ascending] of Object.entries({
    number: ['a', 'b'], part: ['a', 'b'], mean: ['a', 'b'], median: ['b', 'a'],
    tracked: ['a', 'b'], within: ['b', 'a'],
  })) {
    for (const direction of ['ascending', 'descending']) {
      const ordered = [...rows].sort((a, b) => pitch.compareTakes(a, b, {column, direction})).map(t => t.id);
      assert.deepEqual(ordered, [...(direction === 'ascending' ? ascending : [...ascending].reverse()), 'pending'], `${column}: ${direction}`);
    }
  }
  assert.equal(JSON.stringify(rows), before, 'sorts never change stored takes');
  const tied = [scoredTake('later', 10, 10, .8, {createdAt: 2}), scoredTake('earlier', 10, 10, .8, {createdAt: 1})];
  for (const direction of ['ascending', 'descending']) {
    assert.deepEqual([...tied].sort((a, b) => pitch.compareTakes(a, b, {column: 'mean', direction})).map(t => t.id), ['earlier', 'later']);
  }
});

test('take sorting distinguishes measured zero tracking from missing scores', () => {
  const silent = scoredTake('silent', null, null, 0);
  const pending = {id: 'pending'};
  const voiced = scoredTake('voiced', 20, 10, .9);
  for (const direction of ['ascending', 'descending']) {
    assert.deepEqual([pending, voiced, silent].sort((a, b) => pitch.compareTakes(a, b, {column: 'mean', direction})).map(t => t.id), ['voiced', 'pending', 'silent']);
  }
  assert.deepEqual([pending, voiced, silent].sort((a, b) => pitch.compareTakes(a, b, {column: 'tracked'})).map(t => t.id), ['voiced', 'silent', 'pending']);
});

test('best-pitch comparison protects separate passages, speeds, parts, divisions and score versions', () => {
  const takes = [take('good', 10), take('bad', 40), take('partial', 0, 1, {complete: false}),
    take('gap', 0, 1, {gap: true}), take('deleted', 0, 1, {deleteAfter: 1}),
    take('active', 0, 1, {active: true}), take('unsaved', 0, 1, {unsaved: true}),
    take('unfinalized', 0, 1, {finalized: false}), take('silent', 0, .2)];
  for (const [key, value] of Object.entries({fingerprint: 'other', rate: 2, part: 1, line: 1, start: 1, end: 3})) {
    takes.push(take(key, 0, 1, {pitchReference: reference({[key]: value})}));
  }
  assert.deepEqual([...pitch.bestIds(takes)], ['good']);
  assert.equal(pitch.bestIds([take('only', 0)]).size, 0);
  assert.deepEqual([...pitch.bestIds([take('a', 0), take('b', 0)])], ['a', 'b']);
  assert.deepEqual([...pitch.bestIds([take('a', 9.11), take('b', 9.14)])], ['a', 'b'], 'ties at displayed 0.1-cent precision share Best');
  assert.deepEqual([...pitch.bestIds([take('a', 9.1), take('b', 9.2)])], ['a'], 'retain useful sub-cent discrimination');
});

test('low coverage cannot beat a fully tracked performance on cents error alone', () => {
  assert.equal(pitch.bestIds([take('few-clean-notes', 0, .1), take('full', 20)]).size, 0,
    'without similar coverage there is no meaningful winner');
  assert.deepEqual([...pitch.bestIds([take('a', 0, .79), take('b', 10, .82)])], ['a'], 'no 90% cutoff');
  assert.deepEqual([...pitch.bestIds([take('a', 10, .79), take('b', 20, .82), take('sparse', 0, .2)])], ['a']);
  assert.equal(pitch.bestIds([take('almost-full', 0, .94), take('full', 20)]).size, 0,
    'even 90%-plus cannot exploit a tracking deficit greater than five points');
  assert.deepEqual([...pitch.bestIds([take('nearby', 10, .95), take('full', 20)])], ['nearby']);
  assert.deepEqual([...pitch.bestIds([take('a', 0, .9), take('b', 10, .94)])], ['a']);
  assert.equal(pitch.bestIds([take('a', 0, .9), take('b', 10, .95001)]).size, 0);
  assert.deepEqual([...pitch.bestIds([take('a', 0, .4), take('b', 10, .44)])], ['a'], 'relative ranking is not an absolute singing grade');
});

test('analysis versions refresh old metrics without changing saved references or audio', () => {
  const old = take('old', 10);
  old.pitchScore.score = 0;
  assert.equal(pitch.validScore(old.pitchScore), true);
  const before = JSON.stringify(old);
  assert.deepEqual([...pitch.bestIds([old, take('new', 30)])], ['old']);
  assert.equal(JSON.stringify(old), before, 'no audio/reference/result migration writes');
  assert.equal(pitch.validReference(old.pitchReference), true, 'v1 timing references are still valid');
  for (const patch of [{version: 1}, {version: 99}, {coverage: NaN}, {coverage: -.1}, {coverage: 1.1},
    {coverage: .2}, {meanAbsCents: null}, {meanAbsCents: -1}, {meanAbsCents: Infinity},
    {expectedSeconds: -1}, {trackedSeconds: -1}, {trackedSeconds: Infinity}]) {
    const invalid = {...old.pitchScore, ...patch};
    assert.equal(pitch.validScore(invalid), false, JSON.stringify(patch));
    assert.equal(pitch.bestIds([{...old, pitchScore: invalid}, take('new', 30)]).size, 0);
  }
});

test('journal saves distinct first-pass and repeat pitch references', async () => {
  const records = new Map();
  const store = {append: async (record, offset, pcm, status) => {
    const next = {...record, ...status, frames: offset + pcm.length, number: records.size + 1};
    records.set(record.id, next); return next;
  }};
  const full = reference(), initial = reference({start: 2, seconds: 2, notes: [[0, 2, [69]]]});
  const journal = new TakeJournal(store, 'song', {seconds: 4, pitchReference: full,
    initial: {seconds: 2, start: 2, pitchReference: initial}}, 8000);
  journal.begin(0);
  journal.append(0, new Float32Array(16000));
  journal.begin(16000);
  journal.append(16000, new Float32Array(32000));
  journal.finish(48000);
  await journal.flush();
  assert.deepEqual([...records.values()].map(record => record.pitchReference), [initial, full]);
});
