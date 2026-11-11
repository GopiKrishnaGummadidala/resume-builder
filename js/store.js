// Persistence: all documents live in one localStorage entry in this browser.
//
// Several tabs can have the app open at once, each with its own in-memory copy. To stop one tab
// overwriting the work of another, every save is read-merge-write: documents are merged per id and
// the newest `updatedAt` wins; deletions are remembered as tombstones so a stale tab cannot bring a
// deleted document back. See docs/concurrency.md.
import { normalizeDoc, uid } from './data.js';

export const STORAGE_KEY = 'craftfolio.v1';
export const SCHEMA = 2; // 1: { docs }   2: { schema, docs, deleted }
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;
const SAVE_DELAY = 300;

/** Parse a persisted value into a clean state. Never throws; bad input gives an empty state. */
export function parseState(raw) {
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* corrupt entry: start empty */ }
  const docs = Array.isArray(parsed?.docs) ? parsed.docs.map(normalizeDoc).filter(Boolean) : [];
  const deleted = {};
  if (parsed?.deleted && typeof parsed.deleted === 'object') {
    for (const [id, ts] of Object.entries(parsed.deleted)) if (Number.isFinite(ts)) deleted[id] = ts;
  }
  return { schema: SCHEMA, docs, deleted };
}

/**
 * Merge two states. Pure function.
 * - same id in both: the copy with the larger updatedAt wins (ties keep `mine`)
 * - a tombstone removes a document unless the document was edited after the deletion
 * - `mine` keeps its object identities, so an open editor keeps editing the same object
 */
export function mergeStates(mine, theirs, now = Date.now()) {
  const deleted = { ...theirs.deleted };
  for (const [id, ts] of Object.entries(mine.deleted)) deleted[id] = Math.max(ts, deleted[id] ?? 0);
  for (const [id, ts] of Object.entries(deleted)) if (now - ts > TOMBSTONE_TTL) delete deleted[id];

  const byId = new Map();
  for (const d of theirs.docs) byId.set(d.id, d);
  for (const d of mine.docs) {
    const other = byId.get(d.id);
    if (!other || d.updatedAt >= other.updatedAt) byId.set(d.id, d);
  }
  const docs = [...byId.values()]
    .filter(d => !(deleted[d.id] >= d.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const d of docs) delete deleted[d.id]; // edited after deletion: the edit wins, drop the tombstone
  return { schema: SCHEMA, docs, deleted };
}

/** Storage backend; swappable so the store can be unit-tested without a browser. */
function browserBackend() {
  return {
    read() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
    write(value) { localStorage.setItem(STORAGE_KEY, value); }, // may throw (quota, blocked storage)
  };
}

/** Used outside a browser (unit tests, tooling), where there is no localStorage. */
function memoryBackend() {
  let value = null;
  return { read: () => value, write: v => { value = v; } };
}

export function createStore(backend = typeof window === 'undefined' ? memoryBackend() : browserBackend()) {
  let state = parseState(backend.read());
  let timer = null;
  let failing = false;
  const listeners = new Set();
  const errorListeners = new Set();

  function persist() {
    clearTimeout(timer);
    timer = null;
    state = mergeStates(state, parseState(backend.read()));
    try {
      backend.write(JSON.stringify(state));
      failing = false;
    } catch (err) {
      if (!failing) errorListeners.forEach(fn => fn(err)); // report once per failure streak
      failing = true;
    }
  }

  function upsert(doc) {
    doc.updatedAt = Date.now();
    const i = state.docs.findIndex(d => d.id === doc.id);
    if (i === -1) state.docs.unshift(doc); else state.docs[i] = doc;
  }

  const api = {
    get docs() { return state.docs; },
    get(id) { return state.docs.find(d => d.id === id); },
    add(doc) { upsert(doc); persist(); return doc; },
    /** Record an edit to `doc` and write immediately. */
    update(doc) { upsert(doc); persist(); },
    /** Record an edit and write after a short pause (used while typing). */
    touch(doc) {
      upsert(doc);
      clearTimeout(timer);
      timer = setTimeout(persist, SAVE_DELAY);
    },
    /** Write any pending edit right away (the page is being hidden or closed). */
    flush() { if (timer) persist(); },
    remove(id) {
      state.docs = state.docs.filter(d => d.id !== id);
      state.deleted[id] = Date.now();
      persist();
    },
    duplicate(id) {
      const src = api.get(id);
      if (!src) return null;
      const copy = structuredClone(src);
      copy.id = uid();
      copy.title = `${src.title} (copy)`;
      for (const key of ['experience', 'education', 'projects']) (copy[key] || []).forEach(e => (e.id = uid()));
      return api.add(copy);
    },
    /** Another tab changed storage: fold its changes in. Returns the ids whose content changed here. */
    syncFromStorage() {
      const before = new Map(state.docs.map(d => [d.id, d.updatedAt]));
      const theirs = parseState(backend.read());
      state = mergeStates(state, theirs);
      const after = new Map(state.docs.map(d => [d.id, d.updatedAt]));
      const changed = new Set();
      for (const [id, ts] of after) if (before.get(id) !== ts) changed.add(id);
      for (const id of before.keys()) if (!after.has(id)) changed.add(id);
      // Self-heal: if storage lacks something this tab has (two tabs wrote at the same moment and
      // one write was overwritten), write the merged state back. Tabs converge: the other tab then
      // sees nothing new and does not write again.
      const stored = new Map(theirs.docs.map(d => [d.id, d.updatedAt]));
      const behind = state.docs.some(d => stored.get(d.id) !== d.updatedAt)
        || Object.entries(state.deleted).some(([id, ts]) => theirs.deleted[id] !== ts);
      if (behind) persist();
      if (changed.size) listeners.forEach(fn => fn(changed));
      return changed;
    },
    /** fn(changedIds) is called when another tab changed the documents. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** fn(err) is called when saving fails (storage full or blocked). */
    onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },
  };
  return api;
}

export const store = createStore();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === STORAGE_KEY || e.key === null) store.syncFromStorage(); });
  // Typing saves after a short pause; make sure that pause never loses the last keystrokes.
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
}
