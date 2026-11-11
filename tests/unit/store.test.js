import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseState, mergeStates, createStore, SCHEMA } from '../../js/store.js';
import { blankResume, blankLetter } from '../../js/data.js';

/** In-memory stand-in for localStorage; two stores sharing one behave like two browser tabs. */
function fakeBackend() {
  let value = null;
  return {
    read: () => value,
    write: v => { value = v; },
    get raw() { return value; },
    set raw(v) { value = v; },
  };
}
const doc = (id, updatedAt, title = id) => ({ ...blankResume(), id, updatedAt, title });
const state = (docs = [], deleted = {}) => ({ schema: SCHEMA, docs, deleted });
const DAY = 24 * 60 * 60 * 1000;

describe('parseState', () => {
  test('returns an empty state for missing, corrupt or wrong-shaped data', () => {
    for (const raw of [null, '', 'not json', '42', '{"docs":"nope"}', '[]']) {
      assert.deepEqual(parseState(raw), state());
    }
  });

  test('reads the original format that had only { docs }', () => {
    const s = parseState(JSON.stringify({ docs: [doc('abcd1234', 5)] }));
    assert.equal(s.docs.length, 1);
    assert.equal(s.docs[0].id, 'abcd1234');
    assert.deepEqual(s.deleted, {});
  });

  test('drops entries that are not documents and cleans the rest', () => {
    const s = parseState(JSON.stringify({ docs: [null, 7, 'x', { foo: 1 }, { title: 'Keep me', theme: { color: 'red' } }] }));
    assert.equal(s.docs.length, 1);
    assert.equal(s.docs[0].title, 'Keep me');
    assert.match(s.docs[0].theme.color, /^#[0-9a-f]{6}$/i);
  });

  test('ignores tombstones that are not timestamps', () => {
    const s = parseState(JSON.stringify({ docs: [], deleted: { a: 5, b: 'x', c: null } }));
    assert.deepEqual(s.deleted, { a: 5 });
  });
});

describe('mergeStates', () => {
  test('keeps documents that exist on only one side', () => {
    const m = mergeStates(state([doc('aaaa', 1)]), state([doc('bbbb', 2)]), 10);
    assert.deepEqual(m.docs.map(d => d.id).sort(), ['aaaa', 'bbbb']);
  });

  test('the newer copy of the same document wins, in both directions', () => {
    assert.equal(mergeStates(state([doc('aaaa', 5, 'mine')]), state([doc('aaaa', 9, 'theirs')]), 10).docs[0].title, 'theirs');
    assert.equal(mergeStates(state([doc('aaaa', 9, 'mine')]), state([doc('aaaa', 5, 'theirs')]), 10).docs[0].title, 'mine');
  });

  test('a tie keeps the local object, so an open editor keeps its reference', () => {
    const mine = doc('aaaa', 5, 'mine');
    assert.equal(mergeStates(state([mine]), state([doc('aaaa', 5, 'theirs')]), 10).docs[0], mine);
  });

  test('a deletion in another tab removes the local copy', () => {
    const m = mergeStates(state([doc('aaaa', 5)]), state([], { aaaa: 8 }), 10);
    assert.equal(m.docs.length, 0);
    assert.equal(m.deleted.aaaa, 8);
  });

  test('a local deletion is not undone by a stale copy in storage', () => {
    const m = mergeStates(state([], { aaaa: 8 }), state([doc('aaaa', 5)]), 10);
    assert.equal(m.docs.length, 0);
  });

  test('an edit made after the deletion wins and clears the tombstone', () => {
    const m = mergeStates(state([doc('aaaa', 9)]), state([], { aaaa: 8 }), 10);
    assert.equal(m.docs.length, 1);
    assert.equal(m.deleted.aaaa, undefined);
  });

  test('old tombstones expire', () => {
    const now = 100 * DAY;
    const m = mergeStates(state([], { old: now - 31 * DAY, recent: now - DAY }), state(), now);
    assert.deepEqual(Object.keys(m.deleted), ['recent']);
  });

  test('result is sorted newest first', () => {
    const m = mergeStates(state([doc('aaaa', 1), doc('cccc', 3)]), state([doc('bbbb', 2)]), 10);
    assert.deepEqual(m.docs.map(d => d.id), ['cccc', 'bbbb', 'aaaa']);
  });
});

describe('createStore', () => {
  test('add, get, update, remove round-trip through storage', () => {
    const backend = fakeBackend();
    const store = createStore(backend);
    const d = store.add(blankResume());
    assert.equal(store.get(d.id), d);
    d.title = 'Renamed';
    store.update(d);
    assert.equal(createStore(backend).get(d.id).title, 'Renamed');
    store.remove(d.id);
    assert.equal(createStore(backend).docs.length, 0);
  });

  test('duplicate makes an independent copy with new ids', () => {
    const store = createStore(fakeBackend());
    const src = store.add({ ...blankResume(), experience: [{ id: 'exp00001', role: 'Dev', company: '', location: '', start: '', end: '', bullets: '' }] });
    const copy = store.duplicate(src.id);
    assert.notEqual(copy.id, src.id);
    assert.notEqual(copy.experience[0].id, src.experience[0].id);
    assert.match(copy.title, /\(copy\)$/);
    copy.experience[0].role = 'Changed';
    assert.equal(src.experience[0].role, 'Dev');
    assert.equal(store.duplicate('missing0'), null);
  });

  test('two tabs: a save in one tab does not erase a document created in the other', () => {
    const backend = fakeBackend();
    const tabA = createStore(backend);
    const tabB = createStore(backend); // both start empty
    const a = tabA.add(blankResume());
    const b = tabB.add(blankLetter()); // tab B has never seen `a`
    const fresh = createStore(backend);
    assert.deepEqual(fresh.docs.map(d => d.id).sort(), [a.id, b.id].sort());
  });

  test('two tabs: a deleted document is not resurrected by a stale tab', () => {
    const backend = fakeBackend();
    const tabA = createStore(backend);
    const d = tabA.add(blankResume());
    const tabB = createStore(backend); // has a copy of d
    tabA.remove(d.id);
    tabB.add(blankLetter()); // tab B saves while still holding d in memory
    assert.equal(createStore(backend).get(d.id), undefined);
    assert.equal(tabB.get(d.id), undefined);
  });

  test('syncFromStorage reports which documents changed and notifies subscribers', () => {
    const backend = fakeBackend();
    const tabA = createStore(backend);
    const tabB = createStore(backend);
    const seen = [];
    tabB.subscribe(changed => seen.push([...changed]));
    const d = tabA.add(blankResume());
    assert.deepEqual([...tabB.syncFromStorage()], [d.id]);
    assert.deepEqual(seen, [[d.id]]);
    assert.equal(tabB.syncFromStorage().size, 0, 'nothing new: no notification');
    assert.equal(seen.length, 1);
    tabA.remove(d.id);
    assert.deepEqual([...tabB.syncFromStorage()], [d.id]);
    assert.equal(tabB.get(d.id), undefined);
  });

  test('a write overwritten by another tab at the same moment is healed on sync', () => {
    const backend = fakeBackend();
    const tabA = createStore(backend);
    const tabB = createStore(backend);
    const a = tabA.add(blankResume());
    const afterA = backend.raw;
    const b = tabB.add(blankLetter());
    // Simulate the race: tab B's write was based on storage from before tab A wrote, so A's document is gone.
    backend.raw = JSON.stringify({ schema: SCHEMA, docs: [b], deleted: {} });
    assert.equal(createStore(backend).get(a.id), undefined, 'precondition: storage lost tab A\'s document');
    tabA.syncFromStorage(); // tab A hears about B's write
    const healed = createStore(backend);
    assert.ok(healed.get(a.id) && healed.get(b.id), 'both documents are back in storage');
    const settled = backend.raw;
    tabB.syncFromStorage();
    tabA.syncFromStorage();
    assert.equal(backend.raw, settled, 'tabs converge: no further writes');
    assert.notEqual(afterA, settled);
  });

  test('touch delays the write and flush forces it', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const backend = fakeBackend();
    const store = createStore(backend);
    const d = store.add(blankResume());
    d.title = 'Typing…';
    store.touch(d);
    assert.equal(createStore(backend).get(d.id).title, 'Untitled CV', 'not written yet');
    store.flush();
    assert.equal(createStore(backend).get(d.id).title, 'Typing…');
    d.title = 'More typing';
    store.touch(d);
    t.mock.timers.tick(300);
    assert.equal(createStore(backend).get(d.id).title, 'More typing', 'written after the pause');
  });

  test('a failing storage reports once per failure streak and keeps the data in memory', () => {
    const backend = fakeBackend();
    let fail = true;
    const store = createStore({ read: backend.read, write: v => { if (fail) throw new Error('QuotaExceededError'); backend.write(v); } });
    const errors = [];
    store.onError(e => errors.push(e.message));
    const d = store.add(blankResume());
    store.update(d);
    assert.equal(errors.length, 1, 'one report for the streak');
    assert.equal(store.get(d.id), d, 'still usable in memory');
    fail = false;
    store.update(d);
    assert.equal(createStore(backend).docs.length, 1, 'recovers when storage works again');
    fail = true;
    store.update(d);
    assert.equal(errors.length, 2, 'a new streak reports again');
  });

  test('corrupt storage does not crash the app', () => {
    const backend = fakeBackend();
    backend.raw = '{"docs":[{"broken":';
    const store = createStore(backend);
    assert.equal(store.docs.length, 0);
    store.add(blankResume());
    assert.equal(createStore(backend).docs.length, 1);
  });
});
