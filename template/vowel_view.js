/* Passive display. The player owns microphone access, recording, timing and mixing. */
window.MeleteVowelView = (() => {
  "use strict";
  const tools = window.MeleteVowels;
  const HOP_MS=75, TRAIL_MS=3000, MAX_EXAMPLE_MS=10000;
  const [minF1, maxF1] = tools.F1, [minF2, maxF2] = tools.F2;
  const width = 243;
  const unitsPerBark = width / (tools.hzToBark(maxF2) - tools.hzToBark(minF2));
  const field = {x: 43, y: 44, width, height: unitsPerBark * (tools.hzToBark(maxF1) - tools.hzToBark(minF1))};
  const byId = id => document.getElementById(id);
  function svg(tag, attrs) {
    const element = document.createElementNS("http://www.w3.org/2000/svg",tag);
    for (const [name,value] of Object.entries(attrs)) element.setAttribute(name,value);
    return element;
  }
  function position(p) {
    const {x,y}=tools.chartPoint(p);
    return {x:field.x+x*field.width, y:field.y+y*field.height};
  }
  function label(group, value, attrs) {
    const text = svg("text", attrs);
    text.textContent = value;
    group.append(text);
  }
  function drawScale(group) {
    group.append(svg("rect", {...field, class:"vowel-field", rx:3}));
    for (const f2 of [minF2, 1000, 1500, 2000, 2500, maxF2]) {
      const {x} = position({f1:minF1, f2});
      group.append(svg("line", {class:"vowel-grid", x1:x, x2:x, y1:field.y, y2:field.y+field.height}));
      label(group, f2, {class:"vowel-tick", x, y:field.y-13, "text-anchor":"middle"});
    }
    for (const f1 of [minF1, 400, 600, 800, 1000, maxF1]) {
      const {y} = position({f1, f2:maxF2});
      group.append(svg("line", {class:"vowel-grid", x1:field.x, x2:field.x+field.width, y1:y, y2:y}));
      label(group, f1, {class:"vowel-tick", x:field.x-4, y, "text-anchor":"end", "dominant-baseline":"middle"});
    }
    // Orientation labels in absolute Hz, independent of the score and microphone.
    for (const [name,f1,f2] of [["ee",300,2350],["ah",780,1250],["oo",350,830]]) {
      label(group, name, {...position({f1,f2}), class:"vowel-landmark", dy:-7, "text-anchor":"middle"});
    }
  }
  function path(group, points, opacity=1) {
    if (!points.length) return;
    if (points.length===1) {
      const {x,y}=position(points[0]);
      group.append(svg("circle",{cx:x,cy:y,r:1.3,class:"vowel-sample",opacity}));
      return;
    }
    const d=points.map((p,i)=>{
      const {x,y}=position(p);
      return (i ? "L" : "M")+x.toFixed(2)+" "+y.toFixed(2);
    }).join(" ");
    group.append(svg("path",{d, class:"vowel-path",opacity}));
  }
  // Timed dots on both paths let a singer compare when the vowel moved.
  function timeMarks(group, run, onset, opacityAt) {
    for (let i=1; i<run.length; ++i) {
      const a=run[i-1], b=run[i];
      const t=onset+250*(1+Math.floor((a.t-onset)/250));
      if (t>b.t || b.t<=a.t) continue;
      const k=(t-a.t)/(b.t-a.t);
      const {x,y}=position({f1:a.f1+k*(b.f1-a.f1),f2:a.f2+k*(b.f2-a.f2)});
      group.append(svg("circle",{class:"vowel-beat",cx:x,cy:y,r:2.3,opacity:opacityAt(t)}));
    }
  }

  function drawTarget(group, points) {
    const xy = points.map(point => point.hz && position(point.hz));
    for (let i = 0; i < xy.length; i++) {
      const end = xy[i];
      if (!end) continue;
      const start = xy[i-1];
      if (start) {
        const dx = end.x-start.x, dy = end.y-start.y, length = Math.hypot(dx,dy);
        if (!length) continue;
        const size = Math.min(5, length*.55), x = dx/length, y = dy/length;
        group.append(svg("line", {x1:start.x, y1:start.y, x2:end.x, y2:end.y,
          class:points[i].optional ? "optional" : "glide"}));
        group.append(svg("polyline", {class:"arrowhead", points:[
          [end.x-size*x-size*.6*y, end.y-size*y+size*.6*x], [end.x,end.y],
          [end.x-size*x+size*.6*y, end.y-size*y-size*.6*x]].map(p=>p.join(",")).join(" ")}));
      } else if (i === 0) {
        group.append(svg("circle", {class:xy.length===1 ? "steady" : "nucleus",
          cx:end.x, cy:end.y, r:xy.length===1 ? 6.5 : 3.5}));
      } else {
        // A diamond places just this known endpoint; no arrow crosses an unknown one.
        group.append(svg("rect", {class:"offglide", x:end.x-3.5, y:end.y-3.5, width:7, height:7,
          transform:"rotate(45 "+end.x+" "+end.y+")"}));
      }
    }
  }

  function syllableDisplay({data, part, tick, writtenPitch}) {
    const root=byId("vowelSyllablePanel"), group=byId("vowelTarget"), name=byId("vowelSyllable");
    const symbols=byId("vowelSymbols"), detail=byId("vowelTargetDetail");
    const corpus=byId("vowelCorpus"), variant=byId("vowelVariant"), choices=new Map();
    const targets=window.MeleteVowelTargets;
    let lastPart, lastHit, choiceKey, lastTick;
    function update(at=tick(), force=false) {
      const spec=data(), selected=part();
      if (!spec) return;
      const lanes=spec.tracks[selected];
      const pitch=lanes?.length>1 ? writtenPitch(at) : null;
      const hit=targets.syllableAt(spec.tracks,selected,at,pitch);
      lastTick=at;
      if (!force && !root.hidden && hit===lastHit && selected===lastPart) return;
      lastHit=hit; lastPart=selected; root.hidden=false;
      group.replaceChildren(); variant.replaceChildren(); variant.hidden=true;
      symbols.textContent=""; detail.textContent="";
      if (!hit) {
        name.textContent=Number.isInteger(selected) ? "No lyric here" : "Choose a part";
        return;
      }
      name.textContent=hit.count>1 ? hit.word+" · "+hit.text+" ("+(hit.index+1)+"/"+hit.count+")" : hit.word;
      const options=targets.pronunciations(spec.lexicon,hit);
      if (!options?.length) {
        detail.textContent=options ? "No vowel target" : "No pronunciation mapped for this syllable.";
        return;
      }
      choiceKey=targets.spelling(hit.word)+"|"+hit.index;
      const chosen=choices.get(choiceKey) || options[0];
      if (options.length>1) {
        variant.replaceChildren(...options.map(o=>new Option(targets.notation(o),o)));
        variant.value=chosen; variant.hidden=false;
      } else symbols.textContent=targets.notation(chosen);
      const points=targets.landmarks(spec,chosen,corpus.value);
      drawTarget(group,points);
      const missing=points.filter(p=>!p.hz);
      detail.textContent=missing.length
        ? "No measured landmark for "+missing.map(p=>"["+p.symbol+"]"+(p.optional?" (optional)":"")).join(", ")+"."
        : points.length===1 ? "Hollow ring marks the held vowel." : "Follow the arrow from nucleus to offglide.";
      if (!points[0].hz && points[1]?.hz) detail.textContent+=" Diamond marks the offglide ["+points[1].symbol+"].";
      const description=points.filter(p=>p.hz).map(({symbol,hz})=>symbol+" · F1 "+hz.f1+" Hz · F2 "+hz.f2+" Hz");
      if (description.length) {
        const title=svg("title",{}); title.textContent=description.join(" → "); group.prepend(title);
      }
    }
    corpus.addEventListener("change",()=>update(lastTick,true));
    variant.addEventListener("change",()=>{ choices.set(choiceKey,variant.value); update(lastTick,true); });
    function clear() {
      root.hidden=true; group.replaceChildren(); name.textContent=""; symbols.textContent=""; detail.textContent="";
      variant.hidden=true; variant.replaceChildren(); lastHit=null; lastPart=null;
    }
    return {update,clear};
  }

  function attach({input,section,score}) {
    const toggle=byId("vowelToggle"), panel=byId("vowelPanel"), dot=byId("vowelDot");
    const trail=byId("vowelTrail"), reference=byId("vowelReference"), hz=byId("vowelHz");
    const status=byId("vowelStatus"), guide=byId("vowelGuide"), pin=byId("vowelPin"), clear=byId("vowelClear");
    const bySection=new Map();
    const syllables=syllableDisplay(score);
    let key, source, channel, buffer, timer, lastClock, lastWindow, candidate, lastLive, onset;
    let live=[], example=null, started=0, failed=false;
    const examples=()=>bySection.get(key) || [];
    function message(value) { if(status.textContent!==value) status.textContent=value; }

    function renderReference() {
      const all=examples(), bounds=tools.referenceRegion(all);
      reference.replaceChildren();
      clear.hidden=!all.length;
      if (!bounds) {
        guide.textContent="Sing a held vowel or word, then pin the example.";
        return;
      }
      const left=position({f1:bounds.low1,f2:bounds.high2}), right=position({f1:bounds.high1,f2:bounds.low2});
      reference.append(svg("rect",{class:"vowel-region",x:left.x,y:left.y,width:right.x-left.x,height:right.y-left.y,rx:2}));
      // The latest timed path stays legible; the shade includes every pinned middle.
      for (const run of all.at(-1).runs) {
        path(reference,run,.75);
        timeMarks(reference,run,0,()=>.8);
      }
      guide.textContent=(all.length===1 ? "One example guides the shaded region." : all.length+" examples define the shaded region.")
        +" Dashes trace the latest example. Dots mark ¼ s.";
    }
    function renderTrail(now) {
      live=live.filter(p=>now-p.t<TRAIL_MS);
      const group=document.createDocumentFragment();
      const fade=t=>Math.max(.04,1-(now-t)/TRAIL_MS);
      for (const run of tools.strokes(live)) {
        for(let i=0;i<run.length;++i) path(group,run.slice(Math.max(0,i-1),i+1),fade(run[i].t));
        timeMarks(group,run,run[0].onset,fade);
      }
      if (group.childNodes.length || trail.childNodes.length) trail.replaceChildren(group);
    }
    function hideDot() {
      lastLive=null;
      dot.setAttribute("visibility","hidden");
      hz.textContent="";
    }
    function resetLive() {
      candidate=null; live=[]; lastClock=null; lastWindow=-Infinity;
      hideDot(); trail.replaceChildren();
    }
    function markGap(t) {
      if (live.at(-1)?.f1!=null) live.push({t});
      if (example?.at(-1)?.f1!=null) example.push({t});
      hideDot();
    }
    function accept(result,{t,analyser}) {
      if (panel.hidden || input()!==analyser || section()!==key || performance.now()-t>tools.GAP_MS) return;
      const previous=candidate;
      candidate=result && {f1:result.f1, f2:result.f2, t};
      if (!candidate || !previous || t-previous.t>tools.GAP_MS
        || Math.abs(result.f1-previous.f1)>190 || Math.abs(result.f2-previous.f2)>440) {
        markGap(t);
        message("Waiting for a clear vowel");
        return;
      }
      if (!lastLive || t-lastLive.t>tools.GAP_MS) onset=t;
      lastLive={...candidate,onset};
      live.push(lastLive);
      if (example) example.push(lastLive);
      const {x,y}=position(result);
      dot.setAttribute("cx",x); dot.setAttribute("cy",y); dot.setAttribute("visibility","visible");
      hz.textContent="F1 "+result.f1+" Hz · F2 "+result.f2+" Hz";
      message("Tracking vowel");
    }
    function releaseWorker() {
      channel?.close(); channel=null; source=null; buffer=null;
      resetLive();
    }
    function failure() {
      failed=true; example=null; pin.disabled=true; pin.textContent="Start example";
      releaseWorker();
      message("Vowel analysis unavailable");
    }
    function connect(analyser) {
      releaseWorker();
      channel=window.MeleteLivePitch.Channel.fromSource(tools.workerSource(),accept,failure);
      source=analyser; buffer=new Float32Array(analyser.fftSize);
    }
    function finishExample() {
      const captured=tools.referenceExample(example || []);
      example=null; pin.textContent="Start example";
      if (!captured) {
        guide.textContent="No steady middle yet. Hold the vowel a little longer and try again.";
        return;
      }
      bySection.set(key,[...examples(),captured]);
      renderReference();
    }
    function tick() {
      if (panel.hidden || failed) return;
      if (section()!==key) {
        key=section(); example=null; pin.textContent="Start example";
        releaseWorker(); renderReference();
      }
      const analyser=input(), now=performance.now();
      if (!analyser) {
        if (example) finishExample();
        if (source) releaseWorker();
        message("Turn on Sing to use the mic"); pin.disabled=true;
      } else {
        try {
          if (source!==analyser) {
            if (example) finishExample();
            connect(analyser); message("Waiting for a clear vowel");
          }
          pin.disabled=false;
          if (now-lastWindow>tools.GAP_MS && (lastLive || candidate)) {
            markGap(now); candidate=null;
            message("Waiting for a clear vowel");
          }
          if (!channel.pending && lastClock!==analyser.context.currentTime) {
            lastClock=analyser.context.currentTime; lastWindow=now;
            analyser.getFloatTimeDomainData(buffer);
            channel.submit(buffer,{sampleRate:analyser.context.sampleRate},{t:now,analyser});
          }
          if (example && now-started>=MAX_EXAMPLE_MS) finishExample();
          renderTrail(now);
        } catch { failure(); return; }
      }
      timer=window.setTimeout(tick,analyser?HOP_MS:175);
    }
    function show(open) {
      if (open===!panel.hidden) return;
      panel.hidden=!open;
      toggle.setAttribute("aria-pressed",String(open));
      clearTimeout(timer);
      failed=false; example=null; pin.textContent="Start example";
      releaseWorker();
      if (open) {
        const scale=byId("vowelScale");
        if (!scale.childElementCount) drawScale(scale);
        key=section(); renderReference(); syllables.update(); tick();
      } else syllables.clear();
    }
    toggle.addEventListener("click",()=>show(panel.hidden));
    byId("vowelClose").addEventListener("click",()=>{show(false);toggle.focus();});
    pin.addEventListener("click",()=>{
      if (section()!==key) return;
      if (example) { finishExample(); return; }
      if (!input()) return;
      started=performance.now(); example=[];
      guide.textContent="Sing the example now. Pin it after the vowel closes.";
      pin.textContent="Pin example";
    });
    clear.addEventListener("click",()=>{
      example=null; pin.textContent="Start example";
      bySection.delete(key); renderReference();
    });
    document.addEventListener("melete:deactivate",()=>show(false));
    document.addEventListener("visibilitychange",()=>{if(document.hidden) show(false);});
    window.addEventListener("pagehide",()=>show(false));
    return {position(tick) { if (!panel.hidden) syllables.update(tick); }};
  }
  return {attach};
})();
