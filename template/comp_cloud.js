/* Same-origin private backup. Identity can load inline; audio uploads require opt-in. */
((root) => {
  "use strict";
  const CHUNK = 1024 * 1024;
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(x => x.toString(16).padStart(2, "0")).join("");
  function create(adapter) {
    const el = id => document.getElementById(id), model = root.MeleteComp;
    let session = null, remote = null, remoteKey = null, working = false, timer = null, savedRevision = -1;
    let pendingUpload = null, scope = "mine", listing = [], listOrder = {column:"updatedAt", direction:-1};
    let connection = 0;
    const uploaded = new Set();
    let endpoint;
    function account() {
      el('cloudScope').hidden = !session?.reviewer;
    }
    function signIn() {
      try {
        const api = new URL(adapter.cloudConfig.api || '', document.baseURI);
        if (!adapter.cloudConfig.api || !/^https?:$/.test(api.protocol)
          || api.origin !== (root.origin || location.origin)) throw new Error('Cloud backup is not configured on this copy. Your local recordings are safe.');
        endpoint = api;
        const url = new URL('signin.html', api); url.searchParams.set('direct', '1');
        const popup = root.open(url, 'melete-google-sign-in', 'popup,width=460,height=640');
        if (!popup) throw new Error('Allow the sign-in window, then try again. No recordings have been uploaded.');
        try { localStorage.setItem('melete:cloud:visited','true'); } catch {}
      } catch(error) { adapter.toast(error.message,'error'); }
    }
    function message(text) { el("compCloudStatus").textContent = text; }
    function autoKey() { return `melete:cloud:auto:${session?.user?.id || "signed-out"}`; }
    function enabled() { try { return session?.user && localStorage.getItem(autoKey()) === "true"; } catch { return false; } }
    function controls() {
      for (const id of ["compCloudSave", "compCloudRestore", "compCloudDelete", "compCloudLogout", "compCloudAuto"]) el(id).disabled = working || !session?.user;
      el("compCloudRestore").disabled ||= !remote;
      el("compCloudDelete").disabled ||= !remote;
      el("compCloudSave").disabled ||= !adapter.state();
      el("compCloudRestore").disabled ||= !adapter.state();
      el("compCloudAuto").checked = Boolean(enabled());
      el("compCloudDelete").dataset.deleteToken = `${remoteKey}:${remote?.revision}`;
      account();
    }
    async function request(action, {method = "GET", body, query = {}} = {}) {
      if (!endpoint) {
        if (!adapter.cloudConfig.api || !/^https?:$/.test(new URL(document.baseURI).protocol)) throw new Error("Cloud backup is not configured on this copy. Your local recordings are safe.");
        endpoint = new URL(adapter.cloudConfig.api, document.baseURI);
        if (endpoint.origin !== (root.origin || location.origin)) throw new Error("Cloud backup must use this site's own server");
      }
      const url = new URL(endpoint); url.searchParams.set("action", action);
      Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
      const binary = Object.prototype.toString.call(body) === "[object Blob]";
      const response = await fetch(url, {method, credentials: "same-origin", cache: "no-store",
        headers: method === "GET" ? {} : {"X-Melete-CSRF": session?.csrf || "", "Content-Type": binary ? "application/octet-stream" : "application/json"},
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body), signal: AbortSignal.timeout(60000)});
      if (action === "blob" && method === "GET" && response.ok) return response.blob();
      const data = await response.json().catch(() => ({error: "Backup server unavailable"}));
      if (!response.ok) {
        if (response.status === 409) throw new Error("Cloud copy changed on another device. Restore it or review it before replacing. Local recordings were kept.");
        throw new Error(data.error || "Cloud request failed");
      }
      return data;
    }
    async function loadRemote() {
      const current = adapter.state(), owner = session?.user?.id;
      if (!session?.user || !current) return;
      const key = await digest(new TextEncoder().encode(current.key));
      const result = await request("load", {query: {key}});
      if (adapter.state()?.key !== current.key || session?.user?.id !== owner) return;
      remoteKey = key; remote = result.profile;
      controls();
    }
    async function connect({interactive = true} = {}) {
      const attempt = ++connection, next = await request("status");
      if (attempt !== connection) return;
      if (session?.user?.id !== next.user?.id) {
        listing = []; scope = "mine"; remote = null; remoteKey = null; renderListing();
      }
      session = next;
      controls();
      if (!session.configured) throw new Error("The backup server needs its Google client ID configured. Local practice still works.");
      if (session.user) {
        el("compGoogleButton").replaceChildren();
        await loadRemote();
        message("");
        if (el("compCloudDialog").open) await loadListing();
        return;
      }
      if (!interactive) return;
      // Google rejects the null location.origin of about:srcdoc song frames.
      // Authenticate on a real same-origin document, never in the score frame.
      const frame = document.createElement("iframe"), url = new URL('signin.html', endpoint);
      url.searchParams.set('inline', '1'); frame.src = url.href; frame.title = 'Sign in with Google';
      el("compGoogleButton").replaceChildren(frame);
      message("");
    }
    root.addEventListener("message", event => {
      if (event.origin !== (root.origin || location.origin) || event.data?.type !== "melete-cloud-signed-in") return;
      remote = null; remoteKey = null; uploaded.clear(); savedRevision = -1;
      void afterSignIn();
    });
    // Also recover after a mobile browser returns from a separate sign-in tab.
    root.addEventListener("focus", () => {
      if (!working && !session?.user && endpoint) void afterSignIn();
    });
    async function afterSignIn() {
      try {
        await connect({interactive: false});
        if (!session?.user || !pendingUpload) return;
        const intended = pendingUpload; pendingUpload = null;
        if (adapter.state()?.key !== intended.key || adapter.state()?.revision !== intended.revision) {
          adapter.toast("The track changed during sign-in. Click Upload again.", "error"); return;
        }
        await save({reviewable: true});
      } catch (e) { message(e.message); }
    }
    function uploadTrack() {
      if (working || !adapter.state()?.segments.length) return;
      if (session?.user) { void save({reviewable:true}); return; }
      pendingUpload = {key:adapter.state().key, revision:adapter.state().revision};
      signIn();
    }
    async function upload(blob) {
      const chunks = [];
      for (let at = 0; at < blob.size; at += CHUNK) {
        const piece = blob.slice(at, at + CHUNK), hash = await digest(await piece.arrayBuffer());
        if (!uploaded.has(hash)) { await request("blob", {method: "POST", query: {hash}, body: piece}); uploaded.add(hash); }
        chunks.push(hash);
      }
      return {chunks, bytes: blob.size};
    }
    async function download(info, query = {}) {
      if (!info || !Array.isArray(info.chunks) || info.chunks.length > 512 || !Number.isInteger(info.bytes)
        || info.bytes < 0 || info.bytes > 128 * 1024 * 1024) throw new Error("Invalid backup audio");
      const chunks = [];
      for (const hash of info.chunks) {
        const blob = await request("blob", {query: {...query, hash}});
        if (await digest(await blob.arrayBuffer()) !== hash) throw new Error("Cloud recording checksum mismatch");
        chunks.push(blob);
      }
      const blob = new Blob(chunks);
      if (blob.size !== info.bytes) throw new Error("Cloud recording is incomplete");
      return blob;
    }
    async function save({automatic = false, reviewable} = {}) {
      if (working || !session?.user || !adapter.state()) return;
      const current = adapter.state(), takes = new Map(adapter.sources());
      const key = await digest(new TextEncoder().encode(current.key));
      if (automatic && savedRevision === current.revision) return;
      working = true; controls(); message("Backing up selected recordings...");
      try {
        if (remoteKey !== key) await loadRemote();
        if (adapter.state()?.key !== current.key) throw new Error("Part changed before backup started");
        if (automatic && remote && savedRevision < 0) { message("A cloud copy exists. Choose Back up or Restore before automatic backup starts."); return; }
        if (!automatic && remote && savedRevision < 0 && !confirm("Replace this track's existing cloud copy?")) return;
        const state = {...current, undo: null, processed: [], adopted: [], revision: 0};
        const records = [];
        for (const id of model.protectedIds(state)) {
          const take = takes.get(id);
          if (!take?.pitchContour) throw new Error("A selected recording has no cached contour yet");
          const {analysisFrames, performer, ...record} = take;
          const audio = await upload(await adapter.wav(take));
          const pitches = await upload(new Blob([take.pitchContour.pitches]));
          records.push({record: {...record, pitchContour: {...record.pitchContour, pitches: null}}, audio, pitches});
        }
        if (adapter.state()?.key !== current.key) throw new Error("Part changed during backup. Retry from that part.");
        const result = await request("save", {method: "POST", body: {key, revision: remote?.revision || 0,
          ...(reviewable === undefined ? {} : {reviewable}), payload: {version: 1, state, records, summary: adapter.metadata?.()}}});
        remote = result.profile; remoteKey = key; savedRevision = current.revision;
        message("");
        adapter.toast(reviewable ? "Track uploaded for review" : "Track backed up");
        if (el("compCloudDialog").open) await loadListing();
      } catch (e) { message(e.message); adapter.toast(e.message, "error"); }
      finally { working = false; controls(); if (savedRevision >= 0 && adapter.state()?.key === current.key && adapter.state()?.revision !== savedRevision) changed(); }
    }
    async function restore() {
      if (working || !remote || !adapter.state()) return;
      const before = adapter.state(), payload = remote.payload;
      if (!confirm("Restore the cloud track? The current track can be restored with Undo until your next recording.")) return;
      working = true; controls(); message("Restoring recordings...");
      try {
        if (payload?.version !== 1 || payload.state?.key !== before.key || !Array.isArray(payload.records) || payload.records.length > 256) throw new Error("This backup does not match the current score, part and speed");
        // Older backups also carried a best continuous take; only track audio returns.
        const {bestId, bestAfter, undoBest, ...saved} = payload.state;
        const needed = new Set(saved.segments.map(s => s.takeId));
        const imported = [], ids = new Map();
        for (const entry of payload.records.filter(entry => needed.has(entry.record?.id))) {
          const audio = await (await download(entry.audio)).arrayBuffer();
          const view = new DataView(audio), old = entry.record;
          if (audio.byteLength !== 44 + old.frames * 2 || view.getUint16(20, true) !== 1
            || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16
            || view.getUint32(24, true) !== old.sampleRate || view.getUint32(40, true) !== old.frames * 2) throw new Error("Invalid backup WAV");
          const id = crypto.randomUUID(); ids.set(old.id, id);
          const pcm = new Int16Array(old.frames);
          for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(44 + i * 2, true);
          const pitches = await (await download(entry.pitches)).arrayBuffer();
          if (pitches.byteLength % 8) throw new Error("Invalid backup contour");
          const record = {...old, id, pitchContour: {...old.pitchContour, pitches: new Float64Array(pitches)}};
          if (!root.MeleteTakePitch.readContour(record)) throw new Error("Backup contour version does not match this player");
          imported.push({record, pcm});
        }
        const state = {...saved, revision: before.revision, undo: before.segments, freshAt: Date.now(), processed: [],
          track: true, trackVersion: model.TRACK_VERSION, adopted: [...new Set([...(before.adopted || []), ...imported.map(s => s.record.id)])],
          segments: saved.segments.map(s => ({...s, takeId: ids.get(s.takeId)}))};
        const all = new Map([...adapter.sources(), ...imported.map(s => [s.record.id, s.record])]);
        model.validate(state, all);
        await adapter.store.importComp(state, imported, before.revision);
        adapter.changed(); await adapter.restored();
        savedRevision = adapter.state()?.revision ?? -1;
        message("Cloud copy restored. Your other local recordings were kept.");
      } catch (e) { message(e.message); adapter.toast(e.message, "error"); }
      finally { working = false; controls(); }
    }
    async function open() {
      el("compCloudDialog").showModal(); controls();
      try { await connect(); } catch (e) { message(e.message); }
    }
    async function loadListing() {
      if (!session?.user) return;
      if (!session.reviewer) scope = "mine";
      const expected = scope, owner = session.user.id, song = adapter.song(), items = [];
      let offset = 0;
      do {
        const result = await request("list", {query:{song, scope:expected, offset}});
        items.push(...result.items); offset = result.next;
      } while (offset !== null && items.length < 1000);
      if (scope !== expected || session?.user?.id !== owner || adapter.song() !== song) return;
      listing = items; renderListing();
    }
    function renderListing() {
      const pill = el("cloudScope");
      pill.style.setProperty("--pill-index", scope === "mine" ? 0 : 1);
      pill.querySelectorAll("button").forEach((b, i) => {
        const active = (scope === "mine") === (i === 0);
        b.classList.toggle("is-active", active); b.setAttribute("aria-selected", String(active)); b.tabIndex = active ? 0 : -1;
      });
      const rows = [...listing].sort((a,b) => {
        const x=a[listOrder.column], y=b[listOrder.column];
        if ((x == null) !== (y == null)) return x == null ? 1 : -1;
        return listOrder.direction * (typeof x === "string" ? x.localeCompare(y) : (x || 0)-(y || 0));
      }).map(item => {
        const row=document.createElement("tr");
        for (const [key,value] of [["name",item.name],["label",item.label],["createdAt",item.createdAt],["updatedAt",item.updatedAt],["mean",item.mean]]) {
          const cell=document.createElement("td");
          cell.textContent = key.endsWith("At") ? new Date(value).toLocaleString()
            : key === "mean" ? Number.isFinite(value) ? value.toFixed(1) : "\u2014" : String(value);
          row.append(cell);
        }
        const actions=document.createElement("td");
        for (const [downloadOnly,label,svg] of [[false,"Review",'<path d="m9 5 10 7-10 7V5Z"></path>'],
          [true,"Download",'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path>']]) {
          const b=document.createElement("button"); b.className="icon-button";
          b.setAttribute("aria-label",`${label} ${item.name}: ${item.label}`);
          b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
          b.onclick=()=>reviewCloud(item,downloadOnly); actions.append(b);
        }
        row.append(actions); return row;
      });
      el("cloudTakeRows").replaceChildren(...rows);
    }
    async function reviewCloud(item, downloadOnly) {
      if (working) return;
      working=true; controls(); message("Loading...");
      try {
        const query={owner:item.owner,key:item.key};
        const {profile}=await request("load",{query});
        const payload=profile?.payload, state=payload?.state, ref=state?.descriptor?.reference;
        if (!state || !ref || !Array.isArray(payload.records)) throw new Error("Invalid cloud recording");
        const current=adapter.descriptor(ref.part,ref.line ?? null);
        if (!downloadOnly && (!current || model.key(current) !== state.key)) throw new Error("Different score or speed. Download this recording to review it separately.");
        const takes=new Map(), audio=new Map();
        for (const entry of payload.records) {
          const blob=await download(entry.audio,query), pitches=await (await download(entry.pitches,query)).arrayBuffer();
          const wav=new DataView(await blob.arrayBuffer()), old=entry.record;
          if (pitches.byteLength % 8 || wav.byteLength !== 44+old.frames*2 || wav.getUint16(22,true)!==1
            || wav.getUint16(34,true)!==16 || wav.getUint32(24,true)!==old.sampleRate) throw new Error("Invalid cloud recording data");
          const record={...old,pitchContour:{...old.pitchContour,pitches:new Float64Array(pitches)}};
          if (!root.MeleteTakePitch.readContour(record)) throw new Error("Cloud contour is incompatible");
          takes.set(record.id,record); audio.set(record.id,blob);
        }
        model.validate(state,takes);
        const rendered=await root.MeleteCompAudio.prepare(adapter.context(),state,takes,t=>audio.get(t.id),AbortSignal.timeout(60000));
        if (downloadOnly) adapter.downloadBlob(rendered.blob,`${state.song}-${item.name}-track.wav`);
        else {
          const id=`cloud:${item.owner}:${item.key}:${profile.revision}`;
          if (adapter.selected()===id) adapter.clear();
          else adapter.review({id,label:`${item.name}: ${item.label}`,ref,
            frames:model.framesFor(state.segments,takes).map(f=>({...f,start:f.start-rendered.origin,end:f.end-rendered.origin})),...rendered,
            track:ref.part,rate:ref.rate,start:rendered.origin*ref.rate,end:ref.seconds*ref.rate,latency:0,
            ranges:state.segments.map(s=>[s.from*ref.rate,s.to*ref.rate]),
            timelineSegments:state.segments.map(s=>({from:s.from*ref.rate,to:s.to*ref.rate,takeId:s.takeId,label:`${item.name}: take ${takes.get(s.takeId).number}`}))});
          el("compCloudDialog").close();
        }
        message("");
      } catch(e) { message(e.message); adapter.toast(e.message,"error"); }
      finally { working=false; controls(); }
    }
    function changed() {
      clearTimeout(timer);
      if (enabled()) timer = setTimeout(() => { void save({automatic: true}); }, 2500);
    }
    el("compCloudSave").onclick = () => save();
    el("cloudScope").onclick = () => { if (session?.reviewer) { scope=scope === "mine" ? "review" : "mine"; void loadListing().catch(e=>message(e.message)); } };
    el("cloudTakeTable").querySelectorAll("[data-cloud-sort]").forEach(button=>{
      button.onclick=()=>{ const column=button.dataset.cloudSort;
        listOrder={column,direction:column===listOrder.column?-listOrder.direction:column.endsWith("At")?-1:1};renderListing(); };
    });
    el("compCloudRestore").onclick = restore;
    el("compCloudAuto").onchange = () => {
      try {
        localStorage.setItem(autoKey(), String(el("compCloudAuto").checked));
        localStorage.setItem("melete:cloud:enabled", String(el("compCloudAuto").checked));
      } catch {}
      changed();
    };
    el("compCloudLogout").onclick = async () => {
      try {
        await request("logout", {method: "POST", body: {}});
        connection++;
        clearTimeout(timer); session = null; remote = null; remoteKey = null; uploaded.clear();
        pendingUpload = null; listing = []; scope = "mine"; renderListing();
        el('compGoogleInline')?.removeAttribute('src');
        root.google?.accounts?.id.disableAutoSelect(); await connect();
      } catch (e) { message(e.message); }
    };
    el("compCloudDelete").onclick = async () => {
      if (!remote) return;
      try {
        await request("delete", {method: "POST", body: {key: remoteKey, revision: remote.revision}});
        localStorage.setItem(autoKey(), "false"); remote = null; savedRevision = -1;
        controls(); message("Cloud copy deleted. Local recordings were kept.");
        await loadListing();
      } catch (e) { message(e.message); }
    };
    controls();
    void connect({interactive:false}).catch(()=>{});
    return {open, uploadTrack, enter: () => session?.user ? open() : signIn(), changed,
      resume: () => connect({interactive: false}).then(changed).catch(() => {})};
  }
  root.MeleteCloud = {create, digest};
})(globalThis);
