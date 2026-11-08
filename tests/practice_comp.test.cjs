const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../template/take_pitch.js');
const C = require('../template/practice_comp.js');

const ref = {version: 1, fingerprint: 'test-score', part: 0, line: null, start: 0, end: 4,
  captureStart: 0, leadInSeconds: 0, rate: 1, seconds: 4, latency: 0, notes: [[0, 2, [60]], [2, 4, [62]]]};
const descriptor = {song: 'fixture', reference: ref};
test('a comp retains the count-in with its first phrase but never grades it',()=>{
  const full=P.reference({spans:[{start:0,end:4,pitches:[60]}],start:0,end:4,rate:1,part:0,line:null,
    secondsAtTick:t=>t,division:1,measures:[[0,4,4,4]],fingerprint:'test-score'});
  const first={...take('1',0,4,15,1,3),replaces:true};
  const r=P.reference({spans:[{start:0,end:4,pitches:[60]}],start:0,captureStart:-3,end:4,rate:1,part:0,line:null,
    secondsAtTick:t=>t,division:1,measures:[[0,4,4,4]],fingerprint:'test-score'});
  first.pitchReference=r;
  const frames=Array.from({length:700},(_,i)=>({start:i/100,end:(i+1)/100,cents:6015}));
  first.pitchScore=P.scoreFrames(frames,r,7);first.pitchContour=P.packContour(frames,first);
  const sources=new Map([[first.id,first]]),state=C.offer(C.empty({song:'fixture',reference:full}),first,sources);
  assert.equal(state.segments[0].from,-3);
  assert.equal(C.validate(state,sources),true);
  const metrics=C.stats(state,sources);
  assert.ok(Math.abs(metrics.expectedSeconds-4)<1e-8);
  assert.ok(Math.abs(metrics.meanAbsCents-15)<1e-8);
  assert.equal(C.framesFor(state.segments,sources)[0].start,-3);
});
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
test('tracking coverage is whole-song singing time, not just the recorded excerpt',()=>{
  const a=take('1',0,2,20,.8), takes=new Map([[a.id,a]]);
  const state=C.offer(C.empty(descriptor),a,takes), score=C.stats(state,takes);
  assert.equal(score.expectedSeconds,4);
  assert.ok(Math.abs(score.coverage-.4)<1e-8);
  assert.equal(score.completion,.5);
  assert.equal(score.segmentCount,1);
  const processed=C.reconcile(descriptor,[],takes);
  assert.deepEqual(processed.state.segments,state.segments);
  assert.deepEqual(processed.score,score);
});
test('muted long rests do not inflate the number of recorded segments',()=>{
  const segments=[{takeId:'a',from:0,to:2},{takeId:'a',from:4,to:6}];
  assert.equal(C.segmentCount(segments,[[0,2,[60]],[4,6,[60]]]),1);
  assert.equal(C.segmentCount(segments,[[0,6,[60]]]),2);
  assert.equal(C.segmentCount([{...segments[0]}, {...segments[1],takeId:'b'}],[[0,2,[60]],[4,6,[60]]]),2);
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
test('replaced track recordings are discarded; unadopted and favourite takes stay', () => {
  const track = id => ({...take(id, 0, 4), replaces: true});
  const a = track('1'), b = track('2'), silent = {...take('3', 0, 4, 20, 0), replaces: true};
  const favorite = {...track('4'), favorite: true}, c = track('5'), legacy = take('6', 0, 4);
  const all = [a, b, silent, favorite, c, legacy], takes = new Map(all.map(t => [t.id, t]));
  let state = C.empty(descriptor);
  for (const t of [a, b, silent]) state = C.offer(state, t, takes);
  assert.deepEqual(state.adopted, ['1', '2'], 'a recording with no detected singing is never adopted');
  assert.deepEqual(C.discardable([state], all), [], 'Undo holds the previous recording; unadopted audio is kept');
  for (const t of [favorite, c]) state = C.offer(state, t, takes);
  assert.deepEqual(C.discardable([state], all), ['1', '2']);
  assert.deepEqual(C.discardable([state], all, ['1', '2']), [], 'multilevel history protects every referenced source');
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

test('saved boundary-rounding overdubs recover in order without changing audio metadata or uncaptured passages', () => {
  const origin = 128.74999999999997, start = 98879.99999999997;
  const full = {...ref, part: 2, line: 1, end: 110400, seconds: 143.75,
    notes: [[0, 128.75, [54]], [128.75, 130, [50]], [130, 131.25, [52]],
      [131.25, 132.5, [54]], [132.5, 142.5, [55]]]};
  const d = {song: 'boundary-fixture', reference: full};
  const make = (number, from, seconds, legacy = false) => {
    const notes = full.notes.filter(n => n[1] > from && n[0] < from + seconds)
      .map(([a, b, p]) => [Math.max(a, from) - from, Math.min(b, from + seconds) - from, p]);
    const r = {...full, start: from ? start : 0, captureStart: from ? start : 0,
      end: (from + seconds) * 768, seconds, notes: legacy ? notes : P.nonzeroNotes(notes)};
    const t = {id: String(number), number, song: d.song, origin: from, rate: 1, createdAt: number,
      complete: true, finalized: true, replaces: true, frames: Math.round(seconds * 48000), sampleRate: 48000, pitchReference: r};
    const frames = Array.from({length: Math.ceil(t.frames / 480)}, (_, i) => {
      const a = i * 480 / 48000, b = Math.min((i + 1) * 480, t.frames) / 48000, n = notes.find(n => n[0] <= a && n[1] > a);
      return {start: a, end: b, cents: n ? n[2][0] * 100 + 15 : null};
    });
    t.pitchScore = P.scoreFrames(frames, r, seconds); t.pitchContour = P.packContour(frames, t);
    return t;
  };
  const original = make(1, 0, full.seconds);
  const overdubs = [10.842666666666666, 9.530666666666667, 10.576, 8.586666666666666, 9.248]
    .map((seconds, i) => make(143 + i, origin, seconds, true));
  const takes = new Map([original, ...overdubs].map(t => [t.id, t]));
  const before = JSON.stringify([...takes]);
  const saved = C.offer(C.empty(d), original, takes);
  for (const t of overdubs) {
    assert.equal(t.pitchReference.notes.length, 5);
    assert.ok(t.pitchReference.notes[0][1] < 1e-12);
    assert.equal(C.eligible(t, d), true);
  }
  const {state, edits} = C.reconcile(d, [saved], takes);
  assert.equal(edits.length, 5);
  assert.equal(C.validate(state, takes), true);
  assert.ok(overdubs.every(t => state.processed.includes(t.id)));
  assert.equal(state.segments.find(s => s.from <= 132.5 && s.to > 132.5).takeId, '147');
  assert.deepEqual(state.segments[0], {takeId: '1', from: 0, to: origin});
  assert.deepEqual(state.segments.at(-1), {takeId: '1', from: origin + overdubs[0].pitchReference.seconds, to: full.seconds});
  assert.deepEqual(C.reconcile(d, [state], takes).state.segments, state.segments, 'reload is idempotent');
  assert.equal(JSON.stringify([...takes]), before, 'saved reference, PCM length and detector observations remain unchanged');
  const wrong = {...overdubs[0], pitchReference: {...overdubs[0].pitchReference,
    notes: overdubs[0].pitchReference.notes.map((n, i) => i === 2 ? [n[0], n[1], [53]] : n)}};
  assert.equal(C.eligible(wrong, d), false, 'the tolerance does not accept a different melody');
});

test('same-part overdub slots keep independent recordings and survive score revisions', () => {
  const first = take('1', 0, 4), clone = {...take('2', 0, 4), trackSlot: 'clone'};
  const d = {...descriptor, slot: 'clone', layerNumber: 2};
  const all = new Map([[first.id, first], [clone.id, clone]]);
  assert.notEqual(C.key(d), C.key(descriptor));
  assert.equal(C.eligible(first, d), false);
  assert.equal(C.eligible(clone, descriptor), false);
  const a = C.offer(C.empty(descriptor), first, all), b = C.offer(C.empty(d), clone, all);
  assert.deepEqual(a.segments.map(s => s.takeId), ['1']);
  assert.deepEqual(b.segments.map(s => s.takeId), ['2']);
  assert.deepEqual(C.discardable([a, b], [first, clone]), []);
  const revised = {...d, reference: {...ref, fingerprint: 'revised'}};
  const migrated = C.adoptRevision([a, b], revised, new Map([[clone.id, {...clone, pitchReference: revised.reference}]]));
  assert.ok(migrated.segments.every(s => s.takeId === '2'));
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
test('legacy gap recovery prefers newer performances over older Undo sources', () => {
  const a = take('1', 0, 4, 50), b = take('2', 0, 4, 30), c = take('3', 1, 3, 10);
  const takes = new Map([a,b,c].map(t => [t.id,t]));
  const old = {...C.offer(C.empty(descriptor), c, takes), processed: ['1','2','3'], offerVersion: 1};
  const recovered = C.reconcile(descriptor, [old], takes);
  assert.equal(recovered.state.segments.some(s => s.takeId === a.id), false);
  assert.equal(recovered.state.segments[0].takeId, b.id);
  assert.equal(recovered.state.segments[1].takeId, c.id);
  assert.equal(recovered.edits.length, 0, 'migration is not a new user edit');
});
const M = C.AUDIO_MARGIN_SECONDS;
const span = (from, to, rate = 8000, frames = Infinity) =>
  [Math.max(0, Math.floor((from - M) * rate)), Math.min(frames, Math.ceil((to + M) * rate))];
const longRef = {...ref, end: 60, seconds: 60, notes: [[0, 60, [60]]]};
const longDescriptor = {song: 'fixture', reference: longRef};
const track = (takeId, from, to) => ({...C.empty(longDescriptor), segments: [{takeId, from, to}]});
function longTake(id = '1', origin = 0, latency = 0) {
  const seconds = 60 - origin;
  const r = {...longRef, start: origin, captureStart: origin, seconds, latency, notes: [[0, seconds, [60]]]};
  const t = {id, song: 'fixture', part: 'S', createdAt: 20, complete: true, finalized: true,
    frames: seconds * 8000, sampleRate: 8000, pitchReference: r, rate: 1, origin};
  const frames = Array.from({length: seconds * 100}, (_, i) => ({start: i * 80 / 8000 - latency,
    end: (i + 1) * 80 / 8000 - latency, cents: 6010}));
  return {...t, pitchScore: P.scoreFrames(frames, r, seconds), pitchContour: P.packContour(frames, t)};
}
test('used audio maps track time to source frames the way playback does', () => {
  const t = longTake('1', 2, .25);
  const rendered = new Float32Array(8000 * 80), input = Float32Array.from({length: t.frames}, (_, i) => i + 1);
  require('../template/comp_audio.js').splice(rendered, input, [{from: 30, to: 31}], t.origin, .25, 8000);
  // Each input sample holds its own frame number plus one, so the output says what was read.
  const first = rendered[30 * 8000 + 4000] - 1 - 4000, used = C.usedAudio([track('1', 30, 31)], [t]).get('1');
  assert.equal(first, 28.25 * 8000);
  assert.equal(used.length, 1);
  assert.ok(used[0][0] <= first && used[0][1] >= first + 8000, 'the kept range covers every frame played');
  assert.deepEqual(used, [span(28.25, 29.25)]);
});
test('used audio is the union of tracks, Undo and Redo, clipped to the recording', () => {
  const t = longTake();
  const edits = [{key: track('1', 0, 1).key, before: {segments: [{takeId: '1', from: 20, to: 21}]},
    after: {segments: [{takeId: '1', from: 40, to: 41}]}}];
  assert.deepEqual(C.usedAudio([track('1', 0, 1)], [t], edits).get('1'),
    [span(0, 1), span(20, 21), span(40, 41)]);
  assert.deepEqual(C.usedAudio([track('1', 58, 60)], [t]).get('1'), [span(58, 60, 8000, t.frames)]);
  assert.deepEqual(C.usedAudio([track('1', 10, 11), {...track('1', 11, 12), key: 'other'}], [t]).get('1'),
    [span(10, 12)], 'neighbouring ranges merge');
});
test('audio only Undo can reach is still used, and recordings nothing uses are not planned', () => {
  const t = longTake(), other = longTake('2');
  const edits = [{key: track('2', 0, 1).key, before: {segments: [{takeId: '2', from: 5, to: 6}]}, after: {segments: []}}];
  const used = C.usedAudio([track('1', 0, 1)], [t, other, longTake('3')], edits);
  assert.deepEqual([...used.keys()].sort(), ['1', '2']);
});
test('a source stays whole when any use of it cannot be mapped to its recording', () => {
  const t = longTake(), stale = {...track('1', 1, 2), key: 'old',
    descriptor: {...longDescriptor, reference: {...longRef, fingerprint: 'older-score'}}};
  const whole = (comps, takes = [t], edits) => assert.equal(C.usedAudio(comps, takes, edits).has('1'), false);
  assert.equal(C.usedAudio([track('1', 0, 1)], [t]).has('1'), true);
  whole([track('1', 0, 1), stale]);
  whole([track('1', 0, 1)], [{...t, favorite: true}]);
  whole([track('1', 0, 1)], [{...t, active: true}]);
  whole([track('1', 0, 1)], [{...t, finalized: false}]);
  whole([track('1', 0, 1)], [{...t, gap: true}]);
  whole([track('1', 0, 1)], [{...t, origin: null}]);
  whole([track('1', 0, 1)], [{...t, sampleRate: NaN}]);
  whole([track('1', NaN, 1)]);
  whole([track('1', 70, 71)]);
  whole([track('1', 0, 1)], [t], [{key: 'gone', before: {segments: [{takeId: '1', from: 5, to: 6}]}, after: {segments: []}}]);
});
test('a trimmed recording is never offered to a track again', () => {
  const t = take('1', 0, 4), sources = new Map([[t.id, t]]), state = C.empty(descriptor);
  assert.equal(C.offer(state, t, sources).segments.length > 0, true);
  assert.equal(C.offer(state, {...t, storedFrames: 100}, sources), state);
});
