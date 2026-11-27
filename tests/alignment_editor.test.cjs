const test=require('node:test'),assert=require('node:assert/strict');
globalThis.MeleteBeatEditor=require('../tools/alignment_editor/beat-editor.js');
require('../tools/alignment_editor/model.js');
const {model,time}=globalThis.TimingEditorModel;
const store=()=>{const items=new Map();return {getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v)};};
const fixture=(song='one',revision='initial')=>{const base=[[0,.5],[30,3.5],[70,7.5],[100,10.5]];
  return {song,revision,baseId:'grid',sourceSeconds:12,base,anchors:base,
    notes:[0,10,20,30,50,60,70].map(t=>[0,t,t+5,60,80])};};

test('showing candidates does not pin them; dragging one preserves other reviewed anchor times',()=>{
  const d=fixture(),m=model(d,store());assert.equal(m.starts.length,7);assert.equal(m.dirty,false);
  m.commit(m.moved(20,2.9));assert.deepEqual(m.anchors,[[0,.5],[20,2.9],...d.base.slice(1)]);
  m.commit(m.moved(30,4.1));assert.equal(time(m.anchors,20),2.9);assert.equal(time(m.anchors,70),7.5);
  assert.ok(time(m.moved(30,0),30)>2.9);assert.ok(time(m.moved(30,11),30)<7.5);
  m.reset(20);assert.ok(!m.anchors.some(([t])=>t===20));m.history(false);assert.equal(time(m.anchors,20),2.9);
  m.history(true);assert.ok(!m.anchors.some(([t])=>t===20));
});
test('drafts reopen only for the correct song, source grid and project revision',()=>{
  const s=store(),m=model(fixture(),s);m.commit(m.moved(10,1.25));
  assert.ok(model(fixture(),s).dirty);assert.ok(!model(fixture('two'),s).dirty);
  const changed=model(fixture('one','revised'),s);assert.ok(!changed.dirty);assert.match(changed.warn,/changed/);
  assert.ok(!model({...fixture(),baseId:'other audio'},s).dirty);
});
