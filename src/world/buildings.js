import { BUILDINGS } from '../catalog.js';
import { CENTER, GROUND } from '../config.js';
import { hash2 } from '../rng.js';
import { blocked, nearestRoadSide } from './roads.js';
import { clearTrees, flatten, idx, inb, rectRange, touch } from './world.js';

/**
 * Buildings on the land: where one may stand, putting one there, taking it
 * away. A building is { id, type, x, y, w, d, front, level, variant, state }
 * where (x, y, w, d) is the rectangle of tiles it covers on the map and
 * `front` the side that faces its street (0 north, 1 east, 2 south, 3 west).
 */

export const CASTLE_ID = 1;
/** The castle's courtyard: six tiles square, in the middle of the map. */
export const CASTLE_RECT = Object.freeze({ x: CENTER - 3, y: CENTER - 3, w: 6, d: 6 });

/** Which way a building is turned, as a footprint on the map: [w, d] along x and along y. */
export function footprint(type, front) {
  const [w, d] = BUILDINGS[type].size;
  return front === 1 || front === 3 ? [d, w] : [w, d];
}

/** The two tiles deep at the inner end of a gate's bridge, where a gatehouse stands. */
export function gateRect(g) {
  const [mx, my] = g.mid;
  if (g.dir === 0) return { x: mx - 1, y: my + 1, w: 2, d: 2 };
  if (g.dir === 2) return { x: mx - 1, y: my - 3, w: 2, d: 2 };
  if (g.dir === 1) return { x: mx - 3, y: my - 1, w: 2, d: 2 };
  return { x: mx + 1, y: my - 1, w: 2, d: 2 };
}

/** The ground a rectangle sits on counted by the kind of tile that is around its middle. */
export function countNear(world, cx, cy, radius, test) {
  let n = 0;
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(world.size - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(world.size - 1, Math.ceil(cx + radius)); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
      if (test(idx(x, y), x, y)) n++;
    }
  }
  return n;
}

const isWater = (world) => (i) => world.ground[i] === GROUND.WATER;
/** Open water: the sea or a lagoon, not a canal. */
const isSea = (world) => (i) => world.ground[i] === GROUND.WATER && !world.moat[i];
const isTrees = (world) => (i) => world.tree[i] > 0 && world.realm[i] === 1;
const isRock = (world) => (i) => world.ground[i] === GROUND.ROCK && world.amount[i] > 0 && world.realm[i] === 1;
const isOre = (world) => (i) => world.ground[i] === GROUND.ORE && world.amount[i] > 0 && world.realm[i] === 1;

/**
 * May a `type` stand at (x, y) facing `front`? Returns { ok, reason, rect, warn }:
 * `reason` says what is wrong, `warn` what is merely unwise (no road, no trees).
 */
export function check(world, type, x, y, front) {
  const def = BUILDINGS[type];
  const [w, d] = footprint(type, front);
  const rect = { x, y, w, d };
  if (def.where?.gate) {
    const g = world.gates.find((gt) => { const r = gateRect(gt); return x >= r.x - 1 && x <= r.x + 2 && y >= r.y - 1 && y <= r.y + 2; });
    if (!g) return { ok: false, reason: 'A gatehouse goes on a gate', rect };
    if (g.gatehouse) return { ok: false, reason: 'This gate has one', rect: gateRect(g) };
    return { ok: true, rect: gateRect(g), front: g.dir, gate: g, warn: [] };
  }
  for (let ty = y; ty < y + d; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const why = blocked(world, tx, ty, { slope: 1.6 });
      if (why) return { ok: false, reason: why, rect };
    }
  }
  const [lo, hi] = rectRange(world, x, y, w, d);
  if (hi - lo > 1.0) return { ok: false, reason: 'Too steep', rect };
  const cx = x + w / 2, cy = y + d / 2;
  const warn = [];
  const need = def.where;
  if (need?.water && countNear(world, cx, cy, need.water.radius, isWater(world)) < need.water.count) return { ok: false, reason: 'Needs open water close by', rect };
  if (need?.water && countNear(world, cx, cy, 2.6, isWater(world)) < 1) return { ok: false, reason: 'Must stand at the water’s edge', rect };
  if (need?.sea && countNear(world, cx, cy, need.sea.radius, isSea(world)) < need.sea.count) return { ok: false, reason: 'Must stand on the shore of the open sea', rect };
  if (need?.rock && countNear(world, cx, cy, need.rock.radius, isRock(world)) < need.rock.count) return { ok: false, reason: 'Needs bare rock close by', rect };
  if (need?.ore && countNear(world, cx, cy, need.ore.radius, isOre(world)) < need.ore.count) return { ok: false, reason: 'Needs iron ore close by', rect };
  if (need?.trees && countNear(world, cx, cy, need.trees.radius, isTrees(world)) < need.trees.count) warn.push('Few trees within reach');
  if (nearestRoadSide(world, x, y, w, d) === null) warn.push('No road touches it yet');
  return { ok: true, rect, warn };
}

/** The side of a rectangle that a street runs along, else the side that faces the castle. */
export function frontFor(world, x, y, w, d) {
  const side = nearestRoadSide(world, x, y, w, d);
  if (side !== null) return side;
  const dx = CENTER - (x + w / 2), dy = CENTER - (y + d / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
}

/** Stands a building on the land: levels the ground, clears the trees, and returns { building, timber }. */
export function addBuilding(world, type, x, y, front, { state = 'ready', level = BUILDINGS[type]?.level ?? 1, rect = null, id = null } = {}) {
  const r = rect ?? (() => { const [w, d] = footprint(type, front); return { x, y, w, d }; })();
  const b = {
    id: id ?? world.nextId++, type, x: r.x, y: r.y, w: r.w, d: r.d, front, level,
    variant: Math.floor(hash2(r.x, r.y, world.seed) * 1000), state, progress: state === 'ready' ? 1 : 0,
    workers: 0, eff: 0, active: false, built: 0,
  };
  let timber = 0;
  if (type !== 'gatehouse') flatten(world, r.x, r.y, r.w, r.d, { ease: 1.0 });
  for (let ty = r.y; ty < r.y + r.d; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      const i = idx(tx, ty);
      timber += clearTrees(world, tx, ty);
      world.bld[i] = b.id;
      world.zone[i] = 0;
      world.crop[i] = 0;
    }
  }
  world.buildings.set(b.id, b);
  touch(world, ['buildings', 'flat', 'trees', 'ground'], r.x, r.y, r.x + r.w, r.y + r.d, 1);
  world.bver = (world.bver ?? 0) + 1;
  return { building: b, timber };
}

/** Takes a building down. */
export function removeBuilding(world, id) {
  const b = world.buildings.get(id);
  if (!b) return null;
  for (let ty = b.y; ty < b.y + b.d; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) if (inb(tx, ty) && world.bld[idx(tx, ty)] === id) world.bld[idx(tx, ty)] = 0;
  world.buildings.delete(id);
  touch(world, ['buildings', 'flat', 'ground'], b.x, b.y, b.x + b.w, b.y + b.d, 1);
  world.bver = (world.bver ?? 0) + 1;
  return b;
}

/** The building on a tile. */
export function buildingAt(world, x, y) {
  if (!inb(x, y)) return null;
  const id = world.bld[idx(x, y)];
  return id ? world.buildings.get(id) ?? null : null;
}

/** The middle of a building, in tiles. */
export const centerOf = (b) => [b.x + b.w / 2, b.y + b.d / 2];

/** Is it the sort of building that gives work and so needs a road to be of use? */
export const needsRoad = (b) => b.type !== 'castle' && b.type !== 'well' && b.type !== 'green';

/** Puts the castle on its mound. */
export function placeCastle(world, level = 0) {
  const r = CASTLE_RECT;
  const b = {
    id: CASTLE_ID, type: 'castle', x: r.x, y: r.y, w: r.w, d: r.d, front: 2, level, variant: 0, state: 'ready', progress: 1, workers: 0, eff: 1, active: true, built: 0,
  };
  for (let y = r.y; y < r.y + r.d; y++) for (let x = r.x; x < r.x + r.w; x++) { world.bld[idx(x, y)] = CASTLE_ID; world.tree[idx(x, y)] = 0; }
  world.buildings.set(CASTLE_ID, b);
  touch(world, ['buildings', 'trees'], r.x, r.y, r.x + r.w, r.y + r.d, 2);
  return b;
}

