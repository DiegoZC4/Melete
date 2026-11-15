/* Device-local copies of reviewed media. Keep the small picker index separate from the audio. */
(() => {
  "use strict";
  let opening;
  function database() {
    if (!opening) opening = new Promise(resolve => {
      let req;
      try { req = indexedDB.open("melete-review-media-v1", 1); }
      catch { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("items", {keyPath:["scope","id"]}).createIndex("scope","scope");
        db.createObjectStore("media");
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      req.onerror = req.onblocked = () => resolve(null);
    });
    return opening;
  }
  async function transaction(stores, mode, run) {
    const db = await database();
    if (!db) return null;
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error);
        run(tx, value => { result = value; });
      });
    } catch { return null; } // Browsers with unavailable/full storage can still stream.
  }
  function open(scope) {
    return {
      async list() {
        return await transaction(["items"], "readonly", (tx, done) => {
          const req = tx.objectStore("items").index("scope").getAll(scope);
          req.onsuccess = () => done(req.result);
        }) || [];
      },
      get(id, version) {
        return transaction(["items","media"], "readonly", (tx, done) => {
          const key = [scope,id], item = tx.objectStore("items").get(key);
          item.onsuccess = () => {
            if (item.result?.version !== version) return;
            const media = tx.objectStore("media").get(key);
            media.onsuccess = () => done(media.result);
          };
        });
      },
      put(id, version, item, media, observed, current = () => true) {
        return transaction(["items","media"], "readwrite", (tx, done) => {
          const items = tx.objectStore("items"), key = [scope,id], before = items.get(key);
          before.onsuccess = () => {
            if (!current() || (before.result?.version !== version && before.result?.observed > observed)) return;
            items.put({scope,id,version,item,observed});
            tx.objectStore("media").put(media,key);
            done(true);
          };
        });
      },
      remove(id, version) {
        return transaction(["items","media"], "readwrite", tx => {
          const items = tx.objectStore("items"), key = [scope,id], before = items.get(key);
          before.onsuccess = () => {
            if (before.result?.version !== version) return;
            items.delete(key);
            tx.objectStore("media").delete(key);
          };
        });
      }
    };
  }
  globalThis.MeleteReviewCache = {open};
})();
