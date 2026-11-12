/* One track per practice part. New recordings replace the phrases they sing,
   and phrase comping keeps entrance/release margins with their sung source. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./take_pitch.js") : root.MeleteTakePitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteComp = api;
})(globalThis, function compTools(pitch) {
  "use strict";
  const EPS = pitch.TIME_EPSILON;
  const key = d => JSON.stringify([1, d.song, d.reference.fingerprint, d.reference.part,
    d.reference.line ?? null, d.reference.rate, d.reference.notes, d.reference.seconds, ...(d.slot ? [d.slot] : [])]);
  const OFFER_VERSION = 2;
  const TRACK_VERSION = 1;
  // Breath cleanup weighs noise over runs of up to 1.2 s, so a shorter margin
  // could change how the audio that stays is cleaned.
  const AUDIO_MARGIN_SECONDS = 1.3;
  const empty = descriptor => ({key: key(descriptor), song: descriptor.song, descriptor, offerVersion: OFFER_VERSION,
    trackVersion: TRACK_VERSION, revision: 0, segments: [], undo: null, processed: [], adopted: [], freshAt: 0});
  function adoptRevision(saved, descriptor, takes, current) {
    // A score-key change must not recover audio that the singer deleted under
    // an older key. Deletion applies to the track identity, not its score hash.
    const removed = saved.filter(s => !s.segments.length && !s.track && s.freshAt > 0
      && s.song === descriptor.song && (s.descriptor.slot || null) === (descriptor.slot || null)
      && s.descriptor.reference.part === descriptor.reference.part
      && (s.descriptor.reference.line ?? null) === (descriptor.reference.line ?? null)
      && s.descriptor.reference.rate === descriptor.reference.rate)
      .sort((a,b) => b.freshAt-a.freshAt)[0];
    if (removed && removed.key !== current?.key && removed.freshAt > Math.max(current?.updatedAt || 0,current?.freshAt || 0)) {
      return {...removed, key:key(descriptor), descriptor, revision:current?.revision || 0,
        undo:protectedIds(removed).every(id=>takes.has(id) && eligible(takes.get(id),descriptor)) ? removed.undo : null,
        processed:[...new Set([...(removed.processed || []), ...(current?.processed || [])])], revisionOf:removed.key};
    }
    if (current && (current.segments.length || current.processed.length || current.freshAt
      || current.track || current.undo || current.revisionOf)) return current;
    const previous = saved.filter(s => s.key !== key(descriptor) && s.song === descriptor.song
      && (s.descriptor.slot || null) === (descriptor.slot || null)
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
    return notes.flatMap(([from, to, pitches]) => pitch.nonzeroNotes(ranges.map(s => [Math.max(from, s.from),
      Math.min(to, s.to), pitches]))).sort((a, b) => a[0] - b[0]);
  }
  // A complete recording of this track's passage, scored or not.
  function matches(take, descriptor) {
    const r = take.pitchReference, target = descriptor.reference;
    if ((take.trackSlot || null) !== (descriptor.slot || null)) return false;
    if (!take.complete || !take.finalized || take.active || take.unsaved || take.gap || take.deleteAfter
      || !pitch.validReference(r) || !Number.isFinite(take.origin) || r.fingerprint !== target.fingerprint
      || r.part !== target.part || (r.line ?? null) !== (target.line ?? null) || r.rate !== target.rate) return false;
    const from = take.origin + (r.leadInSeconds || 0), to = take.origin + r.seconds;
    if (from < -EPS || to > target.seconds + EPS || to <= from) return false;
    const expected = clipNotes(target.notes, [{from, to}]);
    const actual = pitch.nonzeroNotes(r.notes);
    return expected.length === actual.length && expected.every((n, i) =>
      Math.abs(n[0] - actual[i][0] - take.origin) < EPS
      && Math.abs(n[1] - actual[i][1] - take.origin) < EPS
      && JSON.stringify(n[2]) === JSON.stringify(actual[i][2]));
  }
  function eligible(take, descriptor) {
    return pitch.hasPitchBand(take.pitchScore) && matches(take, descriptor);
  }
  function segment(take) {
    return {takeId: take.id, from: take.origin,
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
        const origin=take.origin-(take.playbackAdvance || 0);
        const start = Math.max(s.from, origin + f.start), end = Math.min(s.to, origin + f.end);
        return end - start > EPS ? [{start, end, cents: f.cents, takeId: s.takeId, ...(f.live ? {live:true} : {})}] : [];
      });
    }).sort((a, b) => a.start - b.start);
  }
  function stats(state, takes, ranges = state.segments) {
    const ref = state.descriptor.reference;
    const covered = normalize(ranges);
    const notes = clipNotes(ref.notes, covered);
    const frames = framesFor(covered, takes);
    const score = pitch.scoreFrames(frames, ref, ref.seconds);
    const total = ref.notes.reduce((sum, n) => sum + n[1] - n[0], 0);
    const filled = notes.reduce((sum, n) => sum + n[1] - n[0], 0);
    return {...score, completion: total ? filled / total : 0,
      segmentCount: segmentCount(covered, ref.notes), totalExpectedSeconds: total};
  }
  function segmentCount(segments, notes) {
    let previous, count = 0;
    for (const s of segments) {
      if (!previous || previous.takeId !== s.takeId
        || notes.some(([a,b]) => Math.min(b,s.from) - Math.max(a,previous.to) > EPS)) count++;
      previous = s;
    }
    return count;
  }
  function reconcile(descriptor, saved, takes) {
    // Decode/clean each contour once for the entire reconciliation, not once
    // for every candidate phrase and every statistics pass.
    takes = new Map([...takes].map(([id, t]) => [id, {...t, analysisFrames: t.analysisFrames || pitch.readContour(t)}]));
    let state = migrate(adoptRevision(saved, descriptor, takes, saved.find(s => s.key === key(descriptor))));
    state = repairMargins({...state, descriptor}, takes);
    const backfill = (state.offerVersion || 1) < OFFER_VERSION, replaced = [], silent = [], edits = [];
    // Migration fills gaps from the newest recording first. Older audio kept
    // only for Undo must not outrank a more recent performance.
    for (const take of [...takes.values()].sort((a, b) => (backfill ? -1 : 1) * (a.createdAt - b.createdAt))) {
      const next = offer(state, take, takes, {backfill});
      if (next !== state && take.replaces && !backfill) (next.segments === state.segments ? silent : replaced).push(take.id);
      if (next.segments !== state.segments && !backfill) edits.push({segments: next.segments,
        track: Boolean(next.track), firstTakeNumber: next.firstTakeNumber ?? null});
      state = next;
    }
    if (replaced.length) state = {...state, editedAt: Date.now()};
    if (state.firstTakeNumber == null && state.segments.length) {
      const numbers = state.segments.map(s => takes.get(s.takeId)?.number).filter(Number.isFinite);
      if (numbers.length) state = {...state, firstTakeNumber: Math.min(...numbers)};
    }
    state = {...state, offerVersion: OFFER_VERSION};
    return {state, replaced, silent, edits, score: stats(state, takes), frames: framesFor(state.segments, takes)};
  }
  function workerSource() {
    return `${pitch.source()}\nconst model = (${compTools.toString()})(MeleteTakePitch);
      onmessage = ({data}) => { try { postMessage({result:model.reconcile(data.descriptor, data.saved, data.takes)}); }
        catch (e) { postMessage({error:e.message}); } };`;
  }
  async function reconcileAsync(descriptor, saved, takes) {
    const url = URL.createObjectURL(new Blob([workerSource()], {type:"text/javascript"}));
    const worker = new Worker(url);
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Track processing timed out; original recordings kept")), 60000);
        worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.result);
        worker.onerror = () => reject(new Error("Track processing failed; original recordings kept"));
        worker.postMessage({descriptor, saved, takes});
      });
    } finally { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); }
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
        from = notes.findLast(n => n[1] <= s.from + EPS)?.[1] ?? Math.min(0, source.from);
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
    // A trimmed source no longer holds the passages a new offer could choose.
    if (take.storedFrames !== undefined) return state;
    if (!eligible(take, state.descriptor) || !pitch.readContour(take)) return state;
    if ((!backfill && state.processed.includes(take.id)) || take.createdAt <= state.freshAt) return state;
    // Phrase comparisons revisit sources; decode each contour once per offer.
    takes = new Map([...takes].map(([id, t]) => [id, {...t, analysisFrames: t.analysisFrames || pitch.readContour(t)}]));
    const next = {...state, processed: [...new Set([...state.processed, take.id])]};
    const captured = segment(take), ref = state.descriptor.reference;
    const windows = pitch.restPolicyValid(ref) ? ref.restPolicy.keep : [[captured.from, captured.to]];
    const additions = [];
    for (const [from, to] of windows) {
      // Count-in is retained as the phrase's entrance margin, not offered as
      // a replacement for written singing before the requested entrance.
      const incoming = {...captured, from: Math.max(from, captured.from + (take.pitchReference.leadInSeconds || 0)), to: Math.min(to, captured.to)};
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
      if (next.firstTakeNumber == null && Number.isFinite(take.number)) next.firstTakeNumber = take.number;
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
  // Replaced track captures no longer referenced by a track or its history.
  // Never delete a recording that was not successfully adopted into a track.
  function discardable(comps, takes, historyIds = []) {
    const used = new Set([...comps.flatMap(protectedIds), ...historyIds]);
    const adopted = new Set(comps.flatMap(s => s.adopted || []));
    return takes.filter(t => !used.has(t.id) && adopted.has(t.id) && t.complete && t.finalized
      && !t.favorite && !t.active && !t.unsaved && !t.deleteAfter).map(t => t.id);
  }
  // Frames of each source that a track or its Undo/Redo history can still play.
  // A source is left out, and so kept whole, when any use of it cannot be mapped
  // to its recording: a score that changed, a missing track, or a starred take.
  function usedAudio(comps, takes, edits = []) {
    const records = new Map(takes.map(t => [t.id, t])), states = new Map(comps.map(s => [s.key, s]));
    const kept = new Map(), whole = new Set(), checked = new Map();
    const trusted = (t, stateKey) => {
      const id = JSON.stringify([stateKey, t.id]);
      if (!checked.has(id)) checked.set(id, states.has(stateKey) && !t.favorite && !t.playbackAdvance && eligible(t, states.get(stateKey).descriptor));
      return checked.get(id);
    };
    const use = (segments, stateKey) => {
      for (const s of segments || []) {
        const t = records.get(s.takeId);
        if (!t) continue;
        const source = trusted(t, stateKey) ? segment(t) : null;
        const start = s.from - t.origin + t.pitchReference?.latency, end = start + s.to - s.from;
        const first = Math.max(0, Math.floor((start - AUDIO_MARGIN_SECONDS) * t.sampleRate));
        const last = Math.min(t.frames, Math.ceil((end + AUDIO_MARGIN_SECONDS) * t.sampleRate));
        if (source && s.from >= source.from - EPS && s.to <= source.to + EPS && last > first) {
          if (!kept.has(t.id)) kept.set(t.id, []);
          kept.get(t.id).push([first, last]);
        } else whole.add(t.id);
      }
    };
    for (const state of comps) use([...state.segments, ...(state.undo || [])], state.key);
    for (const edit of edits) for (const side of [edit.before, edit.after]) use(side?.segments, edit.key);
    return new Map([...kept].filter(([id]) => !whole.has(id)).map(([id, ranges]) => [id, pitch.mergeRanges(ranges)]));
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
  return {OFFER_VERSION, TRACK_VERSION, AUDIO_MARGIN_SECONDS, key, empty, adoptRevision, migrate, normalize, replace, clipNotes, matches, eligible, reconcile, reconcileAsync, workerSource, segmentCount,
    segment, framesFor, stats, lastSung, bindMargins, repairMargins, offer, remove, undo, protectedIds, discardable, usedAudio, validate};
});
