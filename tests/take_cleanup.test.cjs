const {test} = require("node:test");
const assert = require("node:assert/strict");
const cleanup = require("../template/take_cleanup.js");
const recording = require("../template/loop_recorder.js");

test("only continuous written rests longer than ten performed seconds qualify", () => {
  const refs = {notes:[[25,26],[12,14],[2,3],[13,15]], seconds:36, leadInSeconds:2};
  assert.deepEqual(cleanup.longRests(refs), []);
  assert.deepEqual(cleanup.longRests({...refs,seconds:36.01}, .042), [[26.042,36.01 + .042]]);
  assert.deepEqual(cleanup.longRests({notes:[],seconds:26,leadInSeconds:12}), [[12,26]]);
  assert.deepEqual(cleanup.longRests({notes:[[15,18]],seconds:18,leadInSeconds:15}), []);
  assert.deepEqual(cleanup.longRests({seconds:90}), []);
  assert.deepEqual(cleanup.longRests({notes:[[NaN,10]],seconds:90}), []);
});

test("short rests and count-ins pass through byte for byte even with noisy breath audio", async () => {
  const rate=8000, pcm=Int16Array.from({length:rate*15},(_,i)=>(i*103)%19001-9000);
  const blob=new Blob([recording.wavBytes(pcm,rate)]);
  const take={frames:pcm.length,sampleRate:rate,pitchReference:{notes:[[2,3],[13,14]],seconds:15,leadInSeconds:2}};
  const copy=await cleanup.prepare(blob,take);
  assert.equal(copy.blob,blob);
});

test("a long rest has one smooth dip, protects both phrase edges, and leaves the source alone", async () => {
  const rate=8000, pcm=new Int16Array(rate*17).fill(10000);
  const ref={notes:[[0,2],[15,16]],seconds:16,latency:.25};
  const blob=new Blob([recording.wavBytes(pcm,rate)]);
  const {blob:processed,ranges}=await cleanup.prepare(blob,{frames:pcm.length,sampleRate:rate,pitchReference:ref});
  assert.deepEqual(ranges,[[2.25,15.25]]);
  const out=new Int16Array(await processed.arrayBuffer(),44);
  assert.equal(out.length,pcm.length);
  assert.ok(out.subarray(0,rate*3.25).every(s=>s===10000));
  assert.ok(out.subarray(rate*14.25).every(s=>s===10000));
  assert.equal(out[3.5*rate],out[14*rate]);
  assert.ok(out[3.5*rate]>5000 && out[3.5*rate]<6000);
  assert.ok(out.subarray(3.75*rate,13.75*rate).every(s=>s===Math.trunc(10000*cleanup.SETTINGS.floorGain)));
  assert.deepEqual(new Int16Array(await blob.arrayBuffer(),44),pcm);
  // A rehearsal clip that starts mid-rest must use the same section of the envelope.
  const cut=new Float32Array(rate*3).fill(1);
  cleanup.apply(cut,rate,cleanup.longRests(ref,-8));
  assert.ok(cut.every(v=>Math.abs(v-cleanup.SETTINGS.floorGain)<1e-7));
});

test("Stop click cleanup affects only the end of the listening copy",async()=>{
  const pcm=new Int16Array(8000).fill(1000),blob=new Blob([recording.wavBytes(pcm,8000)]);
  const {blob:out}=await cleanup.prepare(blob,{frames:8000,sampleRate:8000,stopNoiseFrom:.8});
  const clean=new Int16Array(await out.arrayBuffer(),44);
  assert.equal(clean[6300],1000);assert.equal(clean[6500],0);
  assert.deepEqual(new Int16Array(await blob.arrayBuffer(),44),pcm);
});
