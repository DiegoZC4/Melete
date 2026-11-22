const test = require('node:test');
const assert = require('node:assert/strict');
const {color,evidence,exampleReading,guidesFor,rehearsalGroups,groupEvidence} = require('../vowel-lab/song_map.js');

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

const inventory = {
  autumn: [
    ['EE','i','i>ø'],['IH','ɪ'],['AY','e>ɪ','e>ø'],['EH','ɛ','ɛ>ø'],['Short A','æ'],
    ['AH','ɑ','a>ɪ','ɑ>ø'],['AW','ɔ'],['OH','o>ʊ'],['OO','u'],['UH','ʌ','ə'],['Ö','ø'],
  ],
  'the-seed': [
    ['EE','i','i>ɹ'],['IH','ɪ','ɪ>ɹ'],['AY','e>ɪ'],['EH','ɛ','ɛ>ɹ'],['Short A','æ'],
    ['AH','ɑ','a>ɪ','a>ʊ','a>ɪ(>ɹ)','ɑ>ɹ'],['AW','ɔ','ɔ>ɹ'],['OH','o>ʊ'],
    ['OO','u','ʊ'],['UH','ʌ','ə'],['ER','ɝ','ɚ'],
  ],
};
for(const [songId,expected] of Object.entries(inventory)) {
  test(songId+': exact transcriptions partition into eleven rehearsal groups without changing the data',()=>{
    const symbols=expected.flatMap(([, ...members])=>members);
    assert.equal(symbols.length,songId==='autumn'?17:22);
    const vowels=Object.fromEntries([...symbols].reverse().map(v=>[v,{examples:[]}]));
    const song={id:songId,vowels}, before=JSON.stringify(song);
    const groups=rehearsalGroups(song);
    assert.deepEqual(groups.map(g=>[g.label,...g.members]),expected);
    assert.equal(new Set(groups.flatMap(g=>g.members)).size,symbols.length);
    assert.ok(groups.every(g=>g.members.every(v=>color(v)===g.ink)));
    assert.equal(JSON.stringify(song),before);
  });
}
test('unknown songs and new sounds retain separate entries',()=>{
  const vowels={'a>ʊ':{examples:[]},'ɑ':{examples:[]},'y':{examples:[]}};
  assert.equal(rehearsalGroups({id:'untitled',vowels}).length,3);
  assert.deepEqual(rehearsalGroups({id:'autumn',vowels}).find(g=>g.id==='y').members,['y']);
});
test('family evidence never promotes a related pronunciation to measured',()=>{
  const song={vowels:{u:{examples:[]},'ʊ':{examples:[]}}},group={members:['u','ʊ']},other={};
  const exact=v=>v==='u'?other:song;
  assert.equal(groupEvidence(group,song,()=>song),'none');
  assert.equal(groupEvidence(group,song,exact),'borrowed');
  song.vowels['ʊ'].examples=[{patches:[{phase:'steady'}]}];
  assert.equal(groupEvidence(group,song,exact),'partial');
  song.vowels.u.examples=[{patches:[{phase:'steady'}]}];
  assert.equal(groupEvidence(group,song,exact),'measured');
});
