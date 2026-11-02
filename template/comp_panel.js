/* One row per track. A track is one practice part's comp: new recordings for
   the part selected under Practice replace the phrases they sing, and audio
   no track or Undo uses is deleted. */
((root) => {
  "use strict";
  function create(adapter) {
    const model = root.MeleteComp, pitch = root.MeleteTakePitch;
    const byId = id => document.getElementById(id);
    const layerId = state => `comp:${state.key}`;
    // Audio depends only on the passages; Undo bookkeeping never mutes a layer.
    const audioKey = state => JSON.stringify(state.segments);
    // Every reconciled target by comp key, the displayed keys in score order,
    // and the current practice part's key, which receives new recordings.
    let tracks = new Map(), shown = [], armed = null, saved = [], used = new Set(), garbage = new Set();
    let signature = "", pending = null, dirty = false, recording = false, busy = false, cloud = null, ready = false, listed = "";
    const prepared = new Map(), preparing = new Map(), rows = new Map(), statsCache = new WeakMap();
    const error = e => adapter.toast(e.message || String(e), "error");
    const label = state => adapter.trackLabel(state.descriptor.reference.part, state.descriptor.reference.line ?? null);
    function statsFor(track) {
      if (!statsCache.has(track.state)) statsCache.set(track.state, model.stats(track.state, track.sources));
      return statsCache.get(track.state);
    }
    function metrics(row, score) {
      const fmt = value => Number.isFinite(value) ? value.toFixed(1) : "\u2014";
      row.querySelector(".comp-tracked").textContent = score?.expectedSeconds ? fmt(score.coverage * 100) : "\u2014";
      row.querySelector(".comp-mean").textContent = fmt(score?.meanAbsCents);
      row.querySelector(".comp-median").textContent = fmt(score?.medianAbsCents);
      row.querySelector(".comp-within").textContent = score?.trackedSeconds
        ? fmt(score.within50CentsSeconds / score.trackedSeconds * 100) : "\u2014";
    }
    function rowFor(key) {
      if (rows.has(key)) return rows.get(key);
      const row = byId("compRowTemplate").content.firstElementChild.cloneNode(true);
      row.dataset.compKey = key;
      row.querySelector(".comp-review").addEventListener("click", () => play(key, "review"));
      row.querySelector(".take-hear").addEventListener("click", () => play(key, "hear"));
      row.querySelector(".take-download").addEventListener("click", () => play(key, "download"));
      row.querySelector(".take-delete").addEventListener("click", () => removeTrack(key));
      rows.set(key, row);
      return row;
    }
    function fill(row, track) {
      const {state, sources} = track, id = layerId(state), name = `${label(state)} track`;
      const selected = adapter.selected() === id, audible = adapter.audible(id), loading = preparing.has(state.key);
      const empty = !state.segments.length, isArmed = state.key === armed;
      const review = row.querySelector(".comp-review");
      row.classList.toggle("is-selected", selected);
      row.classList.toggle("is-armed", isArmed);
      row.classList.toggle("is-recording", isArmed && recording);
      review.setAttribute("aria-pressed", String(selected));
      review.setAttribute("aria-label", `${selected ? "Deselect" : "Review"} ${name}`);
      review.setAttribute("aria-busy", String(loading));
      review.disabled = !selected && !loading && (busy || recording || empty);
      const ids = [...new Set(state.segments.map(s => s.takeId))];
      const numbers = ids.map(takeId => sources.get(takeId)?.number).filter(Boolean).sort((a, b) => a - b);
      row.querySelector(".take-number").textContent = numbers.length === 1 ? String(numbers[0]) : ids.length ? "Comp" : "\u2014";
      row.querySelector(".take-part").textContent = label(state);
      const bounds = pitch.takeBounds(empty ? {} : {
        start: adapter.tick(state.segments[0].from * state.descriptor.reference.rate),
        end: adapter.tick(state.segments.at(-1).to * state.descriptor.reference.rate),
      });
      row.querySelector(".take-start").textContent = adapter.address(bounds.start);
      row.querySelector(".take-end").textContent = adapter.address(bounds.end);
      let summary = `${state.descriptor.label}: ${isArmed ? "new recordings replace the phrases they sing" : "choose this part under Practice to record on this track"}.`;
      try {
        const s = statsFor(track);
        metrics(row, s);
        review.dataset.completion = String(s.completion);
        if (!empty) {
          summary += ` ${(s.completion * 100).toFixed(1)}% of written singing filled from ${numbers.length === 1 ? `take ${numbers[0]}` : `takes ${numbers.join(", ")}`}. ${pitch.restLabel(s)}`;
        }
      } catch (e) { metrics(row, null); summary = e.message; }
      review.title = `${summary} Click to toggle playback and contour.`;
      adapter.octaveControl(row.querySelector(".take-octave"), empty ? null : id, name);
      const hear = row.querySelector(".take-hear");
      hear.disabled = empty || busy && !audible;
      hear.setAttribute("aria-pressed", String(audible));
      hear.setAttribute("aria-busy", String(adapter.loading(id) || loading));
      hear.title = `${audible ? "Mute" : "Hear"} ${name}. Tracks can play together, including while recording.`;
      hear.setAttribute("aria-label", `${audible ? "Mute" : "Hear"} ${name}`);
      const download = row.querySelector(".take-download");
      download.disabled = busy || recording || empty;
      download.title = `Download ${name} as WAV`;
      download.setAttribute("aria-label", download.title);
      const remove = row.querySelector(".take-delete");
      remove.disabled = busy || recording || empty && !state.track;
      remove.title = `Remove ${name}. Undo is in Take actions until the next recording.`;
      remove.setAttribute("aria-label", `Remove ${name}`);
    }
    function undoTarget() {
      return [...tracks.values()].filter(t => t.state.undo && (shown.includes(t.state.key) || t.state.key === armed))
        .sort((a, b) => (b.state.editedAt || 0) - (a.state.editedAt || 0))[0] || null;
    }
    function render() {
      const container = byId("compRows");
      for (const [key, row] of rows) {
        if (shown.includes(key)) continue;
        adapter.releaseOctave(row.querySelector(".take-octave"));
        row.remove(); rows.delete(key);
      }
      shown.forEach((key, index) => {
        const row = rowFor(key);
        if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
        fill(row, tracks.get(key));
      });
      const add = byId("addTrack"), waiting = armed && !shown.includes(armed) ? tracks.get(armed) : null;
      add.disabled = busy || recording;
      add.querySelector("span").textContent = waiting ? `${label(waiting.state)} track` : "Add track";
      add.title = waiting ? `Add a track for ${waiting.state.descriptor.label}, the part selected under Practice. Recording also adds it.`
        : "Add a track for another part; Practice switches to that part";
      add.setAttribute("aria-label", waiting ? `Add ${label(waiting.state)} track` : "Add a track for another part");
      const undoable = undoTarget();
      byId("undoComp").disabled = busy || recording || !undoable;
      byId("undoComp").querySelector("span").textContent = undoable ? `Undo ${label(undoable.state)} change` : "Undo track change";
      byId("compCloud").disabled = busy || recording;
      const configured = Boolean(adapter.cloudConfig?.api) && /^https?:$/.test(new URL(document.baseURI).protocol);
      byId('compAccount').hidden = !configured;
      byId('compAccount').inert = busy || recording;
      if (configured) makeCloud();
    }
    // A recording's descriptor follows the part, divisi line and speed chosen
    // under Practice; saved tracks at other speeds stay with that speed.
    function targets(current) {
      const result = new Map(current ? [[model.key(current), current]] : []);
      for (const s of saved) {
        const r = s.descriptor.reference;
        if (!(s.segments.length || s.track) || current && r.rate !== current.reference.rate) continue;
        const d = adapter.descriptor(r.part, r.line ?? null);
        if (d && d.reference.rate === r.rate) result.set(model.key(d), d);
      }
      return result;
    }
    async function reconcile() {
      const current = adapter.descriptor(), takes = adapter.takes();
      const stamp = JSON.stringify([[...targets(current).keys()], saved.map(s => [s.key, s.revision]),
        takes.map(t => [t.id, t.frames, t.finalized, t.deleteAfter, t.restAudioVersion, t.updatedAt,
          t.pitchContour?.analysisVersion, t.pitchScore?.meanAbsCents])]);
      if (signature === stamp) { render(); return; }
      saved = await adapter.store.comps(adapter.song());
      const wanted = targets(current), next = new Map(), replaced = [], silent = [];
      let stored = saved;
      for (const [key, descriptor] of wanted) {
        const eligible = new Map(takes.filter(t => model.eligible(t, descriptor)).map(t => [t.id, t]));
        const existing = stored.find(s => s.key === key);
        const before = JSON.stringify(existing || model.empty(descriptor));
        let state = model.migrate(model.adoptRevision(stored, descriptor, eligible, existing));
        state = model.repairMargins({...state, descriptor}, eligible);
        const backfill = (state.offerVersion || 1) < model.OFFER_VERSION;
        for (const take of [...eligible.values()].sort((a, b) => a.createdAt - b.createdAt)) {
          const offered = model.offer(state, take, eligible, {backfill});
          // Backfilling an older comp is not a new recording.
          if (offered !== state && take.replaces && !backfill) {
            if (offered.segments === state.segments) silent.push(take);
            else replaced.push({key, take});
          }
          state = offered;
        }
        if (replaced.some(r => r.key === key)) state = {...state, editedAt: Date.now()};
        state = {...state, offerVersion: model.OFFER_VERSION};
        if (JSON.stringify(state) !== before) {
          state = await adapter.store.saveComp(state);
          stored = [...stored.filter(s => s.key !== key), state];
        }
        next.set(key, {state, sources: eligible});
      }
      // One Undo level across tracks: a new recording ends every other Undo.
      if (replaced.length) stored = await dropUndo(stored, new Set(replaced.map(r => r.key)));
      saved = stored;
      const latest = adapter.descriptor();
      if ((latest && model.key(latest)) !== (current && model.key(current))) { dirty = true; return; }
      for (const [key, old] of tracks) {
        if (next.has(key) && audioKey(next.get(key).state) === audioKey(old.state)) continue;
        preparing.get(key)?.abort(); prepared.delete(key);
        adapter.mute(layerId(old.state));
        if (adapter.selected() === layerId(old.state)) adapter.clear();
      }
      for (const [key, track] of next) track.state = stored.find(s => s.key === key) || track.state;
      tracks = next;
      armed = current ? model.key(current) : null;
      const display = [...next.values()].filter(t => t.state.segments.length || t.state.track);
      if (!display.length && armed) display.push(next.get(armed));
      shown = display.sort((a, b) => a.state.descriptor.reference.part - b.state.descriptor.reference.part
        || (a.state.descriptor.reference.line ?? -1) - (b.state.descriptor.reference.line ?? -1)).map(t => t.state.key);
      used = new Set(saved.flatMap(model.protectedIds));
      garbage = new Set(model.discardable(saved, takes));
      ready = true;
      signature = stamp;
      render();
      // Track membership decides which takes the loose list shows.
      const membership = JSON.stringify([[...used], [...garbage],
        [...tracks.values()].map(t => [t.state.key, t.state.processed, t.state.freshAt])]);
      if (membership !== listed) { listed = membership; adapter.relist(); }
      if (replaced.length || silent.length) adapter.changed();
      const last = replaced.at(-1);
      if (last && !recording) {
        const track = tracks.get(last.key), passage = model.segment(last.take), rate = track.state.descriptor.reference.rate;
        adapter.toast(`${label(track.state)} track: take ${last.take.number} replaced ${adapter.address(adapter.tick(passage.from * rate))}\u2013${adapter.address(adapter.tick(passage.to * rate))}`,
          "", () => edit(last.key, model.undo));
      } else if (silent.length && !recording) {
        adapter.toast(`No singing detected in take ${silent.at(-1).number}; the track was not changed.`, "error");
      }
      if (garbage.size && !recording && !busy) {
        const deleted = await adapter.discard([...garbage]);
        if (deleted.length) { deleted.forEach(id => garbage.delete(id)); dirty = true; }
      }
      if (!cloud) {
        try { if (localStorage.getItem("melete:cloud:enabled") === "true" || localStorage.getItem('melete:cloud:visited') === 'true') void makeCloud()?.resume(); } catch {}
      }
      cloud?.changed();
    }
    async function refresh({active = false, force = false} = {}) {
      recording = active;
      if (force) signature = "";
      dirty = true;
      if (pending) return pending;
      pending = (async () => {
        while (dirty) { dirty = false; await reconcile(); }
      })().catch(error).finally(() => { pending = null; });
      return pending;
    }
    async function dropUndo(stored, keep) {
      const result = [];
      for (const s of stored) result.push(s.undo && !keep.has(s.key) ? await adapter.store.saveComp({...s, undo: null}) : s);
      return result;
    }
    async function save(key, fn) {
      const track = tracks.get(key);
      if (!track) return;
      const next = fn(track.state);
      model.validate(next, track.sources);
      const result = await adapter.store.saveComp(next);
      saved = [...saved.filter(s => s.key !== key), result];
      if (audioKey(result) !== audioKey(track.state)) {
        prepared.delete(key);
        adapter.mute(layerId(result));
        if (adapter.selected() === layerId(result)) adapter.clear();
      }
      signature = "";
      adapter.changed();
      if (key === armed) cloud?.changed();
      return result;
    }
    async function edit(key, fn) {
      if (busy || recording || !tracks.has(key)) return;
      byId("takeActions").open = false;
      busy = true; render();
      try {
        await save(key, state => ({...fn(state), editedAt: Date.now()}));
        saved = await dropUndo(saved, new Set([key]));
      } catch (e) { error(e); }
      finally { busy = false; await refresh(); }
    }
    function removeTrack(key) {
      const state = tracks.get(key)?.state;
      if (!state) return;
      if (state.segments.length) { void edit(key, model.remove); return; }
      void edit(key, s => ({...s, track: false}));
    }
    // Adding a track marks the current part's comp as a track. When that part
    // already has one, the singer first chooses another part to practise.
    async function addTrack() {
      if (busy || recording) return;
      const flag = async key => { if (tracks.has(key)) await save(key, s => ({...s, track: true})); };
      busy = true; render();
      try {
        if (armed && !shown.includes(armed)) { await flag(armed); return; }
        for (const key of shown) if (!tracks.get(key).state.track && !tracks.get(key).state.segments.length) await flag(key);
        const taken = shown.map(key => tracks.get(key).state.descriptor.reference.part);
        adapter.choosePart(taken, async () => {
          await refresh();
          if (armed && !shown.includes(armed) && !busy && !recording) {
            try { await flag(armed); } catch (e) { error(e); }
            await refresh();
          }
        });
      } catch (e) { error(e); }
      finally { busy = false; await refresh(); }
    }
    async function prepare(track) {
      const {state, sources} = track, context = adapter.context(), cacheKey = `${audioKey(state)}:${context.sampleRate}`;
      if (prepared.get(state.key)?.cacheKey === cacheKey) return {...prepared.get(state.key).review};
      const takes = new Map(sources), controller = new AbortController();
      preparing.set(state.key, controller); render();
      try {
        const audio = await root.MeleteCompAudio.prepare(context, state, takes, adapter.wav, controller.signal);
        controller.signal.throwIfAborted();
        if (audioKey(tracks.get(state.key)?.state || {}) !== audioKey(state)) throw new DOMException("Cancelled", "AbortError");
        const rate = state.descriptor.reference.rate, seconds = state.descriptor.reference.seconds;
        const review = {id: layerId(state), label: `${label(state)} track`, ref: state.descriptor.reference,
          frames: model.framesFor(state.segments, takes), ...audio, track: state.descriptor.reference.part,
          rate, start: 0, end: seconds * rate, latency: 0,
          ranges: state.segments.map(s => [s.from * rate, s.to * rate]),
          completion: statsFor(track).completion,
          timelineSegments: state.segments.map(s => ({from: s.from * rate, to: s.to * rate,
            label: `Take ${takes.get(s.takeId).number}`, takeId: s.takeId}))};
        prepared.set(state.key, {cacheKey, review});
        return {...review};
      } finally { if (preparing.get(state.key) === controller) preparing.delete(state.key); }
    }
    async function play(key, mode) {
      const track = tracks.get(key);
      if (!track) return;
      const {state} = track, id = layerId(state);
      if (preparing.has(key) && mode !== "download") { preparing.get(key).abort(); return; }
      if (mode === "hear" && adapter.audible(id)) { adapter.mute(id); return; }
      if (mode === "review" && adapter.selected() === id) { adapter.clear(); return; }
      if (!state.segments.length || recording && mode !== "hear" || busy) return;
      busy = true; render();
      try {
        const ready = await prepare(track);
        if (mode === "download") adapter.downloadBlob(ready.blob, `${state.song}-${label(state)}-track.wav`);
        else if (mode === "hear") adapter.hearReview(ready);
        else adapter.review(ready);
      } catch (e) { if (e.name !== "AbortError") error(e); }
      finally { busy = false; render(); }
    }
    byId("addTrack").addEventListener("click", () => { void addTrack(); });
    byId("undoComp").addEventListener("click", () => {
      const target = undoTarget();
      if (target) void edit(target.state.key, model.undo);
    });
    function makeCloud() {
      if (!adapter.cloudConfig?.api || !/^https?:$/.test(new URL(document.baseURI).protocol)) return null;
      return cloud ||= root.MeleteCloud.create({...adapter, state: () => tracks.get(armed)?.state || null,
        sources: () => tracks.get(armed)?.sources || new Map(),
        restored: async () => { signature = ""; await adapter.reload(); await refresh(); }});
    }
    byId("compCloud").addEventListener("click", () => {
      makeCloud()?.enter();
    });
    // Takes outside every track: older recordings, and any that could not be
    // saved, scored or used. New track takes are never left here.
    function loose(take, failed = false) {
      if (!ready || take.active || used.has(take.id) || garbage.has(take.id)) return false;
      if (take.unsaved || failed) return true;
      // Takes a track will still receive once scored are not loose yet.
      return ![...tracks.values()].some(t => model.matches(take, t.state.descriptor)
        && !t.state.processed.includes(take.id) && take.createdAt > t.state.freshAt);
    }
    render();
    return {refresh, loose, selected: render, invalidate() {
      signature = "";
      for (const controller of preparing.values()) controller.abort();
      prepared.clear();
    }, state: () => tracks.get(armed)?.state || null, sources: () => tracks.get(armed)?.sources || new Map()};
  }
  root.MeleteCompPanel = {create};
})(globalThis);
