(() => {
  "use strict";
  if (window !== window.top || !/^https?:$/.test(location.protocol) ||
      !/(?:\/|\/index\.html)$/.test(location.pathname)) return;
  // The native rehearsal station already serves its own on-disk copy without internet.
  if (["localhost","127.0.0.1","[::1]"].includes(location.hostname) && location.port==="18746") return;
  const build = "__MELETE_BUILD__", base = new URL("./", location.href);
  const workerURL = new URL("melete-offline.js", base).href;
  const buttons = new Set();
  let state = "saving", reg, pending, lastCheck = 0, checkNumber = 0;
  const copy = {
    saving:["Saving offline...", "Preparing this player for use without Wi-Fi."],
    ready:["", "This player is saved for offline use."],
    failed:["Retry offline", "This player is not verified for offline use. Connect and tap to retry."],
    unsupported:["Online only", "This browser cannot keep an offline copy here."],
    older:["", "The saved player version differs from this tab. Reload when finished."]
  };
  function show(next) {
    state = next;
    for (const b of buttons) {
      if (!b.isConnected) {buttons.delete(b);continue;}
      const [label, detail] = copy[state];
      b.hidden = state !== "failed";
      b.textContent = label; b.title = detail;
      b.dataset.state = state; b.setAttribute("aria-label", [label,detail].filter(Boolean).join(". "));
      const download = b.ownerDocument.querySelector("#saveCollection, #download");
      if (download) {
        const help = download.dataset.offlineBaseHelp ??= download.dataset.help || "";
        const status = state === "failed" ? "Offline copy not verified." : detail;
        download.dataset.help = [help, status].filter(Boolean).join(" ");
        download.setAttribute("aria-description", status);
      }
    }
  }
  function mount(doc) {
    const anchor = doc.querySelector("#settingsHelp");
    if (!anchor || doc.querySelector("#offlineReady")) return;
    const b = doc.createElement("button");
    b.id = "offlineReady"; b.type = "button"; b.className = "offline-readiness"; b.hidden = true;
    b.addEventListener("click", () => {
      if (matchMedia("(display-mode: standalone)").matches || navigator.standalone)
        void navigator.storage?.persist?.().catch(()=>{});
      void setup(true);
    });
    anchor.after(b);buttons.add(b);show(state);
  }
  window.MeleteOfflinePlayer = {mount};
  function ask(controller, repair) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const end = (fn, value) => {clearTimeout(timer); channel.port1.close(); fn(value);};
      const timer = setTimeout(() => end(reject, Error("Offline check timed out")), repair ? 30000 : 5000);
      channel.port1.onmessage = e => end(resolve,e.data);
      try {controller.postMessage({type:"melete:offline-check",repair},[channel.port2]);}
      catch(e) {end(reject,e);}
    });
  }
  async function check(repair = false) {
    const serial = ++checkNumber, ctrl = navigator.serviceWorker.controller;
    if (ctrl?.scriptURL !== workerURL) return false;
    try {
      const reply = await ask(ctrl,repair);
      if (serial === checkNumber) show(reply?.ready ? (reply.build===build?"ready":"older") : "failed");
      lastCheck = Date.now();
      return Boolean(reply?.ready);
    } catch { if(serial===checkNumber)show("failed"); return false; }
  }
  async function setup(retry = false) {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {show("unsupported");return;}
    if (pending) return pending;
    pending = (async () => {
      if (retry) show("saving");
      await check(retry);
      const existing = await navigator.serviceWorker.getRegistration(base.href);
      if (existing?.scope===base.href && [existing.active,existing.waiting,existing.installing].some(w=>w && w.scriptURL!==workerURL))
        throw Error("Another app owns this service-worker scope");
      reg = existing?.scope===base.href ? existing : null;
      if (!reg) reg = await navigator.serviceWorker.register(workerURL, {scope:base.href,updateViaCache:"none"});
      else if (retry || navigator.onLine) void reg.update().catch(()=>{});
      const watch = w => {
        if (!w) return;
        const changed = () => {
          if(w.state==="redundant" && !navigator.serviceWorker.controller) show("failed");
          else if(w.state==="activated") void check();
        };
        w.addEventListener("statechange",changed);changed();
      };
      if (!reg.meleteWatched) {
        reg.meleteWatched = true; reg.addEventListener("updatefound",()=>watch(reg.installing));
        watch(reg.installing); watch(reg.active);
      }
      if (!await check() && !reg.installing && !reg.active && !reg.waiting) show("failed");
    })().catch(()=>{if(navigator.serviceWorker.controller?.scriptURL!==workerURL || state==="saving")show("failed");})
      .finally(()=>{pending=null;});
    return pending;
  }
  document.addEventListener("DOMContentLoaded", () => {
    mount(document);
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange",()=>void check());
    void setup();
    // A stalled first install must never look like a verified download.
    setTimeout(()=>{if(state==="saving")show("failed");},45000);
    window.addEventListener("online",()=>void setup(true));
    document.addEventListener("visibilitychange",()=>{
      if (!document.hidden && Date.now()-lastCheck>30000) void setup();
    });
  },{once:true});
})();
