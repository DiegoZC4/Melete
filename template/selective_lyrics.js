/* Personal lyric masks never alter source text, spacing, notes or playback. */
const selectiveLyricTools = (() => {
  const location = (part, tick, verse) => `${part}:${Math.round(tick)}:${verse}`;

  function index(lyrics, parts = []) {
    const words = [], events = new Map(), lanes = new Map();
    for (const [part, tick, verse, raw] of lyrics || []) {
      const text = String(raw || "").trim();
      if (!text || !Number.isFinite(tick)) continue;
      const lane = location(part, 0, verse);
      if (!lanes.has(lane)) lanes.set(lane, []);
      lanes.get(lane).push({ part, tick, verse, text });
    }
    for (const lane of lanes.values()) {
      lane.sort((a, b) => a.tick - b.tick);
      let pending = [];
      const finish = () => {
        if (!pending.length) return;
        const first = pending[0];
        const text = pending.map(event => event.text.replace(/[-\u2010\u2011]\s*$/u, "")).join("");
        const key = JSON.stringify([parts[first.part]?.id ?? first.part, first.verse,
          pending.map(event => [Math.round(event.tick), event.text])]);
        const word = { id: words.length, key, text, events: pending };
        words.push(word);
        pending.forEach(event => events.set(location(event.part, event.tick, event.verse), word));
        pending = [];
      };
      const seen = new Set();
      for (const event of lane) {
        const at = location(event.part, event.tick, event.verse);
        if (seen.has(at)) continue;
        seen.add(at);
        pending.push(event);
        if (!/[-\u2010\u2011]\s*$/u.test(event.text)) finish();
      }
      finish();
    }
    return { words, events, keys: new Set(words.map(word => word.key)) };
  }

  function restore(values, validKeys) {
    return new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && validKeys.has(value)));
  }

  function toggle(hidden, keys) {
    const next = new Set(hidden), reveal = keys.every(key => next.has(key));
    keys.forEach(key => reveal ? next.delete(key) : next.add(key));
    return next;
  }

  function hitBox(box) {
    return { x: box.x - 2, y: box.y, width: box.width + 4, height: Math.max(box.height, 22) };
  }

  function contains(box, x, y) {
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  }

  return { index, location, restore, toggle, hitBox, contains };
})();

if (typeof module === "object" && module.exports) module.exports = selectiveLyricTools;

let lyricWordIndex = selectiveLyricTools.index([]);
let hiddenLyricWords = new Set();
let lyricEditing = false;

function prepareSelectiveLyrics() {
  lyricWordIndex = selectiveLyricTools.index(sequence.lyrics, parts);
  restoreHiddenLyrics([...hiddenLyricWords]);
}

function restoreHiddenLyrics(values) {
  hiddenLyricWords = selectiveLyricTools.restore(values, lyricWordIndex.keys);
  updateHiddenLyrics();
}

function lyricWordAt(part, tick, verse) {
  return lyricWordIndex.events.get(selectiveLyricTools.location(part, tick, verse));
}

function updateHiddenLyrics() {
  for (const root of [elements.score, elements.barScore]) {
    root.classList.toggle("can-edit-lyrics", lyricEditing);
    root.querySelectorAll(".lyric-toggle").forEach(group => {
      const words = group.dataset.lyricWords.split(",").map(id => lyricWordIndex.words[Number(id)]).filter(Boolean);
      const hidden = words.length > 0 && words.every(word => hiddenLyricWords.has(word.key));
      group.classList.toggle("is-lyric-hidden", hidden);
      group.setAttribute("aria-pressed", String(hidden));
      group.setAttribute("aria-disabled", String(!lyricEditing));
      group.setAttribute("tabindex", lyricEditing ? "0" : "-1");
      group.setAttribute("aria-label", hidden ? "Show hidden lyric" : `Hide lyric: ${words[0]?.text || ""}`);
    });
  }
  const reset = document.getElementById("showAllLyrics");
  if (reset) reset.disabled = hiddenLyricWords.size === 0;
  document.getElementById("lyricEditing")?.setAttribute("aria-pressed", String(lyricEditing));
}

function setLyricEditing(value, { persist = true } = {}) {
  lyricEditing = value === true;
  updateHiddenLyrics();
  if (persist) savePreferences();
}

function lyricInteractionTarget(event) {
  const group = event.target.closest(".lyric-toggle");
  if (!lyricEditing || !group) return null;
  // Glyph hit boxes and lyric padding can overlap; the actual note always wins.
  if (group.closest("#score")) {
    const note = standardNoteAtClientPoint(event.clientX, event.clientY);
    const b = note?.box, origin = elements.score.getBoundingClientRect();
    if (b && selectiveLyricTools.contains({x:b.x,y:b.y,width:b.w,height:b.h},
      event.clientX-origin.left+elements.score.scrollLeft,
      event.clientY-origin.top+elements.score.scrollTop)) return null;
    if (note?.rangeNode) return null;
  } else {
    const notes = group.closest("svg")?.querySelectorAll(".bar-note") || [];
    if ([...notes].some(note => selectiveLyricTools.contains(note.getBoundingClientRect(), event.clientX, event.clientY))) return null;
  }
  return group;
}

function decorateLyric(group, words) {
  if (!words.length || group.classList.contains("lyric-toggle")) return;
  const text = group.querySelector("text");
  if (!text) return;
  const box = text.getBBox();
  if (!(box.width > 0 && box.height > 0)) return;
  group.classList.add("lyric-toggle");
  group.dataset.lyricWords = [...new Set(words.map(word => word.id))].join(",");
  group.dataset.lyricParts = [...new Set(words.map(word => word.events[0].part))].join(",");
  group.setAttribute("role", "button");
  group.setAttribute("tabindex", "0");
  group.setAttribute("data-help", "Hide this word; tap its blank to restore.");
  text.classList.add("lyric-toggle-text");
  group.insertBefore(createSvgElement("rect", { class: "lyric-toggle-hit", ...selectiveLyricTools.hitBox(box),
    fill: "transparent", "aria-hidden": "true" }), text);
  group.append(createSvgElement("line", { class: "lyric-placeholder", x1: box.x,
    x2: box.x + box.width, y1: box.y + box.height - 1, y2: box.y + box.height - 1,
    "aria-hidden": "true" }));
}

function decorateStandardLyrics() {
  elements.score.querySelectorAll(".at-surface-svg text:not(.music-glyph-hit-through)").forEach(text => {
    if (/^[\s\uE000-\uF8FF]+$/u.test(text.textContent)) text.classList.add("music-glyph-hit-through");
  });
  elements.score.querySelectorAll(".selective-lyric-source:not(.lyric-toggle)").forEach(group => {
    const id = [...group.classList].find(name => /^lyric-word-\d+$/.test(name));
    const word = id && lyricWordIndex.words[Number(id.slice(11))];
    if (word) decorateLyric(group, [word]);
  });
  updateHiddenLyrics();
}

function decoratePitchBarLyrics() {
  elements.barScore.querySelectorAll(".bar-lyric-text").forEach(text => {
    const word = lyricWordAt(Number(text.dataset.track), Number(text.dataset.tick), Number(text.dataset.verse));
    if (!word || text.parentElement.classList.contains("lyric-toggle")) return;
    const group = createSvgElement("g");
    text.replaceWith(group);
    group.append(text);
    decorateLyric(group, [word]);
  });
  updateHiddenLyrics();
}

function installSelectiveLyrics(lyricEffect) {
  const create = lyricEffect.createNewGlyph;
  lyricEffect.createNewGlyph = function (settings, beat) {
    const glyph = create.call(this, settings, beat);
    if (!beat.voice) return glyph;
    const paint = glyph.paint;
    glyph.paint = function (cx, cy, canvas) {
      const fill = canvas.fillText;
      const verses = (beat.lyrics || []).flatMap((text, verse) => text ? [verse] : []);
      let line = 0;
      canvas.fillText = function (...args) {
        const word = lyricWordAt(beat.voice.bar.staff.track.index, beat.absolutePlaybackStart, verses[line++]);
        if (!word) return fill.apply(this, args);
        this.beginGroup(`selective-lyric-source lyric-word-${word.id}`);
        try { return fill.apply(this, args); } finally { this.endGroup(); }
      };
      try { return paint.call(this, cx, cy, canvas); } finally { canvas.fillText = fill; }
    };
    return glyph;
  };

  const activate = group => {
    const words = group.dataset.lyricWords.split(",").map(id => lyricWordIndex.words[Number(id)]).filter(Boolean);
    hiddenLyricWords = selectiveLyricTools.toggle(hiddenLyricWords, words.map(word => word.key));
    updateHiddenLyrics();
    savePreferences();
  };
  for (const root of [elements.score, elements.barScore]) {
    let press = null;
    root.addEventListener("pointerdown", event => {
      press = null;
      const group = lyricInteractionTarget(event);
      if (!group) return;
      // Preserve native touch scrolling, but never audition or seek a lyric.
      event.stopPropagation();
      press = { group, x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
    }, true);
    root.addEventListener("pointermove", event => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) press.moved = true;
    }, true);
    root.addEventListener("pointercancel", () => { if (press) press.moved = true; }, true);
    root.addEventListener("click", event => {
      const group = lyricInteractionTarget(event);
      if (!group) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.detail || press?.group === group && !press.moved) activate(group);
      press = null;
    }, true);
    root.addEventListener("keydown", event => {
      const group = event.target.closest(".lyric-toggle");
      if (!lyricEditing || !group || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) activate(group);
    }, true);
  }
  const editingToggle = document.getElementById("lyricEditing");
  editingToggle?.addEventListener("click", () => setLyricEditing(!lyricEditing));
  registerResetTarget(editingToggle, "word hiding", (state, defaults) => {
    state.lyricEditing = defaults.lyricEditing;
  });
  document.getElementById("showAllLyrics")?.addEventListener("click", () => {
    restoreHiddenLyrics([]);
    savePreferences();
  });
  updateHiddenLyrics();
}
