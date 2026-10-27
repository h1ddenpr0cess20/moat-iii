import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX, createSaves } from '../src/saves.js';

/** A browser store in memory, which can be made to fill up. */
function memoryStore(limit = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const used = [...m].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
      if (used + v.length > limit) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

const realm = (seed, week = 50) => ({ v: 1, mapWards: 9, seed, week, rank: 1, difficulty: 'normal', pop: { children: 10, adults: 20, elders: 4.4 } });

test('saves by name are kept apart, listed newest first, and come back', () => {
  const store = memoryStore();
  const saves = createSaves(store);
  const a = saves.save(realm('alder', 10), { name: 'Before the raid' });
  const b = saves.save(realm('birch', 100));
  assert.ok(a && b && a.id !== b.id);
  assert.equal(b.name, 'birch, April, Year 3');
  assert.equal(a.people, 34);
  assert.deepEqual(saves.list().map((s) => s.id).sort(), [a.id, b.id].sort());
  assert.equal(saves.read(a.id).seed, 'alder');
  assert.equal(saves.read(b.id).seed, 'birch');
  // Saving over one keeps its name and its place.
  const again = saves.save(realm('alder', 20), { id: a.id });
  assert.equal(again.id, a.id);
  assert.equal(again.name, 'Before the raid');
  assert.equal(saves.read(a.id).week, 20);
  assert.equal(saves.list().length, 2);
  assert.equal(saves.list()[0].id, a.id);
  saves.remove(b.id);
  assert.equal(saves.read(b.id), null);
  assert.deepEqual(saves.list().map((s) => s.id), [a.id]);
});

test('a named save is loaded by making it the game in play', () => {
  const store = memoryStore();
  const saves = createSaves(store);
  saves.saveCurrent(realm('elm'));
  const kept = saves.save({ ...realm('oak'), mapWards: 11 });
  assert.equal(saves.current().seed, 'elm');
  assert.ok(saves.restore(kept.id));
  assert.equal(saves.current().seed, 'oak');
  assert.equal(store.getItem('moat3.wards'), '11');
  assert.ok(saves.currentAt() > 0);
  assert.equal(saves.restore('gone'), false);
});

test('the game in play is where it always was, so old saves still continue', () => {
  const store = memoryStore();
  store.setItem('moat3.save.v1', JSON.stringify(realm('old')));
  const saves = createSaves(store);
  assert.equal(saves.current().seed, 'old');
  assert.equal(saves.currentAt(), 0);
  assert.deepEqual(saves.list(), []);
});

test('there is room for so many saves, and a full store is said, not hidden', () => {
  const saves = createSaves(memoryStore());
  for (let i = 0; i < MAX; i++) assert.ok(saves.save(realm(`s${i}`)));
  assert.equal(saves.save(realm('one too many')), null);
  assert.ok(saves.save(realm('over'), { id: saves.list()[3].id }), 'saving over one still works');

  const small = memoryStore(400);
  const tight = createSaves(small);
  assert.ok(tight.save(realm('fits')));
  assert.equal(tight.save({ ...realm('too big'), pad: 'x'.repeat(500) }), null);
  assert.equal(tight.list().length, 1);
  assert.equal(small.keys().filter((k) => k.startsWith('moat3.save.')).length, 1, 'a save that did not fit leaves nothing behind');
});
