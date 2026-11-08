const assert = require('node:assert/strict');

async function checkCompHistory(frame) {
  const result = await frame.evaluate(async () => {
    const R = MeleteRecording, name = `melete-history-qa-${crypto.randomUUID()}`;
    const store = new R.TakeStore(indexedDB, name), other = new R.TakeStore(indexedDB, name);
    const song = 'history-song', summaries = {};
    const make = (key, id) => ({key, song, descriptor: {label: key}, revision: 0, processed: [id], adopted: [id],
      segments: [{takeId: id, from: 0, to: 1}], track: true});
    const source = async id => store.append({id, song, sampleRate: 100, createdAt: Date.now()}, 0, new Int16Array(100), {complete: true, finalized: true});
    const step = async direction => store.stepCompHistory(song, direction, (await store.compHistory(song)).revision);
    try {
      for (const id of ['a', 'b', 'c', 'd']) await source(id);
      let first = await store.saveComp(make('Bass', 'a'));
      await store.saveComp(make('Alto', 'b'));
      first = await store.saveComp({...first, segments: make('Bass', 'c').segments, processed: ['a','c'], adopted: ['a','c']});
      summaries.steps = (await store.compHistory(song)).past.length;
      summaries.protected = await store.deleteTakes(song, ['a', 'b', 'c']);
      await step('undo');
      summaries.undo = (await store.comps(song)).find(s => s.key === 'Bass');
      await step('undo');
      summaries.acrossParts = (await store.comps(song)).find(s => s.key === 'Alto').segments;
      (await store.open()).close(); store.opening = null;
      summaries.reopened = (await other.compHistory(song)).future.length;
      await step('redo'); await step('redo');
      summaries.redo = (await store.comps(song)).find(s => s.key === 'Bass').segments[0].takeId;
      await step('undo');
      const staleHistory = await store.compHistory(song);
      first = (await store.comps(song)).find(s => s.key === 'Bass');
      first = await other.saveComp({...first, segments: make('Bass', 'd').segments});
      summaries.branch = (await store.compHistory(song)).future.length;
      try { await store.stepCompHistory(song, 'undo', staleHistory.revision); }
      catch (e) { summaries.stale = e.message; }
      summaries.releasedRedo = await store.deleteTakes(song, ['c']);
      for (let i = 0; i < R.COMP_HISTORY_LIMIT + 1; i++) {
        const id = `later-${i}`; await source(id);
        first = await store.saveComp({...first, segments: make('Bass', id).segments});
      }
      summaries.limit = (await store.compHistory(song)).past.length;
      summaries.expired = await store.deleteTakes(song, ['a','d']);
      // Legacy one-step undo survives upgrade without becoming a normal row.
      const legacySong = 'legacy';
      await store.transaction(['comps'], 'readwrite', tx => tx.objectStore('comps').put({
        ...make('Legacy', 'b'), song: legacySong, undo: [], revision: 1}));
      const legacy = await store.compHistory(legacySong);
      summaries.legacy = {count: legacy.past.length, undo: (await store.comps(legacySong))[0].undo};
      // A cloud restore is one reversible local edit, not an upload of history.
      await store.importComp({...first, segments: make('Bass', 'cloud').segments},
        [{record: {id:'cloud', frames:100, sampleRate:100}, pcm:new Int16Array(100)}], first.revision);
      summaries.cloud = (await step('undo')).state.segments[0].takeId;
      const oldHistory = await store.compHistory(song), current = (await store.comps(song)).find(s => s.key === 'Bass');
      await other.saveComp({...current, track:false}, current.revision, {history:false});
      try { await store.stepCompHistory(song, 'undo', oldHistory.revision); }
      catch (error) { summaries.external = error.message; }
      // A small injected budget exercises actual PCM deletion without creating
      // hundreds of megabytes of scratch audio. Current tracks remain pinned.
      const secondary = 'other-song';
      for (const id of ['extra-old','extra-new']) await store.append({id,song:secondary,sampleRate:100,createdAt:Date.now()},0,new Int16Array(100),{complete:true,finalized:true});
      let second=await store.saveComp({...make('Other','extra-old'),song:secondary});
      second=await store.saveComp({...second,segments:make('Other','extra-new').segments,adopted:['extra-old','extra-new']});
      const trackedBefore=await store.recordingTime();
      const cap=await store.pruneCompHistory(0);
      summaries.budget={bytes:cap.extraBytes,trimmed:cap.trimmed,removed:cap.removed,
        current:await store.wav('extra-new').then(b=>b.size),
        oldGone:await store.wav('extra-old').then(()=>false,()=>true),
        timePreserved:trackedBefore===await store.recordingTime()};
      summaries.budget.chunks=await store.transaction(['chunks'],'readonly',(tx,done)=>{
        tx.objectStore('chunks').index('takeId').count('extra-old').onsuccess=e=>done(e.target.result);
      });
      // Trimming on real IndexedDB: ten 100-frame chunks, only some still played.
      const cut='trim-song', keep=ranges=>()=>new Map([['long',ranges]]);
      const samples=async id=>new Int16Array((await (await store.wav(id)).arrayBuffer()).slice(44));
      const offsets=()=>store.transaction(['chunks'],'readonly',(tx,done)=>{
        tx.objectStore('chunks').index('takeId').getAllKeys('long').onsuccess=e=>done(e.target.result.map(k=>k[1]));
      });
      const stored=async()=>(await store.list(cut)).find(t=>t.id==='long').storedFrames;
      for(let at=0;at<1000;at+=100){
        await store.append({id:'long',song:cut,sampleRate:100,createdAt:Date.now()},at,
          Int16Array.from({length:100},(_,i)=>at+i+1),{complete:at===900,finalized:at===900});
      }
      await store.saveComp({...make('Cut','long'),song:cut,segments:[{takeId:'long',from:2.5,to:3.5}]});
      const whole=await samples('long');
      const seen={};
      summaries.trim={};
      summaries.trim.nothing=[await store.trimAudio(cut,()=>new Map()),await store.trimAudio(cut,keep([]))];
      summaries.trim.failed=await store.trimAudio(cut,()=>{throw new Error('plan failed');}).catch(e=>e.message);
      summaries.trim.untouched=[(await offsets()).length,await stored()];
      summaries.trim.first=await store.trimAudio(cut,(records,comps,edits)=>{
        Object.assign(seen,{records:records.length,comps:comps.length,edits:edits.length});return keep([[250,350]])();});
      summaries.trim.seen=seen;
      const after=await samples('long');
      summaries.trim.offsets=await offsets();
      summaries.trim.length=[after.length,whole.length];
      summaries.trim.kept=after.slice(200,400).every((v,i)=>v===whole[200+i]);
      summaries.trim.silent=[...after.slice(0,200),...after.slice(400)].every(v=>v===0);
      summaries.trim.bytes=R.takeBytes(await store.list(cut));
      summaries.trim.repeat=await store.trimAudio(cut,keep([[250,350]]));
      // A later pass cannot see the end of a chunk before a gap, so it keeps it.
      summaries.trim.narrower=await store.trimAudio(cut,keep([[250,260]]));
      summaries.trim.narrowerOffsets=await offsets();
      summaries.trim.intact=(await samples('long')).slice(200,300).every((v,i)=>v===whole[200+i]);
      await store.transaction(['chunks'],'readwrite',tx=>tx.objectStore('chunks').delete(['long',200]));
      summaries.trim.damaged=await store.wav('long').then(()=>null,e=>e.message);
      const record=(await store.list(cut)).find(t=>t.id==='long');
      await store.transaction(['takes','chunks'],'readwrite',tx=>{
        tx.objectStore('chunks').put({takeId:'plain',offset:50,pcm:new Int16Array(50)});
        tx.objectStore('takes').put({id:'plain',song:cut,sampleRate:100,frames:100});
      });
      summaries.trim.gapInWhole=await store.wav('plain').then(()=>null,e=>e.message);
      const restored=(await store.comps(cut))[0];
      await store.importComp({...restored,segments:[{takeId:'cloud-cut',from:0,to:1}]},
        [{record:{...record,id:'cloud-cut',frames:100},pcm:new Int16Array(100)}],restored.revision);
      summaries.trim.imported=[(await store.list(cut)).find(t=>t.id==='cloud-cut').storedFrames,(await samples('cloud-cut')).length];
      return summaries;
    } finally {
      (await store.open()).close(); (await other.open()).close();
      await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
    }
  });
  assert.equal(result.steps, 3);
  assert.deepEqual(result.protected, []);
  assert.equal(result.undo.segments[0].takeId, 'a');
  assert.deepEqual(result.undo.processed, ['a','c'], 'undo never reoffers the rejected recording');
  assert.deepEqual(result.acrossParts, []);
  assert.equal(result.reopened, 2);
  assert.equal(result.redo, 'c');
  assert.equal(result.branch, 0);
  assert.match(result.stale, /another tab/);
  assert.deepEqual(result.releasedRedo, ['c']);
  assert.equal(result.limit, 20);
  assert.deepEqual(result.expired, ['a','d']);
  assert.deepEqual(result.legacy, {count:1, undo:null});
  assert.equal(result.cloud, 'later-20');
  assert.match(result.external, /outside its edit history/);
  assert.equal(result.budget.bytes,0);assert.ok(result.budget.trimmed>0);
  assert.ok(result.budget.removed.some(t=>t.song==='other-song'&&t.id==='extra-old'));
  assert.equal(result.budget.oldGone,true);assert.equal(result.budget.chunks,0);
  assert.equal(result.budget.current,244);assert.equal(result.budget.timePreserved,true);
  const trim=result.trim;
  assert.deepEqual(trim.nothing,[[],[]],'no plan and an empty plan delete nothing');
  assert.equal(trim.failed,'plan failed');
  assert.deepEqual(trim.untouched,[10,undefined]);
  assert.deepEqual(trim.first,[{id:'long',storedFrames:200}]);
  assert.deepEqual(trim.seen,{records:1,comps:1,edits:1});
  assert.deepEqual(trim.offsets,[200,300],'only whole chunks outside the plan go');
  assert.deepEqual(trim.length,[1000,1000],'every position stays where it was');
  assert.equal(trim.kept,true);assert.equal(trim.silent,true);
  assert.equal(trim.bytes,400);
  assert.deepEqual(trim.repeat,[],'a second pass has nothing left to do');
  assert.deepEqual(trim.narrower,[{id:'long',storedFrames:100}]);
  assert.deepEqual(trim.narrowerOffsets,[200]);assert.equal(trim.intact,true);
  assert.match(trim.damaged,/incomplete/,'a chunk lost after trimming is still reported');
  assert.match(trim.gapInWhole,/incomplete/,'a gap in an untrimmed recording is still damage');
  assert.deepEqual(trim.imported,[undefined,100],'a cloud copy arrives whole');
  return {multiLevel:true,crossPart:true,durable:true,protectedSources:true,boundedRetention:true,redoBranch:true,cloudUndo:true,crossSongByteCap:true,physicalAudioCleanup:true,audioTrim:true};
}
module.exports = {checkCompHistory};
