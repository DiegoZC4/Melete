const test=require('node:test');
const assert=require('node:assert/strict');
const cloud=require('../template/comp_cloud.js');
const station=require('../template/station.js');

test('review receipts survive rescoring, reload and withdrawal',()=>{
  const data=new Map();
  global.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  try {
    const state={key:'track',descriptor:{reference:{fingerprint:'song',rate:1}},segments:[{takeId:'voice',from:1,to:2}]};
    const source={id:'voice',frames:1000,sampleRate:8000,updatedAt:2};
    const sources=new Map([[source.id,source]]);
    const stamp=cloud.signature(state,sources);
    const old={signature:stamp,id:'review-123',owner:'singer',uploaded:3};
    data.set('melete:submitted-tracks:v1',JSON.stringify({track:old}));
    source.updatedAt=17;
    source.pitchScore={scoringVersion:5};
    assert.ok(cloud.hasReceipt(state,sources));
    assert.deepEqual(cloud.publicationReceipts().track.sourceIds,['voice']);
    cloud.forgetReceipt(old.id,old.owner);
    assert.ok(cloud.hasReceipt(state,sources));
    assert.ok(cloud.publicationReceipts().track.withdrawn);
    const hash='1'.repeat(64);
    const receipt=cloud.rememberReceipt('another',stamp,{id:'new',uploaded:99},'singer',hash);
    assert.deepEqual(receipt.sourceIds,['voice']);
    assert.equal(cloud.publicationReceipts().another.manifestSha256,hash);
    const fresh={...state,key:'fresh',segments:[{takeId:'fresh-voice',from:0,to:1}]};
    assert.equal(cloud.hasReceipt(fresh,sources),false);
    assert.ok(cloud.hasReceipt({...state,key:'different-key'},new Map([['voice',{...source,publication:old}]])));
    const archived={...source,song:'song',createdAt:4};
    global.MeleteLocalStationRoster={archivedSources:{voice:{...archived,archive:'rehearsal',wavSha256:hash}}};
    assert.equal(station.archiveReceipt(archived).wavSha256,hash);
    assert.equal(station.archiveReceipt({...archived,frames:1}),null);
  } finally {delete global.localStorage;delete global.MeleteLocalStationRoster;}
});
