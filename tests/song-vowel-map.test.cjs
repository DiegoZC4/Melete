const test = require('node:test');
const assert = require('node:assert/strict');
const {color,evidence,exampleReading,guidesFor} = require('../vowel-lab/song_map.js');

test('a mixed recording can supply one glide phase without supplying a trajectory', () => {
  const early={phase:'early',center:[450,1330]}, late={phase:'late',center:[455,1340]};
  assert.equal(evidence('a>ɪ',{examples:[]}), 'none');
  assert.equal(evidence('a>ɪ',{examples:[{patches:[early]},{patches:[late]}]}), 'partial');
  assert.equal(evidence('a>ɪ',{examples:[{patches:[early,late]}]}), 'measured');
  assert.match(exampleReading({patches:[early,late],motion:false}), /Early 450 \/ 1330 Hz · Late 455 \/ 1340 Hz · No clear movement/);
});

test('speech guides preserve missing coordinates and share colors across songs', () => {
  const landmark={symbol:'ɪ',men:{f1:400,f2:2000},women:{f1:470,f2:2300}};
  assert.deepEqual(guidesFor('a>ɪ(>ɹ)',[landmark]),[{index:1,s:'ɪ',points:[[400,2000],[470,2300]]}]);
  assert.deepEqual(guidesFor('ɚ',[landmark]),[]);
  assert.notEqual(color('ɪ'),color('i'));
  assert.equal(evidence('i',{examples:[{patches:[{phase:'steady'}]}]}),'measured');
});
