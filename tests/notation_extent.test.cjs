const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
const start = source.indexOf('  function syncNotationOverflow(');
const body = source.slice(start, source.indexOf('\n  }', start) + 4);

function fixture(flow, boxes) {
  const layers = [{style:{width:'6000px'}}, {style:{width:'6000px'}}];
  const properties = {}, classes = {};
  const score = {clientWidth:384,
    style:{setProperty:(key,value)=>{properties[key]=value;}},
    classList:{toggle:(key,value)=>{classes[key]=value;}},
    querySelectorAll:()=>layers};
  const bars = boxes.map(box=>box&&({realBounds:box,staffSystemBounds:{realBounds:{x:0,w:200}}}));
  const context = {flow,elements:{score},api:{score:{masterBars:bars},
    boundsLookup:{findMasterBarByIndex:index=>bars[index]}}};
  const sync = vm.runInNewContext(body+'\nsyncNotationOverflow',context);
  return {sync,layers,properties,classes,bars};
}

test('horizontal scroll width follows scaled engraving at smaller and larger zoom',()=>{
  for(const scale of [.7,1,1.5]) {
    const f=fixture('continuous',[{x:35,w:2000*scale},{x:35+2000*scale,w:1000*scale}]);
    f.sync();
    const width=Math.ceil(35+3000*scale+12)+'px';
    assert.deepEqual(f.layers.map(l=>l.style.width),[width,width]);
    assert.equal(f.properties['--notation-content-width'],width);
    assert.equal(f.classes['has-horizontal-overflow'],false);
    assert.equal(f.bars[0].staffSystemBounds.realBounds.w,200,'do not rewrite horizontal system geometry');
  }
});

test('vertical notation keeps native surfaces and expands only overflowing systems',()=>{
  const f=fixture('wrap',[{x:30,w:500}]);f.sync();
  assert.deepEqual(f.layers.map(l=>l.style.width),['6000px','6000px']);
  assert.equal(f.properties['--notation-content-width'],'542px');
  assert.equal(f.classes['has-horizontal-overflow'],true);
  assert.equal(f.bars[0].staffSystemBounds.realBounds.w,530);
});

test('missing engraving bounds do not collapse the native horizontal surfaces',()=>{
  const f=fixture('continuous',[null]);f.sync();
  assert.deepEqual(f.layers.map(l=>l.style.width),['6000px','6000px']);
});
