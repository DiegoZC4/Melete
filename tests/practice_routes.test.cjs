const assert = require('node:assert/strict');
const {test} = require('node:test');
const {playbackNotes, extendPreferences} = require('../template/practice_routes.js');
const roles = [{part: 1, soloist: 2, handoffs: [{start: 4, end: 8}]}];
const n = (track, start, end, key=60) => ({track, start, end, key, velocity: 80});

test('shared S2 passages sound once, separate voices sound during handoff', () => {
  const notes = [n(0,0,10,67), n(1,0,4), n(2,0,4), n(1,4,8,67), n(2,4,8,69), n(1,8,10), n(2,8,10)];
  const before = JSON.stringify(notes);
  const choir = playbackNotes(notes, roles, 1, t=>t);
  const solo = playbackNotes(notes, roles, 2, t=>t);
  assert.equal(choir.length, 5);
  assert.equal(solo.length, 5);
  assert.deepEqual(choir.filter(x=>x.start===4).map(x=>[x.track,x.key]), [[1,67],[2,69]]);
  assert.deepEqual(solo.filter(x=>x.start===4).map(x=>[x.track,x.key]), [[1,67],[2,69]]);
  assert.equal(choir.find(x=>x.start===8).track, 1);
  assert.equal(solo.find(x=>x.start===8).track, 2);
  assert.equal(JSON.stringify(notes), before);
});

test('time conversion, crossing held notes and slurs preserve their segments', () => {
  const phrase = {...n(1,0,6), segments:[n(1,0,3),n(1,3,6,64)]};
  const own = {...phrase, track:2, segments:phrase.segments.map(s=>({...s,track:2}))};
  const output = playbackNotes([phrase,own], roles, 2, t=>t/2);
  const flat = output.flatMap(x=>x.segments || [x]);
  assert.deepEqual(flat.map(x=>[x.track,x.start,x.end,x.key]),
    [[2,0,2,60],[1,2,3,60],[1,3,4,64],[2,2,3,60],[2,3,4,64],[2,4,6,64]]);
});

test('adding roles preserves the old mixer and appends only new defaults', () => {
  const old = {visible:[false,true],audible:[true,false],volumes:[200,75],pans:[-10,45],practicePart:1};
  assert.deepEqual(extendPreferences(old,roles,3), {...old,visible:[false,true,false],
    audible:[true,false,true],volumes:[200,75,100],pans:[-10,45,0]});
  assert.deepEqual(old.volumes,[200,75]);
  assert.equal(extendPreferences(old,[],2),old);
});

test('no handoffs changes neither notes nor normal part selection', () => {
  const notes=[n(0,0,1)]; assert.equal(playbackNotes(notes,[],null,t=>t),notes);
});

test('role traces and take references stay separate without invalidating other singers', () => {
  const vm=require('node:vm');
  const app=require('node:fs').readFileSync(require('node:path').join(__dirname,'../template/app.js'),'utf8');
  const calls=[];
  const c=vm.createContext({sequence:{practiceRoles:roles},practicePartIndex:0,ready:true,singEnabled:false,preparingCapture:null,stationReview:null,changingReviewFocus:false,
    pitchTraceBaseKey:'trace',pitchTraceKey:'trace',config:{},practiceDivisi:[],pitchTraceLanes:new Map(),pitchTraceDirty:new Map(),pitchCaptureWorker:null,takeState:'off',
    buildMetadata:{build:{sourcePlaybackSha256:'source',playbackSha256:'expanded',
      practiceReferenceFingerprints:{1:'chorus',2:'solo'}}},
    savePitchTraceNow(){calls.push(['save',c.practicePartIndex,c.pitchTraceKey]);},
    loadPitchTrace(){calls.push(['load',c.practicePartIndex,c.pitchTraceKey]);}});
  for(const name of ['pitchTraceFingerprint','roleTraceKey','assignPracticePart']) {
    const start=app.indexOf(`  function ${name}(`);
    assert.ok(start>=0);
    vm.runInContext(app.slice(start,app.indexOf('\n  }',start)+4),c);
  }
  assert.equal(c.pitchTraceFingerprint(0),'source');
  assert.equal(c.pitchTraceFingerprint(1),'chorus');
  assert.equal(c.pitchTraceFingerprint(2),'solo');
  for(const part of [1,2,2,0]) c.assignPracticePart(part);
  assert.deepEqual(calls,[['save',0,'trace'],['save',1,'trace:part:1:line:all'],['save',2,'trace:part:2:line:all']]);
  assert.equal(c.pitchTraceLanes.size,0,'changing part clears the live overlay, not saved takes');
});
