const assert = require('node:assert/strict');
const {test} = require('node:test');
const {recordingDay, recordingDays} = require('../template/loop_recorder.js');

test('recording time counts captured seconds, not score tempo or comp coverage', () => {
  const createdAt = new Date(2026, 10, 2, 12).getTime();
  const record = {createdAt, sampleRate: 48000, frames: 48000 * 125, rate: .5};
  assert.equal(recordingDay(createdAt), '2026-11-02');
  assert.deepEqual(recordingDays(record), [['2026-11-02', 125]]);
  assert.deepEqual(recordingDays({...record, practiceTimeFrames: 48000 * 124.25}), [['2026-11-02', .75]]);
  assert.deepEqual(recordingDays({...record, practiceTimeFrames: record.frames}), []);
  assert.deepEqual(recordingDays({...record, practiceTimeFrames: record.frames + 100}), []);
});

test('recording time splits checkpoints at local midnight and rejects invalid audio metadata', () => {
  const record = {createdAt: new Date(2026, 10, 2, 23, 59, 59, 500).getTime(), sampleRate: 1000, frames: 2000};
  assert.deepEqual(recordingDays(record), [['2026-11-02', .5], ['2026-11-03', 1.5]]);
  assert.deepEqual(recordingDays({...record, practiceTimeFrames: 1000}), [['2026-11-03', 1]]);
  for (const invalid of [{sampleRate: 0}, {sampleRate: Infinity}, {frames: NaN}, {frames: -1}, {frames: Number.MAX_VALUE}, {createdAt: NaN}]) {
    assert.deepEqual(recordingDays({...record, ...invalid}), []);
  }
});

test('recording day accounting follows both daylight-saving transitions', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    for (const [month, day, hours] of [[2, 8, 23], [10, 1, 25]]) {
      const start = new Date(2026, month, day).getTime();
      assert.deepEqual(recordingDays({createdAt: start, sampleRate: 1000, frames: (hours * 3600 + 1) * 1000}),
        [[recordingDay(start), hours * 3600], [recordingDay(new Date(2026, month, day + 1).getTime()), 1]]);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
