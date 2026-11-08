const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
const source = name => {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const boxes = [{x: 20, y: 100, w: 500, h: 1000}, {x: 20, y: 1200, w: 500, h: 1000}];
  const masters = boxes.map(box => ({bars: Array.from({length: 8}, (_, index) => ({
    bar: {staff: {track: {index}}}, realBounds: {x: 20, y: box.y + index * 120, w: 500, h: 110},
  }))}));
  const c = vm.createContext({window: {innerHeight: 800}, practicePartIndex: 7,
    visibleTracks: new Set(Array.from({length: 8}, (_, i) => i)),
    elements: {transport: {getBoundingClientRect: () => ({height: 180})}},
    masterBarLayoutBox: index => boxes[index], partIndexForTrack: track => track.index,
    api: {boundsLookup: {findMasterBarByIndex: index => masters[index]}},
  });
  vm.runInContext(source('notationFollowBox'), c);
  return {c, boxes, masters};
}

test('oversized notation follows the chosen lower staff, retaining horizontal measure geometry', () => {
  const {c} = fixture();
  assert.deepEqual(plain(c.notationFollowBox(0)), {x:20, y:830, w:500, h:270, focused:true});
  c.practicePartIndex = 5;
  assert.equal(c.notationFollowBox(1).y, 1690);
  c.practicePartIndex = 0;
  assert.equal(c.notationFollowBox(0).y, 100);
});

test('fitting systems, hidden or unset parts, and missing staff bounds retain whole-system following', () => {
  const {c, boxes, masters} = fixture();
  c.window.innerHeight = 1300;
  assert.strictEqual(c.notationFollowBox(0), boxes[0]);
  c.window.innerHeight = 800;
  c.visibleTracks.delete(7);
  assert.strictEqual(c.notationFollowBox(0), boxes[0]);
  c.visibleTracks.add(7); c.practicePartIndex = null;
  assert.strictEqual(c.notationFollowBox(0), boxes[0]);
  c.practicePartIndex = 7; masters[0].bars.pop();
  assert.strictEqual(c.notationFollowBox(0), boxes[0]);
  assert.equal(c.notationFollowBox(99), undefined);
});

test('multiple staves for the same part share a follow region without changing the source bounds', () => {
  const {c, masters} = fixture();
  masters[0].bars.push({bar:{staff:{track:{index:7}}}, visualBounds:{y:1060,h:40}});
  const before = plain(masters);
  assert.equal(c.notationFollowBox(0).h, 270);
  assert.deepEqual(plain(masters), before);
});

test('next-system prediction finds systems by their original geometry and follows the chosen staff', () => {
  const {c, boxes} = fixture();
  Object.assign(c, {engine:{currentSeconds:()=>50,tickAtSeconds:t=>t},flow:'wrap',scoreView:'standard',
    sequence:{endTick:400,measures:[[0,100],[100,100],[200,100],[300,100]]},
    measureIndexAtTick:t=>Math.floor(t/100),clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),
  });
  c.masterBarLayoutBox = i => boxes[Math.floor(i/2)];
  c.api.boundsLookup.findMasterBarByIndex = i => ({bars:[{bar:{staff:{track:{index:7}}},
    realBounds:{y:boxes[Math.floor(i/2)].y+840,h:110}}]});
  c.elements.score = {getBoundingClientRect:()=>({top:-200}),scrollTop:0};
  vm.runInContext(source('nextVerticalSystemTransition'), c);
  assert.deepEqual(plain(c.nextVerticalSystemTransition()), {
    currentTick:50,tick:200,bounds:{top:1730,bottom:2000},
  });
});

test('partially clipped focused staves follow, but unrelated oversized systems do not oscillate', () => {
  const {c} = fixture();
  Object.assign(c,{flow:'wrap',scoreView:'standard'});
  c.elements.score = {classList:{contains:()=>false}};
  vm.runInContext(source('playbackDirection'), c);
  assert.equal(c.playbackDirection({top:730,bottom:840,height:110,focused:true}), 'down');
  assert.equal(c.playbackDirection({top:150,bottom:260,height:110,focused:true}), 'up');
  assert.equal(c.playbackDirection({top:200,bottom:310,height:110,focused:true}), null);
  assert.equal(c.playbackDirection({top:150,bottom:260,height:110}), 'up', 'fitting systems must be fully visible too');
  assert.equal(c.playbackDirection({top:-439.2,bottom:55.2,height:494.4}), 'up', 'a sliver at the edge is not enough after a loop');
  assert.equal(c.playbackDirection({top:100,bottom:1100,height:1000}), null);
});

test('disabled loops retain endpoints without suppressing next-system prediction', () => {
  let enabled=true,animations=0;
  const c=vm.createContext({verticalFollowAnimationFrame:0,flow:'wrap',
    engine:{hasLoop:()=>enabled,secondsAtTick:()=>2,currentSeconds:()=>1.9},
    nextVerticalSystemTransition:()=>({currentTick:190,tick:200,bounds:{top:900,bottom:1100}}),
    loopTickRange:()=>({end:200}),elements:{transport:{getBoundingClientRect:()=>({height:100})}},
    window:{innerHeight:800,scrollY:0},readingLine:()=>150,followScrollDuration:()=>300,
    FOLLOW_SCROLL_LEAD_BUFFER_MS:80,hidePlaybackReturn(){},animateVerticalFollow(){animations++;},
  });
  vm.runInContext(source('predictiveVerticalFollow'),c);
  assert.equal(c.predictiveVerticalFollow({}),false);
  enabled=false;
  assert.equal(c.predictiveVerticalFollow({}),true);
  assert.equal(animations,1);
});

test('manual scroll detachment is evaluated against the selected staff and respected by following', () => {
  const {c} = fixture();
  Object.assign(c,{flow:'wrap',scoreView:'standard',followScrollFrame:0,automaticScrollUntil:0,
    cancelVerticalFollowAnimation(){}, updatePlaybackReturn(){},
    playbackCursorBounds:()=>({top:950,bottom:1060,height:110,focused:true}),
    requestAnimationFrame:fn=>{c.frame=fn;return 1;},
  });
  vm.runInContext(['playbackDirection','cursorOutsideReadingBand','recordManualScoreScroll'].map(source).join('\n'),c);
  c.recordManualScoreScroll();
  assert.equal(c.playbackDetached,true,'detach synchronously, before the next playback frame');
  Object.assign(c,{conductor:null,engine:{playing:true},pendingNotationReload:null,scoreScrub:null,
    performance:{now:()=>1000},lastFollow:0,FOLLOW_CHECK_INTERVAL_MS:100,
  });
  vm.runInContext(source('gentleFollowCursor'),c);
  assert.doesNotThrow(()=>c.gentleFollowCursor());
  c.frame();
});

test('Sing distinguishes audio recording from local pitch-only practice with headphone guidance', () => {
  assert.match(source('activateCachedPitchCapture'), /recordings stay in this browser/);
  assert.match(source('updatePitchCaptureAppearance'), /Saving microphone audio and pitch locally/);
  assert.match(source('updatePitchCaptureAppearance'), /Saving pitch only; no audio is kept/);
  assert.match(source('updatePitchCaptureAppearance'), /Use headphones\./);
  assert.match(source('reviewPracticeTrace'), /inspectedTakeId=explicit/);
  assert.doesNotMatch(app.slice(app.indexOf('  async function scoreNextTake()'), app.indexOf('  function takePitchLabel')), /settingsSectionCollapsed|settingsPanel/);
});

test('horizontal Score follows the moving beat, clamps at the ends, and respects gestures and reduced motion', () => {
  const score = {clientWidth: 500, scrollWidth: 2000, scrollLeft: 0, getBoundingClientRect: () => ({left: 10, right: 510})};
  let beat;
  const c = vm.createContext({elements: {score}, visibleTracks: new Set([0]), window: {innerWidth: 520},
    notationBeatLine: () => ({left: 10 + beat - score.scrollLeft}), notationRenderInFlight: false, pinchActive: false,
    reducedFollowMotion: {matches: false}, HORIZONTAL_READING_FRACTION: .4, horizontalGestureUntil: 0,
    followedScoreLeft: null, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v))});
  vm.runInContext(source('followHorizontalScore'), c);
  const at = x => { beat = x; c.followHorizontalScore(1000); return score.scrollLeft; };
  assert.equal(at(90), 0, 'show the opening margin');
  assert.equal(at(280), 80);
  assert.equal(at(300), 100);
  assert.equal(at(1990), 1500, 'do not scroll past the end');
  assert.equal(at(600), 400, 'a backward loop puts the sounding beat back in view');
  c.horizontalGestureUntil = 1100;
  assert.equal(at(900), 400);
  c.horizontalGestureUntil = 0;
  c.reducedFollowMotion.matches = true;
  assert.equal(at(790), 400, 'leave the page still while there is room ahead');
  assert.equal(at(840), 640, 'turn before the beat leaves the visible page');
  c.visibleTracks.clear();
  assert.equal(at(1300), 640, 'never chase hidden music');
});
