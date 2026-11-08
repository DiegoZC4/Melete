/* Display-only reductions. Saved detector frames and scoring never change. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeRender = api;
})(globalThis, () => {
  "use strict";
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
  function tracePaths(frames, from, to, pointAt, colorAt) {
    const colors = new Map();
    let previous = null, halo = "", edges = 0;
    for (let i = from; i < to; i++) {
      const frame = frames[i];
      if (!Number.isFinite(frame.cents)) { previous = null; continue; }
      const point = pointAt(frame);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { previous = null; continue; }
      if (previous && previous.point.track === point.track && frame.takeId === previous.frame.takeId
        && frame.start - previous.frame.end < (frame.live && previous.frame.live ? .025 : 1e-6)) {
        // Live delivery jitters inside overlapping detector windows. Join those
        // display points, never an explicit unvoiced frame or a capture dropout.
        // Separate subpaths retain every edge, including gaps and source changes.
        const edge = `M${previous.point.x.toFixed(3)} ${previous.point.y.toFixed(3)}L${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
        const color = colorAt(point.error);
        colors.set(color, (colors.get(color) || "") + edge);
        halo += edge; edges++;
      }
      previous = {frame, point};
    }
    return {colors: [...colors], halo, edges};
  }
  return {frameRange, tracePaths};
});
