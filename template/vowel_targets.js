/* Look up the selected singer's syllable without consulting microphone data. */
(function(root) {
  "use strict";
  const silent = new Set(["mm", "n", "nn", "(nn)", "dm"]);
  function spelling(word) {
    return word.normalize("NFC").toLowerCase().replace(/[’‘]/gu, "'")
      .replace(/^[\s.,!?:;“”"]+|[\s.,!?:;“”"]+$/gu, "");
  }
  function active(spans, tick) {
    let left = 0, right = spans.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (spans[mid].end <= tick) left = mid + 1;
      else right = mid;
    }
    const span = spans[left];
    return span && span.start <= tick ? span : null;
  }
  function syllableAt(tracks, part, tick, pitch) {
    const lanes = tracks?.[part];
    if (!lanes?.length || !Number.isFinite(tick)) return null;
    if (lanes.length === 1) return active(lanes[0].syllables, tick);
    let found = null;
    for (const lane of lanes) {
      if (pitch != null && !active(lane.notes, tick)?.pitches.includes(pitch)) continue;
      const hit = active(lane.syllables, tick);
      if (!hit) continue;
      if (found && (found.word !== hit.word || found.index !== hit.index)) return null;
      found = hit;
    }
    return found;
  }
  function pronunciations(lexicon, syllable) {
    const key = spelling(syllable.word);
    if (silent.has(key)) return [];
    const nuclei = Object.hasOwn(lexicon, key) && lexicon[key];
    if (!nuclei || nuclei.length !== syllable.count) return null;
    const value = nuclei[syllable.index];
    return value === "-" ? [] : value.split("/");
  }
  const notation = value => value.replaceAll(">", " → ").replace("( → ", " (→ ");
  function landmarks(data, variant, group) {
    // A parenthesized release is optional. Keep the cue even without a measured point.
    const steps = variant.replace(/[(]/gu, "").replace(/[)]/gu, "").split(">");
    const optional = variant.indexOf("(");
    const mandatory = optional < 0 ? steps.length : variant.slice(0, optional).split(">").length;
    return steps.map((symbol, index) => {
      const anchor = data.trajectoryAnchors?.[variant]?.[symbol] ?? data.anchors[symbol];
      const point = anchor?.[group];
      const hz = Array.isArray(point) && point.length === 2 && point.every(n => Number.isFinite(n) && n > 0)
        ? {f1: point[0], f2: point[1]} : null;
      return {symbol, hz, optional: index >= mandatory};
    });
  }
  const api = {syllableAt, pronunciations, landmarks, notation, spelling};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteVowelTargets = api;
})(typeof window === "object" ? window : globalThis);
