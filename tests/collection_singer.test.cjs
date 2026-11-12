const test=require('node:test'),assert=require('node:assert/strict');
const {matchingSinger}=require('../template/comp_panel.js');
const candidate=(id,key,date,updatedAt=0,stage)=>({id,singer:{key,name:'Singer',directoryId:'singer',date,stage},updatedAt});
test('song review follows identity, preferring the same rehearsal then newest matching comp',()=>{
  const singer={key:'cloud:person',name:'Singer',date:'2026-11-08'};
  const old=candidate('old','cloud:person','2026-11-08',1);
  const current=candidate('same-rehearsal','cloud:person','2026-11-08',2);
  const newer=candidate('new-date','cloud:person','2026-11-15',9);
  const impostor=candidate('same-name','cloud:someone-else','2026-11-08',100);
  assert.equal(matchingSinger([newer,old,impostor,current],singer),current);
  assert.equal(matchingSinger([newer,impostor],singer),newer);
  assert.equal(matchingSinger([impostor],singer),null);
});
test('local station review retains its stage and leaves absent singers unselected',()=>{
  const initial=candidate('initial','station:person',null,1,'start');
  const latest=candidate('scratch','station:person',null,2,'scratchpad');
  assert.equal(matchingSinger([latest,initial],{key:'station:person',stage:'start'}),initial);
  assert.equal(matchingSinger([latest,initial],{key:'station:absent'}),null);
});
test('directory selection uses a unique account, with private local tracks as fallback',()=>{
  const directory={key:'directory:singer'},a=candidate('a','cloud:first',null,1),b=candidate('b','cloud:second',null,2);
  const local=candidate('local','station:singer',null,3);
  assert.equal(matchingSinger([local,a],directory),a);
  assert.equal(matchingSinger([local],directory),local);
  assert.equal(matchingSinger([a,b],directory),null);
});
