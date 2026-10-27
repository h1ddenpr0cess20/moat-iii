import { RANKS, money } from '../catalog.js';
import { calendar } from '../sim/calendar.js';
import { headcount, housingCap } from '../sim/game.js';
import { HOME_WARD } from '../config.js';
import { wardId } from '../world/wards.js';
import { h, round } from './dom.js';
import { GOOD_ICON, icon } from './icons.js';

/**
 * The bar across the top: the city and the date, its funds and how they are
 * moving, how many people there are, what the zones want and how people
 * feel, and the clock's controls. Everything has a tooltip that says what lies
 * behind the number.
 */

const SEASON_ICON = ['leaf', 'sun', 'autumn', 'snow'];
const SPEEDS = [
  { id: 0, icon: 'pause', label: 'Pause', key: 'Space' },
  { id: 1, icon: 'play', label: 'Normal pace', key: 'Space' },
  { id: 2, icon: 'fast', label: 'Twice as fast', key: 'Tab' },
  { id: 4, icon: 'faster', label: 'Four times as fast', key: 'Tab' },
];

const faceOf = (v) => (v >= 72 ? 'happy' : v >= 52 ? 'content' : v >= 32 ? 'sad' : 'angry');
const moodWord = (v) => (v >= 80 ? 'Delighted' : v >= 66 ? 'Happy' : v >= 52 ? 'Content' : v >= 40 ? 'Uneasy' : v >= 28 ? 'Unhappy' : 'Furious');

export function createHud(ctx) {
  const { game, tip } = ctx;
  const chips = {};
  const el = h('div.hud');

  const title = h('div.title');
  const date = h('div.date');
  const realm = h('div.panel.realm', {}, h('span', { html: icon('crown', 26) }), h('div', {}, title, date));
  el.append(realm);

  const bar = h('div.panel.chips');
  const chip = (key, pic, tipFn) => {
    const num_ = h('span.n');
    const sub = h('small');
    const delta = h('span.d');
    const c = h('div.chip', {}, h('span', { html: pic }), num_, sub, delta);
    c.refs = { num: num_, sub, delta };
    tip.attach(c, tipFn);
    chips[key] = c;
    bar.append(c);
    return c;
  };

  chip('gold', icon(GOOD_ICON.gold, 20), () => {
    const r = game.report, t = r.taxSplit ?? {};
    return `<b>City funds</b><div class="row"><span>In the bank</span><span>${money(game.stock.gold)}</span></div>`
      + `<div class="row"><span>Residential taxes</span><span class="good">+${money(t.res ?? 0)}</span></div>`
      + `<div class="row"><span>Commercial taxes</span><span class="good">+${money(t.com ?? 0)}</span></div>`
      + `<div class="row"><span>Industrial taxes</span><span class="good">+${money(t.ind ?? 0)}</span></div>`
      + `<div class="row"><span>Budgets</span><span class="bad">−${money(r.upkeep ?? 0)}</span></div>`
      + '<div class="dim">A week. Set the tax rate and the budget in the ledger.</div>';
  });
  chip('pop', icon('people', 20), () => {
    const p = game.pop, r = game.report;
    return `<b>Population</b><div class="row"><span>Children</span><span>${round(p.children)}</span></div><div class="row"><span>Adults</span><span>${round(p.adults)}</span></div><div class="row"><span>Seniors</span><span>${round(p.elders)}</span></div>`
      + `<div class="row"><span>Homes for</span><span>${round(headcount(game))} of ${housingCap(game)}</span></div>`
      + `<div class="row"><span>Employed</span><span>${round(r.employed ?? 0)} of ${round(r.workforce ?? 0)}</span></div>`
      + `<div class="row"><span>Unemployed</span><span class="${(r.idle ?? 0) > 2 ? 'bad' : ''}">${round(r.idle ?? 0)}</span></div>`
      + `<div class="dim">Open jobs: ${round(r.jobsOpen ?? 0)}. Jobs bring people; people bring shops.</div>`;
  });
  // SimCity's R C I meter: three bars that rise when the zone is wanted and fall when it is not.
  const rci = chip('rci', '<span class="rci"><i></i><i></i><i></i></span>', () => {
    const d = game.report.demand ?? {};
    const line = (name, v) => `<div class="row"><span>${name}</span><span class="${v > 0.1 ? 'good' : v < -0.1 ? 'bad' : ''}">${v > 0 ? '+' : ''}${Math.round((v ?? 0) * 100)}</span></div>`;
    return '<b>Demand</b>' + line('Residential', d.res) + line('Commercial', d.com) + line('Industrial', d.ind)
      + '<div class="dim">Zone what is wanted. Homes want jobs; shops want customers; industry wants workers.</div>';
  });
  chip('mood', icon('happy', 20), () => {
    const r = game.report, c = r.care ?? {};
    const line = (name, v, good = 0.75) => `<div class="row"><span>${name}</span><span class="${v >= good ? 'good' : v < 0.3 ? 'bad' : ''}">${Math.round(v * 100)}%</span></div>`;
    return `<b>${moodWord(game.happiness)}</b><div class="dim">People move away if this falls below 40.</div>`
      + line('Police', c.security ?? 0) + line('Fire', c.fire ?? 0) + line('Schools', c.education ?? 0) + line('Parks', c.cheer ?? 0) + line('Health', game.health / 100)
      + `<div class="row"><span>Crime</span><span class="${(r.crime ?? 0) > 30 ? 'bad' : ''}">${Math.round(r.crime ?? 0)}</span></div>`
      + ((c.smog ?? 0) > 0.05 ? `<div class="row"><span>Smog</span><span class="bad">${Math.round(c.smog * 100)}%</span></div>` : '')
      + (game.blockGain?.mood > 0.2 ? `<div class="row"><span>Donut blocks</span><span class="good">+${game.blockGain.mood.toFixed(1)}</span></div>` : '')
      + (game.tax > 0.09 ? `<div class="row"><span>Taxes</span><span class="bad">−${((game.tax - 0.09) * 120).toFixed(0)}</span></div>` : '');
  });
  el.append(bar);

  const speed = h('div.panel.speed');
  const paused = h('span.paused', {}, 'Paused');
  speed.append(paused);
  const speedButtons = SPEEDS.map((s) => {
    const b = h('button', { 'aria-label': s.label, html: icon(s.icon, 18), onclick: () => ctx.clock.set(s.id) });
    tip.attach(b, () => `${s.label} <span class="dim">[${s.key}]</span>`);
    speed.append(b);
    return [s, b];
  });
  const extras = [
    ['ledger', 'ledger', 'The budget: taxes, services and jobs'],
    ['bell', 'chronicle', 'City news'],
    ['menu', 'menu', 'Menu (F10)'],
  ];
  speed.append(h('span.sep'));
  for (const [ic, dlg, label] of extras) {
    const b = h('button', { 'aria-label': label, html: icon(ic, 20), onclick: () => ctx.dialogs.toggle(dlg) });
    tip.attach(b, () => label);
    speed.append(b);
  }
  el.append(speed);

  const refreshCalendar = () => {
    const cal = calendar(game.week);
    const rank = RANKS[game.rank];
    title.textContent = `${game.world.wards[wardId(HOME_WARD, HOME_WARD)].name} · ${rank.name}`;
    const weather = ctx.scene.atmosphere.state;
    date.innerHTML = `${icon(weather.rain ? 'rain' : SEASON_ICON[cal.season], 16)} ${cal.monthName} · Year ${cal.year}`;
  };

  const set = (key, text, { sub = '', low = false, warn = false, delta = null } = {}) => {
    const c = chips[key], r = c.refs;
    r.num.textContent = text;
    r.sub.textContent = sub;
    c.classList.toggle('low', low);
    c.classList.toggle('warn', warn);
    if (delta === null || Math.abs(delta) < 0.05) { r.delta.textContent = ''; r.delta.className = 'd'; }
    else { r.delta.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1)}`; r.delta.className = `d ${delta > 0 ? 'up' : 'down'}`; }
  };

  const hud = {
    el,
    update() {
      const r = game.report;
      refreshCalendar();
      set('gold', money(game.stock.gold), { delta: r.delta ?? 0, low: game.stock.gold < 0 });
      set('pop', `${round(headcount(game))}`, { sub: `/${housingCap(game)}`, low: false, warn: headcount(game) >= housingCap(game) });
      const idle = Math.round(r.idle ?? 0);
      chips.pop.refs.delta.textContent = idle >= 5 ? `${idle} jobless` : '';
      chips.pop.refs.delta.className = idle >= 5 ? 'd down' : 'd';
      const d = r.demand ?? {};
      [d.res, d.com, d.ind].forEach((v, i) => { const bar = rci.querySelectorAll('.rci i')[i]; bar.style.height = `${Math.round(50 + 45 * (v ?? 0))}%`; });
      set('mood', `${Math.round(game.happiness)}`, { low: game.happiness < 38, warn: game.happiness < 52 });
      chips.mood.firstChild.innerHTML = icon(faceOf(game.happiness), 20);
      for (const [s, b] of speedButtons) b.classList.toggle('on', ctx.clock.speed === s.id);
      paused.hidden = ctx.clock.speed !== 0;
    },
  };
  return hud;
}
