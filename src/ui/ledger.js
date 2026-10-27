import { BUILDINGS, CASTLE_LEVELS, RANKS, money } from '../catalog.js';
import { jobsOf, priorityOf } from '../sim/economy.js';
import { headcount, setPriority, setTax } from '../sim/game.js';
import { ownedCount } from '../world/wards.js';
import { bonusLines, bonusOf } from '../sim/bonus.js';
import { fill, h, num, round } from './dom.js';

/**
 * The ledger: where the founder does the sums. Four pages: the budget and the
 * tax, the services and what they reach, who works where, and the donut
 * blocks.
 */

const PRIORITY = ['Off', 'Low', 'Normal', 'High'];
const TABS = [['treasury', 'Budget'], ['stores', 'Services'], ['labor', 'Jobs'], ['blocks', 'Blocks']];
let tab = 'treasury';

const taxWord = (t) => (t <= 0.05 ? 'Low' : t <= 0.09 ? 'Fair' : t <= 0.13 ? 'High' : t <= 0.17 ? 'Steep' : 'Punishing');

function treasury(ctx, body) {
  const { game } = ctx;
  const r = game.report, t = r.taxSplit ?? {};
  const rows = [['Residential taxes', t.res ?? 0], ['Commercial taxes', t.com ?? 0], ['Industrial taxes', t.ind ?? 0], t.tour ? ['Visitors', t.tour] : null, ['Services', -(r.upkeep ?? 0)]].filter(Boolean);
  const table = h('table', {}, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td.r', { class: v >= 0 ? 'good' : 'bad' }, `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`))),
    h('tr', {}, h('td', {}, h('b', {}, 'Each week')), h('td.r', { class: (r.delta ?? 0) >= 0 ? 'good' : 'bad' }, h('b', {}, `${(r.delta ?? 0) >= 0 ? '+' : '−'}${money(Math.abs(r.delta ?? 0))}`)))));
  const slider = h('input', { type: 'range', min: 0, max: 20, step: 1, value: Math.round(game.tax * 100), 'aria-label': 'Tax rate' });
  const label = h('div', {});
  const paint = () => { label.innerHTML = `<b>${Math.round(game.tax * 100)}%</b> · ${taxWord(game.tax)} <span class="dim">· mood ${game.tax > 0.09 ? '−' : '+'}${Math.abs((game.tax - 0.09) * 120).toFixed(0)}, taxes ×${(game.tax / 0.1).toFixed(1)}</span>`; };
  slider.addEventListener('input', () => { setTax(game, +slider.value / 100); paint(); });
  paint();
  const budget = h('input', { type: 'range', min: 50, max: 150, step: 10, value: Math.round((game.budget ?? 1) * 100), 'aria-label': 'Service budget' });
  const blabel = h('div', {});
  const bpaint = () => { blabel.innerHTML = `<b>${Math.round((game.budget ?? 1) * 100)}%</b> <span class="dim">of what the services ask for</span>`; };
  budget.addEventListener('input', () => { game.budget = +budget.value / 100; bpaint(); });
  bpaint();
  const d = r.demand ?? {};
  const bar = (name, v, col) => h('div.stat', {}, h('span', {}, name), h('b', { style: { color: col } }, `${v > 0 ? '+' : ''}${Math.round((v ?? 0) * 100)}`));
  const rank = RANKS[Math.min(RANKS.length - 1, game.rank + 1)];
  const need = rank.need ?? {};
  const checks = game.rank + 1 >= RANKS.length ? [] : [
    need.pop ? [`${need.pop.toLocaleString('en-US')} people`, headcount(game) >= need.pop] : null,
    need.wards ? [`${need.wards} districts`, ownedCount(game.world) >= need.wards] : null,
    need.castle ? [`A ${CASTLE_LEVELS[need.castle - 1].name}`, game.castleLevel >= need.castle - 1] : null,
    need.building ? [`A ${BUILDINGS[need.building].name.toLowerCase()}`, [...game.world.buildings.values()].some((b) => b.type === need.building && b.state === 'ready')] : null,
  ].filter(Boolean);
  fill(body,
    h('div.grid2', {},
      h('div', {}, h('h3', {}, 'Funds'), h('div.stat', {}, h('span', {}, 'In the bank'), h('b', {}, money(game.stock.gold))), table,
        game.blockGain?.tax > 0.001 ? h('p.dim', {}, `Donut blocks add ${(game.blockGain.tax * 100).toFixed(1)}% to your taxes.`) : null,
        h('h3', {}, 'Demand'), bar('Residential', d.res, '#59b35f'), bar('Commercial', d.com, '#4f8fd6'), bar('Industrial', d.ind, '#d6b24f'),
        h('h3', {}, 'Landmarks'),
        bonusOf(game).sources.length
          ? h('div', {}, ...bonusOf(game).sources.map((type) => h('div', { html: `<b>${BUILDINGS[type].name}</b> <span class="dim">· ${bonusLines(BUILDINGS[type]).join(' · ')}</span>` })))
          : h('p.dim', {}, 'A port, an airport, a university, a data center or a stadium does something for the whole island. You have none yet.')),
      h('div', {}, h('h3', {}, 'Tax rate'), slider, label,
        h('p.dim', {}, 'High taxes fill the bank and empty the city. At 9% or under people are content; over it, they grumble and firms stay away.'),
        h('h3', {}, 'Service budget'), budget, blabel,
        h('p.dim', {}, 'Police, fire, schools, parks and hospitals cost the city each week. Cut them and they reach less.'),
        h('h3', {}, game.rank + 1 >= RANKS.length ? 'Your city' : `Your city: a ${RANKS[game.rank].name}`),
        game.rank + 1 >= RANKS.length ? h('p', {}, 'The tech capital of the world. There is nothing left to disrupt.') : h('div', {}, h('p', {}, `To be a ${rank.name}:`), ...checks.map(([text, ok]) => h('div', { html: `${ok ? '✔' : '✘'} <span class="${ok ? 'good' : 'bad'}">${text}</span>` }))))));
}

function stores(ctx, body) {
  const { game } = ctx;
  const r = game.report, c = r.care ?? {};
  const line = (name, v, what) => h('tr', {}, h('td', {}, name), h('td.r', { class: v >= 0.75 ? 'good' : v < 0.3 ? 'bad' : '' }, `${Math.round((v ?? 0) * 100)}%`), h('td.dim', {}, what));
  const count = (type) => [...game.world.buildings.values()].filter((b) => b.type === type && b.state === 'ready').length;
  fill(body,
    h('p', {}, 'How much of each service reaches the homes, on average. Build more where the overlays show gaps.'),
    h('div.table-wrap', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Service'), h('th.r', {}, 'Reaches'), h('th', {}, ''))), h('tbody', {},
      line('Police', c.security, `${count('police')} stations · crime ${Math.round(r.crime ?? 0)}`),
      line('Fire', c.fire, `${count('firehouse')} stations`),
      line('Schools', c.education, `${count('school')} schools, ${count('library')} libraries, ${count('university')} universities`),
      line('Parks', c.cheer, `${count('park')} parks, ${count('plaza')} plazas, ${count('marina')} marinas, ${count('stadium')} stadiums`),
      line('Health', c.health, `${count('hospital')} hospitals, ${count('clinic')} clinics`)))),
    (c.smog ?? 0) > 0.05 ? h('p.warn', {}, `Smog from factories reaches ${Math.round(c.smog * 100)}% of homes. Keep industry back from where people live.`) : null,
    (c.noise ?? 0) > 0.05 ? h('p.warn', {}, `Noise from the airport, the port and the like reaches ${Math.round(c.noise * 100)}% of homes.`) : null);
}

function labor(ctx, body) {
  const { game } = ctx;
  const r = game.report;
  const groups = new Map();
  for (const b of game.world.buildings.values()) {
    if (b.type === 'castle') continue;
    const jobs = jobsOf(b);
    if (!jobs || b.state !== 'ready') continue;
    const g = groups.get(b.type) ?? { type: b.type, n: 0, jobs: 0, workers: 0, off: 0 };
    g.n++; g.jobs += jobs; g.workers += b.workers; if (!b.connected) g.off++;
    groups.set(b.type, g);
  }
  const rows = [...groups.values()].sort((a, b) => priorityOf(game, b.type) - priorityOf(game, a.type)).map((g) => h('tr', {},
    h('td', {}, BUILDINGS[g.type].name, g.n > 1 ? h('span.dim', {}, ` ×${g.n}`) : null, g.off ? h('span.bad', {}, ' (no road)') : null),
    h('td.r', {}, `${num(g.workers, 1)} / ${g.jobs}`),
    h('td.r', {}, h('span.seg', {}, ...PRIORITY.map((name, n) => h('button', { class: n === priorityOf(game, g.type) ? 'on' : '', onclick: () => { setPriority(game, g.type, n); ctx.dialogs.refresh(); } }, name))))));
  fill(body, 
    h('div.grid2', {}, h('div', {}, h('div.stat', {}, h('span', {}, 'Adults looking for work'), h('b', {}, round(r.workforce ?? 0))), h('div.stat', {}, h('span', {}, 'Employed'), h('b', {}, round(r.employed ?? 0))), h('div.stat', {}, h('span', {}, 'Unemployed'), h('b', { class: (r.idle ?? 0) > 2 ? 'bad' : '' }, round(r.idle ?? 0))), h('div.stat', {}, h('span', {}, 'Jobs unfilled'), h('b', {}, round(r.jobsOpen ?? 0)))),
      h('p', {}, 'The city tower and its services are staffed first. When there are too few workers, the places set to High are staffed before the rest.')),
    h('div.table-wrap', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Place'), h('th.r', {}, 'Workers'), h('th.r', {}, 'Priority'))), h('tbody', {}, ...rows))));
}

function blocksTab(ctx, body) {
  const { game } = ctx;
  const blocks = [...game.blocks].filter((b) => b.core.length >= 4 || b.homes > 0).sort((a, b) => b.rating - a.rating);
  const g = game.blockGain ?? { tax: 0, mood: 0, cap: 0, shops: 0 };
  const rows = blocks.map((b) => h('tr', { style: { cursor: 'pointer' }, onclick: () => { ctx.dialogs.close(); ctx.inspector.show({ kind: 'block', id: b.id }); ctx.scene.focusOn(b.center[0], b.center[1], { zoom: 0.9 }); } },
    h('td', {}, h('b', {}, b.name)), h('td.r', {}, `${b.rating}`), h('td', {}, b.standing), h('td.r', {}, `${b.homes}${b.works ? ` · ${b.works}` : ''}`), h('td.r', {}, `${Math.round(b.fill * 100)}%`), h('td', {}, b.hearts.length ? b.hearts.map((x) => x.name).join(', ') : (b.crop ?? '—'))));
  const best = blocks.find((b) => b.q === 0 && b.core.length >= 4);
  fill(body, 
    h('div.grid2', {},
      h('div', {}, h('h3', {}, 'The donut'), h('p', {}, 'A loop of streets with a ring of homes or shops around the inside and, in the middle, a plaza, a park or a building that serves them all. The closer the ring is to complete, and the better the heart, the higher the rating.'),
        h('p', { html: '<b>Hearts, best first:</b> plaza, park, the tower, school, hospital, police or fire station; or back yards.' })),
      h('div', {}, h('h3', {}, 'What the blocks bring the city'),
        h('div.stat', {}, h('span', {}, 'Taxes'), h('b', { class: g.tax > 0 ? 'good' : '' }, `+${(g.tax * 100).toFixed(1)}%`)),
        h('div.stat', {}, h('span', {}, 'More room'), h('b', { class: g.cap > 0 ? 'good' : '' }, `+${g.cap} people`)),
        h('div.stat', {}, h('span', {}, 'Mood'), h('b', { class: g.mood > 0 ? 'good' : '' }, `+${g.mood.toFixed(1)}`)),
        h('div.stat', {}, h('span', {}, 'Shop sales'), h('b', { class: g.shops > 0 ? 'good' : '' }, `+${(g.shops * 100).toFixed(0)}%`)))),
    blocks.length ? h('div.table-wrap', {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Block'), h('th.r', {}, 'Rating'), h('th', {}, 'Standing'), h('th.r', {}, 'Homes · trades'), h('th.r', {}, 'Ring built'), h('th', {}, 'Heart'))), h('tbody', {}, ...rows)))
      : h('p', { html: 'You have no blocks yet. Take the <b>Blocks</b> tool, stamp one on open ground and leave its core open for a plaza.' }),
    best ? h('p.warn', { html: `✦ ${best.name === 'Hollow Block' ? 'A block' : best.name} near (${Math.round(best.center[0])}, ${Math.round(best.center[1])}) has no heart yet. Put a plaza or a park in the middle.` }) : null);
}

export function ledgerDialog(ctx) {
  const pages = { treasury, stores, labor, blocks: blocksTab };
  return {
    title: 'City Budget',
    icon: 'ledger',
    refresh: true,
    tabs: true,
    width: 960,
    draw(body, { tabs }) {
      if (tabs) {
        tabs.replaceChildren(...TABS.map(([id, name]) => h('button.tab', { class: id === tab ? 'on' : '', onclick: () => { tab = id; ctx.dialogs.refresh(); } }, name)));
      }
      pages[tab](ctx, body);
    },
  };
}
