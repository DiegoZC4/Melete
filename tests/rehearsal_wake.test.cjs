const test = require('node:test');
const assert = require('node:assert/strict');
const {rehearsalWakeLock} = require('../template/microphone_check.js');

test('a rehearsal holds one wake lock and releases it when stopped, even during acquisition', async () => {
  let calls=0, resolve, releases=0;
  const set=rehearsalWakeLock({request(type){
    assert.equal(type,'screen'); calls++; return new Promise(ok=>{resolve=ok;});
  }});
  const lock=()=>({release:async()=>{releases++;}, addEventListener(){}});
  const flush=()=>new Promise(ok=>setImmediate(ok));
  set(false); set(true); set(true);
  assert.equal(calls,1);
  set(false); resolve(lock()); await flush(); assert.equal(releases,1);
  set(true); resolve(lock()); await flush(); set(true); assert.equal(calls,2);
  set(false); assert.equal(releases,2);
  assert.doesNotThrow(()=>rehearsalWakeLock(null)(true));
});

test('a stale wake request cannot replace the lock from a restarted rehearsal', async () => {
  const requests = [], released = [];
  const set = rehearsalWakeLock({request: () => new Promise(resolve => requests.push(resolve))});
  const lock = id => ({release:async () => released.push(id), addEventListener(){}});
  set(true); set(false); set(true);
  requests[1](lock('current'));
  requests[0](lock('stale'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(released, ['stale']);
  set(false);
  assert.deepEqual(released, ['stale', 'current']);
});
