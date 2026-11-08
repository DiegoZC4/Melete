const {test} = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../template/shared_notation.js');

const lyric = (part, tick, text, verse = 0) => [part, tick, verse, text];

test('compact lyrics hide every repeat in a run, keeping the first', () => {
  for (let count = 1; count <= 8; count++) {
    const lyrics = Array.from({length:count}, (_, i) => lyric(0, i, 'hm'));
    const before = JSON.stringify(lyrics);
    const hidden = tools.repeatedLyrics(lyrics);
    assert.equal(hidden.size, count - 1);
    assert.ok(!hidden.has(lyrics[0]));
    assert.equal(JSON.stringify(lyrics), before);
  }
});

test('repeat runs stay independent across parts, verses, and changed words', () => {
  const long = Array.from({length:4}, (_, i) => lyric(0, i, 'doo'));
  const short = Array.from({length:3}, (_, i) => lyric(0, i + 8, 'doo'));
  const others = [lyric(1, 0, 'doo'), lyric(0, 0, 'doo', 1)];
  const blank = lyric(0, 1, '');
  const lyrics = [...long.slice(0, 2), blank, ...others, ...long.slice(2), lyric(0, 7, 'word'), ...short];
  assert.deepEqual([...tools.repeatedLyrics(lyrics)], [...long.slice(1), ...short.slice(1)]);
  assert.equal(tools.repeatedLyrics([lyric(0, 0, 'do'), lyric(0, 1, 'doo'), lyric(0, 2, 'doom')]).size, 0);
});

const parts = ['S1', 'S2', 'A1', 'A2', 'T1', 'T2', 'B1', 'B2'].map(short => ({short}));
const ownerLabel = owners => tools.ownerSegments(owners, parts).map(segment => segment.text).join('');

test('compact owner labels use contiguous ranges with colored endpoints', () => {
  assert.equal(ownerLabel([0, 1, 2]), 'S1\u2013A1');
  assert.equal(ownerLabel([3, 4, 5, 6, 7]), 'A2\u2013B2');
  assert.equal(ownerLabel([1]), 'S2');
  assert.equal(ownerLabel([]), '');
  assert.deepEqual(tools.ownerSegments([0, 1, 2], parts), [
    {part:0, text:'S1'}, {part:null, text:'\u2013'}, {part:2, text:'A1'},
  ]);
});

test('owner ranges never include absent parts and sort by score order', () => {
  assert.equal(ownerLabel([7, 6, 5, 3, 2, 0, 3]), 'S1, A1\u2013A2, T2\u2013B2');
  const largeChoir = Array.from({length:12}, (_, i) => ({short:`V${i + 1}`}));
  assert.equal(tools.ownerSegments([11, 9, 10], largeChoir).map(segment => segment.text).join(''), 'V10\u2013V12');
});

test('old repetition setting migrates into the one compact preference', () => {
  assert.deepEqual(tools.annotationPreferences({lyrics:'changes'}), {desktop:'shared', mobile:'shared'});
  assert.deepEqual(tools.annotationPreferences({lyrics:'changes', annotationLayouts:{desktop:'part',mobile:'part'}}),
    {desktop:'shared',mobile:'shared'});
  assert.deepEqual(tools.annotationPreferences({lyrics:'full'}), {desktop:'shared',mobile:'shared'});
});

test('legacy full-lyrics state cannot disable compact mode after initialization', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const app = fs.readFileSync(require.resolve('../template/app.js'), 'utf8');
  const code = app.slice(app.indexOf('  function setLyricsMode('), app.indexOf('  function applyMeasureNumberSettings('));
  const context = {lyricsMode:'full'};
  vm.runInNewContext(code + '\nsetLyricsMode("full", {reload:false,persist:false});', context);
  assert.equal(context.lyricsMode, 'changes');
});

test('shared lyrics work without a song-specific melody map', () => {
  const events = [0, 1, 2, 3].map(part => ({part, tick:0, end:1, text:'hello', bar:0, beat:{}}));
  const plan = tools.plan(events, new Set([0, 1, 2, 3]), []);
  assert.equal(plan.rows.backing.length, 1);
  assert.equal(plan.hidden.size, 4);
});

test('independent simultaneous phrases stay on their own staves', () => {
  const events = [0, 1, 2, 3].map(part => ({part, tick:0, end:1, text:part < 2 ? 'hello' : 'goodbye', bar:0, beat:{}}));
  const plan = tools.plan(events, new Set([0, 1, 2, 3]), []);
  assert.equal(plan.rows.backing.length, 0);
  assert.equal(plan.hidden.size, 0);
});

test('a rest ends a run, so the first word after it stays', () => {
  const words = [0, 960, 2880, 3840].map(tick => lyric(6, tick, 'hold'));
  const notes = [[6, 0, 960], [6, 960, 1920], [6, 2880, 3840], [6, 3840, 4800]];
  assert.deepEqual([...tools.repeatedLyrics(words, notes)], [words[1], words[3]]);
  assert.deepEqual([...tools.repeatedLyrics(words, [...notes, [5, 0, 4800]])], [words[1], words[3]],
    'another part singing through the gap does not fill this part\'s rest');
  assert.deepEqual([...tools.repeatedLyrics(words, [[6, 0, 1920], [6, 1000, 4800]])], words.slice(1),
    'overlapping notes leave no rest');
  assert.deepEqual([...tools.repeatedLyrics(words)], words.slice(1), 'without notes no rest is known');
});

test('notes without a word do not count as a rest', () => {
  const words = [lyric(6, 0, 'oo'), lyric(6, 1920, 'oo')];
  assert.deepEqual([...tools.repeatedLyrics(words, [[6, 0, 960], [6, 960, 1920], [6, 1920, 2880]])], [words[1]]);
});

test('unchanged backing syllables bridge a quarter-note breath, not a long absence or a vowel change', () => {
  for (const division of [3, 96, 960]) {
    const notes = [[0,0,1],[0,2,3],[0,4,5],[0,7,8],[0,9,10]].map(([p,a,b])=>[p,a*division,b*division]);
    const words = notes.map(([p,t],i)=>lyric(p,t,i===4?'oo':'mm'));
    assert.deepEqual([...tools.repeatedLyrics(words,notes,division)], [words[1],words[2]]);
    const lexical = notes.map(([p,t])=>lyric(p,t,'hold'));
    assert.equal(tools.repeatedLyrics(lexical,notes,division).size, 0);
  }
});
