const {toggleRecording, startRecording, stopRecording, deleteUnused} = require('./browser-sing.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function checkTakeStore(page) {
  const result = await page.evaluate(async () => {
    const store = new MeleteRecording.TakeStore(indexedDB, `melete-qa-${crypto.randomUUID()}`);
    const record = {id: 'first', song: 'one', createdAt: Date.now(), sampleRate: 8000, favorite: false,
      pitchReference: {version: 1, fingerprint: 'test-reference'}};
    const status = {finalized: false, complete: false};
    let quota, stale;
    try {
      await store.append(record, 0, new Int16Array([1, -2, 3]), status);
      await store.favorite(record.id, true);
      const appended = await store.append(record, 3, new Int16Array([-4, 5]), status);
      const prematureScore = await store.pitchScore(record.id, 5, record.pitchReference, {version: 1, score: 99});
      // Simulate a browser quota abort after both stores have received writes.
      try {
        await store.transaction(['takes', 'chunks'], 'readwrite', (tx, done, fail) => {
          tx.objectStore('takes').put({...appended, frames: 6});
          tx.objectStore('chunks').add({takeId: record.id, offset: 5, pcm: new Int16Array([6])});
          fail(new DOMException('Test quota', 'QuotaExceededError'));
        });
      } catch (error) { quota = error.name; }
      const afterAbort = await store.list('one');
      try { await store.append(record, 0, new Int16Array([99]), status); }
      catch (error) { stale = error.message; }
      const finalized = await store.append(record, 5, new Int16Array(0), {finalized: true, complete: true});
      const wrongFrames = await store.pitchScore(record.id, 6, record.pitchReference, {version: 1, score: 100});
      const wrongReference = await store.pitchScore(record.id, 5, {fingerprint: 'different'}, {version: 1, score: 100});
      const contour = {version: 1, analysisVersion: 1, sampleRate: 8000, audioFrames: 5,
        reference: JSON.stringify(record.pitchReference), pitches: new Float64Array([6901.23456789, NaN])};
      const wrongContour = await store.pitchScore(record.id, 5, record.pitchReference, {version: 1, score: 82},
        {...contour, sampleRate: 48000});
      const graded = await store.pitchScore(record.id, 5, record.pitchReference, {version: 1, score: 82}, contour);
      let cacheQuota;
      try {
        await store.transaction(['takes'], 'readwrite', (tx, done, fail) => {
          tx.objectStore('takes').put({...graded, pitchContour: {...contour, pitches: new Float64Array([1, 2])}});
          fail(new DOMException('Test cache quota', 'QuotaExceededError'));
        });
      } catch (error) { cacheQuota = error.name; }
      const cacheAfterAbort = (await store.list('one'))[0].pitchContour;
      const wav = new DataView(await (await store.wav(record.id)).arrayBuffer());
      const pcm = Array.from({length: 5}, (_, i) => wav.getInt16(44 + 2 * i, true));
      const foreign = await store.append({...record, id: 'other-song', song: 'two'}, 0, new Int16Array([7]), status);
      const protectedIds = await store.deleteUnstarred('one', ['first', 'other-song']);
      const protectedStage = await store.stageDelete('one', 'first', 1000);
      const foreignStage = await store.stageDelete('one', 'other-song', 1000);
      await store.favorite('first', false);
      const staged = await store.stageDelete('one', 'first', 1000);
      const deletedScore = await store.pitchScore(record.id, 5, record.pitchReference, {version: 1, score: 100});
      const earlyPurge = await store.purgeDeleted('one', 10999);
      const stillReadable = (await store.wav('first')).size;
      let pendingStar;
      try { await store.favorite('first', true); } catch (error) { pendingStar = error.message; }
      const restored = await store.undoDeletes('one', 10999);
      const restoredPcm = Array.from(new Int16Array((await (await store.wav('first')).arrayBuffer()).slice(44)));
      await store.stageDelete('one', 'first', 20000);
      const lateUndo = await store.undoDeletes('one', 30000);
      const expired = await store.purgeDeleted('one', 30000);
      const resurrection = await store.pitchScore(record.id, 5, record.pitchReference, {version: 1, score: 100});
      const expiredChunks = await store.transaction(['chunks'], 'readonly', (tx, done) => {
        tx.objectStore('chunks').index('takeId').count('first').onsuccess = event => done(event.target.result);
      });
      const deleted = await store.deleteUnstarred('one', ['first', 'other-song']);
      const chunks = await store.transaction(['chunks'], 'readonly', (tx, done) => {
        tx.objectStore('chunks').index('takeId').getAll('first').onsuccess = event => done(event.target.result.length);
      });
      const next = await store.append({...record, id: 'next'}, 0, new Int16Array([8]), status);
      await store.append({...record, id: 'formerly-starred', favorite: true}, 0, new Int16Array([9]), status);
      const explicitStage = await store.stageDelete('one', 'formerly-starred', 40000, {includeFavorites: true});
      const explicitUndo = await store.undoDeletes('one', 40001);
      await store.stageDelete('one', 'formerly-starred', 50000, {includeFavorites: true});
      const explicitPurge = await store.purgeDeleted('one', 60000);
      const explicitBulk = await store.deleteTakes('one', ['next', 'other-song']);
      return {appended, quota, afterAbort, stale, finalized, pcm, foreign, protectedIds, deleted, chunks,
        foreignStillPresent: (await store.list('two')).length, next,
        explicitStage, explicitUndo, explicitPurge, explicitBulk,
        protectedStage, foreignStage, staged, earlyPurge, stillReadable, pendingStar, restored, restoredPcm, lateUndo, expired, expiredChunks,
        prematureScore, wrongFrames, wrongReference, wrongContour, graded, deletedScore, resurrection,
        cacheQuota, cacheAfterAbort: Array.from(cacheAfterAbort.pitches), restoredContour: Array.from(restored[0].pitchContour.pitches)};
    } finally {
      (await store.open()).close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(store.name);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    }
  });
  assert.equal(result.appended.favorite, true, 'appending cannot overwrite a favorite');
  assert.equal(result.quota, 'QuotaExceededError');
  assert.equal(result.afterAbort[0].frames, 5, 'quota abort rolls metadata back with audio');
  assert.equal(result.afterAbort[0].finalized, false);
  assert.match(result.stale, /another tab/);
  assert.equal(result.finalized.complete, true, 'zero-length finalization saves completion');
  for (const name of ['prematureScore', 'wrongFrames', 'wrongReference', 'wrongContour', 'deletedScore', 'resurrection']) assert.equal(result[name], null, name);
  assert.equal(result.graded.pitchScore.score, 82);
  assert.equal(result.graded.favorite, true, 'pitch scoring cannot overwrite a concurrent favorite');
  assert.equal(result.restored[0].pitchScore.score, 82, 'Undo retains the saved score');
  assert.equal(result.cacheQuota, 'QuotaExceededError');
  assert.deepEqual(result.cacheAfterAbort, [6901.23456789, NaN], 'cache quota abort preserves previous analysis and audio');
  assert.deepEqual(result.restoredContour, result.cacheAfterAbort, 'Undo retains exact cached pitches and gaps');
  assert.deepEqual(result.pcm, [1, -2, 3, -4, 5]);
  assert.deepEqual(result.protectedIds, [], 'favorites and foreign-song takes are protected');
  assert.deepEqual(result.deleted, ['first']);
  assert.equal(result.chunks, 0, 'deleting a take releases all of its audio chunks');
  assert.equal(result.foreignStillPresent, 1);
  assert.equal(result.foreign.number, 1, 'numbering is per song');
  assert.equal(result.next.number, 2, 'deletion never reuses a take number');
  assert.equal(result.protectedStage, null);
  assert.equal(result.foreignStage, null);
  assert.equal(result.staged.deleteAfter, 11000);
  assert.deepEqual(result.earlyPurge, []);
  assert.equal(result.stillReadable, 54, 'audio is retained on disk throughout Undo');
  assert.match(result.pendingStar, /Undo/);
  assert.equal(result.restored.length, 1);
  assert.equal(result.restored[0].deleteAfter, undefined);
  assert.deepEqual(result.restoredPcm, result.pcm);
  assert.deepEqual(result.lateUndo, []);
  assert.deepEqual(result.expired, ['first']);
  assert.equal(result.expiredChunks, 0, 'expiry releases audio chunks, not just the take listing');
  assert.equal(result.explicitStage.deleteAfter, 50000, 'explicit UI deletion can remove a legacy favorite');
  assert.equal(result.explicitUndo[0].favorite, true, 'Undo preserves historical metadata');
  assert.equal(result.explicitUndo[0].deleteFavorite, undefined);
  assert.deepEqual(result.explicitPurge, ['formerly-starred']);
  assert.deepEqual(result.explicitBulk, ['next'], 'new bulk deletion still respects song isolation');
  return {atomicAbort: true, chunkRoundTrip: true, legacyFavoriteCompatibility: true,
    explicitLegacyDeletion: true, songIsolation: true, durableUndo: true};
}

async function openTakes(page) {
  if (await page.locator('#partChooser').isVisible()) await page.locator('#partChooserDismiss').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
  if (await page.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#settingsToggle').click();
}

async function checkLocalTakeFailures(page, origin, settled, {mobile, temporary, output}) {
  await page.goto(origin + '?loop=1-3'); await settled();
  await page.waitForFunction(() => __qa.recording.ready && __qa.engine.hasLoop());
  assert.ok(await page.evaluate(() => (__qa.engine.loopEndSeconds - __qa.engine.loopStartSeconds) / __qa.engine.rate > 3));
  const store = await checkTakeStore(page);
  await page.evaluate(async () => {
    await __qa.takeStore.append({id: crypto.randomUUID(), song: __qa.takeSong, createdAt: Date.now(),
      sampleRate: 8000, part: 'QA', rate: 1, label: '1-3', favorite: true}, 0,
      new Int16Array(8000), {finalized: true, complete: true});
    await __qa.reloadTakes();
  });
  const initial = await page.evaluate(() => __qa.recording.takes);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].favorite, true);
  await openTakes(page);
  await page.evaluate(() => {
    window.realAppend = __qa.takeStore.append.bind(__qa.takeStore);
    __qa.takeStore.append = (record, offset, pcm, status) => {
      if (!offset) return realAppend(record, offset, pcm, status);
      return __qa.takeStore.transaction(['takes', 'chunks'], 'readwrite', (tx, done, fail) => {
        tx.objectStore('takes').put({...record, ...status, frames: offset + pcm.length});
        tx.objectStore('chunks').add({takeId: record.id, offset, pcm});
        fail(new DOMException('Test quota', 'QuotaExceededError'));
      });
    };
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'recording');
  await page.locator('#settingsToggle').click();
  await page.waitForFunction(() => __qa.recording.state === 'off' && __qa.recording.notice.startsWith('Storage full.'));
  assert.equal(await page.locator('#takePanel').isVisible(), true, 'a storage fault exposes the recovery controls');
  const failed = await page.evaluate(() => __qa.recording);
  assert.equal(failed.microphone, false);
  assert.equal(await page.evaluate(() => __qa.engine.playing), false);
  assert.equal(failed.takes.length, 2, 'failure keeps the previous favorite and new partial take');
  const partial = failed.takes.at(-1);
  assert.equal(partial.unsaved, true);
  assert.equal(partial.complete, false);
  assert.ok(partial.savedFrames >= failed.sampleRate, 'already saved prefix retained');
  assert.ok(partial.length > partial.savedFrames, 'failed tail stays in working memory');
  assert.ok(failed.bytes <= failed.capacity * 3 * 2, 'failure cannot grow an unbounded memory queue');
  assert.equal(await page.locator('#retryTakeSave').isVisible(), true);
  const prefix = await page.evaluate(async () => {
    const [record] = (await __qa.takeStore.list(__qa.recording.takes.at(-1).song)).filter(item => !item.favorite);
    return {record, bytes: (await __qa.takeStore.wav(record.id)).size};
  });
  assert.equal(prefix.record.frames, partial.savedFrames);
  assert.equal(prefix.record.finalized, false);
  assert.equal(prefix.bytes, 44 + partial.savedFrames * 2);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: `Download take ${partial.number} as WAV`, exact: true}).click();
  const download = await pending;
  const filename = path.join(temporary, `unsaved-tail-${mobile ? 'mobile' : 'desktop'}.wav`);
  await download.saveAs(filename);
  const unsavedWav = await fs.readFile(filename);
  assert.equal(unsavedWav.length, 44 + partial.length * 2, 'download includes failed tail, not just saved prefix');
  await page.screenshot({path: path.join(output, `storage-full-${mobile ? 'mobile' : 'desktop'}.png`)});
  await page.evaluate(() => { __qa.takeStore.append = realAppend; });
  await page.locator('#retryTakeSave').click();
  await page.waitForFunction(() => __qa.recording.bytes === 0 && __qa.recording.notice === 'All takes saved locally');
  const retried = await page.evaluate(async id => Array.from(new Uint8Array(await (await __qa.takeStore.wav(id)).arrayBuffer())), partial.id);
  assert.deepEqual(Buffer.from(retried), unsavedWav, 'retry stores exactly the downloadable unsaved audio');

  // Recover a checkpoint from an interrupted page, not an orderly Stop.
  const interrupted = await page.evaluate(async () => {
    const sample = __qa.recording.takes.at(-1);
    return __qa.takeStore.append({...sample, id: crypto.randomUUID(), createdAt: Date.now(), favorite: false},
      0, new Int16Array([1, 2, -3, 4]), {finalized: false, complete: false});
  });
  await page.reload(); await settled();
  await page.waitForFunction(() => __qa.recording.ready);
  const recovered = await page.evaluate(() => __qa.recording);
  const checkpoint = recovered.takes.find(item => item.id === interrupted.id);
  assert.equal(checkpoint.length, 4);
  assert.equal(checkpoint.complete, false);
  assert.equal(recovered.state, 'off');
  assert.equal(recovered.bytes, 0);
  assert.equal(recovered.takes.find(item => item.id === initial[0].id).favorite, true);
  await openTakes(page);
  const checkpointRow = page.locator(`[data-take-id="${interrupted.id}"]`);
  assert.match(await checkpointRow.locator('.take-warning').getAttribute('title'), /incomplete/);
  assert.equal(await checkpointRow.locator('.take-download').isDisabled(), false);

  // Preflight catches a known full quota before ever asking for a microphone.
  await page.evaluate(() => {
    window.realEstimate = navigator.storage.estimate.bind(navigator.storage);
    window.originalGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.quotaGumCalls = 0;
    navigator.storage.estimate = async () => ({quota: 1000, usage: 999});
    navigator.mediaDevices.getUserMedia = (...args) => { quotaGumCalls++; return originalGum(...args); };
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off' && __qa.recording.notice.startsWith('Storage full.'));
  assert.equal(await page.evaluate(() => quotaGumCalls), 0);
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, recovered.takes.length);
  await page.evaluate(() => {
    navigator.storage.estimate = realEstimate;
    window.realUsage = __qa.takeStore.usage.bind(__qa.takeStore);
    __qa.takeStore.usage = async () => { throw new DOMException('Test unavailable', 'InvalidStateError'); };
  });
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off');
  assert.match((await page.evaluate(() => __qa.recording)).notice, /Local storage unavailable/);
  assert.equal(await page.evaluate(() => quotaGumCalls), 0, 'unavailable storage never silently records in RAM only');
  assert.equal((await page.evaluate(() => __qa.recording)).takes.length, recovered.takes.length);
  await page.evaluate(() => {
    __qa.takeStore.usage = realUsage;
    navigator.mediaDevices.getUserMedia = originalGum;
  });
  await page.locator('#settingsToggle').click();

  // A larger library of older takes pages metadata, not audio, and still works without messaging.
  await page.evaluate(async () => {
    const {pitchReference, pitchScore, pitchContour, ...sample} = __qa.recording.takes[0];
    for (let i = 0; i < 26; i++) {
      await __qa.takeStore.append({...sample, id: crypto.randomUUID(), createdAt: Date.now() + i, favorite: false},
        0, new Int16Array([1]), {finalized: true, complete: true});
    }
  });
  await page.addInitScript(() => {
    window.BroadcastChannel = class { constructor() { throw new DOMException('Messaging blocked', 'SecurityError'); } };
  });
  await page.reload(); await settled();
  await page.waitForFunction(() => __qa.recording.ready);
  await openTakes(page);
  await page.locator('#takeList .take-row').nth(24).waitFor({state: 'attached'});
  assert.equal(await page.locator('#takeList .take-row').count(), 25);
  await page.locator('#takeMore').click();
  assert.equal(await page.locator('#takeList .take-row').count(), recovered.takes.length + 26);
  assert.equal(await page.locator('#takeMore').isVisible(), false);
  assert.equal((await page.evaluate(() => __qa.recording)).bytes, 0);
  assert.equal(await page.locator('#takeFavorites').count(), 0);
  await page.locator('#settingsToggle').click();

  // A blocked browser property must not abort initialization of the whole app.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {get() { throw new DOMException('Storage blocked', 'SecurityError'); }});
  });
  await page.reload(); await settled();
  await openTakes(page);
  await toggleRecording(page);
  await page.waitForFunction(() => __qa.recording.state === 'off' && __qa.recording.notice.startsWith('Local storage unavailable.'));
  assert.equal((await page.evaluate(() => __qa.recording)).microphone, false);
  // Explicitly leave capture mode to listen without writable storage.
  await page.locator('#pitchCapture').click();
  await page.locator('#settingsToggle').click();
  await page.locator('#playPause').click();
  await page.waitForFunction(() => __qa.engine.playing);
  await page.locator('#playPause').click();
  assert.equal(await page.evaluate(() => __qa.engine.playing), false);
  return {...store, safeQuotaStop: true, retainedUnsavedTail: true, exactRetry: true,
    partialCheckpointRecovery: true, preflightBeforeMicrophone: true, unavailableStorageStops: true,
    pagedLibrary: true, optionalMessaging: true, blockedStorageAllowsPractice: true};
}

module.exports = {checkLocalTakeFailures, checkTakeStore};
