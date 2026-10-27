import { h } from './dom.js';
import { icon } from './icons.js';
import { savedList } from './saves.js';

/**
 * The menu: save and load, sound, how the picture is drawn, and how to play.
 */

const CONTROLS = [
  ['Slide the map', 'WASD or arrow keys; the right button dragged; or one finger dragged on empty ground'],
  ['Turn and tilt', 'Q and E to turn; Z and X to tilt; the middle button dragged; or two fingers twisted'],
  ['Draw in or out', 'The wheel, + and −, or a pinch'],
  ['Tools', '1 look · 2 roads · 3 zones · 4 blocks · 5 build · 6 clear · Esc or right-click to let go'],
  ['Turn a building', 'R, while it is in your hand'],
  ['Time', 'Space to pause, Tab for faster'],
  ['Pages', 'M the district map · L the budget · H the news · C the tower'],
];

export function menuDialog(ctx) {
  const { game, sound, flow } = ctx;
  const slider = (label, which) => {
    const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(sound.settings[which] * 100), 'aria-label': label, oninput: () => sound.setVolume(which, +input.value / 100) });
    return h('div.stat', {}, h('span', {}, label), input);
  };
  return {
    title: 'Settings',
    icon: 'castle',
    width: 720,
    draw(body) {
      const saved = flow.savedAt();
      const mute = h('button.btn.small', { onclick: () => { sound.toggleMute(); mute.textContent = sound.muted ? 'Sound off' : 'Sound on'; } }, sound.muted ? 'Sound off' : 'Sound on');
      const quality = h('span.seg', {}, ...[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([id, name]) => h('button', { class: flow.quality === id ? 'on' : '', onclick: (e) => { flow.setQuality(id); e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); } }, name)));
      const redraw = () => this.draw(body);
      const stored = (entry, what) => {
        if (entry) { ctx.say(`${what}: ${entry.name}.`, 'good'); redraw(); } else ctx.say(flow.saves.list().length >= flow.saves.MAX ? `There is room for ${flow.saves.MAX} saves: delete one first.` : 'The game could not be saved: the browser has no room for it.', 'bad');
      };
      const nameInput = h('input.save-name', { type: 'text', maxlength: 40, placeholder: `${game.seed}, as it stands`, 'aria-label': 'Name of the save', spellcheck: 'false' });
      const saveNew = () => stored(flow.saveAs({ name: nameInput.value }), 'Saved');
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNew(); });
      const loadFailed = () => ctx.say('That save could not be loaded: the browser has no room to open it.', 'bad');
      body.replaceChildren(
        h('div.grid2', {},
          h('div', {}, h('h3', {}, 'The game'),
            h('div.actions', {}, h('button.btn.gold', { onclick: () => { ctx.dialogs.close(); } }, 'Back to the island'), h('button.btn', { onclick: () => { flow.save(); ctx.say('The game is saved.', 'good'); ctx.dialogs.close(); } }, 'Save'), h('button.btn', { disabled: !saved, title: 'Back to the last save of this realm', onclick: () => flow.load() }, 'Load')),
            h('p.dim', {}, saved ? `Last saved: ${saved}.` : 'Nothing saved yet. The game saves itself each season.'),
            h('div.actions', {}, h('button.btn', { onclick: () => flow.newGame() }, 'A new island…'), h('button.btn', { onclick: () => { ctx.steward.reset(); ctx.say('Your chief of staff will brief you again.', 'info'); } }, 'Hear the hints again'))),
          h('div', {}, h('h3', {}, 'Sound'), mute, slider('Music', 'music'), slider('Effects', 'sfx'),
            h('h3', {}, 'Picture'), h('div.stat', {}, h('span', {}, 'Quality'), quality),
            h('p.dim', {}, 'Low draws fewer shadows and smaller pixels; it helps a slow machine.'))),
        h('h3', {}, `Saved realms (${flow.saves.list().length} of ${flow.saves.MAX})`),
        h('div.actions.save-new', {}, nameInput, h('button.btn', { onclick: saveNew }, 'Save as new')),
        savedList(flow.saves, {
          onLoad: (id) => { if (!flow.load(id)) loadFailed(); },
          onOverwrite: (id) => stored(flow.saveAs({ id, name: nameInput.value }), 'Saved over'),
          redraw,
        }),
        h('h3', {}, 'How to play'),
        h('table', {}, h('tbody', {}, ...CONTROLS.map(([k, v]) => h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, v))))),
        h('p.dim', { html: `${icon('castle', 16)} <b>Moat III: The Island</b> is built on the Madness Engine. Seed: <b>${game.seed}</b> · ${game.difficulty}.` }));
    },
  };
}
