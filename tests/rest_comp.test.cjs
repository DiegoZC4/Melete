const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../template/take_pitch.js');
const C = require('../template/practice_comp.js');
const A = require('../template/comp_audio.js');
const {TakeBuffer, TakeJournal} = require('../template/loop_recorder.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ~= ${b}`);

const spans = [{start: 2, end: 3, pitches: [60]}, {start: 7, end: 8, pitches: [62]}];
const makeRef = (extra = {}) => P.reference({spans, division: 1, measures: [[0, 4, 4, 4], [4, 4, 4, 4], [8, 4, 4, 4]],
  secondsAtTick: t => t, start: 0, end: 10, rate: 1, fingerprint: 'rests', part: 0, line: null, ...extra});

test('one-beat rest guards use full-score context, including a rest-only capture', () => {
  const ref = makeRef();
  assert.deepEqual(ref.restPolicy.keep, [[1, 4], [6, 9]]);
  assert.deepEqual(ref.restPolicy.guards, [[1, 2], [3, 4], [6, 7], [8, 9]]);
  const middle = makeRef({start: 3.5, end: 6.5});
  assert.deepEqual(middle.notes, []);
  assert.deepEqual(middle.restPolicy.keep, [[0, .5], [2.5, 3]]);
  assert.deepEqual(makeRef({rate: 2}).restPolicy.keep, [[.5, 2], [3, 4.5]]);
});

test('beat guards follow tempo and meter, not a fixed wall-clock second', () => {
  const ref = makeRef({spans: [{start: 4, end: 5, pitches: [60]}],
    measures: [[0, 4, 4, 4], [4, 3, 6, 8], [7, 4, 4, 4]],
    secondsAtTick: t => t < 4 ? t / 2 : 2 + (t - 4)});
  assert.deepEqual(ref.restPolicy.keep, [[1.5, 3.5]]);
  assert.deepEqual(ref.restPolicy.guards, [[1.5, 2], [3, 3.5]]);
});

test('deep-rest PCM is erased before storage; timing, latency, and kept samples survive', async () => {
  const ref = makeRef({latency: .1}), sr = 8000;
  const pcm = new Int16Array(sr * 10).fill(1000);
  P.discardRestAudio(pcm, sr, ref);
  for (const t of [.5, 4.5, 5.5, 9.5]) assert.equal(pcm[Math.round((t + .1) * sr)], 0);
  for (const t of [1.5, 2.5, 3.5, 6.5, 7.5, 8.5]) assert.equal(pcm[Math.round((t + .1) * sr)], 1000);
  assert.equal(pcm[Math.round(1.1 * sr)], 0, 'fade begins inside retained margin');
  assert.equal(pcm[Math.round(1.11 * sr)], 1000);
  const b = new TakeBuffer(sr, 10);
  b.append(0, new Float32Array(sr).fill(.25));
  const t = b.begin(0, ref);
  b.append(sr, new Float32Array(9 * sr).fill(.25)); b.finish(10 * sr, true);
  assert.equal(b.info(t).complete, true);
  assert.equal(t.pcm[sr * 5], 0); assert.ok(t.pcm[sr * 2] > 0);
  const writes = [], store = {async append(record, offset, samples, status) {
    writes.push({offset, samples: samples.slice()});
    return {...record, ...status, frames: offset + samples.length};
  }};
  const journal = new TakeJournal(store, 'rests', {seconds: 10, pitchReference: ref}, sr);
  journal.begin(0); journal.append(0, new Float32Array(sr * 10).fill(.5));
  journal.finish(sr * 10); await journal.flush();
  const stored = new Int16Array(sr * 10);
  for (const w of writes) stored.set(w.samples, w.offset);
  assert.equal(stored[sr * 5], 0, 'no raw backup/checkpoint of the discarded audio');
  assert.ok(stored[sr * 2] > 0);
});

function take(id, from = 0, to = 10, {error = 20, noisy = true, missing = false} = {}) {
  const ref = makeRef({start: from, end: to});
  const t = {id, song: 'rests', createdAt: Number(id), finalized: true, complete: true, origin: from,
    sampleRate: 8000, frames: (to - from) * 8000, pitchReference: ref};
  const frames = Array.from({length: t.frames / 80}, (_, i) => {
    const start = i / 100, end = (i + 1) / 100;
    const note = ref.notes.find(n => n[0] <= start && n[1] > start);
    return {start, end, cents: missing ? null : note ? note[2][0] * 100 + error : noisy ? 6000 : null};
  });
  const clean = P.cleanRestFrames(frames, ref);
  t.pitchContour = P.packContour(clean, t); t.pitchScore = P.scoreFrames(clean, ref, ref.seconds);
  return t;
}
const descriptor = {song: 'rests', reference: makeRef()};

test('rest voicing uses seconds, separate from intonation; missing recording is never silence', () => {
  const t = take('1'), s = t.pitchScore;
  near(s.meanAbsCents, 20); near(s.coverage, 1);
  assert.ok(Math.abs(s.restVoicedSeconds - 4) < 1e-6);
  assert.equal(s.restObservedSeconds, 4);
  assert.equal(P.scoreFrames([], makeRef(), 10).restVoicedSeconds, null);
  const frames = P.readContour(t);
  assert.equal(frames.find(f => f.start === 5).cents, null);
  assert.equal(frames.find(f => f.start === 1.5).cents, 6000);
  const shortened = P.trimReference(makeRef(), 5, 5);
  assert.equal(P.restPolicyValid(shortened), true);
  assert.deepEqual(shortened.restPolicy.keep, [[1, 4]]);
});

test('rest-only silence never hides the chosen phrase entrance or release', () => {
  const a = take('1'), b = take('2', 3, 7, {noisy: false});
  const takes = new Map([[a.id, a], [b.id, b]]);
  const original = C.offer(C.empty(descriptor), a, takes);
  const offered = C.offer(original, b, takes);
  assert.deepEqual(offered.segments, original.segments);
  near(C.stats(offered, takes).meanAbsCents, 20);
  near(C.stats(offered, takes).restVoicedSeconds, 4);
  const noAudio = {...b, gap: true}; takes.set(b.id, noAudio);
  assert.deepEqual(C.offer(original, noAudio, takes).segments, original.segments);
  const noFrames = {...b, analysisFrames: []}; takes.set(b.id, noFrames);
  assert.deepEqual(C.offer(original, noFrames, takes).segments, original.segments, 'unobserved audio cannot erase a rest error');
});

test('the newest recording of a phrase brings its own rests; one with no singing changes nothing', () => {
  const a = take('1'), b = take('2', 0, 10, {error: 90, noisy: false});
  const takes = new Map([[a.id, a], [b.id, b]]);
  const first = C.offer(C.empty(descriptor), a, takes);
  const state = C.offer(first, b, takes);
  near(C.stats(state, takes).meanAbsCents, 90);
  near(C.stats(state, takes).restVoicedSeconds, 0);
  assert.deepEqual([...new Set(state.segments.map(s => s.takeId))], [b.id]);
  assert.deepEqual(C.undo(state).segments, first.segments);
  const d = take('4', 0, 10, {missing: true}); takes.set(d.id, d);
  assert.equal(C.offer(state, d, takes).segments, state.segments);
});

test('a recording stopped mid-phrase punches in only the notes it sang', () => {
  const a=take('1'), b=take('2',2,3,{error:0,noisy:false}), c=take('3',1,4,{error:5}), d=take('4',6,7.5,{error:5});
  const takes=new Map([a,b,c,d].map(t=>[t.id,t]));
  const original=C.offer(C.empty(descriptor),a,takes);
  const punched=C.offer(original,b,takes);
  assert.equal(punched.segments.find(s=>s.from<=2.5&&s.to>2.5).takeId,b.id);
  assert.equal(punched.segments.find(s=>s.from<=7.5&&s.to>7.5).takeId,a.id);
  assert.equal(C.validate(punched,takes),true);
  assert.deepEqual(C.offer(C.empty(descriptor),b,takes).segments,[C.segment(b)]);
  const improved=C.offer(original,c,takes);
  for(const t of [1.5,2.5,3.5])assert.equal(improved.segments.find(s=>s.from<=t&&s.to>t).takeId,c.id);
  assert.equal(improved.segments.find(s=>s.from<=7.5&&s.to>7.5).takeId,a.id);
  const stopped=C.offer(original,d,takes);
  assert.equal(stopped.segments.find(s=>s.from<=7.25&&s.to>7.25).takeId,d.id);
  assert.equal(stopped.segments.find(s=>s.from<=7.75&&s.to>7.75).takeId,a.id,'singing after the Stop press is kept');
  assert.equal(C.validate(stopped,takes),true);
});

test('saved rest splices repair to the sung source, including Undo, without editing recordings', () => {
  const a=take('1'), b=take('2',3,7,{noisy:false}), takes=new Map([a,b].map(t=>[t.id,t]));
  const spliced=C.replace([C.segment(a)],C.segment(b));
  const state={...C.empty(descriptor),segments:spliced,undo:spliced};
  const sourceBytes=JSON.stringify([...takes.values()]);
  const fixed=C.repairMargins(state,takes);
  assert.deepEqual(fixed.segments,[C.segment(a)]);
  assert.deepEqual(fixed.undo,[C.segment(a)]);
  assert.deepEqual(C.repairMargins(fixed,takes),fixed,'repair is idempotent');
  near(C.stats(fixed,takes).restVoicedSeconds,4);
  near(C.stats(fixed,takes).meanAbsCents,C.stats(state,takes).meanAbsCents);
  assert.equal(JSON.stringify([...takes.values()]),sourceBytes);
  assert.equal(C.validate(fixed,takes),true);
});

test('different sung phrases retain their sources and guards; the seam falls in muted rest', () => {
  const a=take('1'),b=take('2'),silence=take('3',3,7,{noisy:false});
  const takes=new Map([a,b,silence].map(t=>[t.id,t]));
  const old=[{takeId:a.id,from:2,to:3},C.segment(silence),{takeId:b.id,from:7,to:8}];
  const fixed=C.bindMargins(old,descriptor,takes);
  assert.deepEqual(fixed,[{takeId:a.id,from:0,to:5},{takeId:b.id,from:5,to:10}]);
  assert.deepEqual(C.clipNotes(descriptor.reference.notes,old),C.clipNotes(descriptor.reference.notes,fixed));
  const missing=C.bindMargins([{takeId:a.id,from:2,to:2.5}],descriptor,takes);
  assert.deepEqual(missing,[{takeId:a.id,from:0,to:2.5}],'never fill missing written singing');
  const sr=1000,out=new Float32Array(sr*10);
  for(const [id,level] of [[a.id,.25],[b.id,.5]]) {
    const audio=new Float32Array(sr*10).fill(level);
    P.discardRestAudio(audio,sr,descriptor.reference);
    A.splice(out,audio,fixed.filter(s=>s.takeId===id),0,0,sr);
  }
  for(const t of [1.5,2.5,3.5])assert.equal(out[t*sr],.25,'first phrase retains audible entrance and release');
  for(const t of [6.5,7.5,8.5])assert.equal(out[t*sr],.5,'second phrase retains its own margins');
  for(const t of [.5,4.5,5,5.5,9.5])assert.equal(out[t*sr],0,'deep rests remain muted in the compiled audio');
});

test('overlapping one-beat margins form one phrase; a recording stopped inside it keeps later singing', () => {
  const shortSpans=[{start:2,end:3,pitches:[60]},{start:4,end:5,pitches:[62]}];
  const r=makeRef({spans:shortSpans}),d={song:'rests',reference:r};
  const changeRef=(t,reference,error)=>{
    const frames=Array.from({length:reference.seconds*100},(_,i)=>{
      const start=i/100,end=(i+1)/100,n=reference.notes.find(n=>n[0]<=start&&n[1]>start);
      return {start,end,cents:n?n[2][0]*100+error:6000};
    });
    t.pitchReference=reference;t.pitchContour=P.packContour(P.cleanRestFrames(frames,reference),t);
    t.pitchScore=P.scoreFrames(frames,reference,reference.seconds);return t;
  };
  const a=changeRef(take('1'),r,20);
  const b=changeRef(take('2',1,4),makeRef({spans:shortSpans,start:1,end:4}),0);
  const takes=new Map([a,b].map(t=>[t.id,t]));
  assert.deepEqual(r.restPolicy.keep,[[1,6]]);
  const state=C.offer(C.empty(d),a,takes), next=C.offer(state,b,takes);
  assert.equal(next.segments.find(s=>s.from<=2.5&&s.to>2.5).takeId,b.id);
  assert.equal(next.segments.find(s=>s.from<=4.5&&s.to>4.5).takeId,a.id);
  assert.equal(C.validate(next,takes),true);
});
