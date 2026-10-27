import { h } from './dom.js';
import { savedList } from './saves.js';

/**
 * The title: over the land, the name, and the way in. A new realm is a seed
 * (the same seed is always the same land) and how hard the disasters come.
 */
export function createTitle({ seed, difficulty, disasters, size, sizes, canContinue, saves, onBegin, onContinue, onNew, onLoad }) {
  const seedInput = h('input', { type: 'text', value: seed, maxlength: 24, 'aria-label': 'Seed', spellcheck: 'false' });
  // A peaceful city: no raiders, no defenses. Fires and the odd earthquake can be turned off.
  const level = difficulty;
  let chosen = size;
  const sizeSeg = h('span.seg', {}, ...Object.entries(sizes).map(([id, wards]) => h('button', { class: id === chosen ? 'on' : '', title: `${wards} × ${wards} wards, ${wards * 30} × ${wards * 30} tiles`, onclick: (e) => { chosen = id; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); note.textContent = sizeNote(id); } }, `${id[0].toUpperCase() + id.slice(1)} ${wards * 30}`)));
  const sizeNote = (id) => `${sizes[id]} × ${sizes[id]} districts. ${id === 'large' ? 'A great coast: slower to make, and it wants a good machine.' : id === 'medium' ? 'Room to grow, and a fair load.' : 'A compact coast, quick to make.'}`;
  const note = h('div.dim', { style: { fontSize: '12.5px', textAlign: 'left' } }, sizeNote(chosen));
  const dice = () => { seedInput.value = Math.random().toString(36).slice(2, 8); };
  const disastersBox = h('input', { type: 'checkbox', checked: disasters });
  const begin = () => (seedInput.value.trim() === seed && level === difficulty && chosen === size && disastersBox.checked === disasters && !canContinue ? onBegin() : onNew(seedInput.value.trim() || seed, level, chosen, disastersBox.checked));
  const shelf = h('div.title-saves', { hidden: true });
  const drawShelf = () => {
    shelf.replaceChildren(savedList(saves, { onLoad, redraw: drawShelf }));
    loadBtn.hidden = !saves.list().length;
  };
  const loadBtn = h('button.btn', { onclick: () => { shelf.hidden = !shelf.hidden; } }, 'Load a saved city');
  const el = h('div.title-screen', {},
    h('h1', {}, 'MOAT III', h('small', {}, 'The Island')),
    h('div.tag-line', {}, 'You are a tech billionaire. You bought an island off California, put your tower in the middle and dug canals round it. Now build the company town: zone it, run it, and grow it into the tech capital of the world.'),
    h('div.panel.title-card', {},
      canContinue ? h('button.btn.gold', { onclick: onContinue }, 'Continue your city') : null,
      h('button.btn' + (canContinue ? '' : '.gold'), { onclick: begin }, canContinue ? 'A new city' : 'Begin'),
      loadBtn, shelf,
      h('label', {}, 'Land (seed)', h('span', {}, seedInput, h('button.btn.small', { title: 'A different land', onclick: dice }, '⟲'))),
      h('label', {}, 'Map size', sizeSeg), note,
      h('label', {}, 'Disasters (fires, earthquakes)', disastersBox)));
  drawShelf();
  return { el, remove() { el.remove(); } };
}
