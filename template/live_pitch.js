/* One in-flight pitch estimate: never queue old microphone windows. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./vocal_pitch.js") : root.MeleteVocalPitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteLivePitch = api;
})(globalThis, function livePitchTools(vocal) {
  "use strict";
  function candidate(detector, input, sampleRate, previous, minimum, maximum) {
    const valid = frequency => Number.isFinite(frequency) && frequency >= minimum && frequency <= maximum;
    const cents = frequency => Math.round((69 + 12 * Math.log2(frequency / 440)) * 100);
    const primary = detector.findPitch(input, sampleRate);
    if (!valid(primary[0]) || !Number.isFinite(previous)) return primary;
    const change = Math.abs(cents(primary[0]) - previous);
    if (change < 900 || change > 1300) return primary;
    let alternate;
    try {
      detector.clarityThreshold = 0.98;
      alternate = detector.findPitch(input, sampleRate);
    } finally { detector.clarityThreshold = 0.9; }
    return valid(alternate?.[0]) && Number(alternate?.[1]) >= 0.6
      && Math.abs(cents(alternate[0]) - previous) <= 120 ? alternate : primary;
  }
  function workerSource(pitchy) {
    return `self.window = self;\n${pitchy}\n${vocal.source()}\nconst tools = (${livePitchTools.toString()})(MeleteVocalPitch);
      let detector;
      self.onmessage = ({data}) => {
        try {
          const input = data.input;
          if (!detector) {
            detector = MeleteVocalPitch.createDetector(Pitchy.PitchDetector, input.length);
            detector.clarityThreshold = 0.9;
          }
          const started = performance.now();
          const result = tools.candidate(detector, input, data.sampleRate, data.previous, data.minimum, data.maximum);
          self.postMessage({result, cost: performance.now() - started});
        } catch (error) { self.postMessage({error: error.message}); }
      };`;
  }
  class Channel {
    static fromSource(source, accept, fail) {
      const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      try { return new Channel(new Worker(url), accept, fail, url); }
      catch (error) { URL.revokeObjectURL(url); throw error; }
    }
    constructor(worker, accept, fail, url = null) {
      this.worker = worker;
      this.url = url;
      this.pending = null;
      this.generation = 0;
      worker.onmessage = ({data}) => {
        this.releaseSource();
        const job = this.pending;
        this.pending = null;
        if (!job || job.generation !== this.generation) return;
        if (data.error) fail(new Error(data.error));
        else accept(data.result, job.metadata, data.cost);
      };
      worker.onerror = event => { this.releaseSource(); this.pending = null; fail(new Error(event.message || "Pitch worker failed")); };
    }
    // WebKit may not have read the blob yet when the Worker constructor returns.
    releaseSource() { if (this.url) { URL.revokeObjectURL(this.url); this.url = null; } }
    submit(input, options, metadata) {
      if (this.pending) return false;
      this.pending = {generation: this.generation, metadata};
      // Transfer a copy; the analyser's reusable input buffer stays on the UI thread.
      const copy = input.slice();
      this.worker.postMessage({...options, input: copy}, [copy.buffer]);
      return true;
    }
    invalidate() { this.generation += 1; }
    close() { this.invalidate(); this.pending = null; this.worker.terminate(); this.releaseSource(); }
  }
  return {candidate, workerSource, Channel};
});
