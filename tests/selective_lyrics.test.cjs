const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../template/selective_lyrics.js');

test('lyric masking groups hyphenated words, not repeated words or other parts/verses', () => {
  const rows = [[0,0,0,'to-'],[0,480,0,'gether'],[0,960,0,'to-'],[0,1440,0,'gether'],
    [1,0,0,'to-'],[1,480,0,'gether'],[0,0,1,'hello']];
  const source = JSON.stringify(rows);
  const index = tools.index(rows, [{id:'S'},{id:'A'}]);
  const first = index.events.get('0:0:0');
  assert.equal(first.text, 'together');
  assert.equal(first, index.events.get('0:480:0'));
  assert.notEqual(first, index.events.get('0:960:0'));
  assert.notEqual(first, index.events.get('1:0:0'));
  assert.notEqual(first, index.events.get('0:0:1'));
  assert.equal(JSON.stringify(rows), source, 'display masks leave source lyrics intact');
});

test('hidden word keys survive rebuilds and unrelated additions, pruning changed/deleted words', () => {
  const a = tools.index([[0,960,0,'home']], [{id:'S'}]);
  const b = tools.index([[0,0,0,'new'],[0,960,0,'home']], [{id:'S'}]);
  const key = a.words[0].key;
  assert.deepEqual([...tools.restore([key, 'stale', key, null], b.keys)], [key]);
  assert.equal(tools.restore([key], tools.index([[0,960,0,'away']], [{id:'S'}]).keys).size, 0);
  assert.equal(tools.restore({}, b.keys).size, 0);
});

test('a shared lyric toggles its member words together without clearing unrelated masks', () => {
  const original = new Set(['S', 'unrelated']);
  const hidden = tools.toggle(original, ['S','A']);
  assert.deepEqual([...hidden], ['S', 'unrelated', 'A']);
  assert.deepEqual([...tools.toggle(hidden, ['S','A'])], ['unrelated']);
  assert.deepEqual([...original], ['S', 'unrelated']);
});

test('lyric hit padding extends down, never toward low noteheads', () => {
  assert.deepEqual(tools.hitBox({x:10,y:90,width:15,height:11}), {x:8,y:90,width:19,height:22});
  assert.deepEqual(tools.hitBox({x:10,y:90,width:15,height:30}), {x:8,y:90,width:19,height:30});
  assert.equal(tools.contains(tools.hitBox({x:10,y:90,width:15,height:11}),17,87), false);
  assert.equal(tools.contains(tools.hitBox({x:10,y:90,width:15,height:11}),17,105), true);
});

test('direct note priority uses the note rectangle, not a whole lyric column', () => {
  const note={x:20,y:30,width:10,height:9};
  assert.equal(tools.contains(note,25,34),true);
  assert.equal(tools.contains(note,25,40),false);
  assert.equal(tools.contains(note,31,34),false);
});
