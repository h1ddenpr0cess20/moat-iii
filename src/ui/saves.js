import { RANKS } from '../catalog.js';
import { MAP_SIZES } from '../config.js';
import { h, num } from './dom.js';

/**
 * The list of the founder's saved cities, for the menu and the title. A button
 * that would lose something asks to be pressed twice.
 */

const sizeName = (wards) => { const k = Object.keys(MAP_SIZES).find((id) => MAP_SIZES[id] === wards) ?? 'small'; return k[0].toUpperCase() + k.slice(1); };

/** A button that does `fn` on its second press; the first asks. */
export function twice(label, fn, { sure = 'Sure?', cls = '.small' } = {}) {
  let armed = null;
  const btn = h('button.btn' + cls, {
    onclick: () => {
      if (armed) { clearTimeout(armed); armed = null; fn(); return; }
      btn.textContent = sure;
      armed = setTimeout(() => { armed = null; btn.textContent = label; }, 2500);
    },
  }, label);
  return btn;
}

/**
 * The saves in `saves`, each with what can be done to it: `onLoad(id)`, and if given
 * `onOverwrite(id)`; any can be deleted. `redraw` is called when the list changes.
 */
export function savedList(saves, { onLoad, onOverwrite = null, redraw }) {
  const list = saves.list();
  if (!list.length) return h('p.dim', {}, 'No realms saved by name yet.');
  return h('div.saves', {}, ...list.map((s) => {
    const rank = RANKS[s.rank]?.name;
    return h('div.save-row', {},
      h('div.save-info', {},
        h('b', {}, s.name),
        h('small.dim', {}, [s.date, rank, s.people ? `${num(s.people)} people` : null, `${sizeName(s.wards)} map`, `seed ${s.seed}`].filter(Boolean).join(' · ')),
        h('small.dim', {}, `Saved ${new Date(s.at).toLocaleString()}`)),
      h('div.save-actions', {},
        twice('Load', () => onLoad(s.id), { sure: 'Load?' }),
        onOverwrite ? twice('Save over', () => onOverwrite(s.id), { sure: 'Over it?' }) : null,
        twice('Delete', () => { saves.remove(s.id); redraw(); }, { sure: 'Delete?' })));
  }));
}
