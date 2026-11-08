const test = require('node:test');
const assert = require('node:assert/strict');
const station = require('../template/station.js');
const pitch = require('../template/take_pitch.js');
const model = require('../template/practice_comp.js');

const singers = station.merge([{name: 'DemoA', voice: 'Alto'}, {name: 'DemoB (AliasB)', voice: 'Bass'},
  {name: 'Sample One'}, {name: 'Sample Two'}, {name: 'DemoZ', voice: 'Alto'}]);

test('the picker searches names and voice parts', () => {
  assert.deepEqual(station.search(singers, 'alto').map(s => s.name), ['DemoA', 'DemoZ']);
  assert.deepEqual(station.search(singers, 'ALIASB').map(s => s.name), ['DemoB (AliasB)']);
  assert.deepEqual(station.search(singers, 'alto demoa').map(s => s.name), ['DemoA']);
  assert.deepEqual(station.search(singers, 'sample').map(s => s.name), ['Sample One', 'Sample Two']);
  assert.equal(station.search(singers, '').length, singers.length);
});

test('a saved singer does not erase the roster voice part', () => {
  const merged = station.merge([{name: 'DemoN', voice: ''}], [{name: 'demon', voice: 'Alto'}, {name: '!!!'}]);
  assert.deepEqual(merged, [{id: 'demon', name: 'demon', voice: 'Alto'}]);
});

test('song assignments override generic roles only in that song; abbreviations and names search the same list', () => {
  const roster = {singers:[{name:'Demo',voice:'Alto'}, {name:'Unassigned'}],
    assignments:{one:{S2:['Demo'], A1:['Visitor'], A2:['Another']}}};
  const one = station.songRoster(roster,'one'), two = station.songRoster(roster,'two');
  assert.deepEqual(station.search(one,'soprano 2').map(s=>s.name),['Demo']);
  assert.deepEqual(station.search(one,'A2').map(s=>s.name),['Another']);
  assert.deepEqual(station.search(one,'').map(s=>s.name),['Demo','Visitor','Another','Unassigned']);
  assert.deepEqual(station.search(two,'alto').map(s=>s.name),['Demo']);
  assert.equal(two.find(s=>s.name==='Visitor').voice,'');
  for (const [long,short] of [['Soprano','S'],['Alto 2','A2'],['tenor1','T1'],['B2','B2']]) assert.equal(station.partCode(long),short);
});

test('fitted columns budget for measured names; explicit selections survive a narrow window', () => {
  const {visibleFields} = require('../template/take_controls.js');
  const keys=['singer','part','mean','created'], widths={singer:80,part:25,mean:45,created:80};
  assert.deepEqual(visibleFields(keys,widths,151,'fit'),['singer','part','mean']);
  assert.deepEqual(visibleFields(keys,widths,250,'fit'),keys);
  assert.deepEqual(visibleFields(keys,widths,15,['singer','created']),['singer','created']);
});
test('station guide isolates the assigned recording channel, handles folded sections and never guesses between divisions',()=>{
  const channels=['S','A1','A2','T1','T2','B1','B2'].map(short=>({short}));
  const at=(voice,guide,last)=>station.guideChannel({voice,guide},channels,last);
  assert.equal(at('S','S2'),0); assert.equal(at('A','A2'),2); assert.equal(at('A'),-1);
  assert.equal(at('A',null,1),1); assert.equal(at('',null,-1),-1); assert.equal(at('Bass 2'),6);
  assert.equal(station.guideChannel({voice:'S2'},['S1','S2 Solo','S2'].map(short=>({short}))),2);
  const mix=station.guideMix(channels,2);
  assert.deepEqual(mix.visibleChannels,[false,false,true,false,false,false,false]);
  assert.ok(mix.audible.every(Boolean));
  assert.deepEqual(mix.volumes,[35,35,150,35,35,35,35]); assert.deepEqual(mix.pans,[-35,-35,50,-35,-35,-35,-35]);
  const first={...station.guideMix(channels,2,100),guideVersion:1};
  assert.ok(station.untouchedFirstPreset(first,channels,2));
  first.volumes[2]=115; assert.ok(!station.untouchedFirstPreset(first,channels,2),'manual gain is not overwritten');
});

test('a four-part song can inherit families without duplicating names or overriding a song-specific correction', () => {
  const roster = {singers:[{name:'Sample',voice:'Tenor'}], sectionFrom:{four:'eight'},
    assignments:{eight:{S1:['First'],S2:['Second'],A2:['Sample'],B1:['Named']}, four:{T:['Named']}}};
  const four = station.songRoster(roster,'four');
  assert.deepEqual(station.search(four,'S').map(s=>s.name),['First','Second']);
  assert.deepEqual(station.search(four,'Alto').map(s=>s.name),['Sample']);
  assert.equal(four.find(s=>s.name==='Named').voice,'T');
  assert.equal(station.songRoster(roster,'eight').find(s=>s.name==='Named').voice,'B1');
  assert.equal(station.songRoster(roster,'other').find(s=>s.name==='Sample').voice,'Tenor');
});

test('only the parameter or the collection switch asks for the station', () => {
  assert.equal(station.requested('?station'), true);
  assert.equal(station.requested('?song=the-seed&mode=station'), true);
  assert.equal(station.requested('?mode=practice&station'), false, 'an explicit mode wins over an old flag');
  assert.equal(station.requested('?song=station'), false);
  assert.equal(station.requested('?part=alto&station=1'), true);
  assert.equal(station.requested('?part=alto'), false);
  assert.equal(station.requested(''), false);
});

const reference = {fingerprint: 'f', part: 1, line: null, rate: 1, notes: [[0, 4, [60]], [4, 8, [62]]], seconds: 8};
const base = {song: 'the-seed', label: 'Alto', reference};
const alice = {id: 'alice', name: 'Alice', voice: 'Alto'};

test('each singer stage is its own track that takes only its own recordings', () => {
  const stages = station.STAGES.map(([stage]) => station.descriptor(base, alice, stage));
  assert.equal(new Set(stages.map(model.key)).size, 3);
  assert.notEqual(model.key(stages[0]), model.key(base));
  assert.notEqual(model.key(stages[0]), model.key(station.descriptor(base, {...alice, id: 'bob'}, 'start')));
  assert.deepEqual(stages[1].station, {...alice, stage: 'scratchpad'});
  const take = {trackSlot: stages[0].slot, complete: true};
  assert.equal(model.matches({...take, trackSlot: null}, stages[0]), false);
  assert.equal(model.matches(take, stages[1]), false);
});

test('recording destinations are fixed for the first pass and repeats', () => {
  const loop = {mode: 'loop', initial: {start: 12}};
  assert.equal(station.recordingPlan(loop, null), loop);
  const first = {...alice, stage: 'start'};
  const plan = station.recordingPlan(loop, first);
  assert.equal(plan.initial.start, 12);
  assert.deepEqual(plan.initial.station, first);
  assert.equal(plan.initial.trackSlot, station.descriptor(base, alice, 'start').slot);
  assert.equal(plan.trackSlot, station.descriptor(base, alice, 'scratchpad').slot);
  assert.equal(plan.station.stage, 'scratchpad');
  for (const stage of ['scratchpad', 'final']) {
    const same = station.recordingPlan(loop, {...alice, stage});
    assert.equal(same.trackSlot, station.descriptor(base, alice, stage).slot);
    assert.equal(same.initial, loop.initial);
  }
  assert.equal(station.recordingPlan({mode: 'segment'}, first).station.stage, 'start');
  assert.deepEqual(loop, {mode: 'loop', initial: {start: 12}});
});

test('the Singer sort groups a singer and keeps their stages in order', () => {
  const row = (name, stage) => ({singer: station.sortName({name, stage}, reference), number: 1});
  const rows = [row('Bob', 'start'), row('Alice', 'final'), {number: 2, singer: null}, row('Alice', 'start'), row('Alice', 'scratchpad')];
  const order = {column: 'singer', direction: 'ascending'};
  assert.deepEqual(rows.sort((a, b) => pitch.compareTakes(a, b, order)).map(r => r.singer?.split(' ').at(-1) ?? null),
    ['0', '1', '2', '0', null]);
  assert.equal(rows[3].singer.startsWith('Bob'), true);
  assert.equal(pitch.takeSort({column: 'singer'}).direction, 'ascending');
});

test('the summary keeps table values and adds the passage-relative tracking', () => {
  const state = {descriptor: station.descriptor(base, alice, 'final'), processed: ['a', 'b']};
  const score = {expectedSeconds: 8, trackedSeconds: 3, coverage: 3 / 8, meanAbsCents: 12.34567, medianAbsCents: 10,
    within50CentsSeconds: 3, completion: .5, totalExpectedSeconds: 8, segmentCount: 2};
  const row = station.summary({song: 'the-seed', state, part: 'Alto', bars: '1-2; 3-4', score,
    dates: {createdAt: Date.UTC(2026, 10, 8), updatedAt: null}});
  assert.equal(row.stage, 'Final');
  assert.equal(row.voice_part, 'Alto');
  assert.equal(row.recordings, 2);
  assert.equal(row.tracked_percent, '37.500');
  assert.equal(row.tracked_of_passage_percent, '75.000');
  assert.equal(row.mean_cents, '12.346');
  assert.equal(row.within_50_cents_percent, '100.000');
  assert.equal(row.speed_percent, '100');
  assert.equal(row.created, '2026-11-08T00:00:00.000Z');
  assert.equal(row.modified, '');
  assert.deepEqual(Object.keys(row).sort(), [...station.COLUMNS].sort());
});

test('an unscored track still exports with blank metrics', () => {
  const state = {descriptor: base, processed: []};
  const row = station.summary({song: 's', state, part: 'Alto', bars: '', score: null, dates: {}});
  assert.equal(row.singer, '');
  assert.equal(row.stage, '');
  assert.equal(row.mean_cents, '');
  assert.equal(row.tracked_of_passage_percent, '');
});

test('CSV quoting survives commas, quotes and line breaks', () => {
  const lines = station.csv([{singer: 'Mark, "H"', bars: '1-2\n3'}]).split('\r\n');
  assert.equal(lines[0], station.COLUMNS.join(','));
  assert.equal(lines[1].startsWith('"Mark, ""H""",'), true);
  assert.equal(lines[1].includes('"1-2\n3"'), true);
  assert.equal(lines.at(-1), '');
});

test('spreadsheet formula prefixes become text, without changing the source or numeric metrics', () => {
  for (const name of ['=1+1', '+42', '-42', '  @name', '\t=1+1', '＝1+1']) {
    const row = {singer:name, mean_cents:12.5};
    const data = station.csv([row]).split('\r\n')[1].split(',');
    assert.equal(data[0], "'" + name);
    assert.equal(data[station.COLUMNS.indexOf('mean_cents')], '12.5');
    assert.equal(row.singer, name);
  }
  assert.ok(station.csv([{singer:'Example Name'}]).includes('\r\nExample Name,'));
});
test('personal comp attribution follows its audible sources without changing station routing',()=>{
  const station=require('../template/station.js');
  const diego={id:'diego',name:'Diego'},src=new Map([['a',{performer:diego}],['b',{performer:diego}]]);
  const state={descriptor:{},segments:[{takeId:'a'},{takeId:'b'}]};
  assert.deepEqual(station.trackSinger(state,src),diego);
  src.get('b').performer={id:'b',name:'B'};
  assert.equal(station.trackSinger(state,src),null);
  src.delete('b');assert.equal(station.trackSinger(state,src),null);
  state.descriptor.station={id:'lead',name:'Lead'};assert.equal(station.trackSinger(state,src).id,'lead');
});
