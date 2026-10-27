import { PLOT_DEPTH, ZONES, ZONE_ID } from '../catalog.js';
import { DIRS, ROAD, TILES } from '../config.js';
import { blocked, network } from './roads.js';
import { clearTrees, idx, inb, touch } from './world.js';

/**
 * Zones, and the lots that grow on them. A house takes a plot with its front
 * on a street and reaches back as far as it needs; the land behind the plots
 * is left alone, and that is the donut: a ring of houses around a core of
 * gardens, orchard or field.
 */

/** Why a tile can't be zoned, or null. */
export function zoneBlocked(world, x, y) {
  if (!inb(x, y)) return 'Off the map';
  const i = idx(x, y);
  if (world.road[i]) return 'A road';
  return blocked(world, x, y);
}

/** Zones a tile (or clears it with `zone` of null). Returns the timber from cleared trees, or -1 if it can't. */
export function setZone(world, x, y, zone) {
  if (zone === null) {
    const i = idx(x, y);
    if (!inb(x, y) || !world.zone[i] || world.bld[i]) return -1;
    world.zone[i] = 0;
    world.crop[i] = 0;
    touch(world, 'flat', x, y);
    return 0;
  }
  if (zoneBlocked(world, x, y)) return -1;
  const i = idx(x, y);
  const id = ZONE_ID[zone];
  if (world.zone[i] === id) return 0;
  const gain = clearTrees(world, x, y);
  world.zone[i] = id;
  world.crop[i] = 0;
  touch(world, ['flat', 'ground'], x, y);
  return gain;
}

/** How many tiles of a zone, for knowing what a plan costs. */
export const zoneCost = (zone) => ZONES[zone].cost;

/** Plans a donut block over a rectangle of tiles: the street around it, the plots inside it, and the core. Returns tile lists. */
export function blockPlan(x0, y0, x1, y1, { ring = 'res', core = 'res' } = {}) {
  const roads = [], ringTiles = [], coreTiles = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (edge) { roads.push([x, y]); continue; }
      const depth = Math.min(x - x0, x1 - x, y - y0, y1 - y); // 1 for the first row inside the street
      (depth <= PLOT_DEPTH ? ringTiles : coreTiles).push([x, y]);
    }
  }
  return { roads, ring: ringTiles, core: core === 'none' ? [] : coreTiles, ringZone: ring, coreZone: core };
}

/** Does the block plan fit: big enough to have a core, and small enough to be reached. */
export const BLOCK = Object.freeze({ min: 8, max: 22 });

/**
 * Where the land is core: a zoned, empty tile that is further than a plot's
 * depth from every street. Returns the tile indices.
 */
export function coreTiles(world) {
  const { dist } = network(world);
  const near = new Int8Array(TILES).fill(-1);
  const queue = [];
  for (let i = 0; i < TILES; i++) {
    if (dist[i] >= 0) { near[i] = 0; queue.push(i % world.size, Math.floor(i / world.size)); }
  }
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q], y = queue[q + 1];
    const d = near[idx(x, y)];
    if (d >= PLOT_DEPTH + 1) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const j = idx(nx, ny);
      if (near[j] < 0 && !world.road[j]) { near[j] = d + 1; queue.push(nx, ny); }
    }
  }
  const out = [];
  for (let i = 0; i < TILES; i++) {
    if (world.zone[i] === ZONE_ID.res && !world.bld[i] && !world.road[i] && (near[i] < 0 || near[i] > PLOT_DEPTH - 1)) out.push(i);
  }
  return out;
}

const DIR_LATERAL = [[1, 0], [0, 1], [1, 0], [0, 1]];

/**
 * Looks along every connected street for a plot of `size` ([width along the
 * street, depth]) on land zoned `zone`. Returns the best as { x, y, w, d,
 * front } or null. `value(x, y)` says how good a spot is.
 */
export function findLot(world, zone, size, rnd, value = () => 0) {
  const { dist } = network(world);
  const zid = ZONE_ID[zone];
  const [W, D] = size;
  let best = null, bestScore = -Infinity;
  const free = (x, y) => inb(x, y) && world.zone[idx(x, y)] === zid && !world.bld[idx(x, y)] && !world.road[idx(x, y)] && !blocked(world, x, y);
  for (let i = 0; i < TILES; i++) {
    if (dist[i] < 0 || world.road[i] === ROAD.BRIDGE || world.road[i] === ROAD.SPAN) continue;
    const rx = i % world.size, ry = Math.floor(i / world.size);
    for (let k = 0; k < 4; k++) {
      const fx = rx + DIRS[k][0], fy = ry + DIRS[k][1];
      if (!free(fx, fy)) continue;
      const [lx, ly] = DIR_LATERAL[k];
      for (let o = 0; o < W; o++) {
        // The plot's front row runs from (fx, fy) - o along the street.
        const sx = fx - lx * o, sy = fy - ly * o;
        let ok = true;
        // The tiles of the plot: along the street W, reaching away from it D.
        for (let a = 0; a < W && ok; a++) {
          for (let b = 0; b < D; b++) {
            const tx = sx + lx * a + DIRS[k][0] * b, ty = sy + ly * a + DIRS[k][1] * b;
            if (!free(tx, ty)) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const ex = sx + lx * (W - 1) + DIRS[k][0] * (D - 1), ey = sy + ly * (W - 1) + DIRS[k][1] * (D - 1);
        const x0 = Math.min(sx, ex), y0 = Math.min(sy, ey);
        const w = Math.abs(ex - sx) + 1, d = Math.abs(ey - sy) + 1;
        // Packed against a neighbor on either side scores best, so streets fill without gaps.
        const shut = (tx, ty) => !free(tx, ty);
        let score = rnd() * 0.8 + value(x0 + w / 2, y0 + d / 2);
        if (shut(sx - lx, sy - ly)) score += 2;
        if (shut(sx + lx * W, sy + ly * W)) score += 2;
        if (score > bestScore) { bestScore = score; best = { x: x0, y: y0, w, d, front: (k + 2) % 4 }; }
      }
    }
  }
  return best;
}

/** The farm tiles on a zone: which tiles, as indices. */
export function zoneTiles(world, zone) {
  const out = [];
  const id = ZONE_ID[zone];
  for (let i = 0; i < TILES; i++) if (world.zone[i] === id && !world.bld[i]) out.push(i);
  return out;
}

