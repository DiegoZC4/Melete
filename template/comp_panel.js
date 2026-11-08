/* One row per track. A track is one practice part's comp: new recordings for
   the part selected in See replace the phrases they sing, and audio
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
    let signature = "", pending = null, dirty = false, recording = false, busy = false, cloud = null, ready = false, listed = "", cloudKey = null;
    let practiceIdentity = null, autoReview = null, landedStartSlot = null;
    let revealSinger = false, checkSingerRoute = false, correcting = null;
    let history = {past: [], future: [], revision: 0};
    let historyBudgetStamp = "", usedAudioStamp = "";
    const prepared = new Map(), preparing = new Map(), rows = new Map(), statsCache = new WeakMap();
    const metricChanges = new Map();
    const contourVersions = new WeakMap();
    let contourVersion = 0;
    function sourceVersion(take) {
      const contour = take.pitchContour;
      if (contour && !contourVersions.has(contour)) contourVersions.set(contour, ++contourVersion);
      return [take.id, take.frames, take.updatedAt, contourVersions.get(contour), take.pitchScore?.scoringVersion,take.performer?.id];
    }
    const slotKey = `melete:track-slots:${adapter.song()}`;
    let slots = {};
    try { slots = JSON.parse(localStorage.getItem(slotKey) || "{}"); } catch {}
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) slots = {};
    const identity = d => JSON.stringify([d.reference.part, d.reference.line ?? null]);
    const stations = root.MeleteStation;
    // Only the station picker arms a named track. Reviewing another singer's
    // row, or loading without ?station, must never move recordings onto it.
    const station = stations.create({song: adapter.song, allowed: !adapter.audition?.(), stageFor, changed: stationChanged,
      playback: adapter.playback || null});
    root.MeleteTakeControls.tablePreferences(byId("takePanel"), !adapter.audition?.() && stations.requested());
    function currentDescriptor() {
      const d = adapter.descriptor();
      const named = d && station.descriptor(d);
      if (named) return named;
      return d && slots[identity(d)] ? {...d, slot: slots[identity(d)]} : d;
    }
    const error = e => adapter.toast(e.message || String(e), "error");
    const label = state => adapter.trackLabel(state.descriptor.reference.part, state.descriptor.reference.line ?? null)
      + (!state.descriptor.station && state.descriptor.slot ? ` \u00b7 ${state.descriptor.layerNumber || 2}` : "");
    const trackName = state => [state.descriptor.station?.name, label(state),
      state.descriptor.station && state.firstTakeNumber ? `Take ${state.firstTakeNumber}` : ""].filter(Boolean).join(" \u00b7 ");
    function statsFor(track) {
      if (!statsCache.has(track.state)) statsCache.set(track.state, model.stats(track.state, track.sources));
      return statsCache.get(track.state);
    }
    function metrics(row, score, changes) {
      const fmt = value => Number.isFinite(value) ? value.toFixed(1) : "\u2014";
      const controls = root.MeleteTakeControls;
      for (const [name, value] of Object.entries(controls.metricValues(score))) {
        const cell = row.querySelector(`.comp-${name}`), change = changes?.[name];
        cell.classList.add("take-metric");
        cell.textContent = fmt(value);
        cell.dataset.direction = change?.direction || "";
        cell.dataset.change = change ? change.improved ? "better" : "worse" : "";
        cell.title = `${controls.metricLabels[name]}: ${Number.isFinite(value) ? value.toFixed(3) : "unavailable"}.${change ? ` ${change.description}` : ""}`;
        cell.parentElement.title = cell.title;
      }
      row.querySelector(".comp-review").setAttribute("aria-description",
        Object.values(changes || {}).map(change => change.description).join(" "));
    }
    function rowFor(key) {
      if (rows.has(key)) return rows.get(key);
      const row = byId("compRowTemplate").content.firstElementChild.cloneNode(true);
      row.dataset.compKey = key;
      row.querySelector(".comp-review").addEventListener("click", () => play(key, "review"));
      const credit = row.querySelector(".edit-take-singer");
      let singleClick;
      const editCredit=()=>{clearTimeout(singleClick); correctSinger(key);};
      credit.addEventListener("dblclick", editCredit);
      credit.addEventListener("click", e => {
        if (e.detail===0) { editCredit(); return; }
        if (e.detail!==1 || creditDialog.open) return;
        clearTimeout(singleClick);
        singleClick=setTimeout(()=>{if (credit.isConnected && !creditDialog.open && !row.querySelector(".comp-review").disabled) void play(key,"review");},450);
      });
      let lastTap=null;
      credit.addEventListener("pointerup",e=>{
        if (e.pointerType!=="touch") return;
        if (lastTap && e.timeStamp-lastTap.at<450 && Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<12) {
          lastTap=null; editCredit();
        } else lastTap={at:e.timeStamp,x:e.clientX,y:e.clientY};
      });
      credit.addEventListener("keydown", e => { if (e.key === "F2") { e.preventDefault(); correctSinger(key); } });
      adapter.hearControl(row.querySelector(".take-hear"), () => layerId(tracks.get(key).state), () => play(key, "hear"));
      row.querySelector(".take-download").addEventListener("click", () => play(key, "download"));
      row.querySelector(".take-upload").addEventListener("click", () => {
        cloudKey = key; makeCloud()?.uploadTrack();
      });
      row.querySelector(".take-delete").addEventListener("click", () => removeTrack(key));
      rows.set(key, row);
      return row;
    }
    function fill(row, track) {
      const {state, sources} = track, id = layerId(state), name = `${trackName(state)} track`, named = state.descriptor.station;
      const performer=stations.trackSinger(state,sources);
      const selected = adapter.rowSelected(id), audible = adapter.audible(id), loading = preparing.has(state.key);
      const empty = !state.segments.length, isArmed = state.key === armed;
      const preparingSinger = Boolean(named && isArmed && empty);
      row.classList.toggle("is-new",preparingSinger);
      const review = row.querySelector(".comp-review");
      row.classList.toggle("is-selected", selected);
      row.classList.toggle("is-armed", isArmed);
      row.classList.toggle("is-recording", isArmed && recording && adapter.keepingAudio());
      review.setAttribute("aria-pressed", String(selected));
      review.setAttribute("aria-label", `${selected ? "Deselect" : "Review"} ${name}`);
      review.setAttribute("aria-busy", String(loading));
      review.disabled = !selected && !loading && (busy || recording || empty);
      const ids = [...new Set(state.segments.map(s => s.takeId))];
      const numbers = ids.map(takeId => sources.get(takeId)?.number).filter(Boolean).sort((a, b) => a - b);
      row.querySelector(".take-number").textContent = preparingSinger ? "New" : String(state.firstTakeNumber ?? numbers[0] ?? "\u2014");
      const singer = row.querySelector(".take-singer");
      singer.textContent = performer?.name || "\u2014";
      singer.title = performer ? [performer.name, performer.voice].filter(Boolean).join(", ") : "";
      row.querySelector(".take-part").textContent = named ? adapter.trackLabel(state.descriptor.reference.part, state.descriptor.reference.line ?? null) : label(state);
      row.style.setProperty("--take-part-color",adapter.trackPaint(state.descriptor.reference.part,state.descriptor.reference.line ?? null));
      const credit=row.querySelector(".edit-take-singer");
      credit.hidden=!station.enabled || !performer;
      credit.disabled=busy || recording;
      credit.title=`${performer?.name || ""} · ${label(state)}. Double-click to change singer.`;
      credit.setAttribute("aria-label",`Change singer for ${name}`);
      row.querySelector(".take-segments").textContent = String(statsFor(track).segmentCount);
      root.MeleteTakeControls.showDates(row, root.MeleteTakeControls.trackDates(state, sources));
      let summary = `${state.descriptor.label}: ${isArmed ? "new recordings replace the phrases they sing" : "hold this part in See to practise it"}.`;
      try {
        const s = statsFor(track);
        metrics(row, s, metricChanges.get(state.key));
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
      hear.title = `${audible ? "Mute" : "Hear"} ${name}. Hold to isolate; hold the only audible track to hear everyone.`;
      hear.setAttribute("aria-label", `${audible ? "Mute" : "Hear"} ${name}`);
      const download = row.querySelector(".take-download");
      download.disabled = busy || recording || empty;
      download.title = `Download ${name} as WAV`;
      download.setAttribute("aria-label", download.title);
      const remove = row.querySelector(".take-delete");
      remove.disabled = busy || recording || empty && !state.track;
      remove.title = `Remove ${name}. Click twice; Undo is available.`;
      if (!remove.classList.contains("is-delete-armed")) remove.setAttribute("aria-label", `Remove ${name}`);
      remove.dataset.deleteToken = `${state.key}:${state.revision}`;
      const upload = row.querySelector(".take-upload");
      // Named singers' recordings stay on this device.
      upload.hidden = Boolean(named) || !adapter.cloudConfig?.api || !/^https?:$/.test(new URL(document.baseURI).protocol);
      upload.disabled = busy || recording || empty;
      upload.title = "Upload this track for review; sign in if needed";
      upload.setAttribute("aria-label", `Upload ${name} for review`);
    }
    function render() {
      const container = byId("compRows");
      for (const [key, row] of rows) {
        if (shown.includes(key)) continue;
        adapter.releaseOctave(row.querySelector(".take-octave"));
        row.remove(); rows.delete(key);
      }
      const scroll = byId("takePanel").querySelector(".take-review");
      const top = scroll.scrollTop, left = scroll.scrollLeft;
      const fresh = key => key === armed && tracks.get(key).state.descriptor.station && !tracks.get(key).state.segments.length;
      const sorted = [...shown].sort((a, b) => Number(Boolean(fresh(b))) - Number(Boolean(fresh(a)))
        || pitch.compareTakes(sortRecord(tracks.get(a)), sortRecord(tracks.get(b)), adapter.sort()));
      sorted.forEach((key, index) => {
        const row = rowFor(key);
        if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
        fill(row, tracks.get(key));
      });
      const add = byId("addTrack"), waiting = armed && !shown.includes(armed) ? tracks.get(armed) : null;
      add.disabled = busy || recording || Boolean(station.current());
      add.title = waiting ? `Add a track for ${waiting.state.descriptor.label}, the part selected in See. Recording also adds the first track.`
        : "Add a track for any part, including another layer of the same part";
      add.setAttribute("aria-label", waiting ? `Add ${label(waiting.state)} track` : "Add a track for another part");
      for (const [direction, entries, shortcut] of [["undo", history.past, "Cmd/Ctrl+Z"], ["redo", history.future, "Cmd/Ctrl+Shift+Z"]]) {
        const button = byId(`${direction}Comp`), edit = entries.at(-1);
        const name = direction === "undo" ? "Undo" : "Redo";
        button.disabled = busy || recording || !edit;
        button.setAttribute("aria-label", edit ? `${name} ${edit.label} change` : `${name} track change`);
        button.title = `${button.getAttribute("aria-label")} (${shortcut}); ${entries.length} edit${entries.length === 1 ? "" : "s"}. Up to 20 edits, 128 MiB of extra history audio across songs.`;
      }
      const singers=saved.flatMap(s=>stations.trackSinger(s,tracks.get(s.key)?.sources) || []);
      byId("compView").classList.toggle("has-singers", station.render({disabled: busy || recording,
        named: singers.length>0, singers}));
      byId("stationExport").disabled = busy || recording;
      const configured = Boolean(adapter.cloudConfig?.api) && /^https?:$/.test(new URL(document.baseURI).protocol);
      if (configured) makeCloud();
      const table = byId("takePanel").querySelector(".take-review");
      table.style.setProperty("--take-actions-width", configured && [...container.children].some(row => !row.querySelector(".take-upload").hidden) ? "80px" : "54px");
      root.MeleteTakeControls.fitTable(table);
      scroll.scrollTop = top; scroll.scrollLeft = left;
      if (revealSinger && rows.has(armed) && tracks.get(armed).state.descriptor.station?.id === station.current()?.id && station.current()) {
        const box=rows.get(armed).getBoundingClientRect(), pane=scroll.getBoundingClientRect();
        scroll.scrollTop=fresh(armed) ? 0 : Math.max(0,top+box.top-pane.top-byId("compView").querySelector(".comp-columns").offsetHeight);
        scroll.scrollLeft=0; revealSinger=false;
      }
    }
    function sortRecord(track) {
      const {state, sources} = track, ids = [...new Set(state.segments.map(s => s.takeId))];
      const numbers = ids.map(id => sources.get(id)?.number).filter(Number.isFinite);
      return {...root.MeleteTakeControls.trackDates(state, sources), number: state.firstTakeNumber ?? (numbers.length ? Math.min(...numbers) : null),
        part: label(state), singer: stations.trackSinger(state,sources)?.name || null,
        segmentCount: statsFor(track).segmentCount,
        pitchScore: statsFor(track)};
    }
    // A recording's descriptor follows the part, divisi line and speed chosen
    // under Practice; saved tracks at other speeds stay with that speed.
    function targets(current, takes) {
      const result = new Map(current ? [[model.key(current), current]] : []);
      for (const s of saved) {
        const r = s.descriptor.reference;
        if (!(s.segments.length || s.track) || current && r.rate !== current.reference.rate) continue;
        const base = adapter.descriptor(r.part, r.line ?? null);
        const d = base && {...base, ...(s.descriptor.slot ? {slot:s.descriptor.slot, layerNumber:s.descriptor.layerNumber} : {}),
          ...(s.descriptor.station ? {station:s.descriptor.station} : {})};
        if (d && d.reference.rate === r.rate) result.set(model.key(d), d);
      }
      // A named pass may finish scoring after the picker has moved on, or
      // after a reload. Recover its destination from the capture, not the UI.
      const seen = new Set();
      for (const take of takes) {
        const named = take.station, r = take.pitchReference;
        if (!named || !r || !take.complete || !take.finalized || stations.stageLabel(named.stage) === "") continue;
        const source = JSON.stringify([take.trackSlot, r.part, r.line, r.rate]);
        if (seen.has(source)) continue;
        const base = adapter.descriptor(r.part, r.line ?? null);
        if (!base || base.reference.rate !== r.rate) continue;
        const d = stations.descriptor(base, named, named.stage);
        if (d.slot !== take.trackSlot) {
          if (!take.trackSlot?.startsWith(d.slot+":")) continue;
          d.slot=take.trackSlot;
        }
        seen.add(source);
        result.set(model.key(d), d);
      }
      return result;
    }
    async function reconcile() {
      history = await adapter.store.compHistory(adapter.song());
      const request = autoReview;
      if (request?.initial) {
        saved = await adapter.store.comps(adapter.song());
        if (request !== autoReview) { dirty = true; return; }
        request.initial = false;
        const base = adapter.descriptor();
        const newest = base && saved.filter(s => !s.descriptor.station && identity(s.descriptor) === identity(base)
          && s.descriptor.reference.rate === base.reference.rate && (s.track || s.segments.length))
          .sort((a, b) => (b.editedAt || b.updatedAt || b.createdAt || 0) - (a.editedAt || a.updatedAt || a.createdAt || 0))[0];
        if (base) slots[identity(base)] = newest?.descriptor.slot || null;
        request.key = base ? model.key(currentDescriptor()) : null;
      }
      const current = currentDescriptor(), takes = adapter.takes();
      const stamp = JSON.stringify([[...targets(current, takes).keys()], saved.map(s => [s.key, s.revision]),
        practiceIdentity, current && model.key(current), recording,
        takes.map(t => [t.id, t.frames, t.finalized, t.deleteAfter, t.restAudioVersion, t.updatedAt,
          t.pitchContour?.analysisVersion, t.pitchScore?.meanAbsCents,t.performer?.id])]);
      if (signature === stamp && !checkSingerRoute) { render(); return; }
      saved = await adapter.store.comps(adapter.song());
      if (checkSingerRoute && !recording && !busy) {
        checkSingerRoute=false;
        if (station.verifyStage()) {
          signature=""; dirty=true;
          const d=currentDescriptor();
          if (autoReview) autoReview.key=d ? model.key(d) : null;
          return;
        }
      }
      const wanted = targets(current, takes), next = new Map(), replaced = [], silent = [];
      let stored = saved;
      for (const [key, descriptor] of wanted) {
        const eligible = new Map(takes.filter(t => model.eligible(t, descriptor)).map(t => [t.id, t]));
        const existing = stored.find(s => s.key === key);
        const inputKey = state => JSON.stringify([key, state?.revision || 0, [...eligible.values()].map(sourceVersion)]);
        const cached = tracks.get(key);
        if (cached?.inputKey === inputKey(existing)) { next.set(key, cached); continue; }
        const before = JSON.stringify(existing || model.empty(descriptor));
        const result = await model.reconcileAsync(descriptor, stored, eligible);
        let state = result.state;
        replaced.push(...result.replaced.map(id => ({key, take:eligible.get(id)})));
        silent.push(...result.silent.map(id => eligible.get(id)));
        if (JSON.stringify(state) !== before) {
          state = await adapter.store.saveComp(state, state.revision,
            {history: Boolean(result.edits.length), steps: result.edits});
          stored = [...stored.filter(s => s.key !== key), state];
        }
        statsCache.set(state, result.score);
        next.set(key, {state, sources: eligible, frames: result.frames, score: result.score, inputKey: inputKey(state)});
      }
      saved = stored;
      history = await adapter.store.compHistory(adapter.song());
      const budgetStamp = JSON.stringify([history.revision, saved.map(s => [s.key, s.revision])]);
      if (!adapter.audition?.() && budgetStamp !== historyBudgetStamp) {
        const cleanup = await adapter.store.pruneCompHistory();
        if (cleanup.removed.length) { adapter.evicted?.(cleanup.removed); dirty = true; }
        history = await adapter.store.compHistory(adapter.song());
        historyBudgetStamp = JSON.stringify([history.revision, saved.map(s => [s.key, s.revision])]);
      }
      // Recording waits: its source is still growing and the writes must not stall.
      const audioStamp = JSON.stringify([history.revision, saved.map(s => [s.key, s.revision])]);
      if (!adapter.audition?.() && !recording && audioStamp !== usedAudioStamp) {
        usedAudioStamp = audioStamp;
        // Housekeeping: a failed cleanup is reported but never stops the tracks updating.
        const trimmed = await adapter.store.trimAudio(adapter.song(), (records, comps, edits) =>
          model.usedAudio(comps, records.map(adapter.timed), edits)).catch(failure => { error(failure); return []; });
        if (trimmed.length) adapter.trimmed(trimmed);
      }
      const latest = currentDescriptor();
      if ((latest && model.key(latest)) !== (current && model.key(current))) { dirty = true; return; }
      const updates = [];
      for (const [key, old] of tracks) {
        if (next.has(key) && audioKey(next.get(key).state) === audioKey(old.state)) continue;
        preparing.get(key)?.controller.abort(); prepared.delete(key);
        if (next.get(key)?.state.segments.length) updates.push(key);
        else {
          adapter.mute(layerId(old.state));
          if (adapter.selected() === layerId(old.state)) adapter.clear();
        }
      }
      for (const [key, track] of next) {
        track.state = stored.find(s => s.key === key) || track.state;
        statsCache.set(track.state, track.score);
        const previous = tracks.get(key), controls = root.MeleteTakeControls;
        if (!previous) { metricChanges.delete(key); continue; }
        const before = statsFor(previous), after = statsFor(track);
        if (before.scoringVersion !== after.scoringVersion || before.version !== after.version) metricChanges.delete(key);
        else if (audioKey(previous.state) !== audioKey(track.state)) {
          metricChanges.set(key, controls.metricDeltas(before, after));
        } else if (JSON.stringify(controls.metricValues(before)) !== JSON.stringify(controls.metricValues(after))) {
          // Rescoring identical audio is not a singing improvement.
          metricChanges.delete(key);
        }
      }
      tracks = next;
      armed = current ? model.key(current) : null;
      const display = [...next.values()].filter(t => t.state.segments.length || t.state.track
        || t.state.key === armed && t.state.descriptor.station);
      if (!display.length && armed) display.push(next.get(armed));
      shown = display.sort((a, b) => a.state.descriptor.reference.part - b.state.descriptor.reference.part
        || (a.state.descriptor.reference.line ?? -1) - (b.state.descriptor.reference.line ?? -1)).map(t => t.state.key);
      const historyIds = root.MeleteRecording.historySources(history);
      used = new Set([...saved.flatMap(model.protectedIds), ...historyIds]);
      garbage = new Set(adapter.audition?.() ? [] : model.discardable(saved, takes, historyIds));
      ready = true;
      signature = stamp;
      render();
      const last = replaced.at(-1);
      const armedTrack = tracks.get(armed);
      if (!recording && armedTrack && adapter.pendingRecording?.(armed, armedTrack.state.processed)) {
        if (armedTrack.state.segments.length) {
          adapter.patchReview(visualReview(armedTrack), true);
          if (!updates.includes(armed)) updates.push(armed);
        } else adapter.captureSettled?.();
      }
      for (const key of updates) {
        const track = tracks.get(key), id = layerId(track.state);
        adapter.patchReview(visualReview(track), false);
        if (adapter.selected() === id || adapter.audible(id)) refreshAudio(track);
      }
      if (autoReview && !recording && !busy) {
        const {key, selection} = autoReview; autoReview = null;
        if (selection === adapter.selectionRevision() && tracks.get(key)?.state.segments.length
          && adapter.selected() !== layerId(tracks.get(key).state)) await play(key, "review", selection);
      }
      // Track membership decides which takes the loose list shows.
      const membership = JSON.stringify([[...used], [...garbage],
        [...tracks.values()].map(t => [t.state.key, t.state.processed, t.state.freshAt])]);
      if (membership !== listed) { listed = membership; adapter.relist(); }
      if (replaced.length || silent.length) adapter.changed();
      if (last && !recording) {
        const track = tracks.get(last.key), passage = model.segment(last.take), rate = track.state.descriptor.reference.rate;
        adapter.toast(`${trackName(track.state)} track: take ${last.take.number} replaced ${adapter.address(adapter.tick(passage.from * rate))}\u2013${adapter.address(adapter.tick(passage.to * rate))}`,
          "", () => stepHistory("undo"));
      } else if (silent.length && !recording) {
        adapter.captureSettled?.();
        adapter.toast(`No singing detected in take ${silent.at(-1).number}; the track was not changed.`, "error");
      }
      if (garbage.size && !recording && !busy) {
        const deleted = await adapter.discard([...garbage]);
        if (deleted.length) { deleted.forEach(id => garbage.delete(id)); dirty = true; }
      }
      // A landed Start take moves on, so the next recording keeps the baseline.
      if (current?.station?.stage === "start" && replaced.some(({key}) => key === armed)) landedStartSlot = current.slot;
      if (landedStartSlot && !recording) {
        if (station.advance(landedStartSlot)) { signature = ""; dirty = true; }
        landedStartSlot = null;
      }
      if (!cloud) {
        try { if (localStorage.getItem("melete:cloud:enabled") === "true" || localStorage.getItem('melete:cloud:visited') === 'true') void makeCloud()?.resume(); } catch {}
      }
      cloud?.changed();
    }
    async function refresh({active = false, force = false} = {}) {
      recording = active;
      const base = adapter.descriptor(), nextIdentity = base && JSON.stringify([identity(base), base.reference.rate]);
      if (nextIdentity !== practiceIdentity) {
        practiceIdentity = nextIdentity;
        checkSingerRoute=Boolean(station.current());
        // Clear the old part synchronously. Storage/audio work must never
        // override a later explicit selection while it is still loading.
        adapter.clear();
        autoReview = {initial: true, selection: adapter.selectionRevision(), key: null};
        signature = "";
      }
      if (force) signature = "";
      dirty = true;
      if (pending) return pending;
      pending = (async () => {
        while (dirty) { dirty = false; await reconcile(); }
      })().catch(error).finally(() => { pending = null; });
      return pending;
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
      } catch (e) { error(e); }
      finally { busy = false; await refresh(); }
    }
    async function stepHistory(direction) {
      if (pending) await pending;
      if (busy || recording || !history[direction === "undo" ? "past" : "future"].length) return;
      busy = true; render();
      try {
        const result = await adapter.store.stepCompHistory(adapter.song(), direction, history.revision);
        if (result) {
          history = result.history;
          saved = await adapter.store.comps(adapter.song());
          signature = ""; autoReview = null;
          adapter.changed();
        }
      } catch (e) { error(e); }
      finally { busy = false; await refresh({force: true}); }
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
        adapter.choosePart([], async () => {
          await refresh();
          if (!armed || busy || recording) return;
          try {
            if (shown.includes(armed) && tracks.get(armed).state.segments.length) {
              const d = adapter.descriptor(), slot = crypto.randomUUID();
              const siblings = [...tracks.values()].filter(t => identity(t.state.descriptor) === identity(d));
              const descriptor = {...d, slot, layerNumber:1+Math.max(1,...siblings.map(t=>t.state.descriptor.layerNumber||1))};
              const state = await adapter.store.saveComp({...model.empty(descriptor), track:true});
              saved = [...saved, state]; slots[identity(d)] = slot;
              try { localStorage.setItem(slotKey, JSON.stringify(slots)); } catch {}
              signature = "";
            } else await flag(armed);
          } catch (e) { error(e); }
          await refresh();
        });
      } catch (e) { error(e); }
      finally { busy = false; await refresh(); }
    }
    function visualReview(track) {
      const {state, sources} = track, rate = state.descriptor.reference.rate;
      const origin = Math.min(0, state.segments[0]?.from || 0);
      return {id: layerId(state), label: `${trackName(state)} track`, ref: state.descriptor.reference,
        frames: track.frames.map(f => ({...f, start:f.start - origin, end:f.end - origin})),
        track: state.descriptor.reference.part, rate, start: origin * rate,
        end: state.descriptor.reference.seconds * rate, latency: 0,
        ranges: state.segments.map(s => [s.from * rate, s.to * rate]),
        completion: statsFor(track).completion,
        timelineSegments: state.segments.map(s => ({from: s.from * rate, to: s.to * rate,
          label: `Take ${sources.get(s.takeId).number}`, takeId: s.takeId}))};
    }
    function refreshAudio(track) {
      // Publish the contour first. Decoding, splicing, WAV encoding and loudness
      // do not own table selection or block the next transport action.
      const job = preparing.get(track.state.key);
      if (job?.background && !job.controller.signal.aborted) return;
      void prepare(track).then(review => adapter.replaceAudio(review)).catch(e => {
        if (e.name !== "AbortError") error(e);
      }).finally(render);
      const pending = preparing.get(track.state.key);
      if (pending) pending.background = true;
    }
    async function prepare(track) {
      const {state, sources} = track, context = adapter.context(), cacheKey = `${audioKey(state)}:${context.sampleRate}`;
      if (prepared.get(state.key)?.cacheKey === cacheKey) return {...prepared.get(state.key).review};
      const current = preparing.get(state.key);
      if (current?.cacheKey === cacheKey && !current.controller.signal.aborted) return {...await current.promise};
      current?.controller.abort();
      const takes = new Map(sources), controller = new AbortController();
      const job = {controller, cacheKey, promise: null};
      preparing.set(state.key, job); render();
      job.promise = (async () => {
        try {
          const audio = await root.MeleteCompAudio.prepare(context, state, takes, adapter.wav, controller.signal);
          controller.signal.throwIfAborted();
          if (audioKey(tracks.get(state.key)?.state || {}) !== audioKey(state)) throw new DOMException("Cancelled", "AbortError");
          const review = {...visualReview(track), ...audio};
          prepared.set(state.key, {cacheKey, review});
          return review;
        } finally { if (preparing.get(state.key) === job) preparing.delete(state.key); }
      })();
      return {...await job.promise};
    }
    function noteExplicitSelection() {
      const base = adapter.descriptor();
      practiceIdentity = base && JSON.stringify([identity(base), base.reference.rate]);
      autoReview = null;
    }
    async function play(key, mode, expectedSelection = null) {
      adapter.cancelHearBatch();
      if (mode === "review" && expectedSelection === null) autoReview = null;
      const track = tracks.get(key);
      if (!track) return;
      const {state} = track, id = layerId(state);
      if (mode === "review" && adapter.selected() === id) {
        if (adapter.rowSelected(id)) adapter.clear();
        else if (expectedSelection === null && !recording && !busy) adapter.inspectLoaded(id);
        return;
      }
      if (preparing.has(key) && mode !== "download") { preparing.get(key).controller.abort(); return; }
      if (mode === "hear" && adapter.audible(id)) { adapter.mute(id); return; }
      if (!state.segments.length || recording && !["hear", "enable"].includes(mode) || busy) return;
      if (mode === "enable" && adapter.audible(id)) return;
      if (mode === "review") {
        if (expectedSelection === null) {
          // Explicit selection arms this exact dub; background auto-selection
          // must not pick a newer sibling while its audio is preparing.
          // Reviewing a take at a staffed station must not mute the guide or
          // silently change the next singer's scoring part.
          if (!station.current()) adapter.focusPart(state.descriptor.reference);
          noteExplicitSelection();
        }
        const current = adapter.descriptor();
        if (current && identity(current) === identity(state.descriptor) && !state.descriptor.station && !station.current()) {
          slots[identity(current)] = state.descriptor.slot || null;
          localStorage.setItem(slotKey, JSON.stringify(slots));
          armed = key;
        }
      }
      busy = true; render();
      try {
        const ready = await prepare(track);
        if (expectedSelection !== null && expectedSelection !== adapter.selectionRevision()) return;
        if (mode === "download") adapter.downloadBlob(ready.blob, `${state.song}-${trackName(state)}-track.wav`);
        else if (["hear", "enable"].includes(mode)) adapter.hearReview(ready);
        else adapter.review(ready, expectedSelection === null);
      } catch (e) { if (e.name !== "AbortError") error(e); }
      finally { busy = false; render(); }
    }
    function stageFor(singer) {
      const base = adapter.descriptor();
      const key = base && model.key(stations.descriptor(base, singer, "start"));
      if (!base) return "start";
      const ref=base.reference;
      const landing=adapter.takes().some(t=>t.station?.id===singer.id && t.station.stage==="start" && t.finalized && t.complete && !t.pitchScore && !t.deleteAfter
        && t.pitchReference?.part===ref.part && (t.pitchReference.line??null)===(ref.line??null) && t.pitchReference.rate===ref.rate);
      return landing || saved.some(s => s.key === key && s.segments.length) ? "scratchpad" : "start";
    }
    function stationChanged(personChanged) {
      revealSinger = Boolean(station.current());
      checkSingerRoute = revealSinger;
      adapter.clear();
      adapter.practicePersonChanged?.(personChanged);
      const current = currentDescriptor();
      autoReview = {initial: false, selection: adapter.selectionRevision(), key: current ? model.key(current) : null};
      void refresh({force: true});
    }
    const creditDialog=byId("takeSingerDialog"), creditInput=byId("takeSingerName");
    function correctSinger(key) {
      const track=tracks.get(key), state=track?.state, singer=track && stations.trackSinger(state,track.sources);
      if (!station.enabled || !singer || recording || busy || creditDialog.open) return;
      correcting={key,revision:state.revision,person:singer.id};
      byId("takeSingerPart").textContent=`${state.segments.length ? "Take "+state.firstTakeNumber : "New take"} · ${label(state)}`;
      byId("takeSingerOptions").replaceChildren(...station.choices().map(person=>{
        const option=document.createElement("option"); option.value=person.name; option.label=stations.partCode(person.voice); return option;
      }));
      creditInput.value=singer.name; creditInput.setCustomValidity(""); creditDialog.showModal(); creditInput.select();
    }
    byId("takeSingerCancel").onclick=()=>creditDialog.close();
    creditDialog.addEventListener("close",()=>{correcting=null;});
    creditInput.oninput=()=>creditInput.setCustomValidity("");
    creditDialog.querySelector("form").onsubmit=async event=>{
      event.preventDefault();
      const edit=correcting, state=tracks.get(edit?.key)?.state;
      if (!edit || !state || busy || recording) return;
      const typed=stations.clean({name:creditInput.value}), person=station.choices().find(s=>s.id===typed?.id) || typed;
      if (!person) { creditInput.setCustomValidity("Choose or enter a singer."); creditInput.reportValidity(); return; }
      if (edit.person===person.id) { creditDialog.close(); return; }
      if (!state.segments.length) { creditDialog.close(); station.pick(person); return; }
      busy=true; render();
      try {
        if (state.descriptor.station) await adapter.store.reassignStationTrack(edit.key,edit.revision,person,model.key);
        else await adapter.store.correctSourceCredit(edit.key,edit.revision,edit.person,person);
        const id=layerId(state); if (adapter.selected()===id) adapter.clear();
        adapter.mute(id); prepared.delete(edit.key); signature=""; autoReview=null; checkSingerRoute=true;
        creditDialog.close();
        await adapter.reload(); saved=await adapter.store.comps(adapter.song()); adapter.changed();
      } catch(e) { error(e); }
      finally { busy=false; await refresh({force:true}); }
    };
    // Every saved track at every speed, so the numbers need no later reanalysis.
    async function exportStats() {
      if (busy || recording) return;
      busy = true; render();
      try {
        const takes = adapter.takes(), song = adapter.song();
        const comps = (await adapter.store.comps(song)).filter(s => s.segments.length);
        const rows = comps.map(state => {
          const sources = new Map(takes.filter(t => model.eligible(t, state.descriptor)).map(t => [t.id, t]));
          const {part, line = null, rate} = state.descriptor.reference;
          const bars = pitch.mergeRanges(state.segments.map(s => [s.from, s.to]))
            .map(([from, to]) => `${adapter.address(adapter.tick(Math.max(0, from) * rate))}-${adapter.address(adapter.tick(to * rate))}`).join("; ");
          let score = null;
          try { score = model.stats(state, sources); } catch {}
          const singer=stations.trackSinger(state,sources);
          return {order: stations.sortName(singer, state.descriptor.reference) ?? "\uffff",
            ...stations.summary({song, state, singer, part: adapter.trackLabel(part, line), bars, score,
              dates: root.MeleteTakeControls.trackDates(state, sources)})};
        }).sort((a, b) => a.order.localeCompare(b.order, undefined, {numeric: true}));
        const date = new Date().toLocaleDateString("en-CA");
        adapter.downloadBlob(new Blob([stations.csv(rows)], {type: "text/csv"}), `${song}-summary-stats-${date}.csv`);
        adapter.toast(`Exported ${rows.length} track${rows.length === 1 ? "" : "s"}`);
      } catch (e) { error(e); }
      finally { busy = false; render(); }
    }
    byId("stationExport").addEventListener("click", () => { void exportStats(); });
    byId("addTrack").addEventListener("click", () => { void addTrack(); });
    byId("undoComp").addEventListener("click", () => { void stepHistory("undo"); });
    byId("redoComp").addEventListener("click", () => { void stepHistory("redo"); });
    function makeCloud() {
      if (!adapter.cloudConfig?.api || !/^https?:$/.test(new URL(document.baseURI).protocol)) return null;
      const cloudTrack = () => {
        const track = tracks.get(cloudKey || armed);
        return track?.state.descriptor.station ? null : track || null;
      };
      return cloud ||= root.MeleteCloud.create({...adapter, wav: adapter.rawWav || adapter.wav, state: () => cloudTrack()?.state || null,
        sources: () => cloudTrack()?.sources || new Map(),
        metadata: () => cloudTrack() ? sortRecord(cloudTrack()) : null,
        restored: async () => { signature = ""; await adapter.reload(); await refresh(); }});
    }
    // Only failed/incomplete captures need a separate recovery surface.
    // Normal sources belong to tracks/history, never an "unused" take table.
    function loose(take, failed = false) {
      if (!ready || take.active || used.has(take.id) || garbage.has(take.id)) return false;
      if (adapter.audition?.()) return true;
      return Boolean(take.unsaved || failed || !take.complete || take.gap);
    }
    render();
    return {refresh, loose, stepHistory, noteExplicitSelection, slot: () => currentDescriptor()?.slot || null, selected: render,
      stationPerson: () => station.current(),
      prepareStation:station.enabled ? async () => {
        await station.handoffReady();
        if (!station.current()) return;
        await refresh();
        saved=await adapter.store.comps(adapter.song());
        if (station.verifyStage()) await refresh({force:true});
      } : null,
      recordingPlan: spec => stations.recordingPlan(spec, station.current()),
      advanceStart: slot => station.advance(slot) ? model.key(currentDescriptor()) : null,
      settleStation: station.settle, playbackChanged: station.playbackChanged, refreshStationMix: station.refreshMix,
      layers: () => shown.filter(key => tracks.get(key).state.segments.length)
        .map(key => ({id:layerId(tracks.get(key).state), prepare: () => prepare(tracks.get(key))})), invalidate() {
      signature = "";
      for (const job of preparing.values()) job.controller.abort();
      prepared.clear();
    }, state: () => tracks.get(armed)?.state || null, sources: () => tracks.get(armed)?.sources || new Map()};
  }
  root.MeleteCompPanel = {create};
})(globalThis);
