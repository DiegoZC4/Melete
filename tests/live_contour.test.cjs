const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../template/take_pitch.js');
const {TakeJournal}=require('../template/loop_recorder.js');
const ref={version:1,fingerprint:'live',part:0,line:null,start:0,end:8,rate:1,seconds:2,latency:.02,notes:[[0,2,[60]]]};
const take={sampleRate:48000,frames:96000,pitchReference:ref};

test('live contours preserve irregular observed intervals and unobserved gaps through storage',()=>{
  const frames=[{start:.01,end:.019,cents:6000},{start:.019,end:.031,cents:6010},
    {start:.08,end:.09,cents:null},{start:.2,end:.23,cents:6012}];
  const pitchContour=P.packLiveContour(frames,take), decoded=P.readContour({...take,pitchContour});
  assert.equal(pitchContour.version,2);
  assert.deepEqual(decoded,frames.map(f=>({...f,live:true})));
  assert.deepEqual(P.packContour(decoded,{...take,pitchContour}),pitchContour);
  const score=P.scoreFrames(decoded,ref,2);
  assert.ok(Math.abs(score.trackedSeconds-.051)<1e-9,'missing time is not filled or counted as tracked');
  assert.equal(P.readContour({...take,pitchContour:{...pitchContour,pitches:Float64Array.of(.1,.3,6000,.2,.4,6000)}}),null);
  assert.equal(P.readContour({...take,pitchContour:{...pitchContour,pitches:Float64Array.of(0,3,6000)}}),null);
});

test('journal caches live pitch at microphone timestamps, including latency and confirmation backfill',async()=>{
  const records=new Map();
  const store={async append(record,offset,pcm,status){const r={...record,...records.get(record.id),...status,frames:offset+pcm.length,number:1};records.set(r.id,r);return r;}};
  const journal=new TakeJournal(store,'test',{mode:'segment',seconds:2,start:0,end:8,pitchReference:ref},48000);
  journal.begin(48000);
  journal.observePitch(52800,480,null);
  journal.observePitch(52800,480,6010);
  journal.observePitch(53280,480,6020);
  journal.append(48000,new Float32Array(96000));
  journal.finish(144000);
  await journal.flush();
  const saved=[...records.values()][0],frames=P.readContour(saved);
  assert.equal(saved.pitchContour.version,2);
  assert.equal(frames.length,2);
  assert.ok(Math.abs(frames[0].start-.075)<1e-9);
  assert.equal(frames[0].cents,6010);
  assert.ok(P.currentScore(saved.pitchScore));
});

const observations=(voiceTo)=>Array.from({length:196},(_,i)=>({start:i/100,end:(i+1)/100,cents:i/100<voiceTo?6000:null}));
function clickAudio(){const p=new Int16Array(96000); for(let i=0;i<72000;i++)p[i]=3000*Math.sin(2*Math.PI*200*i/48000);
  for(let i=94600;i<94800;i++)p[i]=(i%2?1:-1)*14000;return p;}
test('isolated unpitched stop click is faded out without moving timestamps or touching singing',()=>{
  const pcm=clickAudio(),before=pcm.slice(),from=P.stopNoiseCut(pcm,48000,observations(1.5));
  assert.ok(from>1.9&&from<1.98);
  P.muteStopTail(pcm,48000,from);
  assert.equal(pcm.length,96000);
  assert.deepEqual(pcm.subarray(0,91200),before.subarray(0,91200));
  assert.ok(pcm.subarray(94600).every(v=>v===0));
});
test('tail protection keeps wrong notes, releases, sustained consonants and unknown tracking',()=>{
  const pcm=clickAudio();
  assert.equal(P.stopNoiseCut(pcm,48000,observations(1.94).map(f=>({...f,cents:f.cents===null?null:7300}))),null);
  assert.equal(P.stopNoiseCut(pcm,48000,[]),null);
  const hiss=pcm.slice();for(let i=88800;i<96000;i++)hiss[i]=(i%2?1:-1)*6000;
  assert.equal(P.stopNoiseCut(hiss,48000,observations(1.5)),null);
  assert.equal(P.stopNoiseCut(new Int16Array(96000),48000,observations(1.5)),null);
});
