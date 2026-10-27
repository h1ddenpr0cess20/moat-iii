import { saveSlot } from 'madness-engine/storage';
import { dateText } from './sim/calendar.js';

/**
 * The saved realms. There is the game in play, which saves itself each season
 * (and is what Continue and a plain reload come back to), and up to `MAX`
 * saves the founder makes by name. Each is kept under a key of its own, with a
 * short list of them all beside, so the list is read without the saves.
 *
 * To load a named save, it is copied into the game in play and the page
 * reloaded: the map size is chosen before anything is made, from the game in
 * play, so it must be that game first.
 */

export const MAX = 8;
export const AUTO = 'auto';

const keyOf = (id) => (id === AUTO ? 'moat3.save.v1' : `moat3.save.${id}.v1`);

/** What the list says of a save. */
function describe(data, id, name, at) {
  const pop = data.pop ? Math.round((data.pop.children ?? 0) + (data.pop.adults ?? 0) + (data.pop.elders ?? 0)) : 0;
  return { id, name, at, seed: data.seed, wards: data.mapWards ?? 7, week: data.week ?? 0, date: dateText(data.week ?? 0), rank: data.rank ?? 0, people: pop, difficulty: data.difficulty };
}

export function createSaves(store = globalThis.localStorage) {
  const index = saveSlot('moat3.saves.v1', store);
  const autoAt = saveSlot('moat3.saved-at.v1', store);
  const slot = (id) => saveSlot(keyOf(id), store);

  const named = () => { const list = index.read(); return Array.isArray(list) ? list : []; };
  const drop = (id) => { try { store?.removeItem(keyOf(id)); } catch { /* the store may be closed */ } };
  const writeIndex = (list) => index.write(list.slice().sort((a, b) => b.at - a.at));

  return {
    MAX,
    /** The game in play, as saved; or null. */
    current: () => slot(AUTO).read(),
    /** When the game in play was last saved, or null if it never was. */
    currentAt: () => (slot(AUTO).read() ? autoAt.read() ?? 0 : null),
    /** Saves the game in play. */
    saveCurrent(data) {
      const ok = slot(AUTO).write(data);
      if (ok) autoAt.write(Date.now());
      return ok;
    },
    clearCurrent() { slot(AUTO).write(null); },

    /** The named saves, the newest first. */
    list: named,
    read: (id) => slot(id).read(),
    /**
     * Saves `data` by name: over the save `id` if given, else as a new one.
     * Returns the save's entry, or null if there was no room (too many, or the browser's store is full).
     */
    save(data, { id = null, name = '' } = {}) {
      const list = named();
      const old = id ? list.find((s) => s.id === id) : null;
      if (!old && list.length >= MAX) return null;
      let newId = old?.id;
      for (let n = 0; !newId || (!old && list.some((s) => s.id === newId)); n++) newId = `s${Date.now().toString(36)}${n || ''}`;
      const entry = describe(data, newId, name.trim() || old?.name || `${data.seed}, ${dateText(data.week ?? 0)}`, Date.now());
      if (!slot(newId).write(data)) return null;
      if (!writeIndex([entry, ...list.filter((s) => s.id !== newId)])) { if (!old) drop(newId); return null; }
      return entry;
    },
    rename(id, name) {
      const list = named();
      const s = list.find((x) => x.id === id);
      if (!s || !name.trim()) return false;
      s.name = name.trim();
      return writeIndex(list);
    },
    remove(id) {
      drop(id);
      writeIndex(named().filter((s) => s.id !== id));
    },
    /** Makes the named save `id` the game in play; false if it is gone or there was no room. */
    restore(id) {
      const data = slot(id).read();
      if (!data) return false;
      if (!this.saveCurrent(data)) return false;
      try { store?.setItem('moat3.wards', String(data.mapWards ?? 7)); } catch { /* the size will be guessed */ }
      return true;
    },
  };
}
