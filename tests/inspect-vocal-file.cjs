// Bounded local diagnostic; never changes the source recording.
const fs = require('node:fs');
const pitch = require('../template/take_pitch.js');
const {PitchDetector} = require('./pitch-fixture.cjs');
const wav = fs.readFileSync(process.argv[2]);
if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Expected WAV');
let format, data;
for (let p = 12; p + 8 <= wav.length;) {
  const n = wav.readUInt32LE(p + 4), tag = wav.toString('ascii', p, p + 4);
  if (tag === 'fmt ') format = {type: wav.readUInt16LE(p+8), channels: wav.readUInt16LE(p+10),
    rate: wav.readUInt32LE(p+12), bits: wav.readUInt16LE(p+22)};
  if (tag === 'data') data = wav.subarray(p+8, p+8+n);
  p += 8 + n + n % 2;
}
if (format.type !== 1 || format.bits !== 16 || !data) throw new Error('Expected PCM16');
const pcm = Int16Array.from({length: data.length / (2 * format.channels)}, (_, i) => data.readInt16LE(i*2*format.channels));
const seconds = pcm.length / format.rate;
const ref = pitch.reference({spans:[{start:0,end:seconds,pitches:[40]}], secondsAtTick:t=>t,
  start:0,end:seconds,rate:1,fingerprint:'diagnostic',part:0,line:null});
const result = pitch.analyse(pcm, format.rate, ref, PitchDetector, {includeFrames:true});
const frames = result.frames;
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(frames));
const bins = {};
for (const f of frames) if (f.cents !== null) {
  const note = Math.round(f.cents / 100); bins[note] = (bins[note] || 0) + f.end-f.start;
}
console.log(JSON.stringify({seconds, sampleRate:format.rate, frames:frames.length, secondsByMidi:bins},null,2));
