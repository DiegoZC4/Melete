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
function fixture({key=69, scale=1} = {}) {
  const box = (x,y,w,h) => ({x:x*scale,y:y*scale,w:w*scale,h:h*scale});
  const beat = (tick,x,pitch,y) => ({beat:{absolutePlaybackStart:tick},realBounds:box(x,100,20,40),
    notes:pitch===null?[]:[{note:{realValue:pitch},noteHeadBounds:box(x,y-4,10,8)}]});
  const bars = [
    {bar:{staff:{index:0,track:0,standardNotationLineCount:5}},visualBounds:box(30,100,200,40),
      beats:[beat(0,50,key,115),beat(300,190,null,0)]},
    {bar:{staff:{index:0,track:0,standardNotationLineCount:5}},visualBounds:box(30,300,200,40),
      beats:[beat(400,50,null,0)]},
  ];
  const masters=bars.map((b,index)=>({realBounds:box(30,index?300:100,200,40),bars:[b],
    staffSystemBounds:{index,realBounds:box(30,index?280:80,200,120)}}));
  const c=vm.createContext({sequence:{division:100,endTick:800,measures:[[0,400],[400,400]],notes:[[0,0,300,key]]},
    window:{MeleteTakePitch:require('../template/take_pitch.js')},
    visibleTracks:new Set([0]),practicePartIndex:0,practiceDivisi:[null],partDivisi:[{spans:[{start:0,end:300,pitches:[key]}]}],divisiSpanAt:()=>null,
    divisiLineFor:()=>0,
    restTraceSource:null,restTraceReferences:new Map(),engine:{secondsAtTick:t=>t/100},
    pitchNoteSource:null,pitchNoteCount:0,pitchNotesByPart:new Map(),
    partIndexForTrack:t=>t,measureIndexAtTick:t=>t<400?0:1,STAFF_TRACE_CENTS_PER_STEP:Number(app.match(/const STAFF_TRACE_CENTS_PER_STEP = (\d+);/)[1]),
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
  for(const name of ['pitchRestState','performedScoreTick','expectedPitchAt','buildStaffTraceSystems','staffTracePoint'])
    vm.runInContext(source(name),c);
  const rows=c.buildStaffTraceSystems({findMasterBarByIndex:i=>masters[i]});
  return {c,masters,rows,at:(tick,cents=key*100,line=0)=>c.staffTracePoint(rows[tick<400?0:1],tick,cents,line)};
}
test('50 cents maps to one line/space step in either direction at every notation scale',()=>{
  for(const scale of [.5,1,1.6]) {
    const f=fixture({scale});
    const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} should equal ${b}`);
    close(f.at(0).x,50*scale);
    close(f.at(0).y,115*scale);
    close(f.at(0,6925).y,112.5*scale);
    close(f.at(0,6850).y,120*scale);
    close(f.at(0,6950).y,110*scale);
  }
});
test('enharmonic accidentals retain written centers; tenor uses sounding pitch',()=>{
  const natural=fixture(),flat=fixture({key:68}),tenor=fixture({key:57});
  assert.equal(natural.at(0).y,flat.at(0).y);
  assert.equal(tenor.at(0).y,natural.at(0).y);
  assert.equal(flat.at(0,6900).error,100);
  assert.equal(flat.at(0,6900).y,105);
});
test('staff error remains centered for octave equivalents without modifying the raw pitch',()=>{
  const f=fixture();
  assert.equal(f.at(0,5700).y,f.at(0,6900).y);
  assert.equal(f.at(0,8100).error,0);
  assert.equal(f.at(0,5725).y,f.at(0,6925).y);
});
test('recorded contours use their own part without changing the practice part or visibility',()=>{
  const f=fixture();
  f.c.sequence.notes.push([1,0,300,60]);
  f.c.practicePartIndex=1;
  assert.equal(f.at(0),null,'the chosen live-practice part is not on this staff');
  const recorded=f.c.staffTracePoint(f.rows[0],0,6900,0,0);
  assert.equal(recorded.track,0);
  assert.equal(recorded.error,0);
  assert.equal(recorded.y,115);
  assert.equal(f.c.practicePartIndex,1);
  assert.deepEqual([...f.c.visibleTracks],[0]);
  f.c.visibleTracks.clear();
  const hidden=f.c.buildStaffTraceSystems({findMasterBarByIndex:i=>f.masters[i]});
  assert.equal(f.c.staffTracePoint(hidden[0],0,6900,0,0),null,'a hidden staff is never forced visible for a take');
});
test('rest guards retain written height but turn red; deeper rests disappear',()=>{
  const f=fixture();
  assert.equal(f.at(350).y,115);
  assert.equal(f.at(350).error,null,'red timing error, not invented cents');
  assert.equal(f.at(450),null,'more than one beat after release');
  assert.equal(f.c.staffTracePoint(f.rows[0],400,6900,0),null,'never draw diagonally into another system');
  f.c.sequence.notes=[[0,100,300,69]];
  f.c.partDivisi=[{spans:[{start:100,end:300,pitches:[69]}]}];
  assert.equal(f.at(0).error,null,'early entrance is shown red before the first note');
  f.c.visibleTracks.clear();
  const hidden=f.c.buildStaffTraceSystems({findMasterBarByIndex:i=>f.masters[i]});
  assert.equal(f.c.staffTracePoint(hidden[0],120,6900,0),null);
});
test('trace timing follows swung engraving columns from every visible part',()=>{
  const f=fixture();
  f.c.sequence.swing={unit:'16th',ratio:66.6666666667};
  assert.equal(f.c.performedScoreTick(25),33);
  assert.equal(f.c.performedScoreTick(50),50);
  assert.equal(f.c.performedScoreTick(75),83);
  f.c.visibleTracks.add(1);
  f.masters[0].bars.push({bar:{staff:{index:0,track:1,standardNotationLineCount:5}},
    visualBounds:{x:30,y:160,w:200,h:40},beats:[{beat:{absolutePlaybackStart:25},
      notes:[{note:{realValue:60},noteHeadBounds:{x:90,y:175,w:10,h:8}}]}]});
  const rows=f.c.buildStaffTraceSystems({findMasterBarByIndex:i=>f.masters[i]});
  assert.equal(f.c.staffTracePoint(rows[0],33,6900,0).x,90,'accompaniment follows the melody time columns');
  f.c.sequence.swing={unit:'eighth',ratio:66.6666666667};
  assert.equal(f.c.performedScoreTick(50),67);
});
test('ties follow the new system notehead and each divisi lane keeps its own target',()=>{
  const f=fixture();
  f.c.sequence.notes=[[0,0,800,69]];
  f.c.partDivisi=[{spans:[{start:0,end:800,pitches:[69]}]}];
  f.masters[1].bars[0].beats=[{beat:{absolutePlaybackStart:400},notes:[{
    note:{realValue:69,isTieDestination:true},noteHeadBounds:{x:50,y:324,w:10,h:8},
  }]}];
  let rows=f.c.buildStaffTraceSystems({findMasterBarByIndex:i=>f.masters[i]});
  assert.equal(f.c.staffTracePoint(rows[1],400,6900,0).y,328,'use the new engraved tie destination');
  f.masters[0].bars[0].beats[0].notes.push({note:{realValue:65},noteHeadBounds:{x:50,y:131,w:10,h:8}});
  f.c.sequence.notes.push([0,0,300,65]);
  f.c.partDivisi=[{maxLines:2,spans:[{start:0,end:800,pitches:[69,65]}]}];
  f.c.divisiSpanAt=()=>({pitches:[69,65]});
  f.c.divisiLineFor=line=>line;
  rows=f.c.buildStaffTraceSystems({findMasterBarByIndex:i=>f.masters[i]});
  assert.equal(f.c.staffTracePoint(rows[0],0,6500,1).y,135);
  assert.equal(f.c.staffTracePoint(rows[0],0,6900,0).y,115);
  assert.equal(f.c.staffTracePoint(rows[0],0,6500,0).error,-400,'do not grade the other division as correct');
});
