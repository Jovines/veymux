import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { IDBFactory } = createRequire(new URL('../desktop-rust/package.json', import.meta.url))('fake-indexeddb');
const source = fs.readFileSync(new URL('../public/brand-migration.js', import.meta.url), 'utf8');
const previous = 'termdock';
class Storage {
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}
function open(indexedDB, name, version = 1) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function write(indexedDB, name, value, version = 1) {
  const db = await open(indexedDB, name, version);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put(value, 'identity');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function read(indexedDB, name) {
  const db = await open(indexedDB, name);
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('keys').objectStore('keys').get('identity');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
function start(indexedDB, localStorage = new Storage(), sessionStorage = new Storage()) {
  const window = {};
  vm.runInNewContext(source, { window, indexedDB, localStorage, sessionStorage, console: { error() {} } });
  return window.veymuxMigrationReady;
}
test('copies device credentials and browser settings before declaring the upgrade complete', async () => {
  const indexedDB = new IDBFactory(), local = new Storage(), session = new Storage();
  local.setItem(`${previous}-color-theme`, '"light"'); session.setItem(`${previous}-secure-target-v1`, 'peer-id');
  await write(indexedDB, `${previous}-device-identity`, new Uint8Array([1, 2, 3, 255]));
  const ready = start(indexedDB, local, session);
  assert.equal(local.getItem('veymux-color-theme'), '"light"');
  assert.equal(local.getItem(`${previous}-color-theme`), null);
  await ready;
  assert.deepEqual(await read(indexedDB, 'veymux-device-identity'), new Uint8Array([1, 2, 3, 255]));
  assert.equal(session.getItem('veymux-secure-target-v1'), 'peer-id');
  await start(indexedDB, local, session);
  assert.deepEqual(await read(indexedDB, 'veymux-device-identity'), new Uint8Array([1, 2, 3, 255]));
});
test('existing new settings and keys win over an older installation', async () => {
  const indexedDB = new IDBFactory(), storage = new Storage();
  storage.setItem(`${previous}-color-theme`, '"light"'); storage.setItem('veymux-color-theme', '"dark"');
  await write(indexedDB, `${previous}-device-identity`, 'previous-key');
  await write(indexedDB, 'veymux-device-identity', 'new-key');
  await start(indexedDB, storage);
  assert.equal(await read(indexedDB, 'veymux-device-identity'), 'new-key');
  assert.equal(storage.getItem('veymux-color-theme'), '"dark"');
});
test('failed database upgrade rejects readiness and retains the original credential', async () => {
  const indexedDB = new IDBFactory();
  await write(indexedDB, `${previous}-device-identity`, 'irreplaceable-key');
  await write(indexedDB, 'veymux-device-identity', 'newer-schema', 2);
  await assert.rejects(start(indexedDB));
  assert.equal(await read(indexedDB, `${previous}-device-identity`), 'irreplaceable-key');
});
