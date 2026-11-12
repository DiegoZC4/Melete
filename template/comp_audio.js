/* Comp splice/encoding work stays off the UI thread. Originals are untouched. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteCompAudio = api;
})(globalThis, () => {
  "use strict";
  function splice(out, input, segments, origin, latency, sampleRate) {
    const edge = Math.max(1, Math.round(.003 * sampleRate));
    for (const s of segments) {
      const begin = Math.round(s.from * sampleRate), end = Math.min(out.length, Math.round(s.to * sampleRate));
      const offset = Math.round((s.from - origin + latency) * sampleRate);
      const lo = Math.max(begin, begin - offset, 0), hi = Math.min(end, begin + input.length - offset);
      if (hi <= lo) continue;
      out.set(input.subarray(offset + lo - begin, offset + hi - begin), lo);
      for (let i = lo; i < Math.min(hi, begin + edge); i++) out[i] *= Math.min(1, (i - begin) / edge, (end - 1 - i) / edge);
      for (let i = Math.max(lo, begin + edge, end - edge); i < hi; i++) out[i] *= (end - 1 - i) / edge;
    }
  }
  function workerSource(recording) {
    return `"use strict";\n${globalThis.MeleteLoudnessSource || ""}
      const splice = ${splice.toString()};
      const wavBytes = ${recording.wavBytes.toString()};
      const takePlaybackGain = ${recording.takePlaybackGain.toString()};
      let out, rate;
      onmessage = ({data: m}) => { try {
        if (m.type === "init") { rate = m.rate; out = new Float32Array(m.length); }
        if (m.type === "source") {
          const input = m.wav ? MeleteLoudnessMeter.decodeWav(m.wav).channels[0] : new Float32Array(m.input);
          splice(out, input, m.segments, m.origin, m.latency, rate);
        }
        if (m.type === "finish") {
          const pcm = new Int16Array(out.length);
          for (let i = 0; i < out.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, out[i])) * 32767);
          const wav = wavBytes(pcm, rate), gain = takePlaybackGain(out, rate);
          postMessage({samples: out.buffer, wav, gain}, [out.buffer, wav]);
        }
      } catch (e) { postMessage({error: e.message}); } };`;
  }
  async function prepare(context, snapshot, takes, wav, signal) {
    const origin = Math.min(0, snapshot.segments[0]?.from || 0);
    const seconds = snapshot.descriptor.reference.seconds - origin;
    if (seconds > 1200) throw new Error("Comp audio review is limited to 20 minutes");
    const url = URL.createObjectURL(new Blob([workerSource(globalThis.MeleteRecording)], {type: "text/javascript"}));
    let worker, timer, abort;
    try {
      worker = new Worker(url);
      const result = new Promise((resolve, reject) => {
        worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data);
        worker.onerror = () => reject(new Error("Comp audio preparation failed"));
        abort = () => reject(new DOMException("Cancelled", "AbortError"));
        signal.addEventListener("abort", abort, {once: true});
        timer = setTimeout(() => reject(new Error("Comp audio preparation timed out")), 60000);
      });
      // Observe worker failure immediately, including while a source is decoding.
      result.catch(() => {});
      worker.postMessage({type: "init", rate: context.sampleRate, length: Math.ceil(seconds * context.sampleRate)});
      for (const id of new Set(snapshot.segments.map(s => s.takeId))) {
        signal.throwIfAborted();
        const take = takes.get(id), blob = await wav(take);
        const bytes = await blob.arrayBuffer();
        signal.throwIfAborted();
        const message = {type: "source", origin: take.origin - origin,
          latency: take.pitchReference.latency+(take.playbackAdvance || 0), segments: snapshot.segments.filter(s => s.takeId === id)
            .map(s => ({...s, from:s.from - origin, to:s.to - origin}))};
        if (take.sampleRate === context.sampleRate) {
          worker.postMessage({...message, wav: bytes}, [bytes]);
        } else {
          const decoded = await context.decodeAudioData(bytes);
          signal.throwIfAborted();
          const input = decoded.getChannelData(0).slice();
          worker.postMessage({...message, input:input.buffer}, [input.buffer]);
        }
      }
      worker.postMessage({type: "finish"});
      const {samples, wav: bytes, gain} = await result;
      signal.throwIfAborted();
      const buffer = context.createBuffer(1, samples.byteLength / 4, context.sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      return {buffer, blob: new Blob([bytes], {type: "audio/wav"}), playbackGain: gain, origin};
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      worker?.terminate(); URL.revokeObjectURL(url);
    }
  }
  return {splice, workerSource, prepare};
});
