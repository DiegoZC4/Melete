const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const {TakeBuffer, TakeStore, TakeJournal, wavBytes, WORKLET_SOURCE, MAX_LOOP_SECONDS, PcmCapture,
  takePlaybackWindow, takePlaybackGain} = require('../template/loop_recorder.js');

test('take review levels quiet microphones without changing samples or clipping loud recordings', () => {
  const sr = 48000;
  const tone = level => Float32Array.from({length: sr}, (_, i) => level * Math.sin(2 * Math.PI * 440 * i / sr));
  const quiet = tone(.012), before = quiet.slice();
  const gain = takePlaybackGain(quiet, sr);
  assert.ok(gain > 10 && gain <= 16);
  assert.ok(Math.abs(gain * .012 / Math.sqrt(2) - .1) < .002);
  assert.deepEqual(quiet, before, 'review never normalizes the original samples');
  const paused = new Float32Array(sr * 4);
  paused.set(quiet);
  assert.equal(takePlaybackGain(paused, sr), gain, 'pauses do not increase the review gain');
  const transient = quiet.slice(); transient[100] = .5;
  assert.ok(takePlaybackGain(transient, sr) * .5 <= .85);
  assert.ok(takePlaybackGain(tone(.9), sr) < 1, 'loud captures are not boosted');
  assert.equal(takePlaybackGain(new Float32Array(sr), sr), 1);
  assert.equal(takePlaybackGain(tone(.0001), sr), 1, 'do not amplify an effectively silent file');
  assert.ok(takePlaybackGain(tone(.003), sr) <= 16, 'bounded boost');
});

test('take playback maps the current transport into original audio without changing settings', () => {
  const take = {start: 10, end: 18, rate: .8, latency: .1, buffer: {duration: 10}};
  const before = JSON.stringify(take);
  const pending = takePlaybackWindow(take, 8, 1, 40, .01);
  assert.equal(pending.ratio, 1.25);
  assert.ok(Math.abs(pending.delay - 1.92) < 1e-9);
  assert.equal(pending.from, 0);
  assert.equal(pending.until, 10);
  const inside = takePlaybackWindow(take, 12, 1, 14, .01);
  assert.ok(Math.abs(inside.from - 2.6125) < 1e-9);
  assert.ok(Math.abs(inside.until - 5.1) < 1e-9);
  assert.equal(takePlaybackWindow(take, 19, 1, 40), null);
  assert.equal(takePlaybackWindow(take, 0, 1, 5), null, 'a loop before the take stays silent');
  assert.equal(JSON.stringify(take), before);
});

test('take playback retains count-in and latency at matching or slower current speeds', () => {
  const take = {start: -1, end: 7, rate: 1, latency: .05, buffer: {duration: 8}};
  assert.deepEqual(takePlaybackWindow(take, 0, 1, 20), {ratio: 1, delay: 0, from: 1.05, until: 8});
  assert.deepEqual(takePlaybackWindow(take, 0, .5, 2, .02), {ratio: .5, delay: .02, from: 1.06, until: 3.05});
});

test('blocked IndexedDB access fails lazily and can be retried without breaking player initialization', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    Object.defineProperty(globalThis, 'indexedDB', {configurable: true, get() { throw new Error('Storage blocked'); }});
    const store = new TakeStore();
    await assert.rejects(store.list('song'), /Storage blocked/);
    assert.equal(store.opening, null);
    await assert.rejects(store.list('song'), /Storage blocked/);
    await assert.rejects(new TakeStore(null).list('song'), /unavailable/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  }
});

test('working audio applies backpressure without evicting unsaved takes', () => {
  const buffer = new TakeBuffer(100, 2);
  for (let pass = 0; pass < 3; pass++) {
    buffer.begin(pass * 200);
    buffer.append(pass * 200, new Float32Array(200).fill((pass + 1) / 10));
    assert.ok(buffer.takes.length <= 3);
    assert.ok(buffer.takes.reduce((sum, take) => sum + take.pcm.byteLength, 0) <= 3 * 200 * 2);
  }
  assert.throws(() => buffer.begin(600), /not keeping up/);
  assert.deepEqual(buffer.takes.map(take => take.id), [1, 2, 3]);
  assert.ok(buffer.takes.every(take => buffer.info(take).complete));
  assert.equal(buffer.samples(buffer.takes[1])[0], Math.round(.2 * 32767));
  buffer.release(buffer.takes[0]);
  buffer.begin(600);
  assert.deepEqual(buffer.takes.map(take => take.id), [2, 3, 4]);
});

test('the microphone-ready block preserves real audio across the transport start', () => {
  const buffer = new TakeBuffer(100, 1);
  buffer.append(0, new Float32Array(20).fill(.25));
  buffer.append(20, new Float32Array(20).fill(.5));
  const take = buffer.begin(12);
  buffer.append(40, new Float32Array(72).fill(.5));
  buffer.finish(112, true);
  assert.equal(buffer.info(take).complete, true);
  assert.equal(buffer.info(take).gap, false);
  assert.deepEqual(Array.from(buffer.samples(take).subarray(0, 8)), Array(8).fill(Math.round(.25 * 32767)));
  assert.equal(buffer.samples(take)[8], Math.round(.5 * 32767));
});

test('recent audio is bounded and cannot hide a genuine missing input block', () => {
  const buffer = new TakeBuffer(1000, 1);
  for (let frame=0; frame<10000; frame+=100) buffer.append(frame, new Float32Array(100));
  assert.ok(buffer.recentChunks.reduce((n,chunk)=>n+chunk.samples.length,0)<=350);
  const take = buffer.begin(9900);
  buffer.append(10100, new Float32Array(100));
  assert.equal(buffer.info(take).gap, true);
  assert.deepEqual(buffer.info(take).firstGap, {offset:100, frames:100});
});

function memoryStore() {
  const records = new Map(), chunks = new Map();
  return {records, chunks, fail: false, async append(record, offset, pcm, status) {
    if (this.fail) throw new DOMException('Test full storage', 'QuotaExceededError');
    const previous = records.get(record.id);
    assert.equal(offset, previous?.frames || 0);
    const saved = {...record, ...previous, ...status, number: previous?.number || records.size + 1, frames: offset + pcm.length};
    const audio = chunks.get(record.id) || [];
    audio.push(...pcm);
    chunks.set(record.id, audio);
    records.set(record.id, structuredClone(saved));
    return structuredClone(saved);
  }, async deleteTakes(song, ids) {
    if (this.fail) throw new DOMException('Test full storage', 'QuotaExceededError');
    const deleted = [];
    for (const id of ids) {
      const record = records.get(id);
      if (record && record.song !== song) continue;
      records.delete(id); chunks.delete(id); deleted.push(id);
    }
    return deleted;
  }};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a clock warning persists through recording checkpoints on the affected pass only', async () => {
  const store=memoryStore(), pitchReference={timing:{source:'acoustic',seconds:.041}};
  const journal=new TakeJournal(store,'song',{mode:'loop',seconds:4,pitchReference},100);
  journal.begin(0);journal.append(0,new Float32Array(100));await tick();
  journal.markClockDivergence(-38);
  journal.append(100,new Float32Array(300));journal.begin(400);await tick();
  journal.append(400,new Float32Array(400));journal.finish(800);await journal.flush();
  const [first,next]=[...store.records.values()].sort((a,b)=>a.number-b.number);
  assert.equal(first.pitchReference.timing.clockDivergenceMs,-38);
  assert.deepEqual(next.pitchReference,pitchReference);
  assert.equal(pitchReference.timing.clockDivergenceMs,undefined);
});

test('stopping a free segment retains its actual range despite pending checkpoints', async () => {
  const store = memoryStore(), journal = new TakeJournal(store, 'song',
    {mode:'segment',seconds:10,leadInSeconds:2,start:40,end:50}, 100);
  journal.begin(100);
  journal.append(100, new Float32Array(320).fill(.2));
  journal.finish(420, {discardShortTail:true, segment:(record,seconds)=>({end:record.start+seconds,label:'segment',pitchReference:{seconds}})});
  await journal.flush();
  const record = [...store.records.values()][0];
  assert.equal(record.complete, true);
  assert.equal(record.finalized, true);
  assert.equal(record.seconds, 3.2);
  assert.equal(record.end, 43.2);
  assert.equal(record.frames, 320);
  assert.deepEqual(record.pitchReference, {seconds:3.2});
  assert.equal(store.chunks.get(record.id).length, 320);
});

test('count-in cancellation and hardware failures do not produce successful segments', async () => {
  for (const failure of [false,true]) {
    const store = memoryStore(), journal = new TakeJournal(store, 'song',
      {mode:'segment',seconds:10,leadInSeconds:2}, 100);
    journal.begin(0); journal.append(0,new Float32Array(failure?350:100));
    journal.finish(failure?350:100,{discardShortTail:!failure,segment:failure?null:()=>{throw new Error('Count-in is not a passage');}});
    await journal.flush();
    assert.equal(store.records.size,failure?1:0);
    if(failure) assert.equal([...store.records.values()][0].complete,false);
  }
});

for (const frames of [899, 900, 999, 1000]) test(`manual Stop at ${frames / 10}% ${frames < 1000 ? 'discards' : 'retains'} the last take`, async () => {
  const store = memoryStore(), discarded = [];
  const journal = new TakeJournal(store, 'song', {seconds: 10}, 100, {onDiscard: id => discarded.push(id)});
  journal.begin(0);
  journal.append(0, new Float32Array(frames).fill(.2));
  const id = journal.views()[0].id;
  journal.finish(frames, {discardShortTail: true});
  await journal.flush();
  assert.equal(store.records.has(id), frames >= 1000);
  assert.equal(store.chunks.has(id), frames >= 1000);
  assert.deepEqual(discarded, frames < 1000 ? [id] : []);
  if (frames >= 1000) {
    assert.equal(store.records.get(id).complete, true);
    assert.equal(store.records.get(id).frames, frames);
  }
  assert.equal(journal.entries.size, 0);
  assert.equal(journal.buffer.takes.length, 0);
});

for (const frames of [1099, 1100, 1199, 1200]) test(`first-pass count-in does not inflate completion at ${frames} frames`, async () => {
  const store = memoryStore();
  const journal = new TakeJournal(store, 'song', {seconds: 20, initial: {seconds: 12, leadInSeconds: 2}}, 100);
  journal.begin(50);
  journal.append(50, new Float32Array(frames));
  journal.finish(50 + frames, {discardShortTail: true});
  await journal.flush();
  assert.equal(store.records.size, frames === 1200 ? 1 : 0, 'first passage is 10s, not the 20s repeat');
});

test('short tail cleanup keeps completed loops and old partials, waiting for pending checkpoints', async () => {
  const store = memoryStore(), old = new TakeJournal(store, 'song', {seconds: 10}, 100);
  old.begin(0); old.append(0, new Float32Array(20)); old.finish(20); await old.flush();
  const oldId = [...store.records.keys()][0];
  const journal = new TakeJournal(store, 'song', {seconds: 2}, 100);
  journal.begin(0); journal.append(0, new Float32Array(200)); journal.begin(200); await tick();
  const append = store.append.bind(store);
  let release;
  store.append = (...args) => {
    store.append = append;
    return new Promise(resolve => { release = () => resolve(append(...args)); });
  };
  journal.append(200, new Float32Array(120));
  const tail = journal.views().find(take => take.active).id;
  journal.finish(320, {discardShortTail: true});
  const flushed = journal.flush();
  release(); await flushed;
  assert.equal(store.records.has(tail), false, 'late checkpoint cannot resurrect the ignored tail');
  assert.equal(store.chunks.has(tail), false);
  assert.equal(store.records.size, 2);
  assert.equal(store.records.get(oldId).complete, false, 'existing partial is not swept away');
  assert.equal([...store.records.values()].filter(take => take.complete).length, 1);
});

test('a legacy favorite flag does not retain a newly interrupted loop', async () => {
  const store = memoryStore(), journal = new TakeJournal(store, 'song', {seconds: 10}, 100);
  journal.begin(0); journal.append(0, new Float32Array(100)); await tick();
  const id = journal.views()[0].id;
  store.records.get(id).favorite = true;
  journal.finish(130, {discardShortTail: true});
  journal.append(100, new Float32Array(50).fill(.2));
  await journal.flush();
  assert.equal(store.records.has(id), false);
  assert.equal(store.chunks.has(id), false);
});

test('failed short-tail deletion preserves checkpoint and unsaved audio for a non-destructive retry', async () => {
  const store = memoryStore(), errors = [], journal = new TakeJournal(store, 'song', {seconds: 10}, 100,
    {onError: error => errors.push(error.name)});
  journal.begin(0); journal.append(0, new Float32Array(100)); await tick();
  const id = journal.views()[0].id;
  store.fail = true;
  journal.finish(130, {discardShortTail: true}); journal.append(100, new Float32Array(30));
  await journal.flush();
  assert.deepEqual(errors, ['QuotaExceededError']);
  assert.equal(store.records.get(id).frames, 100);
  assert.equal(journal.views()[0].frames, 130);
  store.fail = false; await journal.retry();
  assert.equal(store.records.get(id).frames, 130, 'retry saves recovered audio instead of deleting it');
  assert.equal(journal.entries.size, 0);
});

for (const problem of ['gap', 'missing flush', 'storage']) test(`${problem} preserves a short interrupted take`, async () => {
  const store = memoryStore(), journal = new TakeJournal(store, 'song', {seconds: 10}, 100);
  journal.begin(0); journal.append(0, new Float32Array(100)); await tick();
  if (problem === 'gap') journal.append(110, new Float32Array(20));
  if (problem === 'storage') journal.fail(new Error('Storage unavailable'));
  journal.finish(130, {discardShortTail: true});
  await journal.flush();
  if (problem === 'storage') await journal.retry();
  assert.equal(store.records.size, 1);
  assert.equal([...store.records.values()][0].complete, false);
});

for (const initialSeconds of [1, 3]) test(`first take can be ${initialSeconds < 2 ? 'shorter' : 'longer'} than the unchanged repeat loop`, async () => {
  const store = memoryStore();
  const initialStart = initialSeconds < 2 ? 1920 : 0;
  const initialLabel = initialSeconds < 2 ? '19.3-24' : '18.7-24';
  const journal = new TakeJournal(store, 'song', {
    seconds: 2, part: 'B2', label: '19-24', start: 960, end: 2880, rate: 1,
    initial: {seconds: initialSeconds, start: initialStart, label: initialLabel},
  }, 100);
  journal.begin(50);
  const initialFrames = initialSeconds * 100;
  journal.append(50, new Float32Array(initialFrames).fill(.1));
  journal.begin(50 + initialFrames);
  await tick();
  journal.append(50 + initialFrames, new Float32Array(200).fill(.2));
  journal.begin(250 + initialFrames);
  await tick();
  journal.append(250 + initialFrames, new Float32Array(30).fill(.3));
  journal.finish(280 + initialFrames);
  await journal.flush();
  const [first, repeat, partial] = [...store.records.values()];
  assert.deepEqual([first.label, repeat.label, partial.label], [initialLabel, '19-24', '19-24']);
  assert.deepEqual([first.start, repeat.start, partial.start], [initialStart, 960, 960]);
  assert.deepEqual([first.frames, repeat.frames, partial.frames], [initialFrames, 200, 30]);
  assert.deepEqual([first.complete, repeat.complete, partial.complete], [true, true, false]);
  assert.ok([first, repeat, partial].every(take => take.finalized && !('initial' in take)));
  for (const [i, take] of [first, repeat, partial].entries()) {
    const pcm = Int16Array.from(store.chunks.get(take.id));
    const wav = Buffer.from(wavBytes(pcm, 100));
    assert.equal(wav.readUInt32LE(40), take.frames * 2);
    assert.ok(pcm.every(sample => sample === Math.round((i + 1) / 10 * 32767)));
  }
  assert.equal(journal.entries.size, 0);
});

test('journal stores many takes while releasing finalized PCM from memory', async () => {
  const store = memoryStore();
  const journal = new TakeJournal(store, 'song', {seconds: 2, part: 'Bass', label: '19-23'}, 100);
  journal.begin(0);
  for (let pass = 0; pass < 30; pass++) {
    journal.append(pass * 200, new Float32Array(200).fill(.1));
    journal.begin((pass + 1) * 200);
    await tick();
    assert.ok(journal.buffer.takes.length <= 1);
  }
  journal.finish(6000);
  await journal.flush();
  assert.equal(store.records.size, 30);
  assert.ok([...store.records.values()].every(take => take.complete && take.finalized && take.frames === 200));
  assert.equal(journal.buffer.takes.length, 0);
  assert.equal(journal.entries.size, 0);
});

test('failed checkpoint preserves earlier saves and the unsaved tail for download and retry', async () => {
  const store = memoryStore(), errors = [];
  const journal = new TakeJournal(store, 'song', {seconds: 3}, 100, {onError: error => errors.push(error.name)});
  journal.begin(0);
  journal.append(0, new Float32Array(100).fill(.2));
  await tick();
  const id = journal.views()[0].id;
  store.records.get(id).favorite = true;
  store.fail = true;
  journal.append(100, new Float32Array(100).fill(.3));
  await tick();
  journal.finish(200);
  await journal.flush();
  assert.deepEqual(errors, ['QuotaExceededError']);
  assert.equal(store.records.get(id).frames, 100);
  assert.equal(journal.views()[0].frames, 200);
  assert.equal(journal.views()[0].unsaved, true);
  const wav = Buffer.from(await journal.wav(id).arrayBuffer());
  assert.equal(wav.readUInt32LE(40), 400);
  store.fail = false;
  await journal.retry();
  assert.equal(store.records.get(id).frames, 200);
  assert.equal(store.records.get(id).favorite, true);
  assert.equal(store.records.get(id).complete, false);
  assert.equal(store.records.get(id).finalized, true);
  assert.equal(journal.entries.size, 0);
});

test('stalled writes bound working memory without silently dropping a pass', async () => {
  const store = memoryStore(), realAppend = store.append.bind(store), release = [];
  store.append = (...args) => new Promise(resolve => release.push(() => resolve(realAppend(...args))));
  const errors = [];
  const journal = new TakeJournal(store, 'song', {seconds: 1}, 100, {onError: error => errors.push(error.message)});
  for (let i = 0; i < 3; i++) { journal.begin(i * 100); journal.append(i * 100, new Float32Array(100)); }
  journal.begin(300);
  journal.finish(300);
  assert.equal(journal.buffer.takes.length, 3);
  assert.match(errors[0], /not keeping up/);
  release.splice(0).forEach(resolve => resolve());
  await journal.flush();
  store.append = realAppend;
  await journal.retry();
  assert.equal(journal.entries.size, 0);
  assert.equal(store.records.size, 3);
});

test('frame routing splits asynchronous chunks at the actual loop boundary without mixing takes', () => {
  const buffer = new TakeBuffer(100, 1);
  buffer.append(0, new Float32Array(30).fill(.1));
  buffer.begin(20);
  buffer.append(30, new Float32Array(60).fill(.2));
  buffer.begin(120);
  buffer.append(90, new Float32Array(60).fill(.3));
  const first = buffer.takes[0];
  assert.equal(buffer.info(first).complete, true);
  assert.equal(buffer.samples(first).length, 100);
  assert.equal(buffer.samples(first)[0], Math.round(.1 * 32767));
  assert.equal(buffer.samples(first)[99], Math.round(.3 * 32767));
  assert.equal(buffer.samples(buffer.current).length, 30);
  buffer.append(150, new Float32Array(30).fill(.4));
  buffer.finish(180);
  assert.equal(buffer.info(buffer.takes[1]).complete, false);
  assert.equal(buffer.info(buffer.takes[1]).seconds, .6);
});

test('long scheduler delays cannot grow memory or turn missing input into a complete take', () => {
  const buffer = new TakeBuffer(100, 1);
  buffer.begin(0);
  buffer.append(0, new Float32Array(20).fill(.1));
  buffer.append(40, new Float32Array(1000).fill(.2));
  buffer.finish(1040, true);
  assert.equal(buffer.samples(buffer.takes[0]).length, 100);
  assert.equal(buffer.info(buffer.takes[0]).complete, false);
  assert.equal(buffer.info(buffer.takes[0]).gap, true);
  assert.equal(buffer.samples(buffer.takes[0])[21], 0);
  assert.throws(() => new TakeBuffer(48000, MAX_LOOP_SECONDS + 1));
  assert.throws(() => new TakeBuffer(48000, NaN));
});

test('stop preserves the tail delivered by flush, but excludes audio after stop', () => {
  const buffer = new TakeBuffer(48000, 2);
  buffer.begin(800);
  buffer.append(800, new Float32Array(2048).fill(.2));
  buffer.finish(3000);
  buffer.append(2848, new Float32Array(800).fill(.3));
  assert.equal(buffer.samples(buffer.takes[0]).length, 2200);
  assert.equal(buffer.samples(buffer.takes[0]).at(-1), Math.round(.3 * 32767));
  assert.equal(buffer.info(buffer.takes[0]).complete, false);
});

test('WAVs are independent mono little-endian PCM16 files with true sample rate and length', () => {
  const pcm = new Int16Array([-32768, -1234, 0, 32767]);
  const wav = Buffer.from(wavBytes(pcm, 48000));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt32LE(28), 96000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length * 2);
  pcm.forEach((sample, index) => assert.equal(wav.readInt16LE(44 + index * 2), sample));
});

test('worklet mixes input channels, timestamps arbitrary blocks, flushes once, and never monitors input', () => {
  const messages = [];
  const context = vm.createContext({Float32Array, currentFrame: 1000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: message => messages.push(message)}; } },
    registerProcessor: (name, processor) => { context.Processor = processor; },
  });
  vm.runInContext(WORKLET_SOURCE, context);
  const processor = new context.Processor();
  const output = [new Float32Array(256)];
  for (let i = 0; i < 10; i++) {
    context.currentFrame = 1000 + i * 256;
    assert.equal(processor.process([[new Float32Array(256).fill(.5), new Float32Array(256).fill(.1)]], [output]), true);
  }
  processor.port.onmessage({data: 'stop'});
  assert.equal(messages.length, 3);
  assert.equal(messages[0].frame, 1000);
  assert.equal(messages[1].frame, 3048);
  assert.equal(messages[1].samples.length, 512);
  assert.ok(Math.abs(messages[0].samples[0] - .3) < 1e-6);
  assert.equal(messages[2].stopped, true);
  assert.ok(output[0].every(value => value === 0));
  assert.equal(processor.process([[]]), false);
});

test('capture waits for real input frames before letting transport start, even if they are silent', async () => {
  const original = global.AudioWorkletNode;
  let node, connected = false;
  global.AudioWorkletNode = class {
    constructor() {
      node = this;
      this.port = {close() {}, postMessage: () => queueMicrotask(() => this.port.onmessage({data: {stopped: true}}))};
    }
    connect() {} disconnect() {}
  };
  try {
    const context = {destination: {}, audioWorklet: {addModule: async () => {}}};
    const source = {connect() { connected = true; }, disconnect() { connected = false; }};
    let ready = false, samples = 0;
    const pending = PcmCapture.create(context, source, (_frame, pcm) => { samples += pcm.length; }, assert.fail)
      .then(capture => { ready = true; return capture; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connected, true);
    assert.equal(ready, false, 'permission and graph construction are not microphone readiness');
    node.port.onmessage({data: {frame: 0, samples: new Float32Array(256), hasInput: false}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false, 'an inactive input does not start playback');
    node.port.onmessage({data: {frame: 256, samples: new Float32Array(2048), hasInput: true}});
    const capture = await pending;
    assert.equal(ready, true);
    assert.equal(samples, 2304);
    await capture.stop();
    assert.equal(connected, false);
  } finally { global.AudioWorkletNode = original; }
});

test('inactive input quanta retain silence and elapsed time instead of punching holes in a take', () => {
  const messages = [];
  const c = vm.createContext({Float32Array, currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: message => messages.push(message)}; } },
    registerProcessor: (_name, processor) => { c.Processor = processor; },
  });
  vm.runInContext(WORKLET_SOURCE, c);
  const processor = new c.Processor();
  const output = [[new Float32Array(128)]];
  processor.process([[new Float32Array(128).fill(.5)]], output);
  c.currentFrame = 128;
  processor.process([[]], output);
  c.currentFrame = 256;
  processor.process([[new Float32Array(128).fill(.25)]], output);
  processor.port.onmessage({data: 'stop'});
  assert.equal(messages[0].samples.length, 384);
  assert.equal(messages[0].frame, 0);
  assert.equal(messages[0].hasInput, true);
  assert.ok(messages[0].samples.subarray(128, 256).every(value => value === 0));
  assert.ok(messages[0].samples.subarray(256).every(value => value === .25));
});
