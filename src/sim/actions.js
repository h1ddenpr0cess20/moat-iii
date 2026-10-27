import { BUILDINGS, CASTLE_LEVELS, RANKS, ROADS, ZONES, ZONE_ID, annexCost, annexWork, canPay, costText, pay } from '../catalog.js';
import { CENTER, GROUND, ROAD, WARD } from '../config.js';
import { addBuilding, check, removeBuilding } from '../world/buildings.js';
import { blockPlan, BLOCK, setZone, zoneBlocked } from '../world/zoning.js';
import { clearRoad, roadBlocked, setRoad } from '../world/roads.js';
import { bordersRealm, carveMoat, computeMoat, gradeWard, ownedCount } from '../world/wards.js';
import { clearTrees, idx, inb, touch, touchAll } from '../world/world.js';
import { PRICES } from './state.js';

/**
 * What the founder can do. Each action has a `plan` (what it would cost and
 * whether it can be done, for the ghost under the cursor) and a doing, which
 * takes the coin and changes the land. Roads and zones are done at once;
 * buildings and moats take the builders time.
 */

const payAll = (game, cost) => {
  pay(game.stock, cost);
  for (const [r, n] of Object.entries(cost)) game.flows.used[r] = (game.flows.used[r] ?? 0) + n;
};
const addCost = (a, b, k = 1) => { for (const [r, n] of Object.entries(b)) a[r] = (a[r] ?? 0) + n * k; return a; };

/** The tiles of a straight line from (x0, y0) along the longer way to (x1, y1). */
export function lineTiles(x0, y0, x1, y1) {
  const out = [];
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) { const s = Math.sign(x1 - x0) || 1; for (let x = x0; x !== x1 + s; x += s) out.push([x, y0]); }
  else { const s = Math.sign(y1 - y0) || 1; for (let y = y0; y !== y1 + s; y += s) out.push([x0, y]); }
  return out;
}

/** The tiles of a rectangle between two corners. */
export function rectTiles(x0, y0, x1, y1) {
  const out = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y]);
  return out;
}

// ---------------------------------------------------------------- roads

export function planRoad(game, tiles, type = 'dirt') {
  if (type === 'bridge') return planBridge(game, tiles);
  const { world } = game;
  const cost = {};
  const ok = [], bad = [];
  let why = null;
  for (const [x, y] of tiles) {
    const reason = roadBlocked(world, x, y);
    const here = inb(x, y) ? world.road[idx(x, y)] : 0;
    const want = type === 'cobble' ? ROAD.COBBLE : ROAD.DIRT;
    if (reason === 'A bridge' || (here === want) || (here === ROAD.COBBLE && want === ROAD.DIRT) || here === ROAD.SPAN) continue;
    if (reason) { bad.push([x, y]); why ??= reason === 'Waterlogged' ? 'Too wet for a road: lay a bridge over it' : reason === 'Water' ? 'Water: lay a bridge over it' : reason; continue; }
    ok.push([x, y]);
    addCost(cost, ROADS[type].cost);
  }
  return { tiles: ok, blocked: bad, cost, afford: canPay(game.stock, cost), reason: ok.length ? null : why };
}

/** Natural water the city may bridge: a river or lake inside the realm, never the moat. */
const spanWater = (world, x, y) => inb(x, y) && world.ground[idx(x, y)] === GROUND.WATER && world.realm[idx(x, y)] === 1 && !world.moat[idx(x, y)] && !world.bld[idx(x, y)];
/** Low, marshy ground beside the water: no road will lie on it, but a boardwalk will. */
const marsh = (world, x, y) => inb(x, y) && !world.bld[idx(x, y)] && !world.road[idx(x, y)] && roadBlocked(world, x, y) === 'Waterlogged';
/** The longest bridge: tiles of water (or marsh) in a row. */
export const MAX_SPAN = 6;

/**
 * A bridge over water, along a straight line of tiles from one bank to the
 * other: dry tiles are laid as dirt road, water and marsh as a plank span. The
 * ends must not be in the water, the water must be the realm's own, and a span
 * is at most six tiles. `spans` are the tiles on planks; `tiles` is everything
 * to lay.
 */
function planBridge(game, tiles) {
  const { world } = game;
  const out = { tiles: [], spans: [], blocked: [], cost: {}, afford: false, reason: null };
  const open = tiles.map(([x, y]) => spanWater(world, x, y));
  const wet = tiles.map(([x, y], k) => open[k] || marsh(world, x, y));
  if (!open.some(Boolean)) return { ...out, blocked: tiles.filter(([x, y]) => roadBlocked(world, x, y) && !marsh(world, x, y)), reason: 'A bridge needs water to cross' };
  if (open[0] || open[open.length - 1]) return { ...out, blocked: tiles.filter((_, k) => open[k]), reason: 'Both ends of a bridge must be on the bank, not in the water' };
  let run = 0;
  for (const w of wet) { run = w ? run + 1 : 0; if (run > MAX_SPAN) return { ...out, blocked: tiles.filter((_, k) => wet[k]), reason: `Too long to span: ${MAX_SPAN} tiles of water at most` }; }
  for (let k = 0; k < tiles.length; k++) {
    const [x, y] = tiles[k];
    const here = world.road[idx(x, y)];
    if (wet[k]) {
      if (here === ROAD.SPAN) continue;
      out.tiles.push([x, y]); out.spans.push([x, y]);
      addCost(out.cost, ROADS.bridge.cost);
      continue;
    }
    const reason = roadBlocked(world, x, y);
    if (here || reason === 'A bridge') continue;
    if (reason) { out.blocked.push([x, y]); out.reason ??= reason; continue; }
    out.tiles.push([x, y]);
    addCost(out.cost, ROADS.dirt.cost);
  }
  if (out.blocked.length) return { ...out, tiles: [], spans: [], cost: {}, reason: out.reason };
  out.afford = canPay(game.stock, out.cost);
  if (!out.tiles.length) out.reason = 'Already built';
  return out;
}

export function buildRoad(game, tiles, type = 'dirt', { free = false } = {}) {
  const plan = planRoad(game, tiles, type);
  if (!plan.tiles.length) return { ok: false, reason: plan.reason ?? 'Nothing to build', placed: 0 };
  let placed = 0, spans = 0;
  const isSpan = new Set((plan.spans ?? []).map(([x, y]) => idx(x, y)));
  if (type === 'bridge' && !free && !plan.afford) return { ok: false, placed: 0, reason: 'Not enough funds for the bridge' };
  for (const [x, y] of plan.tiles) {
    const span = isSpan.has(idx(x, y));
    const c = span ? ROADS.bridge.cost : ROADS[type === 'bridge' ? 'dirt' : type].cost;
    if (!free && !canPay(game.stock, c)) break;
    let timber;
    if (span) {
      const i = idx(x, y);
      timber = clearTrees(game.world, x, y);
      game.world.zone[i] = 0;
      game.world.crop[i] = 0;
      game.world.road[i] = ROAD.SPAN;
      touch(game.world, ['flat', 'ground', 'water'], x, y, x, y, 1);
      game.world.netVersion = (game.world.netVersion ?? 0) + 1;
      spans++;
    } else {
      timber = setRoad(game.world, x, y, type === 'cobble' ? ROAD.COBBLE : ROAD.DIRT);
      if (timber < 0) continue;
    }
    if (!free) payAll(game, c);
    void timber;
    placed++;
  }
  if (placed) { game.world.bver = (game.world.bver ?? 0) + 1; game.emit('road', { placed }); }
  if (spans) game.emit('bridge', { spans });
  return { ok: placed > 0, placed, short: placed < plan.tiles.length, reason: placed ? null : 'Not enough funds' };
}

// ---------------------------------------------------------------- zones

export function planZone(game, tiles, zone) {
  const { world } = game;
  const cost = {};
  const ok = [];
  let why = null;
  for (const [x, y] of tiles) {
    const reason = zoneBlocked(world, x, y);
    if (reason) { why ??= reason; continue; }
    if (world.zone[idx(x, y)] === ZONE_ID[zone]) continue;
    ok.push([x, y]);
  }
  addCost(cost, { gold: ZONES[zone].cost }, ok.length);
  return { tiles: ok, cost, afford: canPay(game.stock, cost), reason: ok.length ? null : why };
}

export function buildZone(game, tiles, zone, { free = false } = {}) {
  const plan = planZone(game, tiles, zone);
  if (!plan.tiles.length) return { ok: false, reason: plan.reason ?? 'Nothing to zone', placed: 0 };
  let placed = 0;
  for (const [x, y] of plan.tiles) {
    if (!free && game.stock.gold < ZONES[zone].cost) break;
    const timber = setZone(game.world, x, y, zone);
    if (timber < 0) continue;
    if (!free) payAll(game, { gold: ZONES[zone].cost });
    void timber;
    placed++;
  }
  if (placed) game.emit('zone', { placed, zone });
  return { ok: placed > 0, placed, reason: placed ? null : 'Not enough funds' };
}

export function eraseZones(game, tiles) {
  let n = 0;
  for (const [x, y] of tiles) if (setZone(game.world, x, y, null) >= 0) n++;
  return n;
}

// ---------------------------------------------------------------- donut blocks

export function planBlock(game, x0, y0, x1, y1, options = {}) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  if (bx - ax + 1 < BLOCK.min || by - ay + 1 < BLOCK.min) return { ok: false, reason: `A block is at least ${BLOCK.min} tiles across`, roads: [], ring: [], core: [], cost: {} };
  if (bx - ax + 1 > BLOCK.max || by - ay + 1 > BLOCK.max) return { ok: false, reason: `A block is at most ${BLOCK.max} tiles across`, roads: [], ring: [], core: [], cost: {} };
  const plan = blockPlan(ax, ay, bx, by, options);
  const type = options.road ?? 'dirt';
  const roads = planRoad(game, plan.roads, type);
  const ring = planZone(game, plan.ring, options.ring ?? 'res');
  const core = plan.core.length ? planZone(game, plan.core, options.core === 'none' ? 'res' : options.core ?? 'res') : { tiles: [], cost: {} };
  const cost = addCost(addCost(addCost({}, roads.cost), ring.cost), options.core === 'none' ? {} : core.cost);
  const ok = roads.tiles.length + ring.tiles.length > 0;
  return { ok, reason: ok ? null : 'Nothing can be built there', roads: roads.tiles, ring: ring.tiles, core: options.core === 'none' ? [] : core.tiles, cost, afford: canPay(game.stock, cost), rect: [ax, ay, bx, by] };
}

export function buildBlock(game, x0, y0, x1, y1, options = {}, { free = false } = {}) {
  const plan = planBlock(game, x0, y0, x1, y1, options);
  if (!plan.ok) return plan;
  if (!free && !plan.afford) return { ...plan, ok: false, reason: 'Not enough funds' };
  buildRoad(game, plan.roads, options.road ?? 'dirt', { free });
  buildZone(game, plan.ring, options.ring ?? 'res', { free });
  if (options.core !== 'none' && plan.core.length) buildZone(game, plan.core, options.core ?? 'res', { free });
  game.emit('block', { plan });
  return plan;
}

// ---------------------------------------------------------------- buildings

export function planBuilding(game, type, x, y, front) {
  const def = BUILDINGS[type];
  const c = check(game.world, type, x, y, front);
  const reasons = [];
  if (c.ok && def.rank && game.rank < def.rank) reasons.push(`Needs the rank of ${RANKS[def.rank].name}`);
  if (c.ok && !canPay(game.stock, def.cost)) reasons.push('Not enough materials');
  return { ...c, def, cost: def.cost, afford: canPay(game.stock, def.cost), ok: c.ok && reasons.length === 0, reason: c.reason ?? reasons[0] ?? null, rankLocked: Boolean(def.rank && game.rank < def.rank) };
}

export function placeBuilding(game, type, x, y, front, { free = false } = {}) {
  const plan = planBuilding(game, type, x, y, front);
  if (!plan.ok && !(free && plan.afford === false && !plan.rankLocked && plan.reason === 'Not enough materials')) return plan;
  const def = BUILDINGS[type];
  if (!free) payAll(game, def.cost);
  const { rect } = plan;
  const f = plan.front ?? front;
  const { building, timber } = addBuilding(game.world, type, rect.x, rect.y, f, { state: free ? 'ready' : 'building', rect });
  void timber;
  if (plan.gate) plan.gate.gatehouse = building.id;
  game.world.bver = (game.world.bver ?? 0) + 1;
  game.emit('placed', { building });
  return { ...plan, building };
}

/** What a demolition gives back. */
const refund = (b) => {
  const cost = BUILDINGS[b.type]?.cost ?? {};
  // What grew on a zone was built with private money: the city gets nothing back for it.
  const k = BUILDINGS[b.type]?.auto ? 0 : b.state === 'building' ? 0.8 : 0.4;
  return Object.fromEntries(Object.entries(cost).map(([r, n]) => [r, Math.floor(n * k)]));
};

export function demolish(game, x, y) {
  const { world } = game;
  if (!inb(x, y)) return { ok: false };
  const i = idx(x, y);
  const id = world.bld[i];
  if (id) {
    if (id === 1) return { ok: false, reason: 'The tower stands' };
    const b = world.buildings.get(id);
    const back = refund(b);
    for (const [r, n] of Object.entries(back)) game.stock[r] += n;
    for (const g of world.gates) if (g.gatehouse === id) g.gatehouse = 0;
    removeBuilding(world, id);
    game.emit('demolished', { building: b });
    return { ok: true, what: BUILDINGS[b.type].name, back };
  }
  if (world.road[i] && world.road[i] !== ROAD.BRIDGE) {
    const span = world.road[i] === ROAD.SPAN;
    clearRoad(world, x, y);
    game.world.bver = (game.world.bver ?? 0) + 1;
    if (span) { touch(world, ['water'], x, y, x, y, 1); game.emit('bridge', { spans: 0 }); }
    return { ok: true, what: span ? 'Bridge' : 'Road' };
  }
  if (world.zone[i]) { setZone(world, x, y, null); return { ok: true, what: 'Zone' }; }
  // The city's own land can be cleared of its trees and its bare rock.
  if (world.realm[i] && world.tree[i] > 0) {
    clearTrees(world, x, y);
    return { ok: true, what: 'Trees' };
  }
  if (world.realm[i] && world.ground[i] === GROUND.ROCK && world.amount[i] > 0) {
    world.amount[i] = 0;
    world.ground[i] = GROUND.GRASS;
    touch(world, ['ground', 'terrain'], x, y, x, y, 2);
    return { ok: true, what: 'Rock' };
  }
  return { ok: false };
}

// ---------------------------------------------------------------- the moat

export function planAnnex(game, wardId) {
  const { world } = game;
  const ward = world.wards[wardId];
  const owned = ownedCount(world);
  const cost = annexCost(owned, ward.stats.hardness);
  const work = annexWork(owned);
  const out = { ward, cost, work, ok: false, reason: null };
  if (ward.owned) return { ...out, reason: 'Already yours' };
  if (ward.dig) return { ...out, reason: 'The diggers are at work here' };
  if (!bordersRealm(world, wardId)) return { ...out, reason: 'It must border your island' };
  const digging = world.wards.find((w) => w.dig);
  if (digging) return { ...out, reason: `The diggers are busy at ${digging.name}` };
  const cap = CASTLE_LEVELS[game.castleLevel].wards;
  if (owned >= cap) return { ...out, reason: `A ${CASTLE_LEVELS[game.castleLevel].name} can run only ${cap} ${cap === 1 ? 'district' : 'districts'}`, capped: true };
  if (!canPay(game.stock, cost)) return { ...out, reason: `Needs ${costText(cost)}`, short: true };
  return { ...out, ok: true };
}

export function startAnnex(game, wardId) {
  const plan = planAnnex(game, wardId);
  if (!plan.ok) return plan;
  payAll(game, plan.cost);
  plan.ward.dig = { progress: 0, weeks: plan.work.weeks, crew: plan.work.crew };
  game.emit('annexStart', { ward: plan.ward });
  game.note(`The dredgers have begun the canals around ${plan.ward.name}.`, 'info', [plan.ward.gx * WARD + WARD / 2, plan.ward.gy * WARD + WARD / 2]);
  return plan;
}

/** The moat is dug: the ward is the realm's, the old moat between is filled, the new one floods. */
export function completeAnnex(game, ward) {
  const { world } = game;
  ward.owned = true;
  ward.dig = null;
  computeMoat(world);
  gradeWard(world, ward.id);
  carveMoat(world);
  // Gatehouses whose gates are gone go with them.
  const live = new Set(world.gates.map((g) => g.gatehouse).filter(Boolean));
  for (const b of [...world.buildings.values()]) if (b.type === 'gatehouse' && !live.has(b.id)) removeBuilding(world, b.id);
  world.netVersion = (world.netVersion ?? 0) + 1;
  world.bver = (world.bver ?? 0) + 1;
  touchAll(world);
  game.emit('annexed', { ward });
  game.note(`${ward.name} is part of the city. The canals are dug and filling.`, 'good', [ward.gx * WARD + WARD / 2, ward.gy * WARD + WARD / 2]);
}

// ---------------------------------------------------------------- the castle

export function planCastle(game) {
  const next = CASTLE_LEVELS[game.castleLevel + 1];
  if (!next) return { ok: false, reason: 'The tower is as tall as it will get' };
  if (game.castleWork) return { ok: false, reason: 'The builders are already at work', next };
  if (game.rank < next.rank) return { ok: false, reason: `Needs the rank of ${RANKS[next.rank].name}`, next, rankLocked: true };
  if (!canPay(game.stock, next.cost)) return { ok: false, reason: `Needs ${costText(next.cost)}`, next, short: true };
  return { ok: true, next };
}

export function startCastle(game) {
  const plan = planCastle(game);
  if (!plan.ok) return plan;
  payAll(game, plan.next.cost);
  game.castleWork = { level: game.castleLevel + 1, progress: 0, weeks: plan.next.weeks, crew: 8 + game.castleLevel * 4 };
  game.note(`The masons have begun to raise the ${plan.next.name.toLowerCase()}.`, 'info', [CENTER, CENTER]);
  game.emit('castleStart', {});
  return plan;
}

// ---------------------------------------------------------------- the rest

export function setTax(game, rate) { game.tax = Math.max(0, Math.min(0.3, rate)); }
export function setPriority(game, type, n) { game.prio[type] = Math.max(0, Math.min(3, n)); }
export function setTrade(game, res, rule) { if (PRICES[res]) game.trade[res] = { ...game.trade[res], ...rule }; }

