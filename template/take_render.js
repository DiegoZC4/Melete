/* Display-only reductions. Saved detector frames and scoring never change. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./take_pitch.js") : root.MeleteTakePitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeRender = api;
})(globalThis, pitch => {
  "use strict";
  const connects = pitch.connects;
  // Live and saved traces share one display rule. Detector window widths are
  // not silence boundaries: the browser can deliver voiced samples irregularly.
  function frameRange(frames, from, to) {
    const lower = value => {
      let lo = 0, hi = frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1, f = frames[mid];
        if ((f.start + f.end) / 2 < value) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    return [lower(from), lower(to + 1e-9)];
  }
  function tracePaths(frames, from, to, pointAt, colorAt, {rate = 1} = {}) {
    const colors = new Map();
    let previous = null, halo = "", edges = 0;
    for (let i = from; i < to; i++) {
      const frame = frames[i];
      if (!Number.isFinite(frame.cents)) { previous = null; continue; }
      const point = pointAt(frame);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { previous = null; continue; }
      const seconds = (frame.start + frame.end) / 2 * rate;
      if (previous && previous.point.track === point.track && frame.takeId === previous.frame.takeId
        && connects(previous.seconds, previous.frame.cents, seconds, frame.cents)) {
        // Match live continuity without bridging explicit unvoiced frames,
        // large pitch jumps, long dropouts, hidden points or comp splices.
        // Separate subpaths retain every edge, including gaps and source changes.
        const edge = `M${previous.point.x.toFixed(3)} ${previous.point.y.toFixed(3)}L${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
        const color = colorAt(point.error);
        colors.set(color, (colors.get(color) || "") + edge);
        halo += edge; edges++;
      }
      previous = {frame, point, seconds};
    }
    return {colors: [...colors], halo, edges};
  }
  return {connects, frameRange, tracePaths};
});
