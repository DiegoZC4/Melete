const test = require('node:test');
const assert = require('node:assert/strict');
const vocal = require('../template/vocal_pitch.js');
const fs = require('node:fs'), vm = require('node:vm');
const frames = rows => rows.map(([start,end,cents]) => ({start,end,cents,live:true}));

test('brief high aliases at an onset and between different notes are omitted, not retuned', () => {
  const make=values=>values.map((cents,i)=>({start:i*.01,end:(i+1)*.01,cents,live:true}));
  const onset=make([...Array(15).fill(null),6806,null,null,6801,6799,6797,6805,
    ...Array(15).fill(null),...Array(25).fill(4510)]);
  const change=make([...Array(15).fill(4430),null,null,null,6720,6720,6722,null,...Array(25).fill(4150)]);
  for(const livePreview of [false,true]){
    const a=vocal.cleanPitchFrames(onset,{livePreview}),b=vocal.cleanPitchFrames(change,{livePreview});
    assert.ok(a.slice(15,22).every(f=>f.cents===null));
    assert.ok(b.slice(18,21).every(f=>f.cents===null));
    assert.deepEqual(a.slice(-25),onset.slice(-25));
    assert.deepEqual(b.slice(-25),change.slice(-25));
    assert.deepEqual(vocal.cleanPitchFrames(a,{livePreview}),a);
    assert.deepEqual(vocal.cleanPitchFrames(b,{livePreview}),b);
  }
});

test('three-sample Autumn release burst is omitted in live and saved contours', () => {
  const f=frames([...Array.from({length:12},(_,i)=>[86.79+i*.011,86.8+i*.011,4510]),
    [86.933724,86.945943,null],[86.945943,86.956454,null],
    [86.956454,86.966997,6760],[86.966997,86.977564,6760],[86.977564,86.988151,6758],
    ...Array.from({length:15},(_,i)=>[86.992379+i*.011,87.002379+i*.011,null])]);
  for(const livePreview of [false,true]){
    const clean=vocal.cleanPitchFrames(f,{livePreview});
    assert.ok(clean.slice(14,17).every(f=>f.cents===null && f.omitted));
    assert.deepEqual(clean.slice(0,12),f.slice(0,12));
    assert.deepEqual(vocal.cleanPitchFrames(clean,{livePreview}),clean);
  }
});

test('irregular laptop samples still supply context without inventing observations', () => {
  const f = frames([[0,.027,4985],[.027,.042,4985],[.049,.078,4986],
    [.083,.11,3790],[.11,.119,null],[.119,.137,3790],[.137,.158,3792],
    [.158,.177,4993],[.177,.198,4995],[.205,.229,4987]]);
  const clean = vocal.cleanPitchFrames(f);
  assert.ok(clean.slice(3,7).every(x => x.cents === null || x.cents > 4900));
  assert.deepEqual(clean.map(({start,end}) => [start,end]), f.map(({start,end}) => [start,end]));
  assert.equal(clean[4].cents, null);
  assert.deepEqual(vocal.cleanPitchFrames(clean), clean);
});
test('non-octave noise bursts and multi-pitch excursions are omitted, not tuned to a target', () => {
  const f = frames([[0,.035,5007],[.035,.064,5006],[.064,.095,5002],[.095,.124,4997],
    [.13,.165,6895],[.165,.182,6899],[.183,.214,6899],[.214,.232,6900],[.232,.252,6898],
    [.254,.282,4997],[.282,.291,5001],[.291,.309,5002],[.309,.33,5001]]);
  const clean = vocal.cleanPitchFrames(f);
  assert.ok(clean.slice(4,9).every(x => x.cents === null && x.omitted));
  assert.deepEqual(clean.slice(0,4), f.slice(0,4));
  const multi = frames([[0,.01,4969],[.01,.02,4968],[.02,.03,4966],
    [.03,.04,5664],[.04,.05,6877],[.05,.06,4961],[.06,.07,4959],[.07,.08,4957]]);
  assert.ok(vocal.cleanPitchFrames(multi).slice(3,5).every(x => x.cents === null));
});
test('short onset octave uncertainty is omitted; sustained register changes and wrong notes remain', () => {
  const f = frames([[0,.01,5495],[.01,.02,4302],[.02,.03,5503],[.03,.04,5493],[.04,.05,5475],[.05,.06,5463]]);
  assert.equal(vocal.cleanPitchFrames(f)[1].cents, null);
  for (const pitch of [5200,6200]) {
    const held = Array.from({length:60},(_,i)=>({start:i*.01,end:(i+1)*.01,cents:i>=10&&i<40?pitch:5000,live:true}));
    assert.deepEqual(vocal.cleanPitchFrames(held), held);
  }
});
test('unobserved fixed-grid gaps and long live gaps never supply continuity', () => {
  const f = frames([[0,.03,5000],[.04,.07,5000],[.08,.11,5000],[.2,.22,6200],[.3,.33,5000],[.34,.37,5000],[.38,.41,5000]]);
  assert.deepEqual(vocal.cleanPitchFrames(f),f);
  const irregular = frames([[0,.03,5000],[.04,.07,5000],[.08,.11,5000],[.12,.14,6200],[.15,.18,5000],[.19,.22,5000],[.23,.26,5000]])
    .map(({live,...f})=>f);
  assert.deepEqual(vocal.cleanPitchFrames(irregular),irregular);
});
test('a single release-edge alias before silence is omitted without filling the silence', () => {
  const f = Array.from({length:30},(_,i)=>({start:i*.01,end:(i+1)*.01,cents:i<10?5180:i===10?3987:null}));
  const clean = vocal.cleanPitchFrames(f);
  assert.equal(clean[10].cents,null);
  assert.ok(clean.slice(11).every(x=>x.cents===null));
  assert.deepEqual(clean.slice(0,10),f.slice(0,10));
});
test('repeated weak octave aliases cannot establish a new live note', () => {
  const app = fs.readFileSync(require.resolve('../template/app.js'),'utf8');
  const c = vm.createContext({PITCH_CONFIDENCE_THRESHOLD:.85,pitchLastAcceptedCents:5300,
    pitchPendingEvidence:null,pitchCaptureMisses:0,
    pitchFrequencyIsValid:f=>f>=55&&f<=1200,centsForFrequency:f=>6900+1200*Math.log2(f/440)});
  for(const name of ['resetPitchEvidence','acceptPitchEvidence','evaluatePitchEvidence']) {
    const start=app.indexOf('  function '+name+'(');
    vm.runInContext(app.slice(start,app.indexOf('\n  }',start)+4),c);
  }
  const hz = cents => 440*2**((cents-6900)/1200);
  for(let i=0;i<30;i++)assert.equal(c.evaluatePitchEvidence(hz(4100),.78,i*.02,{}).accepted,false);
  assert.equal(c.evaluatePitchEvidence(hz(5310),.58,.61,{}).accepted,true,'retain quiet stable bass');
  assert.equal(c.evaluatePitchEvidence(hz(5500),.95,.63,{}).accepted,false);
  assert.equal(c.evaluatePitchEvidence(hz(5502),.95,.65,{}).accepted,true,'accept real new pitches without score snapping');
});

test('isolated alias dots across observed dropout windows do not enlarge the display range', () => {
  const make=values=>values.map((cents,i)=>({start:i*.01,end:(i+1)*.01,cents}));
  const f=make([...Array(20).fill(5300),...Array(13).fill(null),...Array(5).fill(3400),
    ...Array(5).fill(null),...Array(20).fill(5310)]);
  const clean=vocal.cleanPitchFrames(f);
  assert.ok(clean.slice(33,38).every(f=>f.cents===null&&f.rawCents===3400));
  assert.deepEqual(clean.slice(0,20),f.slice(0,20));
  assert.deepEqual(vocal.cleanPitchFrames(clean),clean);
  const fragmented=make([...Array(20).fill(5300),null,4100,null,4102,null,4101,4103,4102,
    ...Array(37).fill(null),...Array(20).fill(5310)]);
  assert.ok(vocal.cleanPitchFrames(fragmented).slice(21,29).every(f=>f.cents===null));
  const real=make([...Array(20).fill(5300),...Array(13).fill(null),...Array(30).fill(4100),
    ...Array(5).fill(null),...Array(20).fill(5310)]);
  assert.deepEqual(vocal.cleanPitchFrames(real),real,'retain sustained register changes');
  const isolated=make([...Array(10).fill(null),...Array(6).fill(6272),...Array(10).fill(null)]);
  const rejected=vocal.cleanPitchFrames(isolated);
  assert.ok(rejected.every(f=>f.cents===null),'six isolated samples are not reliable voiced evidence');
  assert.deepEqual(vocal.cleanPitchFrames(rejected),rejected);
});
