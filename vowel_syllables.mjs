// Use the same AlphaTab beats as the player, including routed practice staves.
// MusicXML begin/middle syllables retain their joining hyphen in the builder.
const joiner = /[-\u2010\u2011]$/u;

function readLane(beats) {
  const syllables = [], notes = [];
  let current = null, pending = [];
  function finishWord(complete) {
    const word = pending.map(entry => entry.text.replace(joiner, "")).join("");
    pending.forEach((entry, index) => Object.assign(entry, {word, index, count: complete ? pending.length : 0}));
    pending = [];
  }
  for (const beat of beats) {
    const start = Math.round(beat.absolutePlaybackStart);
    const end = Math.round(beat.absolutePlaybackStart + beat.playbackDuration);
    if (!(end > start)) continue;
    if (beat.isRest || !beat.notes.length) {
      current = null;
      continue;
    }
    notes.push({start, end, pitches: beat.notes.map(note => note.realValue)});
    const text = beat.lyrics?.[0]?.trim();
    if (text) {
      current = {start, end, text};
      syllables.push(current);
      pending.push(current);
      if (!joiner.test(text)) finishWord(true);
    } else if (current && current.end === start) {
      // Another sounding beat under the same syllable, including across a barline.
      current.end = end;
    } else {
      current = null;
    }
  }
  if (pending.length) finishWord(false);
  return {syllables, notes};
}

export function syllableTracks(score) {
  return score.tracks.map(track => {
    const lanes = [];
    for (const staff of track.staves) {
      const voices = new Map();
      for (const bar of staff.bars) for (const voice of bar.voices) {
        if (!voices.has(voice.index)) voices.set(voice.index, []);
        voices.get(voice.index).push(...voice.beats);
      }
      for (const beats of voices.values()) {
        const lane = readLane(beats);
        if (lane.syllables.length) lanes.push(lane);
      }
    }
    // Chordal divisi sharing one underlay need no pitch-based lyric selection.
    return lanes.length === 1 ? [{syllables: lanes[0].syllables}] : lanes;
  });
}
