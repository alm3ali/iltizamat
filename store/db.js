// غلاف صغير لـ IndexedDB. كل البيانات تبقى على الجهاز.
import { COLLECTIONS, DEFAULT_SETTINGS, SCHEMA_VERSION, validateBackup } from '../logic/backup.js';

const DB_NAME = 'iltizamat';
const DB_VERSION = 1;
const SETTINGS = 'settings';

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      for (const c of COLLECTIONS) {
        if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function getAll(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, record) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(record);
  await txDone(tx);
  return record;
}

export async function remove(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

/** يكتب عدة سجلات في عدة مخازن ضمن معاملة واحدة. */
export async function putMany(byStore) {
  const db = await open();
  const stores = Object.keys(byStore).filter((s) => byStore[s]?.length);
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) for (const r of byStore[s]) tx.objectStore(s).put(r);
  await txDone(tx);
}

export async function getSettings() {
  const db = await open();
  const s = await done(db.transaction(SETTINGS).objectStore(SETTINGS).get('main'));
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(settings) {
  const db = await open();
  const tx = db.transaction(SETTINGS, 'readwrite');
  tx.objectStore(SETTINGS).put(settings, 'main');
  await txDone(tx);
  return settings;
}

export async function exportAll() {
  const out = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: await getSettings() };
  for (const c of COLLECTIONS) out[c] = await getAll(c);
  return out;
}

/** يستبدل كل البيانات بمحتوى ملف. يرمي خطأ إن لم يكن صالحاً. */
export async function importAll(raw) {
  const { ok, data, errors } = validateBackup(raw);
  if (!ok) throw new Error(errors.join('\n'));
  const db = await open();
  const stores = [SETTINGS, ...COLLECTIONS];
  const tx = db.transaction(stores, 'readwrite');
  for (const c of COLLECTIONS) {
    const os = tx.objectStore(c);
    os.clear();
    for (const r of data[c]) os.put(r);
  }
  tx.objectStore(SETTINGS).put(data.settings, 'main');
  await txDone(tx);
}

export async function clearAll() {
  const db = await open();
  const stores = [SETTINGS, ...COLLECTIONS];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
}

export async function isEmpty() {
  return (await getAll('items')).length === 0 && (await getAll('debts')).length === 0;
}
