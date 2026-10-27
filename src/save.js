import { ROAD, WARDS } from './config.js';
import { mulberry32 } from './rng.js';
import { START } from './catalog.js';
import { defaultTrade, newGame } from './sim/state.js';
import { prime } from './sim/game.js';
import { clearMoatTrees, computeMoat } from './world/wards.js';
import { HEIGHTS, MAPS } from './world/snapshot.js';
import { idx, touchAll } from './world/world.js';

/**
 * Saving and loading. The land is made from its seed, so a save keeps only
 * what has changed since: the cells of each map that differ from the fresh
 * one (as runs, so a few hundred thousand cells of mostly nothing take a few
 * kilobytes), the buildings, the wards, the stores and the people.
 */

export const SAVE_VERSION = 1;

/** The cells of `cur` that differ from `base`, as [start, length, ...values] runs. */
function runs(cur, base, scale = 1) {
  const out = [];
  let i = 0;
  const n = cur.length;
  const differs = (k) => (scale === 1 ? cur[k] !== base[k] : Math.round(cur[k] * scale) !== Math.round(base[k] * scale));
  while (i < n) {
    if (!differs(i)) { i++; continue; }
    const start = i;
    const vals = [];
    // Run on across short gaps: it costs less than starting another.
    let quiet = 0;
    while (i < n && quiet < 4) {
      if (differs(i)) quiet = 0; else quiet++;
      vals.push(scale === 1 ? cur[i] : Math.round(cur[i] * scale));
      i++;
    }
    vals.length -= quiet;
    i -= quiet;
    out.push(start, vals.length, ...vals);
  }
  return out;
}

function apply(target, list, scale = 1) {
  for (let p = 0; p < list.length;) {
    const start = list[p], len = list[p + 1];
    for (let k = 0; k < len; k++) target[start + k] = scale === 1 ? list[p + 2 + k] : list[p + 2 + k] / scale;
    p += 2 + len;
  }
}

/** Everything about a game that a save must keep, as plain data. */
export function serialize(game) {
  const { world } = game;
  if (!world.base) throw new Error('save: the world was not snapshotted');
  const maps = {};
  for (const k of MAPS) maps[k] = runs(world[k], world.base[k]);
  for (const k of HEIGHTS) maps[k] = runs(world[k], world.base[k], 1000);
  return {
    v: SAVE_VERSION,
    mapWards: WARDS,
    seed: game.seed,
    difficulty: game.difficulty,
    disasters: game.disasters,
    week: game.week,
    stock: game.stock,
    pop: game.pop,
    happiness: game.happiness,
    health: game.health,
    shock: game.shock,
    tax: game.tax,
    budget: game.budget,
    hurricane: game.hurricane,
    castleLevel: game.castleLevel,
    castleWork: game.castleWork,
    rank: game.rank,
    trade: game.trade,
    nextMerchant: game.nextMerchant,
    nextRelief: game.nextRelief ?? 0,
    nextFirewood: game.nextFirewood ?? 0,
    prio: game.prio,
    nextRaid: Number.isFinite(game.nextRaid) ? game.nextRaid : null,
    raids: game.raids,
    raidGate: game.raidGate ? [game.raidGate.ward, game.raidGate.dir] : null,
    takings: Math.round(game.takings ?? 0),
    plague: game.plague,
    weather: game.weather,
    log: game.log.slice(0, 40),
    gameOver: game.gameOver,
    stats: game.stats,
    wards: world.wards.map((w) => [w.id, w.owned ? 1 : 0, w.dig]),
    gates: world.gates.map((g) => [g.ward, g.dir, g.open ? 1 : 0, g.gatehouse]),
    nextId: world.nextId,
    buildings: [...world.buildings.values()].map((b) => [b.id, b.type, b.x, b.y, b.w, b.d, b.front, b.level, b.variant, b.state, +b.progress.toFixed(3), b.built ?? 0, b.upgrading ? 1 : 0]),
    maps,
  };
}

/** A game from a save: the land from its seed, then the saved changes on it. */
export function deserialize(data) {
  if (!data || data.v !== SAVE_VERSION) throw new Error('This save is from another version of the game.');
  if ((data.mapWards ?? 7) !== WARDS) throw new Error('This save was made on a map of another size.');
  const game = newGame({ seed: data.seed, difficulty: data.difficulty, disasters: data.disasters !== false });
  const { world } = game;
  // Wards first: the moat and the realm follow from which are owned.
  for (const [id, owned, dig] of data.wards) { world.wards[id].owned = Boolean(owned); world.wards[id].dig = dig; }
  computeMoat(world);
  for (const [ward, dir, open, gatehouse] of data.gates) {
    const g = world.gates.find((x) => x.ward === ward && x.dir === dir);
    if (g) { g.open = Boolean(open); g.gatehouse = gatehouse; }
  }
  for (const k of MAPS) apply(world[k], data.maps[k]);
  for (const k of HEIGHTS) apply(world[k], data.maps[k], 1000);
  // A save from before the moat kept its trees out of the water may still have some in it.
  clearMoatTrees(world);
  // The bridges the moat makes are the map's own: the road map must keep them.
  for (const g of world.gates) for (const [x, y] of g.tiles) if (x >= 0 && y >= 0 && x < world.size && y < world.size) world.road[idx(x, y)] = ROAD.BRIDGE;
  world.bld.fill(0);
  world.buildings.clear();
  for (const [id, type, x, y, w, d, front, level, variant, state, progress, built, upgrading] of data.buildings) {
    const b = { id, type, x, y, w, d, front, level, variant, state, progress, workers: 0, eff: type === 'castle' ? 1 : 0, active: type === 'castle', built, upgrading: Boolean(upgrading) };
    world.buildings.set(id, b);
    for (let ty = y; ty < y + d; ty++) for (let tx = x; tx < x + w; tx++) world.bld[idx(tx, ty)] = id;
  }
  world.nextId = data.nextId;
  Object.assign(game, {
    // Goods the game has gained since the save was made start at what a new founder has.
    week: data.week, stock: { ...START.stock, ...data.stock }, pop: data.pop, happiness: data.happiness, health: data.health, shock: data.shock, tax: data.tax, budget: data.budget ?? 1, hurricane: data.hurricane ?? null,
    castleLevel: data.castleLevel, castleWork: data.castleWork, rank: data.rank, trade: { ...defaultTrade(), ...data.trade }, nextMerchant: data.nextMerchant, nextRelief: data.nextRelief ?? 0, nextFirewood: data.nextFirewood ?? 0, prio: data.prio,
    nextRaid: data.nextRaid ?? Infinity, raids: data.raids, plague: data.plague, weather: data.weather, log: data.log, gameOver: data.gameOver, stats: data.stats,
    takings: data.takings ?? 0,
    raidGate: data.raidGate ? world.gates.find((g) => g.ward === data.raidGate[0] && g.dir === data.raidGate[1]) ?? null : null,
  });
  game.rnd = mulberry32((world.seed ^ 0xa5a5a5a5 ^ Math.imul(data.week + 1, 2654435761)) >>> 0);
  world.bver = (world.bver ?? 0) + 1;
  world.netVersion = (world.netVersion ?? 0) + 1;
  touchAll(world);
  prime(game);
  return game;
}
