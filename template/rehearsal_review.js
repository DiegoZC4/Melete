(() => {
  "use strict";
  let location;
  try { location = new URL(window.parent.location.href); } catch { return; }
  if (!/\/melete\/rehearsal\.php$/.test(location.pathname) ||
      !/^\d{4}-\d\d-\d\d$/.test(location.searchParams.get("date") || "")) return;
  function url(action, id, aligned) {
    const u = new URL(location.pathname, location);
    u.searchParams.set("date", location.searchParams.get("date")); u.searchParams.set("action", action);
    if (id) u.searchParams.set("id", id);
    if (aligned) u.searchParams.set("timing","aligned");
    return u;
  }
  async function request(action, id, signal, aligned=false) {
    const r = await fetch(url(action, id, aligned), {cache:"no-store", credentials:"same-origin", signal});
    if (!r.ok) throw Error([401,403].includes(r.status) ? "Session expired. Reload to sign in." : "Recording unavailable. Try again.");
    return r;
  }
  function element(tag, text) {
    const el = document.createElement(tag); if (text) el.textContent = text; return el;
  }
  let mounted = false;
  window.MeleteRehearsalReview = {mount: async adapter => {
    if (mounted) return; mounted = true;
    document.body.classList.add("private-review");
    const bar = element("section"); bar.className = "rehearsal-review"; bar.setAttribute("aria-label","Rehearsal review");
    function selector(label) {
      const group = element("label", label), select = element("select");
      select.setAttribute("aria-label",label);
      group.append(select); bar.append(group); return select;
    }
    const singers = selector("Singer"), versions = selector("Recording");
    const timing = element("label"), toggle = element("input"); toggle.type = "checkbox"; toggle.disabled = true;
    timing.append(toggle, "Score-fit timing"); timing.title = "Align each source take and its pitch contour to the score. Turn off to hear recorded timing. A score fit is not measured hardware latency.";
    const metrics = element("output"), status = element("span"); status.setAttribute("role","status");
    bar.append(timing, metrics, status); document.querySelector(".transport-primary").after(bar);
    const fmt = n => Number.isFinite(n) ? n.toFixed(1) : "\u2013";
    let rows = [], current, controller, selection=null, preferAligned=location.searchParams.get("timing")!=="recorded", initialTime=null;
    const cached=new Map();
    async function render(seek) {
      if (!current) return;
      const {row} = current, fitted = toggle.checked, m = fitted ? row.fitted : row.raw;
      adapter.show(current, fitted, seek, initialTime);initialTime=null;
      metrics.textContent = "Tracked " + fmt(m.coverage * 100) + "%   Mean " + fmt(m.mean) + "\u00a2   Median " + fmt(m.median) + "\u00a2";
      const shift=ms=>ms===0?"0 ms":Math.abs(ms)+" ms "+(ms>0?"earlier":"later");
      const edits=row.alignment?.shifts;
      if(edits){
        const summary=edits.map(e=>"Take "+e.number+": "+shift(e.advanceMs)+" ("+e.status+(e.basis?"; "+e.basis:"")+
          (e.lyricAttacks?", "+e.lyricAttacks+" lyric attacks examined":"")+")").join("; ");
        const low=edits.filter(e=>e.status!=="consistent fit").length;
        status.title=summary;
        status.textContent=!row.alignment.changed ?
          (edits.every(e=>e.basis==="no timing evidence")?"Recorded timing \u00b7 no usable onset or pitch change":"Recorded timing \u00b7 best shift 0 ms") :
          !fitted?"Recorded timing":edits.length===1?shift(edits[0].advanceMs)+" \u00b7 "+edits[0].status :
          edits.length+" source offsets \u00b7 "+(low?low+" uncertain":"consistent fits");
      }else status.textContent=(fitted?shift(row.fit.advanceMs)+" \u00b7 ":"Recorded timing \u00b7 ")+row.fit.status;
    }
    function failure(e) { if (e.name !== "AbortError") status.textContent = e.message; }
    async function choose(seek=true) {
      controller?.abort(); const c = controller = new AbortController(); current = null;
      const row = rows.find(r => r.id === versions.value);
      if(selection!==row?.id){cached.clear();selection=row?.id;}
      adapter.clear();metrics.textContent="";status.title="";
      const available=Boolean(row?.alignment ? row.alignment.changed : row?.fit?.advanceMs);
      toggle.disabled=!available;toggle.checked=available && preferAligned;
      if (!row) { status.textContent = ""; return; }
      status.textContent = "Loading recording\u2026";
      try {
        const variant=Boolean(row.alignment && toggle.checked);
        if(!cached.has(variant)){
          const ctx = adapter.context();
          const [pitch, blob] = await Promise.all([request("pitch",row.id,c.signal,variant).then(r=>r.json()),request("audio",row.id,c.signal,variant).then(r=>r.blob())]);
          if (!adapter.matches(pitch.ref)) throw Error("The saved score and this part do not match.");
          const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
          const loudness = await window.MeleteTakeLoudness.track(buffer);
          c.signal.throwIfAborted();
          cached.set(variant,{row,ref:pitch.ref,frames:pitch.frames.map(([start,end,cents])=>({start,end,cents})),buffer,blob,loudness});
        }
        current=cached.get(variant);await render(seek);
      } catch(e) { if (controller===c) failure(e); }
    }
    async function singerChanged(preselect=null) {
      const items = rows.filter(r => r.singer === singers.value).sort((a,b) =>
        (a.kind === "performance" ? -2 : a.kind !== "source" ? -1 : 0) -
        (b.kind === "performance" ? -2 : b.kind !== "source" ? -1 : 0) || a.number - b.number);
      versions.replaceChildren(...items.map(r=>new Option((r.kind === "performance" ? "Performance" : r.kind === "alternate" ? "Alternate" :
        r.kind==="test"?"Test run":(r.test?"Test take ":"Take ")+r.number) + " (" + r.part + ")", r.id)));
      if(typeof preselect==="string" && items.some(r=>r.id===preselect))versions.value=preselect;
      versions.disabled = !items.length; await choose();
    }
    singers.onchange = singerChanged; versions.onchange = ()=>choose(); toggle.onchange = () => {preferAligned=toggle.checked;void choose(false);};
    singers.add(new Option("Choose singer", "")); versions.disabled = true;
    try {
      rows = (await (await request("catalog")).json()).items.filter(r => r.song === adapter.song);
      for (const name of [...new Set(rows.map(r=>r.singer))].sort((a,b)=>a.localeCompare(b))) singers.add(new Option(name, name));
      if (!rows.length) status.textContent = "No recordings for this score.";
      const linked=rows.find(r=>r.id===location.searchParams.get("recording"));
      if(linked){
        const at=location.searchParams.get("at");
        if(at!==null && /^\d+(?:\.\d+)?$/.test(at) && Number(at)<=linked.end)initialTime=Number(at);
        singers.value=linked.singer;await singerChanged(linked.id);
      }
    } catch(e) { failure(e); }
    addEventListener("pageshow", e=>{if(e.persisted) window.parent.location.reload();});
  }};
})();
