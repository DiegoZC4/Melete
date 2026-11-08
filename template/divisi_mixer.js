/* Mixer channels are independent of notation staves and saved score references. */
((root) => {
  "use strict";
  function channels(parts, analyses) {
    return parts.flatMap((part, source) => Array.from({length: analyses[source]?.maxLines || 1}, (_, line) => {
      const divided = analyses[source]?.maxLines > 1;
      return {...part, source, line: divided ? line : null,
        name: `${part.name}${divided ? `${/\d$/u.test(part.name) ? " Div " : " "}${line + 1}` : ""}`,
        short: `${part.short}${divided ? line + 1 : ""}`};
    }));
  }
  function preferences(stored, channels, partCount) {
    if (channels.length === partCount || stored.mixerChannels === 1) return stored;
    const next = {...stored, mixerChannels: 1, practiceMixMode: null, practiceMixUndo: null};
    for (const key of ["audible", "volumes", "pans"]) {
      if (stored[key]?.length === partCount) next[key] = channels.map(c => stored[key][c.source]);
    }
    return next;
  }
  function route(notes, channels, filter) {
    const groups = new Map();
    channels.forEach((channel, index) => {
      const selected = filter(notes.filter(n => n.track === channel.source), channel.source, channel.line);
      for (const note of selected) {
        const key = JSON.stringify([note.track, note.key, note.start, note.end, note.velocity,
          note.segments?.map(s => [s.key, s.start, s.end, s.velocity])]);
        if (!groups.has(key)) groups.set(key, {...note, mixChannels: []});
        groups.get(key).mixChannels.push(index);
      }
    });
    return [...groups.values()].sort((a,b) => a.start - b.start || a.track - b.track);
  }
  const api = {channels, preferences, route};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteDivisiMixer = api;
})(globalThis);
