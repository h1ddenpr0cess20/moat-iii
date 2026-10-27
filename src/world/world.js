import { CENTER, CHUNK, CHUNKS, DIRS, GROUND, SIZE, TILES, WARD, WARDS } from '../config.js';
import { seedOf } from '../rng.js';

/**
 * The land: one flat array for each thing a tile can have, and the heights
 * of its corners (two vertices a tile, so a moat's bank and a hill's brow
 * come out round). A tile is (x, y), x east and y south; the engine's world
 * is x and z the same, with y up. Nothing here knows about drawing, except
 * which chunks have changed and so want drawing again.
 */

/** Height vertices a tile: two, so one every half tile. */
export const SUB = 2;
/** Height vertices along the map. */
export const HV = SIZE * SUB + 1;

export const KINDS = ['terrain', 'ground', 'flat', 'trees', 'buildings', 'water'];

export function createWorld(seedText = 'moat') {
  const world = {
    seedText: String(seedText),
    seed: seedOf(seedText),
    size: SIZE,
    /** Heights, one every half tile, row by row; and the same before any moat is cut (see wards.js). */
    h: new Float32Array(HV * HV),
    hBase: null,
    /** What each tile is made of (GROUND). */
    ground: new Uint8Array(TILES),
    /** Trees standing on it, 0 to 3. */
    tree: new Uint8Array(TILES),
    /** How good the soil is, 0 to 255. */
    fert: new Uint8Array(TILES),
    /** How much stone or ore is left in a rock or ore tile. */
    amount: new Uint16Array(TILES),
    /** ROAD, zone number, building id, and how far a field's crop has come (0 to 255). */
    road: new Uint8Array(TILES),
    zone: new Uint8Array(TILES),
    bld: new Int32Array(TILES),
    crop: new Uint8Array(TILES),
    /** What the moat does to a tile: 1 water, 2 bank (nothing may be built); castle's own ring likewise. */
    moat: new Uint8Array(TILES),
    /** Whether the tile is the realm's: inside the moat, and not on its banks. */
    realm: new Uint8Array(TILES),
    /** Distance from each height vertex to the nearest exposed ward border. */
    moatD: new Float32Array(HV * HV).fill(99),
    /** Which height of the moat each ward's border has been dug to, 0 to 1 (for the digging to show). */
    wards: [],
    gates: [],
    buildings: new Map(),
    nextId: 2,
    dirty: Object.fromEntries(KINDS.map((k) => [k, new Set()])),
  };
  return world;
}

export const idx = (x, y) => y * SIZE + x;
export const inb = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const wardIndex = (x, y) => Math.floor(x / WARD) + Math.floor(y / WARD) * WARDS;
export const chunkIndex = (x, y) => Math.floor(x / CHUNK) + Math.floor(y / CHUNK) * CHUNKS;

/** Marks the chunks that touch the tiles (x0, y0) to (x1, y1), with a tile to spare, as wanting `kinds` redrawn. */
export function touch(world, kinds, x0, y0, x1 = x0, y1 = y0, margin = 1) {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const c0 = Math.max(0, Math.floor((x0 - margin) / CHUNK)), c1 = Math.min(CHUNKS - 1, Math.floor((x1 + margin) / CHUNK));
  const r0 = Math.max(0, Math.floor((y0 - margin) / CHUNK)), r1 = Math.min(CHUNKS - 1, Math.floor((y1 + margin) / CHUNK));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const k of list) world.dirty[k].add(c + r * CHUNKS);
  // The ground is repainted only where it changed: each chunk keeps the box of tiles touched since it was last painted.
  if (list.includes('ground')) {
    world.groundBox ??= new Map();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = c + r * CHUNKS, box = world.groundBox.get(i);
        const nb = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
        world.groundBox.set(i, box ? [Math.min(box[0], nb[0]), Math.min(box[1], nb[1]), Math.max(box[2], nb[2]), Math.max(box[3], nb[3])] : nb);
      }
    }
  }
}

export function touchAll(world, kinds = KINDS) {
  for (let i = 0; i < CHUNKS * CHUNKS; i++) for (const k of kinds) world.dirty[k].add(i);
  if (kinds.includes('ground')) world.groundBox?.clear();
}

/** The height of the land at world (x, z): the same triangles the ground is drawn with. */
export function heightAt(world, x, z) {
  const gx = Math.max(0, Math.min(SIZE, x)) * SUB, gz = Math.max(0, Math.min(SIZE, z)) * SUB;
  const i = Math.min(HV - 2, Math.floor(gx)), j = Math.min(HV - 2, Math.floor(gz));
  const fx = gx - i, fz = gz - j;
  const h = world.h;
  const h00 = h[j * HV + i], h10 = h[j * HV + i + 1], h01 = h[(j + 1) * HV + i], h11 = h[(j + 1) * HV + i + 1];
  return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

/** The lowest and highest of the nine height vertices a tile has. */
export function tileRange(world, x, y) {
  let lo = Infinity, hi = -Infinity;
  const h = world.h;
  for (let j = 0; j <= SUB; j++) {
    for (let i = 0; i <= SUB; i++) {
      const v = h[(y * SUB + j) * HV + x * SUB + i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

/** The ground's height at a tile's middle. */
export const tileH = (world, x, y) => world.h[(y * SUB + 1) * HV + x * SUB + 1];

/** How much the ground over a rectangle of tiles rises and falls. */
export function rectRange(world, x0, y0, w, d) {
  let lo = Infinity, hi = -Infinity;
  for (let y = y0; y < y0 + d; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const [a, b] = tileRange(world, x, y);
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
  }
  return [lo, hi];
}

/** The distance from the middle of the castle on the squared-off norm its island is drawn with. */
export const castleNorm = (x, y) => (Math.abs(x - CENTER) ** 8 + Math.abs(y - CENTER) ** 8) ** 0.125;

/** Levels the ground under a rectangle of tiles to its average, and eases the ring of land around it into that. */
export function flatten(world, x0, y0, w, d, { ease = 1.2 } = {}) {
  const vx0 = x0 * SUB, vx1 = (x0 + w) * SUB, vy0 = y0 * SUB, vy1 = (y0 + d) * SUB;
  let sum = 0, n = 0;
  for (let vy = vy0; vy <= vy1; vy++) for (let vx = vx0; vx <= vx1; vx++) { sum += world.h[vy * HV + vx]; n++; }
  const target = sum / n;
  const reach = Math.ceil(ease * SUB);
  for (let vy = Math.max(0, vy0 - reach); vy <= Math.min(HV - 1, vy1 + reach); vy++) {
    for (let vx = Math.max(0, vx0 - reach); vx <= Math.min(HV - 1, vx1 + reach); vx++) {
      const dx = Math.max(vx0 - vx, 0, vx - vx1) / SUB, dy = Math.max(vy0 - vy, 0, vy - vy1) / SUB;
      const dist = Math.hypot(dx, dy);
      const k = dist <= 0 ? 1 : Math.max(0, 1 - dist / ease);
      if (k <= 0) continue;
      const i = vy * HV + vx;
      // The banks of a moat are left as they were cut.
      if (world.moatD[i] < 2.7 || castleNorm(vx / SUB, vy / SUB) < 5.6) continue;
      world.h[i] += (target - world.h[i]) * (k * k * (3 - 2 * k));
      if (world.hBase) world.hBase[i] = world.h[i];
    }
  }
  touch(world, ['terrain', 'ground'], x0, y0, x0 + w, y0 + d, 2);
  return target;
}

/** Is the tile's ground one a house can stand on? */
export function plain(world, x, y) {
  const i = idx(x, y);
  const g = world.ground[i];
  return g === GROUND.GRASS || g === GROUND.SAND;
}

/** The tile's trees, ground and so on, in a line for a tooltip. */
export function describeTile(world, x, y) {
  const i = idx(x, y);
  const g = world.ground[i];
  const names = ['Meadow', 'Rock outcrop', 'Iron ore', 'Water', 'Cliff', 'Shore'];
  let text = names[g];
  if (world.tree[i]) text = world.tree[i] > 1 ? 'Forest' : 'Woodland';
  return text;
}

/** The four neighbors of a tile that are on the map. */
export function neighbors(x, y) {
  const out = [];
  for (const [dx, dy] of DIRS) if (inb(x + dx, y + dy)) out.push([x + dx, y + dy]);
  return out;
}

/** Clears out of the way: used when a house or field goes where trees stand. Gives back the timber. */
export function clearTrees(world, x, y) {
  const i = idx(x, y);
  const n = world.tree[i];
  if (!n) return 0;
  world.tree[i] = 0;
  touch(world, ['trees', 'ground'], x, y);
  return n * 2;
}

/** The distance to the middle of the map. */
export const fromCenter = (x, y) => Math.hypot(x - CENTER, y - CENTER);
