/* Render score-aware listening copies without modifying captured microphone samples. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeCleanup = api;
})(globalThis, () => {
  "use strict";
  const VERSION = 3;
  const SETTINGS = Object.freeze({minimumRest: 10, edge: 1, fade: .5, floorGain: 10 ** (-18 / 20)});

  // The reference is already in seconds at the singer's recording tempo.
  // Ignore the count-in, and join overlapping notes when a part has several lines.
  function longRests(ref, offset = 0) {
    if (!Array.isArray(ref?.notes) || !Number.isFinite(ref.seconds) || !Number.isFinite(offset)) return [];
    if (!ref.notes.every(n => Array.isArray(n) && Number.isFinite(n[0]) && Number.isFinite(n[1]) && n[1] > n[0])) return [];
    const notes = [...ref.notes].sort((a, b) => a[0] - b[0]);
    const ranges = [];
    let last = Math.max(0, ref.leadInSeconds || 0);
    function restUntil(end) {
      if (end - last > SETTINGS.minimumRest + 1e-9) ranges.push([last + offset, end + offset]);
    }
    for (const [from, to] of notes) {
      restUntil(Math.min(from, ref.seconds));
      last = Math.max(last, to);
      if (last >= ref.seconds) break;
    }
    restUntil(ref.seconds);
    return ranges;
  }

  function apply(pcm, rate, ranges) {
    for (const [start, end] of ranges) {
      const from = (start + SETTINGS.edge) * rate, to = (end - SETTINGS.edge) * rate;
      const fade = SETTINGS.fade * rate;
      const first = Math.max(0, Math.ceil(from)), last = Math.min(pcm.length, Math.ceil(to));
      for (let i = first; i < last; i++) {
        const depth = Math.min(1, (i - from) / fade, (to - i) / fade);
        const gain = depth >= 1 ? SETTINGS.floorGain
          : 1 - (1 - SETTINGS.floorGain) * (.5 - .5 * Math.cos(Math.PI * depth));
        pcm[i] *= gain;
      }
    }
    return pcm;
  }

  async function prepare(blob, take) {
    const ref = take.pitchReference;
    const ranges = longRests(ref, ref?.latency || 0);
    if (!ranges.length && !Number.isFinite(take.stopNoiseFrom)) return {blob, ranges};
    const wav = await blob.arrayBuffer(), view = new DataView(wav);
    if (view.byteLength !== 44 + take.frames * 2 || view.getUint16(22, true) !== 1
      || view.getUint16(34, true) !== 16 || view.getUint32(24, true) !== take.sampleRate) {
      throw Error("Unexpected source WAV format");
    }
    const pcm = new Int16Array(wav, 44);
    apply(pcm, take.sampleRate, ranges);
    if (Number.isFinite(take.stopNoiseFrom)) {
      const pitch = typeof module === "object" && module.exports ? require("./take_pitch.js") : globalThis.MeleteTakePitch;
      pitch.muteStopTail(pcm, take.sampleRate, take.stopNoiseFrom);
    }
    return {blob: new Blob([wav], {type: "audio/wav"}), ranges};
  }

  return {VERSION, SETTINGS, longRests, apply, prepare};
});
