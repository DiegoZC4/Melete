const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
const start = source.indexOf('  function createLeftEdgeCursorHandler(');
const create = vm.runInNewContext(source.slice(start, source.indexOf('\n  }', start) + 4) + '\ncreateLeftEdgeCursorHandler');

function fixture(scale = 1) {
  const alpha = {model: {MusicFontSymbol: {RestQuarter: 1, RestWhole: 2}},
    midi: {MidiTickLookupFindBeatResultCursorMode: {ToNextBext: 0}}};
  const player = {settings: {display: {scale, resources: {engravingSettings: {glyphWidths: new Map([[1, 8], [2, 12]])}}}}};
  const system = {realBounds: {x: 0, w: 300}, bars: []};
  const master = {index: 0, staffSystemBounds: system, visualBounds: {x: 0, y: 40, w: 300, h: 160}, bars: []};
  const bar = {masterBarBounds: master, beats: []};
  master.bars.push(bar); system.bars.push(master);
  const add = (center, tick, left, rest = false, full = false) => {
    const b = {barBounds: bar, onNotesX: center, realBounds: {x: 80, w: 140},
      beat: {isRest: rest, isFullBarRest: full, duration: 4, absoluteDisplayStart: tick},
      notes: left === null ? [] : [{noteHeadBounds: {x: left}}]};
    bar.beats.push(b); return b;
  };
  const first = add(100, 0, 94), second = add(200, 480, 192);
  const handler = create(alpha, player), calls = [];
  const cursor = {setBounds: (...args) => calls.push(['bounds', ...args]), transitionToX: (...args) => calls.push(['move', ...args])};
  return {handler, cursor, calls, first, second, add, bar, master};
}

test('cursor touches notehead left edges and interpolates without moving score anchors', () => {
  const f = fixture();
  f.handler.placeBeatCursor(f.cursor, f.first, 100);
  assert.deepEqual(f.calls.at(-1), ['bounds', 94, 40, 1, 160]);
  f.handler.placeBeatCursor(f.cursor, f.first, 150);
  assert.equal(f.calls.at(-1)[1], 143);
  f.handler.placeBeatCursor(f.cursor, f.second, 200);
  assert.equal(f.calls.at(-1)[1], 192);
  assert.equal(f.first.onNotesX, 100);
});

test('rests use scaled glyph edges; full-bar rests use their centered content span', () => {
  for (const scale of [0.7, 1, 1.5]) {
    const f = fixture(scale); f.bar.beats.length = 0;
    const rest = f.add(100, 0, null, true);
    const full = f.add(200, 480, null, true, true);
    f.handler.placeBeatCursor(f.cursor, rest, 100);
    assert.ok(Math.abs(f.calls.at(-1)[1] - (100 - 4 * scale)) < 1e-8);
    f.handler.placeBeatCursor(f.cursor, full, 200);
    assert.ok(Math.abs(f.calls.at(-1)[1] - (150 - 6 * scale)) < 1e-8);
  }
});

test('a simultaneous full-bar rest cannot displace a sounding onset in another part', () => {
  const f = fixture(); f.add(100, 0, null, true, true);
  f.handler.placeBeatCursor(f.cursor, f.first, 100);
  assert.equal(f.calls.at(-1)[1], 94);
});

test('animation retains native continuous transition and bar highlight dimensions', () => {
  const f = fixture();
  f.handler.transitionBeatCursor(f.cursor, f.first, 100, 200, 500, 0);
  assert.deepEqual(f.calls.at(-1), ['move', 1000, 290]);
  f.handler.transitionBeatCursor(f.cursor, f.first, 150, 200, 250, 1);
  assert.deepEqual(f.calls.at(-1), ['move', 250, 192]);
  f.handler.placeBarCursor(f.cursor, f.first);
  assert.deepEqual(f.calls.at(-1), ['bounds', 0, 40, 300, 160]);
});

test('audio-clock cursor places the exact current tick and rejects delayed native animations',()=>{
  const f=fixture();
  // The real API lookup resolves the same geometry used for normal paused seeks.
  const player={settings:{display:{scale:1,resources:{engravingSettings:{glyphWidths:new Map()}}}},
    tracks:[{index:0}],tickCache:{findBeat:()=>({beat:'first',nextBeat:{beat:'second'},start:0,tickDuration:480,cursorMode:0})},
    boundsLookup:{findBeat:beat=>beat==='first'?f.first:f.second}};
  const alpha={model:{MusicFontSymbol:{}},midi:{MidiTickLookupFindBeatResultCursorMode:{ToNextBext:0}}};
  const handler=create(alpha,player),barCalls=[];
  handler.onAttach({beatCursor:f.cursor,barCursor:{setBounds:(...args)=>barCalls.push(args)}});
  handler.sync(240);
  assert.deepEqual(f.calls.at(-1),['bounds',143,40,1,160]);
  assert.deepEqual(barCalls.at(-1),[0,40,300,160]);
  const count=f.calls.length;
  handler.placeBeatCursor(f.cursor,f.first,100);
  handler.transitionBeatCursor(f.cursor,f.first,100,200,500,0);
  assert.equal(f.calls.length,count,'stale nested AlphaTab callbacks cannot move the live cursor');
  handler.sync(360);assert.equal(f.calls.at(-1)[1],167.5);
  handler.release();handler.placeBeatCursor(f.cursor,f.first,100);
  assert.equal(f.calls.at(-1)[1],94,'paused editing keeps native seeks');
  handler.onDetach(); // Bundled 1.8.4 invokes this when installing the new handler.
  handler.placeBarCursor({setBounds:(...args)=>barCalls.push(args)},f.first);
  handler.placeBeatCursor(f.cursor,f.first,100);
  handler.sync(240);
  assert.equal(f.calls.at(-1)[1],143,'placement callbacks recover the actual cursor objects');
});

test('a grace note sharing the written onset keeps its own performed cursor anchor',()=>{
  const f=fixture();
  f.first.beat.absoluteDisplayStart=480;
  f.first.beat.absolutePlaybackStart=420;
  f.second.beat.absolutePlaybackStart=480;
  f.handler.placeBeatCursor(f.cursor,f.first,100);
  assert.equal(f.calls.at(-1)[1],94);
  f.handler.placeBeatCursor(f.cursor,f.second,200);
  assert.equal(f.calls.at(-1)[1],192,'the main note must not inherit the grace-note center');
});
