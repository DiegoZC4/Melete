(() => {
  "use strict";
  // The optional desktop station copies this file's own Melete storage before
  // opening the same player at a stable, microphone-permission-capable origin.
  if (globalThis.location?.protocol==="file:" && new URLSearchParams(location.search).has("stationTransfer")
      && /^#[a-f0-9]{64}$/.test(location.hash)) {
    document.body.replaceChildren(); const msg=document.createElement("p"); msg.id="stationProgress";
    msg.textContent="Opening the local Melete recording station…"; document.body.append(msg);
    const script=document.createElement("script"); script.src="./melete-station-transfer.js";
    script.onerror=()=>{msg.textContent="The station transfer helper is missing. Your original takes are still here.";};
    document.head.append(script); return;
  }
  const source = "<!doctype html>\n" + document.documentElement.outerHTML;
  const loading = document.getElementById("loading");
  let bundle;
  try {
    bundle = JSON.parse(document.getElementById("melete-collection-data").textContent);
    if (bundle.version !== 1 || !Array.isArray(bundle.songs) || !bundle.songs.length ||
        !bundle.assets || !bundle.songs.every(song => typeof song.id === "string" &&
          typeof song.title === "string" && Array.isArray(song.chunks) &&
          song.chunks.every(key => Object.hasOwn(bundle.assets, key)))) {
      throw new Error("Missing embedded practice songs");
    }
  } catch (error) {
    loading.textContent = "This practice file is incomplete. Open the latest built copy.";
    console.error("Could not load the practice songs", error);
    return;
  }
  const songs = bundle.songs;
  const decoded = new Map();
  const decode = key => {
    if (!decoded.has(key)) {
      const text = key === bundle.inflater
        ? document.getElementById("melete-collection-inflater").textContent
        : new TextDecoder().decode(fflate.unzlibSync(Uint8Array.from(atob(bundle.assets[key]), c => c.charCodeAt(0))));
      decoded.set(key, text);
    }
    return decoded.get(key);
  };
  const settingsTemplate = document.getElementById("collectionSettings");
  const panel = document.getElementById("player");
  const players = new Map();
  const conductorView = bundle.conductor === true;
  const initialQuery = new URLSearchParams(location.search);
  const conductorDrill = initialQuery.get("drill");
  const mode = initialQuery.get("mode") ?? (initialQuery.has("station") ? "station" : "");
  const stationView = mode === "station";
  const singerKey = "melete:collection-singer:" + JSON.stringify([location.pathname,...songs.map(s=>s.id)]);
  let stationPerson;
  if (stationView) try {
    const value=sessionStorage.getItem(singerKey);
    if (value !== null) stationPerson=JSON.parse(value);
  } catch {}
  let selected = -1, frame = null, settingsOpen = null;
  const passageKeys = ["part", "div", "loop", "myVol", "otherVol", "myPan", "otherPan", "layout", "width"];
  const fieldName = k => passageKeys.find(key=>key.toLowerCase()===k.toLowerCase()) || k.toLowerCase();
  let addressFields = {}, pendingLink = null, lastAddress;
  const linkKey = text => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  function readLink() {
    const fields = params => Object.fromEntries(Array.from(params, ([k, v]) => [fieldName(k), v.trim()])
      .filter(([k, v]) => (k === "song" || passageKeys.includes(k)) && (v || k === "loop")));
    const query = fields(new URLSearchParams(location.search));
    // Old Discord links used either #the-seed or #song=the-seed, sometimes with a passage.
    const hash = location.hash.slice(1).split("&").map(token =>
      token && !token.includes("=") ? "song=" + token : token).join("&");
    const legacy = fields(new URLSearchParams(hash));
    if (query.song && legacy.song && linkKey(query.song) !== linkKey(legacy.song)) return legacy;
    if (legacy.part !== undefined) delete query.div;
    return {...query, ...legacy};
  }
  const songNamed = link => songs.findIndex(song => linkKey(song.id) === linkKey(link.song));
  function deliverLink(player) {
    if (!pendingLink || !player?.ready || player.index !== selected) return;
    const link = pendingLink;
    pendingLink = null;
    const view = player.frame.contentWindow;
    view.document.dispatchEvent(new view.CustomEvent("melete:deep-link", {detail: link}));
  }
  function writeAddress(push = false) {
    const address = new URL(location.href);
    const params = new URLSearchParams({song: songs[selected].id});
    if (mode) params.set("mode", mode);
    for (const key of passageKeys) if (addressFields[key] !== undefined) params.set(key, addressFields[key]);
    for (const [key, value] of address.searchParams) {
      if (!["song", "mode", "station", ...passageKeys].includes(fieldName(key))) params.append(key, value);
    }
    address.search = params.toString();
    address.hash = "";
    if (address.href !== location.href) {
      if (push) history.pushState(null, "", address.href);
      else history.replaceState(history.state, "", address.href);
    }
    lastAddress = location.href;
  }
  function paint(player) {
    if (player.select) player.select.value = String(selected);
    const {toggle, buttons} = player;
    if (!toggle) return;
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === selected));
      button.classList.toggle("is-active", index === selected);
      button.tabIndex = index === selected ? 0 : -1;
    });
    const active = buttons[selected];
    if (!active || !toggle.offsetWidth) return;
    Object.assign(toggle.querySelector(".pill-thumb").style, {
      transform: `translate(${active.offsetLeft + 2}px, ${active.offsetTop + 2}px)`,
      width: `${active.offsetWidth - 4}px`, height: `${active.offsetHeight - 4}px`,
    });
  }
  function mountSettings(child, player) {
    child.head.append(child.importNode(settingsTemplate.content, true));
    const settings = child.getElementById("settingsToggle");
    if (songs.length === 2) {
      const toggle = player.toggle = child.createElement("div");
      toggle.id = "songToggle";
      toggle.className = "pill-toggle" + (songs.every(song => song.icon) ? " has-icons" : "");
      toggle.setAttribute("role", "tablist");
      toggle.setAttribute("aria-label", "Practice song");
      const thumb = child.createElement("span");
      thumb.className = "pill-thumb";
      thumb.setAttribute("aria-hidden", "true");
      toggle.append(thumb);
      player.buttons = songs.map((song, index) => {
        const button = child.createElement("button");
        button.id = `melete-song-${song.id}`;
        button.className = "pill-option";
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", "scoreShell");
        button.setAttribute("aria-label", song.title);
        button.title = song.title;
        const label = child.createElement("span");
        label.className = toggle.classList.contains("has-icons") ? "song-icon" : "song-label";
        label.textContent = toggle.classList.contains("has-icons") ? song.icon : song.title;
        button.append(label);
        toggle.append(button);
        return button;
      });
      toggle.addEventListener("click", event => choose(1 - selected, event.detail === 0));
      toggle.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = ["ArrowLeft", "Home"].includes(event.key) ? 0 : 1;
        if (index === selected) player.buttons[index].focus();
        else choose(index, true);
      });
      settings.before(toggle);
      player.resizeObserver = new ResizeObserver(() => paint(player));
      player.resizeObserver.observe(toggle);
    } else if (songs.length > 2) {
      const select = player.select = child.createElement("select");
      select.id = "songSelect";
      select.setAttribute("aria-label", "Practice song");
      songs.forEach((song, index) => {
        const option = child.createElement("option");
        option.value = String(index);
        option.textContent = song.title;
        select.append(option);
      });
      select.addEventListener("change", () => choose(Number(select.value), true));
      settings.before(select);
    }
    // Replace, rather than stack another handler over the song-only download.
    const download = child.getElementById("download");
    const save = download.cloneNode(true);
    save.id = "saveCollection";
    save.title = `Save all ${songs.length} songs for offline practice`;
    save.setAttribute("aria-label", save.title);
    save.addEventListener("click", saveCollection);
    download.replaceWith(save);
    paint(player);
  }
  function deactivate() {
    if (!frame) return;
    const child = frame.contentDocument;
    child?.dispatchEvent(new frame.contentWindow.CustomEvent("melete:deactivate"));
    settingsOpen = child?.getElementById("settingsToggle")?.getAttribute("aria-expanded") === "true";
    const play = child?.getElementById("playPause");
    if (play?.classList.contains("is-playing")) play.click();
    frame.contentWindow.dispatchEvent(new Event("blur"));
    frame.inert = true;
    frame.setAttribute("aria-hidden", "true");
  }
  function activate(player, keyboard) {
    if (selected !== player.index || !player.ready) return;
    const child = player.frame.contentDocument;
    const settings = child.getElementById("settingsToggle");
    if (settingsOpen !== null && (settings.getAttribute("aria-expanded") === "true") !== settingsOpen) settings.click();
    player.frame.inert = false;
    player.frame.setAttribute("aria-hidden", "false");
    child.dispatchEvent(new player.frame.contentWindow.CustomEvent("melete:activate"));
    if (stationView) child.dispatchEvent(new player.frame.contentWindow.CustomEvent("melete:station-visit",
      {detail:{name:stationPerson, linkedPart:addressFields.part !== undefined || addressFields.div !== undefined}}));
    deliverLink(player);
    paint(player);
    loading.hidden = true;
    if (keyboard) (player.select || player.buttons?.[selected])?.focus();
    else player.frame.contentWindow.focus();
  }
  function prepare(index) {
    if (players.has(index)) return players.get(index);
    const song = songs[index];
    const currentFrame = document.createElement("iframe");
    currentFrame.setAttribute("data-melete-collection-player", "");
    const player = {index, frame: currentFrame, ready: false};
    players.set(index, player);
    currentFrame.title = `${song.title} practice score`;
    currentFrame.inert = index !== selected;
    currentFrame.setAttribute("aria-hidden", "true");
    currentFrame.setAttribute("allow", "microphone; fullscreen; autoplay; clipboard-write");
    currentFrame.addEventListener("load", () => {
      const child = currentFrame.contentDocument;
      const play = child.getElementById("playPause");
      if (!play) {
        if (index === selected) loading.textContent = "The score could not load. Reload to retry.";
        return;
      }
      if (player.document === child) return;
      if (player.document && player.index === selected && Object.keys(addressFields).length) {
        pendingLink = {...addressFields};
      }
      player.document = child;
      player.ready = false;
      if (stationView) child.addEventListener("melete:station-person", event => {
        if (player.index !== selected || (event.detail !== null && typeof event.detail !== "string")) return;
        stationPerson=event.detail;
        try { sessionStorage.setItem(singerKey,JSON.stringify(stationPerson)); } catch {}
      });
      child.addEventListener("melete:link-edited", event => {
        if (player.index !== selected) return;
        for (const key of event.detail) delete addressFields[key];
        writeAddress();
      });
      player.resizeObserver?.disconnect();
      mountSettings(child, player);
      function finish() {
        if (play.disabled) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          player.ready = true;
          activate(player, player.keyboard);
          // Keep the existing instant two-song toggle, without booting every
          // score in a large anthology before the singer has chosen it.
          if (songs.length === 2) {
            const warm = () => prepare(1 - index);
            if (window.requestIdleCallback) requestIdleCallback(warm, {timeout: 1500});
            else setTimeout(warm, 0);
          }
        }));
      }
      const observer = new MutationObserver(finish);
      observer.observe(play, {attributes: true, attributeFilter: ["disabled"]});
      finish();
    });
    try {
      const modeScript = (conductorView ? `<script data-conductor-bootstrap>window.MELETE_CONDUCTOR_VIEW=true;window.MELETE_CONDUCTOR_DRILL=${JSON.stringify(["downbeats", "cold", "gaps"].includes(conductorDrill) ? conductorDrill : null)};<\/script>` : "")
        + (stationView ? "<script data-station-bootstrap>window.MELETE_STATION=true;<\/script>" : "");
      currentFrame.srcdoc = song.chunks.map(decode).join("").replace(/<head\s*>/i, "$&" + modeScript);
      panel.append(currentFrame);
    } catch (error) {
      loading.textContent = "This practice file is incomplete. Open the latest built copy.";
      console.error("Could not decode the practice song", error);
      players.delete(index);
    }
    return player;
  }
  function choose(index, keyboard = false, link = null) {
    const switching = index !== selected;
    if (!songs[index] || (!switching && !link)) return;
    if (switching) deactivate();
    selected = index;
    addressFields = Object.fromEntries(passageKeys.filter(key => link?.[key] !== undefined).map(key => [key, link[key]]));
    pendingLink = Object.keys(addressFields).length ? {...addressFields} : null;
    writeAddress(!link);
    if (!switching) { deliverLink(players.get(index)); return; }
    const song = songs[index];
    panel.setAttribute("aria-label", `${song.title} practice score`);
    document.title = `${song.title} - ${conductorView ? "Conductor - " : ""}Melete`;
    loading.textContent = `Loading ${song.title}...`;
    const player = prepare(index);
    frame = player.frame;
    player.keyboard = keyboard;
    loading.hidden = player.ready;
    activate(player, keyboard);
  }
  document.addEventListener("keydown", event => {
    if (event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
    if (conductorView && frame) {
      frame.contentDocument.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", {code: "Space", key: " ", repeat: event.repeat, bubbles: true}));
    } else if (!event.repeat) frame?.contentDocument?.getElementById("playPause")?.click();
  }, true);
  async function saveCollection() {
    const blob = new Blob([source], {type: "text/html"});
    if (window.showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({suggestedName: bundle.downloadName, types: [{description: "Melete practice collection", accept: {"text/html": [".html"]}}]});
        const writable = await handle.createWritable();
        await writable.write(blob); await writable.close(); return;
      } catch (error) { if (error.name === "AbortError") return; }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = bundle.downloadName;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 30000);
  }
  function followAddress() {
    if (location.href === lastAddress) return;
    const link = readLink(), named = songNamed(link);
    choose(named < 0 ? Math.max(0, selected) : named, false, link);
  }
  window.addEventListener("hashchange", followAddress);
  window.addEventListener("popstate", followAddress);
  followAddress();
})();
