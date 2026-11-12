/* Same-origin private backup. Identity can load inline; audio uploads require opt-in. */
((root) => {
  "use strict";
  const CHUNK = 1024 * 1024;
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(x => x.toString(16).padStart(2, "0")).join("");
  const RECEIPTS = "melete:submitted-tracks:v1";
  function localOnly(state) {
    if (!state?.descriptor) return false;
    const {song, reference:r, slot} = state.descriptor;
    try { return JSON.parse(localStorage.getItem('melete:cloud:local-only:v1') || '[]')
      .includes(JSON.stringify([song,r.part,r.line ?? null,slot || null])); } catch { return false; }
  }
  function receipts() {
    try { return JSON.parse(localStorage.getItem(RECEIPTS) || "{}") || {}; } catch { return {}; }
  }
  function signature(state, sources) {
    if (!state?.segments?.length) return null;
    const ref = state.descriptor.reference;
    return JSON.stringify([state.key, ref.fingerprint, ref.rate, state.segments,
      [...new Set(state.segments.map(s => s.takeId))].map(id => {
        const t = sources.get(id);
        return t ? [id,t.frames,t.sampleRate,t.updatedAt,t.playbackAdvance,t.pitchReference?.latency,
          t.pitchContour?.analysisVersion,t.pitchScore?.scoringVersion] : [id,null];
      })]);
  }
  function hasReceipt(state, sources) {
    const stamp = signature(state, sources);
    return Boolean(stamp && receipts()[state.key]?.signature === stamp);
  }
  function rememberReceipt(key, stamp, result, owner) {
    if (!stamp || !result?.id || !owner) return;
    try { localStorage.setItem(RECEIPTS, JSON.stringify({...receipts(), [key]:
      {signature:stamp,id:result.id,owner,uploaded:result.uploaded}})); } catch {}
  }
  function forgetReceipt(id, owner) {
    const saved = receipts();
    for (const [key, receipt] of Object.entries(saved)) if (receipt.id === id && receipt.owner === owner) delete saved[key];
    try { localStorage.setItem(RECEIPTS, JSON.stringify(saved)); } catch {}
  }
  function create(adapter) {
    const el = id => document.getElementById(id), model = root.MeleteComp;
    let session = null, remote = null, remoteKey = null, working = false, timer = null, savedRevision = -1;
    let pendingUpload = null, listing = [];
    let preferReview=false, listEpoch=0, consentOwner=null, pendingLibrary=false;
    let connection = 0;
    const uploaded = new Set();
    const prepared = new Map(), preparing = new Map();
    const identities = typeof BroadcastChannel === "function" ? new BroadcastChannel("melete-cloud-identity") : null;
    const itemId = item => item.rehearsalDate ? `rehearsal:${item.rehearsalDate}:${item.id}`
      : item.id ? `submitted:${item.owner}:${item.id}` : `cloud:${item.owner}:${item.key}:${item.revision}`;
    const itemVersion = item => JSON.stringify(item);
    let endpoint;
    function clearReviewedAudio(){
      if(/^(submitted|cloud|rehearsal):/.test(adapter.selected?.() || ""))adapter.clear();
      for (const item of listing) adapter.mute?.(itemId(item));
      prepared.clear(); preparing.clear();
    }
    function forgetSession() {
      if(session?.user)adapter.identityChanged?.();
      adapter.directoryChanged?.(null);
      clearReviewedAudio(); connection++; listEpoch++; clearTimeout(timer);
      session=null; remote=null; remoteKey=null; consentOwner=null; pendingUpload=null;
      savedRevision=-1; uploaded.clear(); listing=[]; renderListing(); controls();
    }
    if (identities) identities.onmessage = event => {
      if (event.data !== "changed") return;
      forgetSession();
      // A notification invalidates caches, never grants access; the server
      // verifies the cookie again for every already-loaded song/tab.
      void connect({interactive:false}).catch(() => {});
    };
    root.addEventListener("pagehide",event=>{if (!event.persisted) identities?.close();});
    function account() {
      const login=el('openCloudLibrary');
      if(login){login.setAttribute('aria-label',session?.user ? 'Google account and recording backups' : 'Sign in with Google to review recordings');
        login.title=session?.user ? `${session.user.name}: Google account and recording backups` : 'Sign in with Google to review recordings';}
      el("cloudIdentity").textContent=session?.user?.name || "";
      el("cloudPrivateControls").hidden=!session?.user || !adapter.state();
      el("compCloudLogout").hidden=!session?.user;
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
      el("compCloudSave").disabled ||= !adapter.state() || localOnly(adapter.state());
      el("compCloudAuto").disabled ||= localOnly(adapter.state());
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
      const attempt = ++connection, next = await request("status",{query:{song:adapter.song()}});
      if (attempt !== connection) return;
      if (session?.user?.id !== next.user?.id) {
        if(session?.user)adapter.identityChanged?.();
        adapter.directoryChanged?.(null);
        clearReviewedAudio();
        listing = []; remote = null; remoteKey = null;consentOwner=null;uploaded.clear();renderListing();
      }
      session = next;
      controls();
      if (!session.configured) throw new Error("The backup server needs its Google client ID configured. Local practice still works.");
      if (session.user) {
        el("compGoogleButton").replaceChildren();
        await loadRemote();
        message("");
        await loadListing();
        if(attempt !== connection)return;
        if(session.directoryAccess){
          const data=await request('directory',{query:{song:adapter.song()}});
          if(attempt === connection)adapter.directoryChanged?.(data.directory);
        } else adapter.directoryChanged?.(null);
        return;
      }
      if (!interactive && !el("compCloudDialog").open) return;
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
        if (session?.user) identities?.postMessage("changed");
        if(session?.user && (pendingLibrary || preferReview)){
          pendingLibrary=false;preferReview=false;el("compCloudDialog").close();adapter.openLibrary?.();
        }
        if (!session?.user || !pendingUpload) return;
        const intended = pendingUpload; pendingUpload = null;
        if (Date.now()>intended.until || adapter.state()?.key !== intended.key || adapter.state()?.revision !== intended.revision) {
          adapter.toast("The track changed during sign-in. Click Upload again.", "error"); return;
        }
        await submit();
      } catch (e) { message(e.message); }
    }
    function uploadTrack() {
      if (working || !adapter.state()?.segments.length || localOnly(adapter.state())) return;
      if (session?.user) { void submit(); return; }
      pendingUpload = {key:adapter.state().key, revision:adapter.state().revision,until:Date.now()+5*60000};
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
    async function submit() {
      const state=adapter.state(), owner=session?.user?.id;
      if(!owner || !state?.segments.length || working || localOnly(state))return;
      if(consentOwner!==owner){
        if(!confirm("Submit this comp as "+session.user.name+"? The choir reviewers can hear the finished audio and see its pitch contour and scores. Your other recordings stay private."))return;
        consentOwner=owner;
      }
      working=true;controls();message("Submitting comp...");
      try{
        const ref=state.descriptor.reference, stats=adapter.metadata().pitchScore;
        const stamp=signature(state,adapter.sources());
        const check=()=>{if(session?.user?.id!==owner || adapter.state()?.key!==state.key || adapter.state()?.revision!==state.revision)
          throw Error("The track or account changed. Select the comp and submit again.");};
        const render=await adapter.renderSubmission();check();
        const pitch=new Float32Array(render.frames.length*3);
        render.frames.forEach((f,i)=>pitch.set([f.start,f.end,Number.isFinite(f.cents)?f.cents:NaN],i*3));
        const ids=new Map(), seams=state.segments.map(s=>{
          if(!ids.has(s.takeId))ids.set(s.takeId,ids.size+1);
          return [s.from,s.to,ids.get(s.takeId)];
        });
        const track=await digest(new TextEncoder().encode(state.key)), audio=await upload(render.blob),
          pitches=await upload(new Blob([pitch]));check();
        const result=await request("submit",{method:"POST",body:{version:1,song:state.song,track,label:state.descriptor.label,
          part:ref.part,line:ref.line??null,fingerprint:ref.fingerprint,rate:ref.rate,origin:render.origin,seconds:ref.seconds,seams,
          stats:root.MeleteTakeControls.metricValues(stats),audio,pitches}});
        rememberReceipt(state.key,stamp,result,owner);adapter.submitted?.();
        const notice=result.unchanged?"This version was already submitted":"Comp submitted for review";
        message(notice);adapter.toast(notice);
        await loadListing();
      }catch(e){message(e.message);adapter.toast(e.message,"error");}
      finally{working=false;controls();}
    }
    async function save({automatic = false} = {}) {
      if (working || !session?.user || !adapter.state() || localOnly(adapter.state())) return;
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
          reviewable:false, payload: {version: 1, state, records, summary: adapter.metadata?.()}}});
        remote = result.profile; remoteKey = key; savedRevision = current.revision;
        message("");
        adapter.toast("Track backed up");
        await loadListing();
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
      pendingUpload=null;
      el("compCloudDialog").showModal(); controls();
      try { await connect(); } catch (e) { message(e.message); }
    }
    async function loadListing() {
      if (!session?.user) return;
      const owner=session.user.id, song=adapter.song(), items=[], epoch=++listEpoch;
      const active=()=>epoch===listEpoch && session?.user?.id===owner && adapter.song()===song;
      for(const action of ["submissions","list"]){
        const scope = (action === "submissions" ? session.submissionReviewer : session.reviewer) ? "review" : "mine";
        let offset=0;
        do{
          const result=await request(action,{query:{song,scope,offset}});
          if(!active())return;
          items.push(...(action==="submissions"?result.items:result.items.filter(i=>i.reviewable).map(i=>({...i,uploaded:i.updatedAt}))));
          offset=result.next;
        }while(offset!==null);
      }
      if(session.rehearsalReviewer){
        const result=await request('rehearsals',{query:{song}});
        if(!active())return;
        items.push(...result.items);
      }
      const versions = new Map(items.map(item => [itemId(item), itemVersion(item)]));
      for (const item of listing) if (versions.get(itemId(item)) !== itemVersion(item)) {
        const id = itemId(item);
        if (adapter.selected?.() === id) adapter.clear();
        adapter.mute?.(id); prepared.delete(id); preparing.delete(id);
      }
      listing = items; renderListing();
    }
    function renderListing() {
      account();
      adapter.libraryChanged?.();
    }
    const canWithdraw = item => Boolean(item.id && !item.rehearsalDate && item.owner === session?.user?.id);
    async function withdraw(item) {
      if (!canWithdraw(item)) return;
      await request("withdraw", {method:"POST", body:{id:item.id}});
      uploaded.clear(); forgetReceipt(item.id,item.owner); adapter.submitted?.(); await loadListing();
    }
    function prepare(item, downloadOnly = false) {
      const id = itemId(item), version = itemVersion(item), owner = session?.user?.id, epoch = connection;
      // Sign-out, account changes and a withdrawn/replaced item invalidate both
      // in-flight downloads and decoded audio, without touching local takes.
      const check = () => {
        if (!owner || owner !== session?.user?.id || epoch !== connection
          || !listing.some(i => itemId(i) === id && itemVersion(i) === version))
          throw new DOMException("Recording access changed", "AbortError");
      };
      check();
      if (!downloadOnly && prepared.has(id)) return Promise.resolve({...prepared.get(id)});
      if (!downloadOnly && preparing.has(id)) return preparing.get(id);
      const job = (async () => {
        try {
          const load = item.rehearsalDate ? reviewRehearsal : item.id ? reviewSubmission : reviewCloud;
          const review = await load(item, downloadOnly, check);
          check();
          if (review) {
            const frames = review.frames.map(frame => ({...frame,
              start:frame.start + review.origin, end:frame.end + review.origin}));
            review.pitchScore = root.MeleteTakePitch.scoreFrames(frames, review.ref, review.ref.seconds);
            prepared.set(id, review);
          }
          return review && {...review};
        } finally {
          if (preparing.get(id) === job) preparing.delete(id);
          renderListing();
        }
      })();
      if (!downloadOnly) preparing.set(id, job);
      renderListing();
      return job;
    }
    async function reviewRehearsal(item,downloadOnly,check) {
        const id=itemId(item);
        const get=async action=>{
          const url=new URL('rehearsal.php',endpoint);
          for(const [key,value] of Object.entries({action,date:item.rehearsalDate,id:item.id}))url.searchParams.set(key,value);
          const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(60000)});
          if(!response.ok)throw Error('Rehearsal unavailable for this Google account.');
          return response;
        };
        const stored=await (await get('pitch')).json(), ref=adapter.descriptor(stored.ref.part,stored.ref.line,stored.ref.rate)?.reference;
        check();
        if(!ref || !root.MeleteTakePitch.samePassage(stored.ref,ref))throw Error('Different score edition.');
        const blob=await (await get('audio')).blob(), ctx=adapter.context(), buffer=await ctx.decodeAudioData(await blob.arrayBuffer());
        const rest=root.MeleteTakePitch.playbackRestReference(ref,item.origin,buffer.duration);
        if(rest)for(let channel=0;channel<buffer.numberOfChannels;channel++)root.MeleteTakePitch.discardRestAudio(buffer.getChannelData(channel),buffer.sampleRate,rest);
        const ranges=item.segments.map(([a,b])=>[a*ref.rate,b*ref.rate]);
        const review={id,label:item.name+': '+item.label,ref,buffer,blob,origin:item.origin,latency:0,
          frames:root.MeleteVocalPitch.cleanPitchFrames(root.MeleteTakePitch.cleanRestFrames(
            stored.frames.map(([start,end,cents])=>({start,end,cents,live:true})),rest)),
          track:ref.part,rate:ref.rate,start:item.origin*ref.rate,end:item.end*ref.rate,ranges,
          timelineSegments:ranges.map(([from,to],i)=>({from,to,takeId:String(item.segments[i][2]),label:'Take '+item.segments[i][2]}))};
        check();
        if(downloadOnly){
          const pcm=Int16Array.from(buffer.getChannelData(0),x=>Math.round(Math.max(-1,Math.min(1,x))*32767));
          adapter.downloadBlob(new Blob([root.MeleteRecording.wavBytes(pcm,buffer.sampleRate)],{type:'audio/wav'}),`${adapter.song()}-${item.name}-${item.rehearsalDate}.wav`);
        }
        else{
          if(root.MeleteTakeLoudness)review.loudness=await root.MeleteTakeLoudness.track(buffer);
          return review;
        }
    }
    async function reviewSubmission(item,downloadOnly,check) {
        const query={owner:item.owner,id:item.id}, {manifest:m}=await request("submission",{query});
        check();
        const q={owner:item.owner,submission:item.id}, id=itemId(item);
        const ref=adapter.descriptor(m.part,m.line,m.rate)?.reference;
        if(!downloadOnly && (m.song!==adapter.song() || ref?.fingerprint!==m.fingerprint || ref.rate!==m.rate || Math.abs(ref.seconds-m.seconds)>.01))
          throw Error("Different score edition. Download the comp to listen separately.");
        const blob=await download(m.audio,q);
        check();
        if(downloadOnly){adapter.downloadBlob(blob,`${m.song}-${item.name}-${new Date(item.uploaded).toISOString().slice(0,10)}-comp.wav`);}
        else{
          const samples=new Float32Array(await (await download(m.pitches,q)).arrayBuffer()),frames=[];
          if(samples.length%3)throw Error("Invalid pitch contour");
          for(let i=0;i<samples.length;i+=3){
            const [a,b,c]=samples.subarray(i,i+3);
            if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)throw Error("Invalid pitch contour");
            frames.push({start:a,end:b,cents:Number.isFinite(c)?c:null});
          }
          const ctx=adapter.context(), buffer=await ctx.decodeAudioData(await blob.arrayBuffer());
          const ranges=m.seams.map(([a,b])=>[a*m.rate,b*m.rate]);
          const review={id,label:item.name+": "+item.label,ref,buffer,blob,frames,origin:m.origin,latency:0,
            track:m.part,rate:m.rate,start:m.origin*m.rate,end:m.seconds*m.rate,ranges,
            timelineSegments:ranges.map(([from,to],i)=>({from,to,takeId:String(m.seams[i][2]),label:"Take "+m.seams[i][2]}))};
          if(root.MeleteTakeLoudness)review.loudness=await root.MeleteTakeLoudness.track(buffer);
          return review;
        }
    }
    async function reviewCloud(item, downloadOnly, check) {
        const query={owner:item.owner,key:item.key};
        const {profile}=await request("load",{query});
        check();
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
        check();
        if (downloadOnly) adapter.downloadBlob(rendered.blob,`${state.song}-${item.name}-track.wav`);
        else {
          return {id:itemId(item),label:`${item.name}: ${item.label}`,ref,
            frames:model.framesFor(state.segments,takes).map(f=>({...f,start:f.start-rendered.origin,end:f.end-rendered.origin})),...rendered,
            track:ref.part,rate:ref.rate,start:rendered.origin*ref.rate,end:ref.seconds*ref.rate,latency:0,
            ranges:state.segments.map(s=>[s.from*ref.rate,s.to*ref.rate]),
            timelineSegments:state.segments.map(s=>({from:s.from*ref.rate,to:s.to*ref.rate,takeId:s.takeId,label:`${item.name}: take ${takes.get(s.takeId).number}`}))};
        }
    }
    function changed() {
      clearTimeout(timer);
      if (enabled()) timer = setTimeout(() => { void save({automatic: true}); }, 2500);
    }
    el("compCloudSave").onclick = () => save();
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
        forgetSession();identities?.postMessage("changed");
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
    try{const page=new URL(root.parent.location.href), requested=page.searchParams.get("song");
      preferReview=page.searchParams.get("review")==="1" && (!requested || adapter.song()===requested || adapter.song().endsWith("-"+requested));
    }catch{}
    void connect({interactive:false}).then(() => {
      if (!preferReview) return;
      if (session?.user) {preferReview=false;adapter.openLibrary?.();}
      else return open();
    }).catch(e => {if (preferReview) adapter.toast(e.message,"error");});
    return {open, uploadTrack, entries: () => listing, itemId, prepare, canWithdraw, withdraw,
      loading: id => preparing.has(id), loaded: id => prepared.get(id),
      enter: () => {pendingUpload=null;
      if(session?.user)return open();pendingLibrary=true;signIn();}, changed,
      resume: () => connect({interactive: false}).then(changed).catch(() => {})};
  }
  root.MeleteCloud = {create, digest, signature, hasReceipt, rememberReceipt, forgetReceipt, localOnly};
  if (typeof module !== "undefined" && module.exports) module.exports = root.MeleteCloud;
})(globalThis);
