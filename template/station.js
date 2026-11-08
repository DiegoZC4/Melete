/* Named station singers keep a baseline, a working track and their own mix.
   Historical Final tracks remain reviewable and exportable. */
((root) => {
  "use strict";
  const STAGES = [["start", "Start"], ["scratchpad", "Scratchpad"], ["final", "Final"]];
  const COLUMN_KEY = "melete:station:column";
  const COLUMNS = ["singer", "voice_part", "stage", "song", "part", "layer", "speed_percent", "bars", "recordings",
    "segments", "filled_percent", "sung_seconds", "tracked_seconds", "tracked_percent", "tracked_of_passage_percent",
    "mean_cents", "median_cents", "within_50_cents_percent", "created", "modified"];
  const stageLabel = id => STAGES.find(([stage]) => stage === id)?.[1] || "";
  const stageRank = id => STAGES.findIndex(([stage]) => stage === id);
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  function requested(search = root.location?.search || "") {
    const query = new URLSearchParams(search);
    return root.MELETE_STATION === true || (query.get("mode") ?? (query.has("station") ? "station" : "")) === "station";
  }
  const singerId = name => String(name || "").normalize("NFKD").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  function clean(entry) {
    const name = String(entry?.name || "").trim(), id = singerId(name);
    return id ? {id, name, voice: String(entry?.voice || "").trim(), ...(entry?.guide ? {guide:String(entry.guide)} : {})} : null;
  }
  function merge(...lists) {
    const singers = new Map();
    for (const singer of lists.flat().map(clean).filter(Boolean)) {
      if (!singers.get(singer.id)?.voice) singers.set(singer.id, singer);
    }
    return [...singers.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base", numeric: true}));
  }
  const families = {S:"Soprano", A:"Alto", T:"Tenor", B:"Bass"};
  function partCode(voice) {
    const match = /^(s(?:oprano)?|a(?:lto)?|t(?:enor)?|b(?:ass)?)\s*([12]?)$/i.exec(String(voice || "").trim());
    return match ? match[1][0].toUpperCase() + match[2] : String(voice || "").trim();
  }
  function songRoster(data, song) {
    const assignments = data?.assignments || {};
    const members = parts => Object.entries(parts || {}).flatMap(([voice, names]) =>
      names.map(name => ({name, voice})));
    // Only inherit SATB when explicitly configured. The destination piece's
    // own assignments take priority, so individual exceptions are editable.
    const sections = members(assignments[data?.sectionFrom?.[song]]).map(({name,voice}) =>
      ({name, voice:partCode(voice).replace(/^([SATB])[12]$/, "$1"), guide:partCode(voice)}));
    return merge(members(assignments[song]), sections, data?.singers || [],
      Object.values(assignments).flatMap(members).map(({name}) => ({name})));
  }
  function partOrder(voice) {
    const code = partCode(voice), rank = ["S","A","T","B"].indexOf(code[0]);
    return rank < 0 ? 99 : rank * 3 + (Number(code[1]) || 0);
  }
  function guideChannel(singer, channels, last = -1) {
    const code = partCode(singer?.voice);
    const labels = channels.map(c => [partCode(c.short), partCode(c.name)]);
    const exact = value => value ? labels.findIndex(names => names.some(n=>n.toLowerCase()===value.toLowerCase())) : -1;
    for (const value of [code, partCode(singer?.guide)]) {
      const i=exact(value); if (i >= 0) return i;
    }
    if (!code) return last;
    const family = /^[SATB][12]?$/.test(code) ? code[0] : "";
    const familyChannels=labels.flatMap((names,i)=>names.some(n=>/^[SATB][12]?$/.test(n) && n[0]===family) ? [i] : []);
    return familyChannels.length === 1 ? familyChannels[0] : familyChannels.includes(last) ? last : -1;
  }
  const mixes = root.MeletePracticeMix || (typeof require==="function" && require("./practice_mix.js"));
  function guideMix(channels, i, preset = mixes.factory, roles = []) {
    return {visibleChannels:channels.map((_,index)=>index===i), audible:channels.map(()=>true),
      ...mixes.project(channels,i,typeof preset==="number"?{myVol:preset}:preset,roles),
      practiceMixMode:null,practiceMixPart:null,practiceMixUndo:null};
  }
  function untouchedFirstPreset(profile, channels, index) {
    if (profile?.guideVersion!==1 || index<0) return false;
    const first=guideMix(channels,index,100);
    return ["volumes","pans","audible"].every(key=>first[key].every((v,i)=>v===profile[key]?.[i]));
  }
  function followsOldDefault(profile,channels,index,preset,roles) {
    if (!profile || index<0 || profile.practiceMixMode) return false;
    const previous=guideMix(channels,index,profile.guidePreset || mixes.factory,roles);
    const next=guideMix(channels,index,preset,roles);
    return ["pans","volumes"].some(key=>next[key].some((v,i)=>v!==previous[key][i]))
      && ["volumes","pans","audible"].every(key=>previous[key].every((v,i)=>v===profile[key]?.[i]));
  }
  function search(singers, query) {
    const exact = partCode(query);
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return singers.filter(s => {
      const code = partCode(s.voice), spelled = [families[code[0]], code.slice(1)].filter(Boolean).join(" ");
      if (/^[SATB][12]?$/u.test(exact)) return exact.length === 1 ? code.startsWith(exact) : code === exact;
      return words.every(word => `${s.name} ${s.voice} ${code} ${spelled}`.toLowerCase().includes(word));
    }).sort((a,b) => partOrder(a.voice) - partOrder(b.voice) || a.name.localeCompare(b.name, undefined, {sensitivity:"base"}));
  }
  const slotFor = (id, stage) => `station:${id}:${stage}`;
  const descriptor = (base, singer, stage) => ({...base, slot: slotFor(singer.id, stage),
    station: {id: singer.id, name: singer.name, voice: singer.voice, stage}});
  function recordingPlan(spec, singer) {
    if (!singer) return spec;
    const assignment = stage => ({trackSlot: slotFor(singer.id, stage), station: {...singer, stage}});
    if (spec.mode !== "loop" || singer.stage !== "start") return {...spec, ...assignment(singer.stage)};
    // TakeJournal applies initial only to pass one. Later passes cannot race
    // the asynchronous scoring of the baseline, even when the loop is short.
    return {...spec, ...assignment("scratchpad"), initial: {...spec.initial, ...assignment("start")}};
  }
  // Keeps one singer's stages together, in order, for each part.
  const sortName = (station, reference) => station
    ? `${station.name} ${reference.part} ${reference.line ?? 0} ${stageRank(station.stage)}` : null;

  function trackSinger(state,sources) {
    if (state.descriptor.station) return state.descriptor.station;
    let singer=null;
    for (const segment of state.segments) {
      const p=sources?.get(segment.takeId)?.performer;
      if (!p?.id || singer && p.id!==singer.id) return null;
      singer=p;
    }
    return singer;
  }

  const number = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "";
  const stamp = value => Number.isFinite(value) ? new Date(value).toISOString() : "";
  function summary({song, state, part, bars, score, dates, singer=state.descriptor.station}) {
    const {station, reference, layerNumber} = state.descriptor;
    const metrics = (root.MeleteTakeControls || require("./take_controls.js")).metricValues(score);
    const sung = score ? score.completion * score.totalExpectedSeconds : null;
    return {singer: singer?.name || "", voice_part: singer?.voice || "", stage: stageLabel(station?.stage),
      song, part, layer: layerNumber || "", speed_percent: number(reference.rate * 100, 0), bars,
      recordings: state.processed.length, segments: score?.segmentCount ?? "",
      filled_percent: number(score ? score.completion * 100 : null), sung_seconds: number(sung),
      tracked_seconds: number(score?.trackedSeconds), tracked_percent: number(metrics.tracked),
      // Tracked (%) is of the whole part, so a short passage always reads low.
      tracked_of_passage_percent: number(sung > 0 ? Math.min(100, score.trackedSeconds / sung * 100) : null),
      mean_cents: number(metrics.mean), median_cents: number(metrics.median),
      within_50_cents_percent: number(metrics.within), created: stamp(dates.createdAt), modified: stamp(dates.updatedAt)};
  }
  function csvCell(value) {
    let text = String(value);
    if (typeof value === "string" && /^(?:[\t\r\n]|\s*[=+@-])/u.test(text.normalize("NFKC"))) text = "'" + text;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  const csv = rows => [COLUMNS, ...rows.map(row => COLUMNS.map(column => row[column] ?? ""))]
    .map(cells => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";

  function create({song, allowed = true, stageFor, changed, playback = null}) {
    const byId = id => document.getElementById(id);
    const picker = byId("stationPicker"), input = byId("stationSinger"), list = byId("stationSingerList");
    const enabled = allowed && requested();
    if (enabled && root === root.top) {
      const address = new URL(root.location.href);
      if (address.searchParams.has("station")) {
        address.searchParams.delete("station");
        address.searchParams.set("mode", "station");
        root.history.replaceState(root.history.state, "", address.href);
      }
    }
    const stateKey = `melete:station:${song()}`, mixKey = `melete:station-mix:${song()}`;
    let roster = [], known = [], singer = null, stage = "start", query = null, active = -1, items = [], columnOn = false;
    let settled = false, owner = "", applying = false, lastMix = "", rosterReady = false, handoff = 0, guidePreset;
    let handoffReady = Promise.resolve();
    const profileKey = id => `${mixKey}:${id ? "singer:" + id : "ordinary"}`;
    const profile = () => JSON.stringify({...playback.capture(), ...(owner ? {guideVersion:2,guidePreset} : {})});
    function storedMix(id) {
      try {
        const profile = read(profileKey(id));
        if (profile) return JSON.parse(profile);
        const legacy = JSON.parse(read(mixKey) || "null");
        return id ? (Object.hasOwn(legacy?.singers || {}, id) ? legacy.singers[id] : null) : legacy?.ordinary;
      } catch { return null; }
    }
    // Ownership is local to this player. Independent storage keys also prevent
    // two tabs saving different singers from overwriting each other's profiles.
    function own(next, startup = false) {
      owner = next;
      const personal = storedMix(next), mix = personal || (next && storedMix(""));
      guidePreset = mixes.stationDefault();
      applying = true;
      try { if (mix || next) playback.apply(mix || playback.capture(), {startup, singer:next ? singer : null, personal}); }
      finally { applying = false; }
      lastMix = profile();
      write(profileKey(next), lastMix);
    }
    const tracking = () => enabled || read(profileKey("")) !== null || read(mixKey) !== null;
    function settle(startup = true) {
      if (settled || !playback?.ready() || (enabled && (root.frameElement?.inert || (singer && !rosterReady)))) return;
      settled = true;
      if (!tracking()) return;
      if (!read(profileKey(""))) write(profileKey(""), JSON.stringify(storedMix("") || playback.capture()));
      own(enabled && singer ? singer.id : "", startup);
    }
    function playbackChanged() {
      if (!settled || applying || !tracking()) return;
      const next = profile();
      if (next !== lastMix) write(profileKey(owner), next);
      lastMix = next;
    }
    function sync() {
      if (document.activeElement !== input) input.value = singer?.name || "";
      input.title = singer ? `Recording for ${singer.name}` : "Recordings go to the ordinary track";
    }
    function remember() {
      const value = JSON.stringify(singer ? {...singer, stage} : null);
      try { sessionStorage.setItem(stateKey, value); } catch {}
      write(stateKey, value);
    }
    function paint() {
      const singers = merge(roster, known), typed = clean({name: query});
      const partQuery = /^[SATB][12]?$/u.test(partCode(query));
      items = [...search(singers, query), ...(typed && !partQuery && !singers.some(s => s.id === typed.id) ? [{...typed, add: true}] : [])];
      active = Math.min(active, items.length - 1);
      list.replaceChildren(...items.map((item, index) => {
        const option = document.createElement("div"), name = document.createElement("span"), voice = document.createElement("span");
        option.id = `stationOption${index}`; option.className = "station-option"; option.dataset.index = String(index);
        option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === active));
        name.textContent = item.add ? `Add “${item.name}”` : item.name;
        voice.textContent = partCode(item.voice) || "\u2013"; voice.title = item.voice || "No part listed";
        option.setAttribute("aria-label", [item.voice, name.textContent].filter(Boolean).join(", "));
        option.append(voice, name);
        return option;
      }));
      if (active >= 0) input.setAttribute("aria-activedescendant", `stationOption${active}`);
      else input.removeAttribute("aria-activedescendant");
      list.children[active]?.scrollIntoView({block: "nearest"});
    }
    function open(text = null) {
      query = text; active = String(text || "").trim() ? 0 : -1;
      paint();
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    }
    function close() {
      query = null; active = -1; list.hidden = true;
      input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
    }
    const announce = () => document.dispatchEvent(new CustomEvent("melete:station-person", {detail:singer?.name || null}));
    function pick(item, {received=false, preservePart=false} = {}) {
      ++handoff;
      const next = clean(item), same = next?.id === singer?.id;
      input.value = next?.name || "";
      close();
      if (!same || next) {
        singer = next;
        // Their mix first: it can change the part and speed the stage is read from.
        const alreadySettled = settled;
        settle(preservePart);
        if (alreadySettled) own(singer?.id || "", preservePart);
        if (singer) stage = stageFor(singer);
        remember();
      }
      input.blur(); sync();
      if (!same || next) changed(!same);
      if (!received) announce();
    }
    input.addEventListener("focus", () => { input.select(); open(); });
    // Chrome drops focus's selection on mouseup, and typing must replace the name.
    input.addEventListener("click", () => { if (list.hidden) open(); if (query === null) input.select(); });
    input.addEventListener("input", () => open(input.value));
    input.addEventListener("blur", () => {
      const cleared = !input.value.trim();
      close();
      if (cleared && singer) pick(null); else sync();
    });
    input.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) open();
        if (items.length) active = (active + (event.key === "ArrowDown" ? 1 : items.length - (active < 0 ? 0 : 1))) % items.length;
        paint();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!list.hidden && items[active]) pick(items[active]);
        else if (!input.value.trim()) pick(null);
        else { close(); input.blur(); }
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        close(); input.value = singer?.name || ""; input.blur();
      }
    });
    // Keep focus in the field until the click has chosen a singer.
    list.addEventListener("mousedown", event => event.preventDefault());
    list.addEventListener("click", event => {
      const option = event.target.closest(".station-option");
      if (option) pick(items[Number(option.dataset.index)]);
    });
    if (enabled) {
      let saved = null;
      let tabChoice = null;
      try { tabChoice = sessionStorage.getItem(stateKey); } catch {}
      try { saved = JSON.parse(tabChoice ?? read(stateKey) ?? "null"); } catch {}
      singer = clean(saved);
      if (saved?.stage === "scratchpad" || saved?.stage === "final") stage = "scratchpad";
      try { sessionStorage.setItem(stateKey, JSON.stringify(singer ? {...singer, stage} : null)); } catch {}
      // The roster stays beside the local build; it is never part of a player.
      const loaded = handoffReady = fetch(new URL("station-roster.json", document.baseURI), {cache: "no-store"})
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          roster = songRoster(data, song());
          const updated = singer && roster.find(s => s.id === singer.id);
          if (updated?.voice) { singer = updated; remember(); sync(); }
          if (!list.hidden) paint();
        }).catch(() => {}).finally(()=>{ rosterReady=true; settle(); });
      document.addEventListener("melete:station-visit", event => {
        const {name, linkedPart} = event.detail, ticket = ++handoff;
        if (name === undefined) { settle(); announce(); return; }
        handoffReady = loaded.then(() => {
          if (handoff !== ticket || root.frameElement?.inert) return;
          const next = roster.find(s=>s.id===singerId(name)) || clean({name});
          if (next || singer) pick(next,{received:true,preservePart:linkedPart});
          else settle();
        });
      });
      sync();
    }
    // One-way: named data or one visit with the parameter keeps the column on.
    function render({singers, named, disabled}) {
      if (!columnOn && (enabled || named || read(COLUMN_KEY) === "true")) {
        columnOn = true;
        write(COLUMN_KEY, "true");
      }
      known = singers;
      byId("stationExport").hidden = !columnOn; picker.hidden = !enabled;
      input.disabled = disabled;
      return columnOn;
    }
    function advance(firstSlot) {
      if (!singer || stage !== "start" || firstSlot !== slotFor(singer.id, stage)) return false;
      stage = "scratchpad";
      remember(); sync();
      return true;
    }
    return {render, advance, settle, playbackChanged, pick, choices:()=>merge(roster, known), enabled,
      refreshMix:()=>{if(enabled && settled && owner)own(owner);},
      handoffReady:()=>handoffReady,
      verifyStage() {
        if (!singer) return false;
        const next=stageFor(singer);
        if (next===stage) return false;
        stage=next; remember(); sync(); return true;
      },
      current: () => enabled && singer ? {...singer, stage} : null,
      descriptor: base => enabled && singer ? descriptor(base, singer, stage) : null};
  }
  const api = {STAGES, COLUMNS, stageLabel, requested, singerId, clean, merge, partCode, songRoster, guideChannel, guideMix, untouchedFirstPreset, followsOldDefault, search, descriptor, recordingPlan, sortName, trackSinger, summary, csv, create};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteStation = api;
})(globalThis);
