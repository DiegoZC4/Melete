/* Fixed integrated-loudness gain, never a live AGC. Raw recordings stay raw. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports
    ? require("../vendor/bravoh-loudness/dist/index.cjs") : null);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeLoudness = api;
})(globalThis, function loudnessTools(meter) {
  "use strict";
  const TARGET = -14, CEILING = -2, MAX_BOOST = 30;
  const cache = new WeakMap();
  function plan(result, {dualMono = false} = {}) {
    const stereo = dualMono ? 10 * Math.log10(2) : 0;
    const audible = Number.isFinite(result.integratedLufs) && result.integratedLufs > -60;
    const gainDb = audible ? Math.min(MAX_BOOST, TARGET - result.integratedLufs - stereo,
      CEILING - result.truePeakDbtp) : 0;
    return {...result, gainDb, gain: 10 ** (gainDb / 20), target: TARGET,
      outputLufs: result.integratedLufs + stereo + gainDb,
      peakLimited: audible && gainDb < TARGET - result.integratedLufs - stereo - .01};
  }
  function analyze(channels, sampleRate) {
    return meter.analyzeLoudness(channels, {sampleRateHz: sampleRate});
  }
  function encode(channels, sampleRate, offset, gain) {
    const frames = channels[0].length - offset, count = channels.length;
    const data = new ArrayBuffer(44 + frames * count * 2), view = new DataView(data);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, frames * count * 2, true);
    for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) {
      view.setInt16(44 + (i * count + c) * 2, Math.round(Math.max(-1, Math.min(1, channels[c][i + offset] * gain)) * 32767), true);
    }
    return data;
  }
  function workerSource() {
    return `${globalThis.MeleteLoudnessSource}\nconst loudness = (${loudnessTools.toString()})(MeleteLoudnessMeter);
      onmessage = ({data:m}) => { try {
        const channels = m.channels.map(b => new Float32Array(b));
        if (m.encode) { const wav = loudness.encode(channels,m.rate,m.offset,m.gain); postMessage({wav},[wav]); }
        else postMessage({result:loudness.analyze(channels,m.rate)});
      } catch(e) { postMessage({error:e.message}); } };`;
  }
  async function run(buffer, options = {}) {
    const url = URL.createObjectURL(new Blob([workerSource()], {type:"text/javascript"}));
    const worker = new Worker(url);
    let timer;
    try {
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        channels.push(buffer.getChannelData(c).slice(options.measureOffset || 0).buffer);
        // A full-song buffer copy is bounded; yield between channels.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Recording loudness analysis timed out")), 60000);
        worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data);
        worker.onerror = () => reject(new Error("Recording loudness analysis failed"));
        worker.postMessage({channels, rate:buffer.sampleRate, ...options}, channels);
      });
    } finally { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); }
  }
  async function measure(buffer, offset = 0) {
    if (!cache.has(buffer)) cache.set(buffer, new Map());
    const entries = cache.get(buffer);
    if (!entries.has(offset)) {
      const pending = run(buffer, {measureOffset:offset}).then(({result}) => result).catch(error => { entries.delete(offset); throw error; });
      entries.set(offset, pending);
    }
    return entries.get(offset);
  }
  const track = async buffer => plan(await measure(buffer), {dualMono:buffer.numberOfChannels === 1});
  return {TARGET, CEILING, MAX_BOOST, plan, analyze, encode, workerSource, measure, track, run};
});
