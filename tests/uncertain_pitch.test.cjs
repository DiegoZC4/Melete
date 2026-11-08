const test = require('node:test'), assert = require('node:assert/strict');
const {cleanPitchFrames, repairPitchGrid, restorePitchGrid, rawPitchGrid} = require('../template/vocal_pitch.js');
const pitch = require('../template/take_pitch.js');
const frames = values => values.map((cents,i)=>({start:i/100,end:(i+1)/100,cents}));
test('isolated high-clarity blips in a dropout are omitted, not octave-snapped', () => {
  const f=frames([...Array(20).fill(4150),...Array(26).fill(null),6384,...Array(42).fill(null)]);
  const cleaned=cleanPitchFrames(f);
  assert.equal(cleaned[46].cents,null); assert.equal(cleaned[46].rawCents,6384);
  assert.equal(f[46].cents,6384); assert.equal(cleanPitchFrames(cleaned),cleaned);
});
test('unsupported brief wide jumps are omitted; sustained register changes remain', () => {
  const f=frames([...Array(20).fill(4400),...Array(10).fill(5550),...Array(20).fill(4420)]);
  assert.ok(cleanPitchFrames(f).slice(20,30).every(f=>f.cents===null));
  const long=frames([...Array(20).fill(4400),...Array(30).fill(5600),...Array(20).fill(4420)]);
  assert.deepEqual(cleanPitchFrames(long),long);
  const octave=frames(Array(100).fill(5600));assert.deepEqual(cleanPitchFrames(octave),octave);
});
test('omitted estimates survive packing, and old caches are cleaned without audio reanalysis', () => {
  const ref=pitch.reference({spans:[{start:0,end:1,pitches:[44]}],secondsAtTick:t=>t,start:0,end:1,rate:1,fingerprint:'test',part:0,line:null});
  const f=frames([...Array(20).fill(4400),...Array(10).fill(5550),...Array(70).fill(4420)]);
  const take={sampleRate:8000,frames:8000,pitchReference:ref};
  take.pitchContour=pitch.packContour(cleanPitchFrames(f),take);
  assert.equal(take.pitchContour.pitches[21],5550);
  assert.equal(pitch.readContour(take)[21].cents,null);
});

test('omissions round-trip in the live score grid without losing original estimates', () => {
  const raw=Int16Array.from([...Array(20).fill(4400),...Array(8).fill(0),6384,...Array(8).fill(0)]);
  const cleaned=repairPitchGrid(raw,i=>i/100);
  assert.equal(cleaned.pitches[28],0);
  assert.deepEqual(rawPitchGrid(cleaned.pitches,cleaned.rawOctaves),raw);
  const repairs=[...cleaned.rawOctaves].map(([i,r])=>[i,r.before,r.after]);
  assert.equal(restorePitchGrid(raw,repairs).pitches[28],0);
});
