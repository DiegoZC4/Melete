// Offline test using the exact upstream modules and trained weights. Pass a
// checkout of VoiceSu at the revision documented in vowel-lab/README.md.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL, fileURLToPath} = require('node:url');
const lab = require('../vowel-lab/voicesu_tracker.js');

async function main() {
  const checkout = process.argv[2] || process.env.VOICESU_ROOT;
  if (!checkout) throw Error('Pass the pinned VoiceSu checkout as the first argument.');
  const base = pathToFileURL(path.resolve(checkout) + path.sep).href;
  const create = await lab.load(base, async url => JSON.parse(fs.readFileSync(fileURLToPath(url))));
  const {synth, normalize} = await import(base + 'test/synth.js');
  for (const [rate, pitch] of [[44100,130], [48000,185]]) {
    function vowel(f1, f2) {
      const formants = [f1,f2,2650,3550].map((f,i) => ({f,bw:[65,85,130,160][i]}));
      return normalize(synth(formants, pitch, rate, rate), .31);
    }
    const input = new Float32Array(4*rate);
    input.set(vowel(400,2100)); input.set(vowel(720,1200),rate); input.set(vowel(400,2100),3*rate);
    function track(block) {
      const stream = create(rate), rows = [];
      for (let i=0; i<input.length; i+=block) stream.push(input.subarray(i,i+block), row=>rows.push(row));
      return rows;
    }
    const live = track(128), replay = track(Math.round(rate/2));
    assert.deepEqual(live,replay,'microphone and replay chunking must have identical timestamps and estimates');
    for (const key of ['result','mfcc']) {
      const at = t => live.find(frame => frame.timeMs>=t)[key];
      const first=at(900), next=at(1930), returned=at(3750);
      assert.ok(Math.abs(first.f1-400)<110 && Math.abs(first.f2-2100)<200, JSON.stringify(first));
      assert.ok(Math.abs(next.f1-720)<120 && Math.abs(next.f2-1200)<200, JSON.stringify(next));
      assert.ok(Math.abs(returned.f1-first.f1)<50 && Math.abs(returned.f2-first.f2)<75);
      assert.ok(live.filter(f => f.timeMs>=2100 && f.timeMs<3000).every(f => f[key]===null));
      assert.ok(live.filter(f => f.timeMs>3200 && f.timeMs<3900).every(f => f[key]));
    }
    console.log(rate+' Hz input, '+pitch+' Hz voice: both engines followed the vowel change, cleared in silence and reproduced every live result on replay.');
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
