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
  const VERSION = 1;
  let database;
  function metricsStore() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    return database ||= new Promise(resolve => {
      const request = indexedDB.open("melete-loudness-cache", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("metrics", {keyPath:"key"}).createIndex("at","at");
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    });
  }
  async function stored(buffer, key, result) {
    if (!key) return null;
    try {
      const db = await metricsStore();
      if (!db) return null;
      const identity = JSON.stringify([VERSION, key, buffer.sampleRate, buffer.length, buffer.numberOfChannels]);
      const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity)))]
        .map(n=>n.toString(16).padStart(2,"0")).join("");
      return await new Promise(resolve => {
        const tx = db.transaction("metrics", result ? "readwrite" : "readonly"), store = tx.objectStore("metrics");
        const request = result ? store.put({key:id, result, at:Date.now()}) : store.get(id);
        if (result) {
          const count = store.count();
          count.onsuccess = () => {
            let extra = count.result - 256;
            if (extra > 0) store.index("at").openCursor().onsuccess = event => {
              const cursor = event.target.result;
              if (cursor && extra-- > 0) { cursor.delete(); cursor.continue(); }
            };
          };
        }
        tx.oncomplete = () => resolve(result || request.result?.result || null);
        tx.onerror = tx.onabort = () => resolve(null);
      });
    } catch { return null; } // A disposable analysis cache must never block playback.
  }
  // Independent voices add energy. Sum peaks conservatively so correlated
  // doubles cannot clip; exact integrated mix loudness is measured on export.
  function mix(plans, {reverb = 0} = {}) {
    let energy = 0, peak = 0;
    for (const p of plans) {
      if (!p) continue;
      if (Number.isFinite(p.outputLufs)) energy += 10 ** (p.outputLufs / 10);
      if (Number.isFinite(p.truePeakDbtp)) peak += 10 ** (p.truePeakDbtp / 20) * p.gain;
    }
    const wet = 1 + Math.max(0, Math.min(100, reverb)) / 100 * .6;
    const gain = Math.min(1, energy ? Math.sqrt(10 ** (TARGET / 10) / energy) : 1,
      peak ? 10 ** (CEILING / 20) / (peak * wet) : 1);
    return {gain, gainDb:20*Math.log10(gain), estimated:true};
  }
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
  async function measure(buffer, offset = 0, key = null) {
    if (!cache.has(buffer)) cache.set(buffer, new Map());
    const entries = cache.get(buffer);
    if (!entries.has(offset)) {
      const pending = (async () => {
        const saved = await stored(buffer, key && [key,offset]);
        if (saved) return saved;
        const {result} = await run(buffer, {measureOffset:offset});
        await stored(buffer, key && [key,offset], result);
        return result;
      })().catch(error => { entries.delete(offset); throw error; });
      entries.set(offset, pending);
    }
    return entries.get(offset);
  }
  const track = async (buffer, key = null) => plan(await measure(buffer, 0, key), {dualMono:buffer.numberOfChannels === 1});
  return {TARGET, CEILING, MAX_BOOST, plan, mix, analyze, encode, workerSource, measure, track, run};
});
