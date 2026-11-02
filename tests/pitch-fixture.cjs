const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const FFT = require('../vendor/fft/fft.js');
const source = fs.readFileSync(path.join(__dirname, '../vendor/pitchy/index.js'), 'utf8')
  .replace(/import FFT from .*?;\s*/, '').replace(/export class /g, 'class ');
const context = {FFT};
vm.runInNewContext(source + '\nglobalThis.Detector = PitchDetector;', context);
module.exports = {PitchDetector: context.Detector};
