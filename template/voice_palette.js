/* Colours follow the sung line, not the order of tracks in a file. */
((root) => {
  "use strict";
  const family = part => /^([SATB])(?:[12]|\s|$)/i.exec(part.short)?.[1]?.toUpperCase()
    || /^(soprano|alto|tenor|bass|baritone)\b/i.exec(part.name)?.[1][0].toUpperCase();
  function notesFor(channel, analysis) {
    const notes=[];
    for (const {start,end,pitches} of analysis.spans) {
      if (!(end>start) || !pitches.length) continue;
      const line=channel.line===null ? 0 : Math.round(channel.line*(pitches.length-1)/Math.max(1,analysis.maxLines-1));
      notes.push([start,end,pitches[line]]);
    }
    return notes;
  }
  function mean(notes) {
    let sum=0, weight=0;
    for (const [start,end,pitch] of notes) {
      if (!(end>start) || !Number.isFinite(pitch)) continue;
      sum+=(end-start)*pitch; weight+=end-start;
    }
    return weight ? sum/weight : null;
  }
  function labelPaint(label, parts) {
    // Cloud summaries carry the displayed part label before audio is loaded.
    // Older comp labels also include the practice-speed suffix.
    const normalize = value => String(value || "").replace(/\s*\u00b7\s*\d+(?:\.\d+)?%$/u, "")
      .trim().replace(/\s+/g, " ").toLowerCase();
    const name = normalize(label);
    if (!name) return "";
    const paints = new Set(parts.filter(part => [part.short, part.name].some(value => normalize(value) === name))
      .map(part => part.color).filter(Boolean));
    return paints.size === 1 ? [...paints][0] : "";
  }
  function lanes(channels, analyses, roles=[]) {
    const solos=new Set(roles.map(r=>r.soloist));
    const result=channels.map(c=>{
      const notes=notesFor(c,analyses[c.source]);
      return {notes,mean:mean(notes),family:family(c),solo:solos.has(c.source)};
    });
    const anchors=result.filter(p=>p.family && !p.solo && p.mean!==null).map(p=>p.mean);
    const high=Math.max(...anchors), low=Math.min(...anchors);
    result.forEach((p,i)=>{
      if (!p.family || p.mean===null) return;
      const t=high>low ? Math.max(0,Math.min(1,(high-p.mean)/(high-low))) : {S:0,A:1/3,T:2/3,B:1}[p.family];
      p.hue=25+285*t;
      const nearSibling=channels[i].line>0 && result.some((q,j)=>j<i && channels[j].source===channels[i].source && Math.abs(q.hue-p.hue)<16);
      p.tone=p.solo ? "solo" : nearSibling ? "div" : "voice";
      p.paint=`oklch(var(--${p.tone}-lightness) var(--${p.tone}-chroma) ${p.hue.toFixed(3)})`;
    });
    return result;
  }
  // Preserve written reattacks for pitchbar hits even when analysis joined
  // adjacent notes into one sustained span for grading.
  function barNotes(channel,lane,sourceNotes) {
    if (channel.line===null) return sourceNotes.map(([,s,e,n])=>[s,e,n]);
    const starts=new Map();
    for (const [,s,,n] of sourceNotes) {
      if (!starts.has(n)) starts.set(n,[]);
      starts.get(n).push(s);
    }
    return lane.notes.flatMap(([s,e,n])=>{
      const attacks=[...new Set((starts.get(n)||[]).filter(t=>s<t && t<e))].sort((a,b)=>a-b);
      const ends=[...attacks,e]; return [s,...attacks].map((t,i)=>[t,ends[i],n]);
    });
  }
  const api={lanes,mean,barNotes,labelPaint};
  if (typeof module==="object" && module.exports) module.exports=api;
  else root.MeleteVoicePalette=api;
})(globalThis);
