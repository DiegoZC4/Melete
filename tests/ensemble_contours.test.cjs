const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const app = fs.readFileSync(require.resolve('../template/app.js'), 'utf8');
const source = name => {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
};
const review = (id, track, line = null) => ({id, track, ref:{line}, octave:0, frames:[{cents:6000}]});
function fixture() {
  const c = vm.createContext({scoreView:'bars', visibleChannels:new Set([0,1,2]),
    mixerParts:[{source:0,line:null},{source:1,line:0},{source:1,line:1},{source:2,line:null}],
    engine:{takeLayers:new Map([['s',review('s',0)],['a1',review('a1',1,0)],['a2',review('a2',1,1)],['b',review('b',2)]])},
    takeVisualReviews:new Map(), takeReview:null, inspectedTakeId:null, takeState:'off', pendingCaptureTrace:null, practicePartIndex:1, takeOctave:()=>1});
  vm.runInContext(source('liveTraceVisible')+'\n'+source('audibleTraceReviews'), c);
  return c;
}
const ids = c => Array.from(c.audibleTraceReviews(), r => r.id);
test('ensemble contours match visible mixer divisions, not merely their shared staff', () => {
  const c = fixture();
  assert.deepEqual(ids(c), ['s','a1','a2']);
  c.visibleChannels.delete(1);
  assert.deepEqual(ids(c), ['s','a2']);
  c.visibleChannels = new Set([1,2]);
  assert.deepEqual(ids(c), ['a1','a2'], 'two divisions on one staff are still ensemble review');
  c.visibleChannels.clear();
  assert.deepEqual(ids(c), []);
});
test('Score shows a matching saved contour by default and switches to the live singer during a pass', () => {
  const c=fixture(); c.scoreView='standard'; c.takeReview=review('a2',1,1);
  assert.deepEqual(ids(c), ['a2']);
  for (const state of ['counting','recording','stopping']) {
    c.takeState=state; assert.equal(c.liveTraceVisible(),true); assert.deepEqual(ids(c), []);
  }
  c.takeState='off'; c.visibleChannels.delete(2);
  assert.deepEqual(ids(c), [], 'only a visible division can draw on its staff');
  c.visibleChannels.add(2); c.takeReview=null;
  assert.deepEqual(ids(c), []);
});
test('muted and hidden takes cannot leak into ensemble review, including the selected take', () => {
  const c = fixture(); c.takeReview = review('a2',1,1);
  c.engine.takeLayers.delete('a2');
  assert.deepEqual(ids(c), ['s','a1']);
  c.visibleChannels = new Set([2]);
  assert.deepEqual(ids(c), ['a2'], 'single-part selected review remains inspectable when muted');
  c.visibleChannels = new Set([0]);
  assert.deepEqual(ids(c), ['s']);
  c.scoreView = 'standard'; c.visibleChannels.add(1);
  assert.deepEqual(ids(c), [], 'standard-score behavior is unchanged');
});
test('ensemble redraw uses immediate cleaned comp frames, current octave and paints selection last', () => {
  const c = fixture();
  c.takeVisualReviews.set('a1', {...review('a1',1,0), frames:[{cents:6500}]});
  c.takeVisualReviews.set('muted', review('muted',0));
  c.engine.takeLayers.get('a1').octave = -1;
  c.takeReview = review('s',0);
  const result = c.audibleTraceReviews();
  assert.deepEqual(Array.from(result, r => r.id), ['a1','a2','s']);
  assert.equal(result[0].frames[0].cents, 6500);
  assert.equal(result[0].octave, -1);
  assert.equal(result.at(-1).octave, 1);
});
test('saved contours grade and filter rests against their recorded division, never the current target', () => {
  const calls = [], r = {...review('a2',1,1), start:0, rate:1, label:'Take 2', octave:1,
    frames:[{start:0,end:.01,cents:6500},{start:.01,end:.02,cents:6500}]};
  const node = (tag, attrs = {}) => ({tag, attrs, children:[], append(...children) {this.children.push(...children);}, addEventListener() {}});
  const system = {startTick:0,endTick:100,traceLayer:node('g'),xAtTick:t=>t,yAtPitch:p=>p};
  const c = vm.createContext({practiceWriter:null,recordingBarRanges:null,window:{MeleteTakeRender:require('../template/take_render.js')},
    engine:{secondsAtTick:t=>t/100,tickAtSeconds:s=>s*100}, pendingCaptureTrace:null,
    visibleChannels:new Set([0,1]), takeReview:r, createSvgElement:node, trackLabel:()=> 'A2',
    pitchRestState:(tick,part,line)=>{calls.push(['rest',part,line]);return 'sing';},
    expectedPitchErrorCents:(tick,cents,line,part)=>{calls.push(['grade',part,line,cents]);return 0;},
    pitchTraceColor:()=> 'green'});
  vm.runInContext(source('renderTakeTrace'), c);
  c.renderTakeTrace(system,r);
  assert.deepEqual(calls,[['rest',1,1],['grade',1,1,6500],['rest',1,1],['grade',1,1,6500]]);
  const group=system.traceLayer.children[0], edge=group.children.find(n=>n.attrs.stroke==='green');
  assert.equal(group.attrs['data-line'],1);
  assert.equal(group.attrs['data-selected'],'true');
  assert.match(edge.attrs.d,/77\.000/, '8va changes display register without changing the grading target');
});

test('switching from the live renderer to saved review keeps the same jittered trace edges',()=>{
  const frames=[0,.06,.12,.18,.24,.30,.60,.66,.72,.78].map((start,i)=>({start,end:start+.02,
    cents:i===3?null:i===8?6700:6000,live:true}));
  const review={id:'comp:qa',track:0,ref:{line:null},start:0,rate:1,frames};
  const node=(tag,attrs={})=>({tag,attrs,children:[],append(...items){this.children.push(...items);}});
  const system=()=>({startTick:0,endTick:100,traceLayer:node('g'),traceEdges:new Map(),traceEdgesByBin:new Map(),
    pointAtPitch:(tick,cents)=>({x:tick,y:cents,track:0,error:0})});
  const live=system(),saved=system();
  const c=vm.createContext({window:{MeleteTakeRender:require('../template/take_render.js')},
    engine:{secondsAtTick:t=>t/100,tickAtSeconds:s=>s*100},
    pitchTraceTickAtBin:i=>(frames[i].start+frames[i].end)/2*100,
    liveTraceVisible:()=>true,pitchRestState:()=>'sing',pitchTraceColor:()=> 'green',
    pendingCaptureTrace:null,visibleChannels:new Set([0]),takeReview:review,trackLabel:()=> 'B2',createSvgElement:node});
  vm.runInContext(source('appendPitchTraceEdge')+'\n'+source('renderTakeTrace'),c);
  const lane={pitches:frames.map(f=>f.cents),breaks:[]};
  for(let i=1;i<frames.length;i++)c.appendPitchTraceEdge(live,null,lane,i-1,i);
  c.renderTakeTrace(saved,review);
  const liveEdges=live.traceLayer.children.map(g=>g.children[0].attrs).map(a=>
    `M${a.x1.toFixed(3)} ${a.y1.toFixed(3)}L${a.x2.toFixed(3)} ${a.y2.toFixed(3)}`).join('');
  const savedEdges=saved.traceLayer.children[0].children.find(n=>n.tag==='path').attrs.d;
  assert.equal(live.traceEdges.size,4);
  assert.equal(savedEdges,liveEdges,'stopping creates neither new breaks nor bridges over silence, a long dropout or pitch jumps');
});
