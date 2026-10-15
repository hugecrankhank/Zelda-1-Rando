/*
 * store.js — tiny IndexedDB key/value store, so your base ROM and the seed
 * you're playing survive reloads (and iOS killing the tab). Nothing leaves
 * the browser.
 */
(function () {
  'use strict';
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('z1r-unified', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction('kv', mode), s = t.objectStore('kv');
      const req = fn(s);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    }));
  }
  window.Z1Store = {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
  };

  // Short, stable fingerprint of a ROM (FNV-1a, hex) for save names and tracker keys.
  window.Z1Hash = function (bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
})();
