const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}
const plain = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

test('divisi pitch-trace lanes still map across changing voice counts', () => {
  const c = vm.createContext({clamp});
  vm.runInContext(source('divisiLineFor'),c);
  assert.equal(c.divisiLineFor(0,2,2),0);
  assert.equal(c.divisiLineFor(1,2,2),1);
  assert.equal(c.divisiLineFor(1,3,2),1);
  assert.equal(c.divisiLineFor(1,2,1),0);
});

test('retired per-mixer divisi choices and drag icons are neither applied nor saved', () => {
  assert.doesNotMatch(app,/divisiSelections|setDivisi|filterDivisiNotes|addDragAffordance/);
  for (const name of ['applyPreferenceState','applySettingsState','currentPreferenceState','captureSettingsState']) {
    assert.doesNotMatch(source(name),/\bdivisi\b/);
  }
});

test('follow geometry uses the sounding measure even while the DOM cursor is still on the previous system', () => {
  const boxes = [{x:10,y:100,w:200,h:300},{x:10,y:600,w:200,h:300}];
  const c = vm.createContext({clamp, pendingNotationReload:null,scoreView:'standard',flow:'wrap',sequence:{endTick:800},visibleTracks:new Set([0]),
    engine:{currentSeconds:()=>500,tickAtSeconds:t=>t},measureIndexAtTick:t=>t<400?0:1,
    notationFollowBox:i=>boxes[i],
    elements:{score:{classList:{contains:()=>false},getBoundingClientRect:()=>({left:20,top:-50}),scrollLeft:0,scrollTop:0}}});
  vm.runInContext(source('playbackCursorBounds'),c);
  assert.deepEqual(plain(c.playbackCursorBounds()),{left:30,top:550,right:230,bottom:850,width:200,height:300});
  c.flow='continuous';
  c.notationBeatLine=()=>({left:712,width:1});
  assert.deepEqual(plain(c.playbackCursorBounds()),{left:712,top:550,right:713,bottom:850,width:1,height:300});
  c.notationBeatLine=()=>null;
  assert.equal(c.playbackCursorBounds(),null,'wait for a visible beat instead of following the old bar');
  c.visibleTracks.clear();
  assert.equal(c.playbackCursorBounds(),null,'an empty See selection does not follow stale notation');
});

test('paused position changes cannot start a follow-scroll', () => {
  const c=vm.createContext({conductor:null,engine:{playing:false},pendingNotationReload:null,scoreScrub:null});
  vm.runInContext(source('gentleFollowCursor'),c);
  assert.doesNotThrow(()=>c.gentleFollowCursor(),'must exit before touching the page or stale cursor');
});

test('arrow navigation follows note onsets, includes slur notes, skips rests and does not wrap', () => {
  const sounded=[], seeks=[];
  let position=0, released=0;
  const c=vm.createContext({ready:true,api:{},takeState:'off',keyboardAudition:null,keyboardStepAnchor:null,
    visibleChannels:new Set([1]),mixerParts:[{source:0},{source:1}],
    visiblePitchNotes:()=>[[0,240,960,70],[1,0,2880,60],[1,2880,3840,62],[1,4800,5760,64],[1,5760,6720,65]],
    currentScorePartIndex:()=>1,playbackCursorPlace:()=>'',followCursorFrom(){},cancelPitchAuditions(){},
    window:{clearTimeout(){}}, performance:{now:()=>100},
    engine:{currentSeconds:()=>position,tickAtSeconds:t=>t*960,pauseTransport(){},
      holdNote:key=>{sounded.push(key); return {release(){released++;}};}},
    applyScoreScrubTarget:target=>{position=target.tick/960;seeks.push(position);},
  });
  vm.runInContext(source('stepScoreNote'),c);
  c.stepScoreNote(1); c.stepScoreNote(1); c.stepScoreNote(1); c.stepScoreNote(1);
  assert.deepEqual(seeks,[0,3,5,6]); assert.deepEqual(sounded,[60,62,64,65]);
  c.stepScoreNote(1);assert.equal(position,6);
  c.stepScoreNote(-1); assert.equal(position,5); c.keyboardAudition();
  assert.equal(released,1);
  c.takeState='recording';c.stepScoreNote(-1);assert.equal(position,5);
  assert.equal(c.keyboardAudition,null);
});
