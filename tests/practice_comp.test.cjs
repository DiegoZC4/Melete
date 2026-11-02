const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../template/take_pitch.js');
const C = require('../template/practice_comp.js');

const ref = {version: 1, fingerprint: 'test-score', part: 0, line: null, start: 0, end: 4,
  captureStart: 0, leadInSeconds: 0, rate: 1, seconds: 4, latency: 0, notes: [[0, 2, [60]], [2, 4, [62]]]};
const descriptor = {song: 'fixture', reference: ref};
function take(id, from, to, cents = 20, coverage = 1, lead = 0) {
  const origin = from - lead, notes = C.clipNotes(ref.notes, [{from, to}]).map(([a, b, pitches]) => [a - origin, b - origin, pitches]);
  const r = {...ref, start: from, end: to, captureStart: origin, leadInSeconds: lead, seconds: to - origin, notes};
  const t = {id, song: 'fixture', part: 'S', createdAt: 10 + Number(id) || 20, complete: true, finalized: true,
    frames: Math.round(r.seconds * 8000), sampleRate: 8000, pitchReference: r, rate: 1, origin};
  const frames = Array.from({length: Math.round(r.seconds * 100)}, (_, i) => {
    const start = i / 100, end = (i + 1) / 100;
    const n = notes.find(n => n[0] <= start && n[1] > start);
    return {start, end, cents: n && (i % 100) < coverage * 100 ? n[2][0] * 100 + cents : null};
  });
  t.pitchScore = P.scoreFrames(frames, r, r.seconds);
  t.pitchContour = P.packContour(frames, t);
  return t;
}
test('phrase comp integrates time, excludes count-in and preserves detection gaps', () => {
  const a = take('1', 0, 2, 10, .8, .5), b = take('2', 2, 4, 30);
  const takes = new Map([[a.id, a], [b.id, b]]);
  let state = C.offer(C.empty(descriptor), a, takes); state = C.offer(state, b, takes);
  const s = C.stats(state, takes);
  assert.equal(s.completion, 1); assert.equal(s.segmentCount, 2);
  assert.ok(Math.abs(s.coverage - .9) < 1e-9);
  assert.ok(Math.abs(s.meanAbsCents - (10 * 1.6 + 30 * 2) / 3.6) < 1e-9);
  assert.equal(s.medianAbsCents, 30);
  assert.ok(C.framesFor(state.segments, takes).some(f => f.cents === null));
});
test('each recording replaces the passage it sings, even scoring worse; Undo restores it once', () => {
  const a = take('1', 1, 3, 1), b = take('2', 0, 4, 45, .5), takes = new Map([[a.id, a], [b.id, b]]);
  const original = C.offer(C.empty(descriptor), a, takes);
  const replaced = C.offer(original, b, takes);
  assert.deepEqual(replaced.segments, [{takeId: '2', from: 0, to: 4}]);
  assert.deepEqual(replaced.undo, original.segments);
  const restored = C.undo(replaced);
  assert.deepEqual(restored.segments, original.segments);
  assert.equal(restored.undo, null);
  assert.deepEqual(C.offer(restored, b, takes).segments, original.segments, 'an undone recording is not offered again');
  const silent = take('3', 0, 4, 20, 0); takes.set(silent.id, silent);
  const unchanged = C.offer(replaced, silent, takes);
  assert.equal(unchanged.segments, replaced.segments, 'no detected singing never erases a passage');
  assert.equal(unchanged.undo, replaced.undo);
  assert.ok(unchanged.processed.includes(silent.id));
});
test('segment count counts contiguous passages; no frame-by-frame comping', () => {
  const a = take('1', 0, 4, 25), b = take('2', 1, 3, 10), takes = new Map([[a.id, a], [b.id, b]]);
  let s = C.offer(C.empty(descriptor), a, takes); s = C.offer(s, b, takes);
  assert.equal(s.segments.length, 3);
  assert.deepEqual(s.segments.map(s => s.takeId), ['1', '2', '1']);
  assert.deepEqual(C.replace(s.segments, {takeId: '1', from: 1, to: 3}), [{takeId: '1', from: 0, to: 4}]);
});
test('removing a track keeps one Undo until the next recording', () => {
  const a = take('1', 0, 4), takes = new Map([[a.id, a]]);
  const state = {...C.offer(C.empty(descriptor), a, takes), track: true};
  const removed = C.remove(state, 100);
  assert.deepEqual(removed.segments, []); assert.equal(removed.track, false);
  assert.deepEqual(C.protectedIds(removed), [a.id]);
  assert.deepEqual(C.offer(removed, a, takes).segments, [], 'removed recordings are not offered again');
  const restored = C.undo(removed);
  assert.deepEqual(restored.segments, state.segments); assert.equal(restored.track, true);
  const b = {...take('2', 0, 4), createdAt: 101, replaces: true}; takes.set(b.id, b);
  const next = C.offer(removed, b, takes);
  assert.deepEqual(next.segments.map(s => s.takeId), [b.id]);
  assert.deepEqual(next.undo, [], 'Undo now returns to the empty track');
  assert.deepEqual(C.protectedIds(next), [b.id]);
});
test('replaced track recordings are discarded; silent, older and favourite takes stay', () => {
  const track = id => ({...take(id, 0, 4), replaces: true});
  const a = track('1'), b = track('2'), silent = {...take('3', 0, 4, 20, 0), replaces: true};
  const favorite = {...track('4'), favorite: true}, c = track('5'), legacy = take('6', 0, 4);
  const all = [a, b, silent, favorite, c, legacy], takes = new Map(all.map(t => [t.id, t]));
  let state = C.empty(descriptor);
  for (const t of [a, b, silent]) state = C.offer(state, t, takes);
  assert.deepEqual(state.adopted, ['1', '2'], 'a recording with no detected singing is never adopted');
  assert.deepEqual(C.discardable([state], all), [], 'Undo still holds the previous recording');
  for (const t of [favorite, c]) state = C.offer(state, t, takes);
  assert.deepEqual(C.discardable([state], all), ['1', '2']);
  assert.deepEqual(C.discardable([state, {...state, key: 'other', segments: [C.segment(a)], adopted: []}], all), ['2'],
    'a recording another track still uses is kept');
  assert.deepEqual(C.discardable([state], all.map(t => t.id === '2' ? {...t, unsaved: true} : t)), ['1']);
});
test('older comps become tracks; their recordings are adopted and the best take is dropped', () => {
  const a = take('1', 0, 4), b = take('2', 0, 4), takes = new Map([[a.id, a], [b.id, b]]);
  const old = {...C.offer(C.empty(descriptor), a, takes), trackVersion: undefined, bestId: b.id, bestAfter: 5, undoBest: null};
  const migrated = C.migrate(old);
  for (const field of ['bestId', 'bestAfter', 'undoBest']) assert.equal(field in migrated, false);
  assert.equal(migrated.trackVersion, C.TRACK_VERSION);
  assert.deepEqual(migrated.adopted, [a.id]);
  assert.equal(C.migrate(migrated), migrated);
  assert.deepEqual(C.discardable([migrated], [a, b]), [], 'the former best take is left for the singer');
  assert.deepEqual(C.discardable([{...migrated, segments: [], undo: null}], [a, b]), [a.id], 'once unused, an adopted recording goes');
});
test('part, divisi, tempo and score revisions never silently mix', () => {
  const t = take('1', 0, 4), original = JSON.stringify(t);
  for (const property of [{part: 1}, {line: 0}, {rate: .8}, {fingerprint: 'changed'}]) {
    const d = {...descriptor, reference: {...ref, ...property}};
    assert.notEqual(C.key(d), C.key(descriptor)); assert.equal(C.eligible(t, d), false);
  }
  const d = {...descriptor, reference: {...ref, notes: [[0, 4, [61]]]}};
  assert.equal(C.eligible(t, d), false); assert.equal(JSON.stringify(t), original);
});

test('one-time backfill recovers previously rejected takes, preserving old choices and removals', () => {
  const a = take('1', 1, 3, 20), b = take('2', 0, 4, 10);
  const takes = new Map([[a.id, a], [b.id, b]]);
  const old = {...C.offer(C.empty(descriptor), a, takes), processed: ['1', '2'], offerVersion: 1};
  assert.deepEqual(C.offer(old, b, takes).segments, old.segments);
  const recovered = C.offer(old, b, takes, {backfill: true});
  assert.equal(C.stats(recovered, takes).completion, 1);
  assert.equal(recovered.segments[1].takeId, a.id, 'migration never replaces an existing passage');
  assert.deepEqual(C.offer(C.remove(old, 100), b, takes, {backfill: true}).segments, []);
});
