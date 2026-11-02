/* One track per practice part. New recordings replace the phrases they sing,
   and phrase comping keeps entrance/release margins with their sung source. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./take_pitch.js") : root.MeleteTakePitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteComp = api;
})(globalThis, pitch => {
  "use strict";
  const EPS = 1e-6;
  const key = d => JSON.stringify([1, d.song, d.reference.fingerprint, d.reference.part,
    d.reference.line ?? null, d.reference.rate, d.reference.notes, d.reference.seconds]);
  const OFFER_VERSION = 2;
  const TRACK_VERSION = 1;
  const empty = descriptor => ({key: key(descriptor), song: descriptor.song, descriptor, offerVersion: OFFER_VERSION,
    trackVersion: TRACK_VERSION, revision: 0, segments: [], undo: null, processed: [], adopted: [], freshAt: 0});
  function adoptRevision(saved, descriptor, takes, current) {
    if (current && (current.segments.length || current.processed.length || current.freshAt
      || current.track || current.undo || current.revisionOf)) return current;
    const previous = saved.filter(s => s.key !== key(descriptor) && s.song === descriptor.song
      && pitch.sameTimeline(s.descriptor.reference, descriptor.reference)
      && protectedIds(s).every(id => takes.has(id) && eligible(takes.get(id), descriptor)))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    return previous ? {...previous, key: key(descriptor), descriptor, revision: current?.revision || 0,
      revisionOf: previous.key} : current || empty(descriptor);
  }
  // Earlier versions kept every take plus a separate best continuous take.
  // Recordings already in a comp become ordinary track material; others stay
  // until the singer downloads or deletes them.
  function migrate(state) {
    if (state.trackVersion === TRACK_VERSION) return state;
    const {bestId, bestAfter, undoBest, ...rest} = state;
    return {...rest, trackVersion: TRACK_VERSION, adopted: protectedIds(rest)};
  }
  const overlap = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from) > EPS;
  function normalize(segments) {
    const result = [];
    for (const s of segments.filter(s => s.to - s.from > EPS).sort((a, b) => a.from - b.from)) {
      const last = result.at(-1);
      if (last && s.from < last.to - EPS) throw new Error("Overlapping comp segments");
      if (last?.takeId === s.takeId && Math.abs(last.to - s.from) < EPS) last.to = s.to;
      else result.push({...s});
    }
    return result;
  }
  function replace(segments, segment) {
    return normalize([...segments.flatMap(s => !overlap(s, segment) ? [s] : [
      {...s, to: Math.min(s.to, segment.from)}, {...s, from: Math.max(s.from, segment.to)},
    ]), segment]);
  }
  function clipNotes(notes, ranges) {
    return notes.flatMap(([from, to, pitches]) => ranges.map(s => [Math.max(from, s.from),
      Math.min(to, s.to), pitches]).filter(n => n[1] - n[0] > EPS)).sort((a, b) => a[0] - b[0]);
  }
  // A complete recording of this track's passage, scored or not.
  function matches(take, descriptor) {
    const r = take.pitchReference, target = descriptor.reference;
    if (!take.complete || !take.finalized || take.active || take.unsaved || take.gap || take.deleteAfter
      || !pitch.validReference(r) || !Number.isFinite(take.origin) || r.fingerprint !== target.fingerprint
      || r.part !== target.part || (r.line ?? null) !== (target.line ?? null) || r.rate !== target.rate) return false;
    const from = take.origin + (r.leadInSeconds || 0), to = take.origin + r.seconds;
    if (from < -EPS || to > target.seconds + EPS || to <= from) return false;
    const expected = clipNotes(target.notes, [{from, to}]);
    return expected.length === r.notes.length && expected.every((n, i) =>
      Math.abs(n[0] - r.notes[i][0] - take.origin) < EPS
      && Math.abs(n[1] - r.notes[i][1] - take.origin) < EPS
      && JSON.stringify(n[2]) === JSON.stringify(r.notes[i][2]));
  }
  function eligible(take, descriptor) {
    return pitch.hasPitchBand(take.pitchScore) && matches(take, descriptor);
  }
  function segment(take) {
    return {takeId: take.id, from: take.origin + (take.pitchReference.leadInSeconds || 0),
      to: take.origin + take.pitchReference.seconds};
  }
  function framesFor(segments, takes) {
    const decoded = new Map();
    return segments.flatMap(s => {
      const take = takes.get(s.takeId);
      if (!take) throw new Error("A comp recording is missing");
      if (!decoded.has(s.takeId)) decoded.set(s.takeId, take.analysisFrames || pitch.readContour(take));
      const frames = decoded.get(s.takeId);
      if (!frames) throw new Error("A comp contour is missing or outdated");
      return frames.flatMap(f => {
        const start = Math.max(s.from, take.origin + f.start), end = Math.min(s.to, take.origin + f.end);
        return end - start > EPS ? [{start, end, cents: f.cents, takeId: s.takeId}] : [];
      });
    }).sort((a, b) => a.start - b.start);
  }
  function stats(state, takes, ranges = state.segments) {
    const ref = state.descriptor.reference;
    const covered = normalize(ranges);
    const notes = clipNotes(ref.notes, covered);
    const frames = framesFor(covered, takes);
    const score = pitch.scoreFrames(frames, {...ref, notes}, ref.seconds);
    const total = ref.notes.reduce((sum, n) => sum + n[1] - n[0], 0);
    return {...score, completion: total ? score.expectedSeconds / total : 0,
      segmentCount: covered.length, totalExpectedSeconds: total};
  }
  // End of the last written note in which this recording detected singing.
  function lastSung(range, takes, notes) {
    const frames = framesFor([range], takes).filter(f => Number.isFinite(f.cents));
    return clipNotes(notes, [range]).findLast(([a, b]) => frames.some(f => f.end > a + EPS && f.start < b - EPS))?.[1] ?? null;
  }
  function bindMargins(segments, descriptor, takes) {
    const ref = descriptor.reference;
    if (!pitch.restPolicyValid(ref)) return normalize(segments);
    const notes = pitch.mergeRanges(ref.notes.map(n => n.slice(0, 2)));
    const sung = normalize(segments.flatMap(s => notes.map(([a, b]) => ({...s,
      from: Math.max(a, s.from), to: Math.min(b, s.to)})).filter(s => s.to - s.from > EPS)));
    // Restore only rests. Never change a selected sung passage, fill missing
    // notes, or borrow audio beyond the source's actual capture.
    const margins = sung.map(s => {
      const source = segment(takes.get(s.takeId));
      let from = s.from, to = s.to;
      if (!notes.some(([a, b]) => a < from - EPS && b > from + EPS)) {
        from = notes.findLast(n => n[1] <= s.from + EPS)?.[1] ?? 0;
      }
      if (!notes.some(([a, b]) => a < to - EPS && b > to + EPS)) {
        to = notes.find(n => n[0] >= s.to - EPS)?.[0] ?? ref.seconds;
      }
      return {...s, from: Math.max(from, source.from), to: Math.min(to, source.to)};
    });
    for (let i = 1; i < sung.length; i++) {
      const left = sung[i - 1], right = sung[i];
      if (right.from - left.to <= EPS || clipNotes(ref.notes, [{from: left.to, to: right.from}]).length) continue;
      const release = ref.restPolicy.guards.find(([a]) => Math.abs(a - left.to) < EPS)?.[1] ?? left.to;
      const entrance = ref.restPolicy.guards.find(([, b]) => Math.abs(b - right.from) < EPS)?.[0] ?? right.from;
      // Prefer a seam in already-muted audio. Existing partial phrase joins
      // with overlapping guards retain their sung choices and meet mid-rest.
      const cut = release <= entrance ? (release + entrance) / 2 : (left.to + right.from) / 2;
      margins[i - 1].to = Math.min(margins[i - 1].to, cut);
      margins[i].from = Math.max(margins[i].from, cut);
    }
    return normalize(margins);
  }
  function repairMargins(state, takes) {
    return {...state, segments: bindMargins(state.segments, state.descriptor, takes),
      undo: state.undo ? bindMargins(state.undo, state.descriptor, takes) : null};
  }
  function offer(state, take, takes, {backfill = false} = {}) {
    if (!eligible(take, state.descriptor) || !pitch.readContour(take)) return state;
    if ((!backfill && state.processed.includes(take.id)) || take.createdAt <= state.freshAt) return state;
    // Phrase comparisons revisit sources; decode each contour once per offer.
    takes = new Map([...takes].map(([id, t]) => [id, {...t, analysisFrames: t.analysisFrames || pitch.readContour(t)}]));
    const next = {...state, processed: [...new Set([...state.processed, take.id])]};
    const captured = segment(take), ref = state.descriptor.reference;
    const windows = pitch.restPolicyValid(ref) ? ref.restPolicy.keep : [[captured.from, captured.to]];
    const additions = [];
    for (const [from, to] of windows) {
      const incoming = {...captured, from: Math.max(from, captured.from), to: Math.min(to, captured.to)};
      if (incoming.to - incoming.from <= EPS || !clipNotes(ref.notes, [incoming]).length) continue;
      // Silence never erases earlier singing, and a recording stopped
      // mid-phrase ends at its last sung note rather than at the Stop press.
      const end = lastSung(incoming, takes, ref.notes);
      if (end === null) continue;
      if (!backfill) {
        additions.push(captured.to < to - EPS ? {...incoming, to: Math.min(incoming.to, end)} : incoming);
        continue;
      }
      // The one-time migration of older comps only fills empty territory.
      const previous = state.segments.flatMap(s => overlap(s, incoming)
        ? [{...s, from: Math.max(s.from, incoming.from), to: Math.min(s.to, incoming.to)}] : []);
      const gaps = previous.reduce((ranges, occupied) => ranges.flatMap(s => !overlap(s, occupied) ? [s] : [
        {...s, to: Math.min(s.to, occupied.from)}, {...s, from: Math.max(s.from, occupied.to)},
      ].filter(s => s.to - s.from > EPS)), [incoming]);
      additions.push(...gaps.filter(s => lastSung(s, takes, ref.notes) !== null));
    }
    if (additions.length) {
      next.undo = state.segments.map(s => ({...s}));
      next.segments = bindMargins(additions.reduce(replace, state.segments), state.descriptor, takes);
      // A track recording that filled the track goes once it is replaced.
      if (take.replaces) next.adopted = [...new Set([...(state.adopted || []), take.id])];
    }
    return next;
  }
  // Removing a track keeps one Undo; the recordings go with the next change.
  function remove(state, now = Date.now()) {
    return {...state, undo: state.segments.length ? state.segments : state.undo, segments: [], freshAt: now, track: false};
  }
  function undo(state) {
    return state.undo ? {...state, segments: state.undo, undo: null, track: true} : state;
  }
  function protectedIds(state) {
    return [...new Set([...state.segments, ...(state.undo || [])].map(s => s.takeId))];
  }
  // Recordings a track adopted that no track or Undo uses any more. Older
  // takes that were never part of a track, recordings with no detected
  // singing, and favorites are left for the singer.
  function discardable(comps, takes) {
    const used = new Set(comps.flatMap(protectedIds));
    const adopted = new Set(comps.flatMap(s => s.adopted || []));
    return takes.filter(t => !used.has(t.id) && adopted.has(t.id)
      && !t.favorite && !t.active && !t.unsaved && !t.deleteAfter).map(t => t.id);
  }
  function validate(state, takes) {
    if (state?.key !== key(state.descriptor) || state.song !== state.descriptor.song
      || !pitch.validReference(state.descriptor.reference) || !Array.isArray(state.segments)) throw new Error("Invalid comp");
    for (const s of [...state.segments, ...(state.undo || [])]) {
      const t = takes.get(s.takeId);
      if (!t || !eligible(t, state.descriptor) || !Number.isFinite(s.from) || !Number.isFinite(s.to)
        || s.from < segment(t).from - EPS || s.to > segment(t).to + EPS || s.to <= s.from) throw new Error("Invalid comp passage");
    }
    normalize(state.segments);
    return true;
  }
  return {OFFER_VERSION, TRACK_VERSION, key, empty, adoptRevision, migrate, normalize, replace, clipNotes, matches, eligible,
    segment, framesFor, stats, lastSung, bindMargins, repairMargins, offer, remove, undo, protectedIds, discardable, validate};
});
