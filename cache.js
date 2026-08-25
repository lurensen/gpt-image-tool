/* 图片临时缓存：优先使用 IndexedDB 保存 Blob，不可用时回退 localStorage，有效期 1 小时 */
(function(){
'use strict';
const TTL = 60 * 60 * 1000;
const DB_NAME = 'gpt-image-cache';
const DB_VERSION = 1;
const STORE = 'images';
const LS_KEY = 'gptimg_cache_v1';
const MAX_ENTRIES = 12;

function now(){ return Date.now(); }
function uid(){
  try{
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  }catch(e){}
  return 'img-' + now() + '-' + Math.random().toString(36).slice(2, 8);
}
function dataURLtoBlob(dataURL){
  const parts = dataURL.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [,'image/png'])[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], {type: mime});
}
async function fetchAsBlob(url){
  try{
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (blob.size) return blob;
    throw new Error('empty response');
  }catch(e){
    const res = await fetch(url, {mode: 'no-cors'});
    const blob = await res.blob();
    if (blob.size) return blob;
    throw e;
  }
}

/* ---------- IndexedDB ---------- */
function openDB(){
  return new Promise((resolve, reject) => {
    if (!window.indexedDB){
      reject(new Error('IndexedDB not available'));
      return;
    }
    let req;
    try{
      req = indexedDB.open(DB_NAME, DB_VERSION);
    }catch(e){
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)){
        const store = db.createObjectStore(STORE, {keyPath: 'id'});
        store.createIndex('createdAt', 'createdAt', {unique: false});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}
function listIDB(db){
  return new Promise((resolve, reject) => {
    let tx;
    try{
      tx = db.transaction(STORE, 'readonly');
    }catch(e){
      reject(e);
      return;
    }
    let req;
    try{
      req = tx.objectStore(STORE).index('createdAt').openCursor(null, 'prev');
    }catch(e){
      req = tx.objectStore(STORE).openCursor(null, 'prev');
    }
    const out = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor){
        out.push(cursor.value);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
  });
}
function putIDB(entry){
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB write failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB write aborted')); };
  }));
}
function deleteIDB(ids){
  if (!ids.length) return Promise.resolve();
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB delete failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB delete aborted')); };
  }));
}
async function pruneIDB(){
  const db = await openDB();
  const all = await listIDB(db);
  const t = now();
  const fresh = all
    .filter(e => e.expiresAt && e.expiresAt > t)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const keep = fresh.slice(0, MAX_ENTRIES);
  const drop = all.filter(e => keep.indexOf(e) === -1);
  db.close();
  if (drop.length) await deleteIDB(drop.map(e => e.id));
}
async function saveToIDB(src, blob){
  const createdAt = now();
  const entry = {
    id: uid(),
    blob: blob,
    src: src,
    createdAt: createdAt,
    expiresAt: createdAt + TTL
  };
  await putIDB(entry);
  try{ await pruneIDB(); }catch(e){}
  return true;
}
async function loadFromIDB(){
  const db = await openDB();
  const all = await listIDB(db);
  db.close();
  const t = now();
  const fresh = all
    .filter(e => e.expiresAt && e.expiresAt > t)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const keep = fresh.slice(0, MAX_ENTRIES);
  const drop = all.filter(e => keep.indexOf(e) === -1);
  if (drop.length) deleteIDB(drop.map(e => e.id)).catch(()=>{});
  return keep;
}

/* ---------- localStorage 兜底 ---------- */
function readLS(){
  try{
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}
function writeLS(entries){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
    return true;
  }catch(e){
    return false;
  }
}
function saveLS(src, createdAt, expiresAt){
  const fresh = readLS().filter(e => e.src && e.expiresAt && e.expiresAt > now());
  const all = [{id: uid(), src: src, createdAt: createdAt, expiresAt: expiresAt}]
    .concat(fresh)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
  if (writeLS(all)) return true;
  return writeLS([{id: uid(), src: src, createdAt: createdAt, expiresAt: expiresAt}]);
}
function loadLS(){
  const fresh = readLS()
    .filter(e => e.src && e.expiresAt && e.expiresAt > now())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
  try{ localStorage.setItem(LS_KEY, JSON.stringify(fresh)); }catch(e){}
  return fresh;
}

function formatEntries(entries){
  return entries
    .map(e => ({
      id: e.id,
      src: e.blob ? URL.createObjectURL(e.blob) : e.src,
      createdAt: Number(e.createdAt) || 0,
      expiresAt: Number(e.expiresAt) || 0
    }))
    .filter(e => e.src);
}

async function save(src){
  if (!src) return false;
  if (window.indexedDB){
    try{
      let blob = null;
      if (/^data:/i.test(src)){
        blob = dataURLtoBlob(src);
      } else {
        blob = await fetchAsBlob(src);
      }
      if (blob && blob.size) return await saveToIDB(src, blob);
    }catch(e){
      if (window.console) console.warn('IndexedDB cache failed, fallback to localStorage', e);
    }
  }
  return saveLS(src, now(), now() + TTL);
}

async function load(){
  if (window.indexedDB){
    try{
      const entries = await loadFromIDB();
      if (entries.length) return formatEntries(entries);
    }catch(e){
      if (window.console) console.warn('IndexedDB cache load failed, fallback to localStorage', e);
    }
  }
  return formatEntries(loadLS());
}

window.GPTImageCache = {save: save, load: load, TTL: TTL};
})();