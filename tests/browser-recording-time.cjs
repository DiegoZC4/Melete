const assert = require('node:assert/strict');

async function checkRecordingTime(frame) {
  const result = await frame.evaluate(async () => {
    const R = MeleteRecording, name = `melete-time-qa-${crypto.randomUUID()}`;
    const store = new R.TakeStore(indexedDB, name), other = new R.TakeStore(indexedDB, name);
    const createdAt = new Date(2026, 10, 2, 12).getTime(), day = R.recordingDay(createdAt);
    const make = (id, song = 'autumn') => ({id, song, createdAt, sampleRate: 1000});
    const totals = {};
    try {
      // Surviving old takes are recovered once, even when several share a day.
      await store.transaction(['takes'], 'readwrite', tx => {
        for (const [id, song] of [['old-a', 'autumn'], ['old-b', 'the-seed']]) {
          tx.objectStore('takes').put({...make(id, song), frames: 60000});
        }
      });
      await store.backfillRecordingTime();
      await other.backfillRecordingTime();
      totals.migrated = await store.recordingTime(day);
      const a = await store.append(make('a'), 0, new Int16Array(30000), {finalized: false});
      await other.append(make('b', 'the-seed'), 0, new Int16Array(20000), {finalized: true});
      await store.append(a, 30000, new Int16Array(5000), {finalized: true});
      await store.append(a, 35000, new Int16Array(0), {finalized: true});
      totals.appended = await other.recordingTime(day);
      let stale;
      try { await store.append(a, 0, new Int16Array(1000), {}); }
      catch (error) { stale = error.message; }
      await store.deleteTakes('autumn', ['old-a', 'a']);
      await store.deleteTakes('the-seed', ['old-b', 'b']);
      await store.backfillRecordingTime();
      totals.deleted = await store.recordingTime(day);
      // A cloud import carries audio, but is not a new performance.
      await store.importComp({key: 'qa-import', song: 'autumn', segments: [], revision: 0},
        [{record: {...make('import'), frames: 60000}, pcm: new Int16Array(60000)}], 0);
      totals.imported = await store.recordingTime(day);
      // A rejected audition stub still counts, including its final <1s chunk.
      const originalNow = Date.now;
      Date.now = () => createdAt;
      try {
        const journal = new R.TakeJournal(store, 'autumn', {seconds: 10}, 1000);
        journal.begin(0); journal.append(0, new Float32Array(750));
        journal.finish(750, {discardShortTail: true});
        await journal.flush();
      } finally { Date.now = originalNow; }
      totals.stub = await store.recordingTime(day);
      totals.remaining = (await store.usage()).map(t => t.id);
      // Distinct connections cannot lose an increment to read/modify/write races.
      const first = store.append(make('concurrent-a'), 0, new Int16Array(1000), {});
      const second = other.append(make('concurrent-b', 'the-seed'), 0, new Int16Array(2000), {});
      await first; await second;
      totals.concurrent = await store.recordingTime(day);
      (await other.open()).close(); other.opening = null;
      totals.reopened = await other.recordingTime(day);
      totals.nextDay = await store.recordingTime('2026-11-03');
      return {totals, stale};
    } finally {
      (await store.open()).close(); (await other.open()).close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      });
    }
  });
  assert.deepEqual(result.totals, {migrated: 120, appended: 175, deleted: 175, imported: 175,
    stub: 175.75, remaining: ['import'], concurrent: 178.75, reopened: 178.75, nextDay: 0});
  assert.match(result.stale, /another tab/);
  return {crossSong: true, migrationOnce: true, deletionSafe: true, importsExcluded: true,
    subsecondStub: true, concurrentTabs: true, durable: true};
}

module.exports = {checkRecordingTime};
