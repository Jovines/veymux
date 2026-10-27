/* One-way upgrade of browser preferences and device keys, before app startup. */
(() => {
  const previous = 'termdock';
  const current = 'veymux';
  const renamed = name => name.replace(new RegExp(previous, 'gi'), current);
  function migrateStorage(storage) {
    for (const key of Object.keys(storage)) {
      if (!key.toLowerCase().includes(previous)) continue;
      const next = renamed(key);
      if (storage.getItem(next) === null) storage.setItem(next, storage.getItem(key));
      storage.removeItem(key);
    }
  }
  function opened(request, upgrade) {
    return new Promise((resolve, reject) => {
      request.onupgradeneeded = event => upgrade?.(request.result, event);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other app tabs and reload to finish updating.'));
    });
  }
  async function migrateDatabase(name) {
    const source = await opened(indexedDB.open(name));
    const stores = [...source.objectStoreNames];
    if (!stores.length) { source.close(); indexedDB.deleteDatabase(name); return; }
    let target;
    try {
      target = await opened(indexedDB.open(renamed(name), source.version), database => {
        for (const name of stores) {
          const old = source.transaction(name).objectStore(name);
          const store = database.createObjectStore(name, { keyPath: old.keyPath, autoIncrement: old.autoIncrement });
          for (const indexName of old.indexNames) {
            const index = old.index(indexName);
            store.createIndex(indexName, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
          }
        }
      });
      for (const name of stores) {
        const entries = await new Promise((resolve, reject) => {
          const rows = [], tx = source.transaction(name), cursor = tx.objectStore(name).openCursor();
          cursor.onsuccess = () => { const row = cursor.result; if (row) { rows.push([row.key, row.value]); row.continue(); } };
          tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(tx.error);
        });
        await new Promise((resolve, reject) => {
          const tx = target.transaction(name, 'readwrite'), store = tx.objectStore(name);
          for (const [key, value] of entries) {
            const request = store.getKey(key);
            request.onsuccess = () => {
              if (request.result === undefined) store.keyPath === null ? store.put(value, key) : store.put(value);
            };
          }
          tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
        });
      }
    } finally { source.close(); target?.close(); }
    indexedDB.deleteDatabase(name);
  }
  window.veymuxMigrationReady = (async () => {
    migrateStorage(localStorage);
    migrateStorage(sessionStorage);
    if (typeof indexedDB === 'undefined') return;
    const databases = indexedDB.databases ? await indexedDB.databases()
      : [{ name: `${previous}-device-identity` }, { name: `${previous}-encrypted-background` }, { name: `${previous}-media-plugins` }];
    for (const { name } of databases) if (name?.startsWith(previous)) await migrateDatabase(name);
  })();
  // Keep rejection observable by the app without an unhandled-rejection event.
  window.veymuxMigrationReady.catch(error => console.error('Veymux data upgrade failed', error));
})();
