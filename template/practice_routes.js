/* Performer routes share one guide outside their independently sung passages. */
(function(root) {
  "use strict";
  function playbackNotes(notes, roles, practicePart, secondsAtTick) {
    if (!roles?.length) return notes;
    const routed = new Map();
    for (const role of roles) {
      const ranges = role.handoffs.map(h => [secondsAtTick(h.start), secondsAtTick(h.end)]);
      routed.set(role.part, {role, ranges});
      routed.set(role.soloist, {role, ranges});
    }
    const result = [];
    for (const note of notes) {
      const route = routed.get(note.track);
      if (!route) { result.push(note); continue; }
      const {role, ranges} = route;
      const groups = [];
      for (const segment of note.segments || [note]) {
        const edges = [segment.start, ...ranges.flat().filter(t => t > segment.start && t < segment.end), segment.end]
          .sort((a, b) => a - b);
        for (let i = 1; i < edges.length; i++) {
          const [start, end] = edges.slice(i - 1, i + 1);
          const separate = ranges.some(([a, b]) => start >= a && start < b);
          if (!separate && note.track === role.soloist) continue;
          const track = !separate && practicePart === role.soloist ? role.soloist : note.track;
          const piece = {...segment, start, end, track};
          const last = groups.at(-1);
          if (last && last[0].track === track && Math.abs(last.at(-1).end - start) < 1e-7) last.push(piece);
          else groups.push([piece]);
        }
      }
      for (const segments of groups) {
        result.push(segments.length === 1 ? segments[0] : {...segments[0], end: segments.at(-1).end, segments});
      }
    }
    return result.sort((a, b) => a.start - b.start || a.track - b.track);
  }
  function extendPreferences(stored, roles, count) {
    if (!roles?.length || !stored) return stored;
    const originalCount = count - roles.length;
    const extend = (values, value) => Array.isArray(values) && values.length === originalCount
      ? [...values, ...roles.map(() => value)] : values;
    const volume = stored.practiceMixMode === "learn" ? 20 : 100;
    return {...stored, visible: extend(stored.visible, false), audible: extend(stored.audible, true),
      volumes: extend(stored.volumes, volume), pans: extend(stored.pans, 0),
      ...(stored.practiceMixUndo ? {practiceMixUndo: {...stored.practiceMixUndo,
        audible: extend(stored.practiceMixUndo.audible, true),
        volumes: extend(stored.practiceMixUndo.volumes, 100)}} : {})};
  }
  const api = {playbackNotes, extendPreferences};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeletePracticeRoutes = api;
})(typeof window === "object" ? window : globalThis);
