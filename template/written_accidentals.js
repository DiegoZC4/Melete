/* Preserve written accidentals that AlphaTab otherwise treats as spelling only. */
const MeleteWrittenAccidentals = (() => {
  const types = {natural: 'Natural', sharp: 'Sharp', flat: 'Flat',
    'double-sharp': 'DoubleSharp', 'sharp-sharp': 'DoubleSharp', 'flat-flat': 'DoubleFlat'};
  // Bravura SMuFL bounds in staff spaces; these four glyphs are not in AlphaTab's enum.
  // https://github.com/steinbergmedia/bravura/blob/master/redist/Bravura.json
  const enclosures = {
    parentheses: {left: 0xE26A, right: 0xE26B, width: .564, top: .988, bottom: -.992},
    bracket: {left: 0xE26C, right: 0xE26D, width: .308, top: .752, bottom: -.748},
  };
  const installed = new WeakMap(), decorated = new WeakSet();
  const children = (node, name) => [...node.children].filter(child => child.localName === name);
  const child = (node, name) => children(node, name)[0];
  const index = (node, name) => Math.max(0, (Number.parseInt(child(node, name)?.textContent, 10) || 1) - 1);

  function fromXml(documentXml) {
    const groups = [];
    children(documentXml.documentElement, 'part').forEach((part, track) => {
      children(part, 'measure').forEach((measure, bar) => {
        const voices = new Map();
        for (const node of children(measure, 'note')) {
          // AlphaTab omits cue notes, but retains hidden notes and grace notes.
          if (child(node, 'cue') || !(child(node, 'pitch') || child(node, 'unpitched'))) continue;
          const staff = index(node, 'staff'), voice = index(node, 'voice'), key = `${staff}:${voice}`;
          if (!voices.has(key)) voices.set(key, {track, bar, staff, voice, notes: []});
          const accidental = child(node, 'accidental');
          const type = types[accidental?.textContent.trim()];
          const visible = node.getAttribute('print-object') !== 'no' && accidental?.getAttribute('print-object') !== 'no';
          voices.get(key).notes.push(type && visible && child(node, 'pitch') ? {
            type,
            enclosure: accidental.getAttribute('bracket') === 'yes' ? 'bracket'
              : accidental.getAttribute('parentheses') === 'yes' ? 'parentheses' : null,
          } : null);
        }
        for (const group of voices.values()) if (group.notes.some(Boolean)) groups.push(group);
      });
    });
    return groups;
  }

  function bind(score, groups) {
    const marks = new WeakMap();
    let mapped = 0, unmatched = 0;
    for (const group of groups) {
      const voice = score.tracks[group.track]?.staves[group.staff]?.bars[group.bar]?.voices[group.voice];
      // Within a voice, import preserves written note/chord order, including grace notes.
      // Count mismatches are rejected rather than attaching a mark to a nearby note.
      const notes = voice?.beats.flatMap(beat => beat.notes) || [];
      if (notes.length !== group.notes.length) {
        unmatched += group.notes.filter(Boolean).length;
        continue;
      }
      group.notes.forEach((mark, i) => {
        if (mark) { marks.set(notes[i], mark); mapped++; }
      });
    }
    return {marks, mapped, unmatched};
  }

  function decorate(glyph, mark, note) {
    if (decorated.has(glyph)) return;
    decorated.add(glyph);
    const layout = glyph.doLayout, paint = glyph.paint;
    let box = null;
    glyph.doLayout = function() {
      layout.call(this);
      box = null;
      const enclosure = enclosures[mark.enclosure];
      if (!enclosure) return;
      const metrics = this.renderer.smuflMetrics, unit = metrics.oneStaffSpace;
      const top = metrics.glyphTop.get(this.symbol) * this.glyphScale;
      const bottom = metrics.glyphBottom.get(this.symbol) * this.glyphScale;
      const height = Math.max(this.height, unit * this.glyphScale) + .2 * unit * this.glyphScale;
      const scale = height / ((enclosure.top - enclosure.bottom) * unit);
      const side = enclosure.width * unit * scale, gap = .12 * unit * this.glyphScale;
      const middle = -(top + bottom) / 2;
      box = {enclosure, scale, side, gap, width: this.width,
        dy: middle + (enclosure.top + enclosure.bottom) * unit * scale / 2,
        top: Math.min(-top, middle - height / 2), bottom: Math.max(-bottom, middle + height / 2)};
      this.width += 2 * (side + gap);
      this.height = box.bottom - box.top;
    };
    const top = glyph.getBoundingBoxTop, bottom = glyph.getBoundingBoxBottom;
    glyph.getBoundingBoxTop = function() { return box ? this.y + box.top : top.call(this); };
    glyph.getBoundingBoxBottom = function() { return box ? this.y + box.bottom : bottom.call(this); };
    glyph.paint = function(x, y, canvas) {
      const color = canvas.color;
      canvas.beginGroup(`written-accidental written-${mark.type.toLowerCase()} written-${mark.enclosure || 'plain'} n${note.id}`);
      try {
        if (this.colorOverride) canvas.color = this.colorOverride;
        if (box) {
          canvas.fillMusicFontSymbol(x + this.x, y + this.y + box.dy, box.scale, box.enclosure.left, false);
          paint.call(this, x + box.side + box.gap, y, canvas);
          canvas.fillMusicFontSymbol(x + this.x + box.side + 2 * box.gap + box.width,
            y + this.y + box.dy, box.scale, box.enclosure.right, false);
        } else paint.call(this, x, y, canvas);
      } finally { canvas.color = color; canvas.endGroup(); }
    };
  }

  function install(alpha, documentXml) {
    const groups = fromXml(documentXml);
    const factory = alpha.Environment.defaultRenderers.find(item => item.staffId === 'score');
    let state = installed.get(factory);
    if (!state) {
      state = {marks: new WeakMap()};
      installed.set(factory, state);
      const create = factory.create;
      factory.create = function(...args) {
        const renderer = create.apply(this, args), helper = renderer.accidentalHelper;
        const apply = helper.applyAccidental;
        helper.applyAccidental = function(note) {
          const native = apply.call(this, note);
          const mark = state.marks.get(note);
          return mark ? alpha.model.AccidentalType[mark.type] : native;
        };
        const addBeat = renderer.addBeatGlyph;
        renderer.addBeatGlyph = function(beatGlyph) {
          const pre = beatGlyph.preNotes;
          if (pre) {
            const addNormal = pre.addNormal;
            pre.addNormal = function(group) {
              if (group === this.accidentals) {
                const used = new Set();
                for (const note of beatGlyph.beat.notes) {
                  const mark = state.marks.get(note);
                  if (!mark || !note.isVisible) continue;
                  const y = renderer.getScoreY(helper.getNoteSteps(note));
                  const symbol = alpha.model.MusicFontSymbol[`Accidental${mark.type}`];
                  const glyph = group.glyphs?.find(item => !used.has(item) && item.symbol === symbol && Math.abs(item.y - y) < .001);
                  if (glyph) { used.add(glyph); decorate(glyph, mark, note); }
                }
              }
              return addNormal.call(this, group);
            };
          }
          return addBeat.call(this, beatGlyph);
        };
        return renderer;
      };
    }
    return score => {
      const result = bind(score, groups);
      state.marks = result.marks;
      if (result.unmatched) console.warn(`Melete: ${result.unmatched} written accidentals could not be matched to notation.`);
      return {mapped: result.mapped, unmatched: result.unmatched};
    };
  }
  return {fromXml, bind, decorate, install};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MeleteWrittenAccidentals;
