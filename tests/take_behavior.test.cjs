const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const pitch=require('../template/take_pitch.js'),model=require('../template/practice_comp.js');
const app=fs.readFileSync(require.resolve('../template/app.js'),'utf8');
const ref=()=>({version:1,fingerprint:'score',part:0,line:null,rate:1,start:0,end:40,seconds:40,
  latency:0,notes:[[14,16,[60]],[20,30,[62]]]});

test('a later pass starting inside the initial rest leaves one sung segment, preserving source captures',()=>{
  const make=(id,stage,from,to,date)=>{
    const descriptor={song:'seed',slot:'station:singer-a:'+stage,station:{id:'singer-a',name:'Singer A',stage},reference:ref()};
    const take={id,createdAt:date,origin:0,analysisFrames:[{start:14,end:16,cents:6000},{start:20,end:30,cents:6200}]};
    return {state:{...model.empty(descriptor),firstTakeNumber:date,segments:[{takeId:id,from,to}]},sources:new Map([[id,take]])};
  };
  const old=make('old','start',0,37.647,27),newer=make('new','scratchpad',12.32,39,32);
  const before=JSON.stringify([old.state,newer.state,...old.sources,...newer.sources]);
  const result=model.singerTracks(new Map([old,newer].map(t=>[t.state.key,t])),t=>t.state.descriptor.station);
  const view=[...result.views.values()][0];
  assert.deepEqual(view.state.segments,[{takeId:'new',from:12.32,to:39}]);
  assert.equal(view.score.segmentCount,1);assert.equal(view.state.firstTakeNumber,27);
  assert.equal(view.score.meanAbsCents,0);assert.equal(view.score.completion,1);
  assert.equal(view.members.length,2);assert.equal(view.sources.size,2);
  assert.equal(JSON.stringify([old.state,newer.state,...old.sources,...newer.sources]),before);
});

test('rest-only remnants never count as sung segments, including legacy comps without rest metadata',()=>{
  const segments=[{takeId:'a',from:0,to:12.32},{takeId:'b',from:12.32,to:40}];
  assert.equal(model.segmentCount(segments,ref().notes),1);
  assert.deepEqual(model.bindMargins(segments,{reference:ref()},new Map()),[segments[1]]);
  assert.equal(model.segmentCount([{takeId:'a',from:0,to:14},{takeId:'b',from:30,to:40}],ref().notes),0,
    'touching a note boundary is not overlapping a note');
});

test('average cents uses only detected singing intersected with written notes, clipped at boundaries',()=>{
  const reference={...ref(),notes:[[2,4,[60]],[6,8,[62]],[10,12,[64]]]};
  const frames=[{start:0,end:3,cents:6010},{start:3,end:7,cents:null},
    {start:7,end:9,cents:6170},{start:9,end:10,cents:9999}];
  const result=pitch.scoreFrames(frames,reference,40);
  assert.equal(result.meanAbsCents,20,'one tracked second at 10 cents and one at 30 cents');
  assert.equal(result.trackedSeconds,2);assert.equal(result.expectedSeconds,6);
  assert.equal(result.coverage,1/3,'missed required singing affects coverage only');
  assert.equal(pitch.scoreFrames([{start:2,end:3,cents:6010},{start:7,end:8,cents:6170}],reference,40).meanAbsCents,20);
  assert.equal(pitch.scoreFrames([{start:0,end:2,cents:9999},{start:4,end:6,cents:9999}],reference,40).meanAbsCents,null);
});

test('initial and long written rests are red, while count-in stays preparation',()=>{
  const context=vm.createContext({window:{MeleteTakePitch:pitch},sequence:{notes:[],endTick:40},
    partDivisi:[{spans:[{start:14,end:16,pitches:[60]},{start:30,end:32,pitches:[60]}]}],
    practicePartIndex:0,practiceDivisi:[null],engine:{secondsAtTick:t=>t},
    restTraceSource:null,restTraceReferences:new Map(),pitchTraceOriginTick:()=>-4,
    expectedPitchAt:()=>[[0,14,16,60]],clamp:(v,a,b)=>Math.min(b,Math.max(a,v))});
  for(const name of ['pitchRestState','expectedPitchErrorCents','pitchTraceColor']){
    const start=app.indexOf(`  function ${name}(`);
    vm.runInContext(app.slice(start,app.indexOf('\n  }',start)+4),context);
  }
  for(const t of [0,13.99,16,20,29.99,32,39]){
    assert.equal(context.pitchRestState(t),'rest');
    assert.equal(context.pitchTraceColor(context.expectedPitchErrorCents(t,6000)),'rgb(255 0 0)');
  }
  assert.equal(context.pitchRestState(14),'sing');assert.equal(context.pitchRestState(-1),'preparation');
});
