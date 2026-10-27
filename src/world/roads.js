import { DIRS, GROUND, ROAD, TILES } from '../config.js';
import { CASTLE_BRIDGE, CASTLE_ROOT } from './wards.js';
import { clearTrees, idx, inb, rectRange, tileRange, touch } from './world.js';

/**
 * Roads, and the network they make. A building works only if a road that
 * leads back to the castle's drawbridge touches it; how far along the road it
 * is from a store decides how much of what it makes ever gets there.
 */

/** The steepest a tile can be and still take a road, a house or a field. */
export const MAX_SLOPE = 0.9;

export const isRoad = (world, x, y) => inb(x, y) && world.road[idx(x, y)] !== ROAD.NONE;

/** Why a tile can't be built on, or null if it can. `strict` also refuses roads and buildings. */
export function blocked(world, x, y, { strict = true, slope = MAX_SLOPE } = {}) {
  if (!inb(x, y)) return 'Off the map';
  const i = idx(x, y);
  if (!world.realm[i]) return world.moat[i] ? 'The moat' : 'Outside the moat';
  const g = world.ground[i];
  if (g === GROUND.WATER) return 'Water';
  if (g === GROUND.CLIFF) return 'Too steep';
  if (g === GROUND.ROCK || g === GROUND.ORE) return 'Bare rock';
  if (strict && world.bld[i]) return 'Occupied';
  if (strict && world.road[i]) return 'A road';
  const [lo, hi] = tileRange(world, x, y);
  if (hi - lo > slope) return 'Too steep';
  if (lo < 0.12) return 'Waterlogged';
  return null;
}

/** Why a road can't go on a tile, or null. A bridge tile already has one. */
export function roadBlocked(world, x, y) {
  if (!inb(x, y)) return 'Off the map';
  const i = idx(x, y);
  if (world.road[i] === ROAD.BRIDGE) return 'A bridge';
  if (world.bld[i]) return 'Occupied';
  return blocked(world, x, y, { strict: false });
}

/** Lays a road (or replaces dirt with cobbles). Returns the timber the cleared trees gave, or -1 if it can't. */
export function setRoad(world, x, y, type) {
  if (roadBlocked(world, x, y)) return -1;
  const i = idx(x, y);
  const gain = clearTrees(world, x, y);
  world.zone[i] = 0;
  world.crop[i] = 0;
  world.road[i] = type;
  touch(world, ['flat', 'ground'], x, y, x, y, 1);
  world.netVersion = (world.netVersion ?? 0) + 1;
  return gain;
}

/** Takes up a road. */
export function clearRoad(world, x, y) {
  const i = idx(x, y);
  if (!world.road[i] || world.road[i] === ROAD.BRIDGE) return false;
  world.road[i] = ROAD.NONE;
  touch(world, ['flat', 'ground'], x, y, x, y, 1);
  world.netVersion = (world.netVersion ?? 0) + 1;
  return true;
}

/** Walks out from `sources` along the roads: how many tiles each road tile is from one. Others are -1. */
export function walkRoads(world, sources, limit = 9999) {
  const dist = new Int16Array(TILES).fill(-1);
  const queue = [];
  for (const [x, y] of sources) {
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (world.road[i] && dist[i] < 0) { dist[i] = 0; queue.push(x, y); }
  }
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q], y = queue[q + 1];
    const d = dist[idx(x, y)];
    if (d >= limit) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const j = idx(nx, ny);
      if (world.road[j] && dist[j] < 0) { dist[j] = d + 1; queue.push(nx, ny); }
    }
  }
  return dist;
}

/** Where the town's roads begin: the tiles by the castle's drawbridge, and the bridge itself. */
export function rootTiles() {
  const out = [];
  for (let y = CASTLE_BRIDGE.y; y < CASTLE_BRIDGE.y + CASTLE_BRIDGE.d; y++) for (let x = CASTLE_BRIDGE.x; x < CASTLE_BRIDGE.x + CASTLE_BRIDGE.w; x++) out.push([x, y]);
  for (let x = CASTLE_ROOT.x; x < CASTLE_ROOT.x + CASTLE_ROOT.w; x++) out.push([x, CASTLE_ROOT.y]);
  return out;
}

/** The road distances from the castle, kept until a road changes. */
export function network(world) {
  if (world.net && world.net.version === (world.netVersion ?? 0)) return world.net;
  const dist = walkRoads(world, rootTiles());
  world.net = { version: world.netVersion ?? 0, dist };
  return world.net;
}

/** The nearest connected road tile touching the rectangle, as { x, y, dir, d } (dir: which side of the rectangle it is on), or null. */
export function accessOf(world, x0, y0, w, d) {
  const { dist } = network(world);
  let best = null;
  const consider = (x, y, dir) => {
    if (!inb(x, y)) return;
    const k = dist[idx(x, y)];
    if (k >= 0 && (!best || k < best.d)) best = { x, y, dir, d: k };
  };
  for (let x = x0; x < x0 + w; x++) { consider(x, y0 - 1, 0); consider(x, y0 + d, 2); }
  for (let y = y0; y < y0 + d; y++) { consider(x0 + w, y, 1); consider(x0 - 1, y, 3); }
  return best;
}

/** Does any road, connected or not, touch the rectangle? And which side? */
export function nearestRoadSide(world, x0, y0, w, d) {
  const sides = [];
  for (let x = x0; x < x0 + w; x++) { if (isRoad(world, x, y0 - 1)) sides.push(0); if (isRoad(world, x, y0 + d)) sides.push(2); }
  for (let y = y0; y < y0 + d; y++) { if (isRoad(world, x0 + w, y)) sides.push(1); if (isRoad(world, x0 - 1, y)) sides.push(3); }
  if (!sides.length) return null;
  const counts = [0, 0, 0, 0];
  for (const s of sides) counts[s]++;
  return counts.indexOf(Math.max(...counts));
}

/** How rough the ground is over a rectangle, for deciding whether it needs leveling. */
export const roughness = (world, x, y, w, d) => { const [lo, hi] = rectRange(world, x, y, w, d); return hi - lo; };

