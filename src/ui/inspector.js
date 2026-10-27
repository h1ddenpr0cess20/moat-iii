import { BUILDINGS, CASTLE_LEVELS, GROWN, RANKS, ZONES, ZONE_NAME, money } from '../catalog.js';
import { EDGES, wardOfTile } from '../world/wards.js';
import { needsRoad } from '../world/buildings.js';
import { describeTile, idx } from '../world/world.js';
import { HEARTS, blockAt, blockReport, qualityAt } from '../sim/blocks.js';
import { covered } from '../sim/coverage.js';
import { headcount, planCastle, startCastle, setPriority, demolish } from '../sim/game.js';
import { priorityOf, jobsOf } from '../sim/economy.js';
import { landValue } from '../sim/growth.js';
import { fill, h, num, round } from './dom.js';
import { icon } from './icons.js';

/**
 * What the founder learns by looking: a line of words when the pointer rests on
 * something, and a panel when it is picked. Buildings say what they are doing
 * and what is wrong; blocks say what they are worth and what would make them
 * worth more.
 */

const pct = (v) => `${Math.round(v * 100)}%`;
const PRIORITY = ['Off', 'Low', 'Normal', 'High'];

const kv = (rows) => h('div.kv', {}, rows.filter(Boolean).flatMap(([k, v]) => [h('span', {}, k), h('span', { html: typeof v === 'string' ? v : undefined }, typeof v === 'string' ? null : v)]));
const bar = (v, kind = '') => h('div.bar' + (kind ? '.' + kind : ''), {}, h('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` } }));
const tag = (text, kind = '') => h('span.tag' + (kind ? '.' + kind : ''), {}, text);

export function createInspector(ctx) {
  const { game } = ctx;
  const { world } = game;
  const el = h('div.panel.inspector');
  el.hidden = true;
  let selection = null;

  // ------------------------------------------------------------ status words

  /** A building's definition; the tower's is its tier's. */
  const defOf = (b) => (b.type === 'castle' ? { name: CASTLE_LEVELS[game.castleLevel].name, cat: 'castle', desc: CASTLE_LEVELS[game.castleLevel].desc } : BUILDINGS[b.type]);

  function statusOf(b) {
    const def = defOf(b);
    if (b.type === 'castle') return game.castleWork ? ['Builders at work', 'warn'] : ['Your HQ and penthouse', 'good'];
    if (b.state === 'building') return [`Under construction · ${pct(b.progress)}`, 'warn'];
    if (needsRoad(b) && !b.connected) return ['No road to the tower', 'bad'];
    if (jobsOf(b) && b.eff < 0.4) return ['Short of workers', 'warn'];
    if (def.cap) return [`Home · ${def.cap} residents`, 'good'];
    return [jobsOf(b) ? 'Working' : 'Standing', 'good'];
  }

  const describe = {
    building(b) {
      const def = defOf(b);
      const [status] = statusOf(b);
      const block = blockAt(game, b.x, b.y);
      return `<b>${def.name}</b><div class="dim">${status}</div>${block && block.q > 0 ? `<div class="good">Part of ${block.name} · rating ${block.rating}</div>` : ''}`;
    },
    gate(g) {
      return `<b>${EDGES[g.dir][0].toUpperCase() + EDGES[g.dir].slice(1)} bridge</b><div class="dim">Over the grand canal</div>`;
    },
    block(block) {
      return `<b>${block.name}</b> <span class="dim">· rating ${block.rating}</span><div class="dim">${block.standing} · ${block.homes} homes, ${block.specials.length} ${block.specials.length === 1 ? 'building' : 'buildings'} at its heart</div>${block.rating < 40 ? '<div class="dim">Click for what would improve it.</div>' : ''}`;
    },
    tile(x, y) {
      if (!world.realm[idx(x, y)]) {
        const w = world.wards[wardOfTile(x, y)];
        return `<b>${w.name}</b><div class="dim">${w.owned ? '' : 'Beyond the canals. Annex it from the district map (M).'}</div>`;
      }
      const z = world.zone[idx(x, y)];
      return `<b>${describeTile(world, x, y)}</b>${z ? `<div class="dim">${ZONES[ZONE_NAME[z]].name} zone${world.road[idx(x, y)] ? '' : ''}</div>` : world.road[idx(x, y)] ? '<div class="dim">Road</div>' : ''}`;
    },
  };

  // ------------------------------------------------------------ panels

  const close = () => { selection = null; el.hidden = true; ctx.scene.overlays.clear('select'); ctx.tools.showBlockOverlay(null); };
  const head = (title, sub, pic) => [
    h('button.btn.x', { 'aria-label': 'Close', html: icon('close', 14), onclick: close }),
    h('h2', {}, pic ? h('span', { html: pic }) : null, title),
    sub ? h('div.sub', { html: sub }) : null,
  ];

  function houseNeeds(b) {
    const out = [];
    const [cx, cy] = [b.x + b.w / 2, b.y + b.d / 2];
    const zone = BUILDINGS[b.type].auto;
    const next = GROWN[zone]?.[b.level];
    if (!next) return out;
    const v = landValue(game, cx, cy), pop = headcount(game);
    const needV = b.level === 1 ? 0.45 : 1.1, needPop = b.level === 1 ? (zone === 'com' ? 250 : 120) : (zone === 'com' ? 2500 : zone === 'dense' ? 1500 : 800);
    const want = [[zone === 'ind' ? 'Demand for industry' : 'Good land: parks, police and schools near, no smog', zone === 'ind' || v >= needV], [`A city of ${needPop.toLocaleString('en-US')}+`, pop >= needPop]];
    if (zone === 'ind' && b.level === 2) want.push(['A school in reach', covered(game, 'education', cx, cy) >= 0.3]);
    void qualityAt;
    out.push(h('h3', {}, `To become a ${BUILDINGS[next].name.toLowerCase()}`));
    for (const [text, ok] of want) out.push(h('div', { html: `${ok ? '✔' : '✘'} <span class="${ok ? 'good' : 'bad'}">${text}</span>` }));
    return out;
  }

  function blockCard(block, compact = false) {
    const { perks, tips } = blockReport(block);
    const q = block.q;
    return h('div', {},
      h('div.kv', {}, h('span', {}, 'Rating'), h('span', {}, `${block.rating} · ${block.standing}`), h('span', {}, 'Ring built'), h('span', {}, `${block.built} of ${block.zoned} plots`), h('span', {}, 'Homes'), h('span', {}, `${block.homes} (${block.cap} beds)`), h('span', {}, 'Heart'), h('span', {}, block.hearts.length ? block.hearts.map((x) => x.name).join(', ') : block.crop ?? 'Empty')),
      bar(q, q >= 0.6 ? '' : q >= 0.3 ? 'warn' : 'bad'),
      compact ? null : [
        perks.length ? h('h3', {}, 'What it gives') : null,
        ...perks.map((p) => h('div', { style: { display: 'flex', gap: '6px', margin: '3px 0', fontSize: '13px', alignItems: 'flex-start' }, html: `${icon(p.icon, 16)}<span class="${p.soft ? 'dim' : ''}">${p.text}</span>` })),
        tips.length ? h('h3', {}, 'To improve it') : null,
        ...tips.map((t) => h('p', { html: `✦ ${t}` })),
      ]);
  }

  function showBuilding(b) {
    const def = defOf(b);
    const [status, kind] = statusOf(b);
    const parts = [...head(def.name, `${def.cat === 'housing' ? 'Home' : def.cat === 'market' ? 'Trade' : def.cat[0].toUpperCase() + def.cat.slice(1)}${b.level > 1 && def.auto ? ` · level ${b.level}` : ''}`)];
    parts.push(h('div.badge-line', {}, tag(status, kind)));
    if (b.state === 'building') parts.push(bar(b.progress, 'warn'));
    parts.push(h('p', {}, def.desc));
    const rows = [];
    if (b.state === 'ready') {
      const jobs = jobsOf(b);
      if (jobs) rows.push(['Workers', `${num(b.workers, 1)} of ${jobs}`]);
      if (jobs) rows.push(['Efficiency', pct(Math.min(1, b.eff || 0))]);
      if (def.cap) rows.push(['Residents', def.cap]);
      if (def.upkeep) rows.push(['Budget', `${money(def.upkeep * (game.budget ?? 1))} a week`]);
      if (def.auto) rows.push(['Land value', pct(Math.max(0, Math.min(1, landValue(game, b.x + b.w / 2, b.y + b.d / 2) / 1.6)))]);
      if (def.serve) rows.push(['Looks after', `homes within ${def.serve.radius} tiles`]);
    } else rows.push(['Crew', `${round((b.crewK ?? 0) * def.crew)} of ${def.crew} builders`]);
    parts.push(kv(rows));
    const block = blockAt(game, b.x + 0.5, b.y + 0.5);
    if (block && (def.cap || def.auto)) parts.push(h('h3', {}, `In ${block.name}`), blockCard(block, true));
    if (def.auto && b.state === 'ready') parts.push(...houseNeeds(b));
    if (HEARTS[b.type] && b.state === 'ready' && b.type !== 'castle') {
      const inHeart = block && block.core.includes(idx(Math.floor(b.x + b.w / 2), Math.floor(b.y + b.d / 2)));
      parts.push(h('p', { html: inHeart ? `<span class="good">★ This is the heart of its block.</span>` : '<span class="dim">★ In the middle of a donut block this would serve the whole ring and earn a block bonus.</span>' }));
    }
    if (jobsOf(b) && b.type !== 'castle' && b.state === 'ready') {
      const cur = priorityOf(game, b.type);
      parts.push(h('div.actions', {}, h('span.dim', {}, `Workers for every ${def.name.toLowerCase()}: `), h('span.seg', {}, ...PRIORITY.map((name, n) => h('button', { class: n === cur ? 'on' : '', onclick: () => { setPriority(game, b.type, n); ctx.refreshPanels(); } }, name)))));
    }
    if (b.type === 'castle') return showCastle(parts);
    const acts = h('div.actions');
    acts.append(h('button.btn.small', { onclick: () => { const r = demolish(game, b.x, b.y); if (r.ok) { ctx.say(`${r.what} bulldozed.`, 'info'); ctx.sfx('clear'); close(); } } }, 'Bulldoze'));
    parts.push(acts);
    return parts;
  }

  function showCastle(parts) {
    const lvl = CASTLE_LEVELS[game.castleLevel];
    const next = CASTLE_LEVELS[game.castleLevel + 1];
    parts.push(kv([['Staff', `${lvl.jobs} city workers`], ['Districts it can run', lvl.wards]]));
    if (game.castleWork) {
      const w = game.castleWork;
      parts.push(h('h3', {}, `Building the ${CASTLE_LEVELS[w.level].name}`), bar(w.progress, 'warn'), h('p.dim', {}, `${Math.max(0, Math.ceil((1 - w.progress) * w.weeks))} weeks to go.`));
    } else if (next) {
      const plan = planCastle(game);
      parts.push(h('h3', {}, `Build the ${next.name}`), h('p', {}, next.desc), h('div.kv', {}, h('span', {}, 'Cost'), h('span', { html: `<span class="${game.stock.gold < next.cost.gold ? 'bad' : ''}">${money(next.cost.gold)}</span>` }), h('span', {}, 'Time'), h('span', {}, `${next.weeks} weeks`), h('span', {}, 'Holds'), h('span', {}, `${next.wards} districts`)));
      parts.push(h('div.actions', {}, h('button.btn.gold', { disabled: !plan.ok, onclick: () => { const r = startCastle(game); if (!r.ok) ctx.say(r.reason, 'warn'); else ctx.sfx('place'); show(selection); } }, 'Break ground'), !plan.ok ? h('span.dim', {}, plan.reason) : null));
    } else parts.push(h('p.dim', {}, 'There is nothing taller to build. The Trillion-Dollar Tower tops the coast.'));
    parts.push(h('p.dim', {}, `Next rank: ${RANKS[Math.min(RANKS.length - 1, game.rank + 1)].name}.`));
    return parts;
  }

  function showGate(g) {
    const parts = [...head(`${EDGES[g.dir][0].toUpperCase() + EDGES[g.dir].slice(1)} bridge`, 'A bridge over the grand canal')];
    parts.push(h('p', {}, 'The grand canal is crossed only here. Streets out of the district start at its bridges.'));
    ctx.scene.overlays.clear('select');
    return parts;
  }

  function showBlockPanel(block) {
    const parts = [...head(block.name, `${block.standing} · ${block.homes} homes`, icon('block', 22))];
    parts.push(blockCard(block));
    ctx.tools.showBlockOverlay(block);
    return parts;
  }

  function showTile(x, y) {
    const i = idx(x, y);
    const w = world.wards[wardOfTile(x, y)];
    const g = world.ground[i];
    const parts = [...head(describeTile(world, x, y), `${w.name}${w.owned ? '' : ' · beyond the canals'}`)];
    const rows = [['Ground', ['Meadow', 'Rock', 'Iron ore', 'Water', 'Cliff', 'Shore'][g]]];
    if (world.realm[i]) {
      rows.push(['Soil', `${Math.round((world.fert[i] / 255) * 100)}% fertile`]);
      if (world.tree[i]) rows.push(['Trees', ['', 'a few', 'many', 'dense'][world.tree[i]] ?? 'many']);
      if (world.zone[i]) rows.push(['Zoned', ZONES[ZONE_NAME[world.zone[i]]].name]);
      const NAMES = { security: 'police', fire: 'fire', education: 'schools', cheer: 'parks', health: 'health' };
      const care = Object.keys(NAMES).map((k) => [k, covered(game, k, x, y)]).filter(([, v]) => v > 0.05);
      rows.push(['Services', care.length ? care.map(([k, v]) => `${NAMES[k]} ${pct(v)}`).join(', ') : 'none reach here']);
      rows.push(['Land value', pct(Math.max(0, Math.min(1, landValue(game, x + 0.5, y + 0.5) / 1.6)))]);
    }
    parts.push(kv(rows));
    if (!w.owned) parts.push(h('div.actions', {}, h('button.btn.gold', { onclick: () => ctx.dialogs.open('realm', { ward: w.id }) }, 'See on the district map')));
    return parts;
  }

  function show(sel) {
    selection = sel;
    if (!sel) return close();
    const ov = ctx.scene.overlays;
    let parts;
    ov.clear('select');
    if (sel.kind === 'building') {
      const b = world.buildings.get(sel.id);
      if (!b) return close();
      parts = showBuilding(b);
      ov.rect('select', { x: b.x, y: b.y, w: b.w, d: b.d }, { color: '#ffe27a', width: 0.18, opacity: 0.95, pulse: 0.15 });
      const block = blockAt(game, b.x + 0.5, b.y + 0.5);
      ctx.tools.showBlockOverlay(block && block.q > 0 ? block : null);
    } else if (sel.kind === 'gate') {
      const g = world.gates[sel.id];
      if (!g) return close();
      parts = showGate(g);
    } else if (sel.kind === 'block') {
      const block = game.blocks[sel.id];
      if (!block) return close();
      parts = showBlockPanel(block);
    } else {
      parts = showTile(sel.x, sel.y);
      ov.rect('select', { x: sel.x, y: sel.y, w: 1, d: 1 }, { color: '#ffe27a', width: 0.12, opacity: 0.9 });
    }
    fill(el, parts);
    el.hidden = false;
  }

  const inspector = {
    el, describe, show, close,
    get selection() { return selection; },
    /** Redraws the panel when the game has moved on, if it is open. */
    refresh() {
      if (!selection || el.hidden) return;
      if (selection.kind === 'building' && !world.buildings.has(selection.id)) return close();
      if (selection.kind === 'block' && !game.blocks[selection.id]) return close();
      const top = el.scrollTop;
      show(selection);
      el.scrollTop = top;
    },
  };
  return inspector;
}
