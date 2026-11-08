// Independent BS.1770 check. Requires ffmpeg; run through heavy-run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const loudness = require('../template/take_loudness.js');
const meter = require('../vendor/bravoh-loudness/dist/index.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'melete-lufs-'));
try {
  const results = [];
  for (const [name, count, frequency, gain] of [['quiet-bass',1,110,.015],['loud-soprano',1,880,.3],['stereo-phrases',2,220,.1]]) {
    const rate = 48000, channels = Array.from({length:count}, (_, c) => Float32Array.from({length:rate*8}, (_, i) => {
      const time = i/rate, phrase = time<1||time>7 ? 0 : time<4 ? .4 : 1;
      return gain*phrase*(Math.sin(2*Math.PI*(frequency+c*1.3)*time)+.2*Math.sin(2*Math.PI*frequency*3*time));
    }));
    const bytes = Buffer.from(loudness.encode(channels, rate, 0, 1));
    const file = path.join(directory, name+'.wav'); fs.writeFileSync(file, bytes);
    const output = spawnSync(process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg',
      ['-nostdin','-hide_banner','-i',file,'-af','ebur128=peak=true','-f','null','-'],
      {timeout:30000,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.equal(output.status, 0, output.stderr);
    const summary = output.stderr.slice(output.stderr.lastIndexOf('Summary:'));
    const reference = {input_i:Number(summary.match(/I:\s+([-\d.]+) LUFS/)[1]),
      input_tp:Number(summary.match(/Peak:\s+([-\d.]+) dBFS/)[1])};
    const decoded = meter.decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
    const measured = loudness.analyze(decoded.channels, rate);
    const delta = measured.integratedLufs - Number(reference.input_i);
    assert.ok(Math.abs(delta)<.15, `${name}: ${delta} LU difference`);
    assert.ok(Math.abs(measured.truePeakDbtp-Number(reference.input_tp))<.15, name+' true peak');
    results.push({name,lufs:measured.integratedLufs,ffmpegLufs:Number(reference.input_i),delta,
      truePeak:measured.truePeakDbtp,ffmpegTruePeak:Number(reference.input_tp)});
  }
  console.log(JSON.stringify({results},null,2));
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
