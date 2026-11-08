const test = require('node:test');
const assert = require('node:assert/strict');
const {recordCompEdit, historySources, trimCompHistories, COMP_HISTORY_LIMIT, COMP_HISTORY_BYTES} = require('../template/loop_recorder.js');
const state = id => ({key: 'part', descriptor: {label: 'Bass'}, segments: id ? [{takeId: id, from: 0, to: 4}] : [], track: true});
test('track edit history records content, not metrics or processing metadata', () => {
  const history = {past: [], future: [], revision: 0};
  const first = recordCompEdit(history, state(), state('a'));
  assert.equal(first.past.length, 1);
  assert.deepEqual(historySources(first), ['a']);
  assert.equal(recordCompEdit(first, state('a'), {...state('a'), processed: ['a'], updatedAt: 1}), first);
  assert.deepEqual(history, {past: [], future: [], revision: 0}, 'no input mutation');
});
test('history byte budget is shared across songs and counts each extra source once', () => {
  const source = (id, song) => ({id, song, frames:100, finalized:true, complete:true});
  const history = (from,to,at) => ({past:[{key:to, at, before:state(from), after:state(to)}],future:[],revision:0});
  const histories=[{song:'autumn',history:history('old-a','a',1)}, {song:'seed',history:history('old-b','b',2)}];
  const comps=[state('a'),state('b')], takes=[source('old-a','autumn'),source('a','autumn'),source('old-b','seed'),source('b','seed')];
  const result=trimCompHistories(histories,comps,takes,250);
  assert.equal(result.beforeBytes,400);assert.equal(result.extraBytes,200);
  assert.equal(result.histories[0].history.past.length,0);assert.equal(result.histories[1].history.past.length,1);
  assert.deepEqual(result.removed,[{id:'old-a',song:'autumn'}]);
  assert.equal(histories[0].history.past.length,1,'budgeting never mutates callers');
  const shared=trimCompHistories([...histories,{song:'copy',history:histories[1].history}],comps,takes,400);
  assert.equal(shared.extraBytes,400,'shared references do not double-count stored PCM');
  assert.equal(COMP_HISTORY_BYTES,128*1024*1024);
});
test('budget never evicts current tracks, recovery, favorites or daily-time data', () => {
  const sources=['current','old','recovery','favorite'].map(id=>({id,song:'seed',frames:1e6,finalized:true,complete:true}));
  sources[2].finalized=false;sources[3].favorite=true;
  const hist={past:[{key:'x',at:1,before:{segments:sources.map(t=>({takeId:t.id,from:0,to:1}))},after:state('current')}],future:[],revision:0};
  const result=trimCompHistories([{song:'seed',history:hist}],[state('current')],sources,0);
  assert.equal(result.extraBytes,0);
  assert.deepEqual(result.removed,[{id:'old',song:'seed'}]);
});
test('trimming Redo drops the far end, never the next redo step', () => {
  const edits=['a','b','c'].map((id,i)=>({key:'x',at:i,before:state(i?['a','b'][i-1]:null),after:state(id)}));
  const history={past:[],future:[edits[2],edits[1],edits[0]],revision:0};
  const takes=['a','b','c'].map(id=>({id,song:'s',frames:100,finalized:true,complete:true}));
  const result=trimCompHistories([{song:'s',history}],[],takes,200);
  assert.deepEqual(result.histories[0].history.future,[edits[0]]);
  assert.deepEqual(result.removed.map(t=>t.id),['b','c']);
});
test('new edits clear redo and history retains only a bounded window of sources', () => {
  let history = {past: [], future: [], revision: 0};
  for (let i = 1; i <= COMP_HISTORY_LIMIT + 5; i++) history = recordCompEdit(history, state(String(i-1)), state(String(i)));
  assert.equal(history.past.length, COMP_HISTORY_LIMIT);
  assert.equal(historySources(history).includes('0'), false);
  const edit = history.past.pop(); history.future.push(edit);
  assert.equal(historySources(history).includes(edit.after.segments[0].takeId), true, 'redo audio is protected');
  const branched = recordCompEdit(history, state('24'), state('new'));
  assert.equal(branched.future.length, 0);
  assert.equal(historySources(branched).includes('25'), false);
});
test('a trimmed recording counts only the audio still stored', () => {
  const {takeBytes} = require('../template/loop_recorder.js');
  assert.equal(takeBytes([{frames: 100}, {frames: 100, storedFrames: 25}]), 250);
  assert.equal(takeBytes([{frames: 100, storedFrames: 0}]), 0);
});
