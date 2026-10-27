import { CASTLE, CENTER, DIRS, GROUND, HOME_WARD, MOAT_BANK, MOAT_HALF, ROAD, SIZE, WARD, WARDS, WATER_LEVEL } from '../config.js';
import { mulberry32, pick, smoothstep, lerp } from '../rng.js';
import { PLATEAU } from './generate.js';
import { HV, SUB, castleNorm, idx, tileRange, touchAll } from './world.js';

export { castleNorm };

/**
 * The map is a grid of wards, and the realm is the wards that have been
 * moated. A moat runs around the realm, along every ward border that has
 * unmoated land on the far side; where two of the realm's wards meet there is
 * no moat. The castle has a moat of its own, which never moves.
 */

// California names: a saint, a Spanish word, or an English one, and a word for the kind of place.
const FIRST = ['San Pedro', 'Santa Rosa', 'San Miguel', 'Santa Ana', 'San Lucas', 'Santa Clara', 'San Benito', 'Del Mar', 'La Playa', 'Las Palmas', 'El Segundo', 'Mar Vista', 'Playa', 'Solana', 'Coronado', 'Laguna', 'Encinitas', 'Cabrillo', 'Portola', 'Malibu', 'Pacifica', 'Ventura', 'Montecito', 'Topanga', 'Sausal', 'Redondo', 'Hermosa', 'Alameda', 'Marina', 'Sequoia'];
const LAST = [' Beach', ' Heights', ' Park', ' Hills', ' Shores', ' Bay', ' Point', ' Gardens', ' Village', ' Canyon', ' Mesa', ' Pier', ' Grove', ' Harbor', ' Terrace', ' Vista', ' Cove', ' Landing'];
const TAIL = { wood: ['Grove', 'Redwoods', 'Woods'], water: ['Lagoon', 'Marsh', 'Inlet'], rock: ['Bluffs', 'Point', 'Rocks'], ore: ['Bluffs', 'Rocks', 'Cliffs'], fertile: ['Valley', 'Gardens', 'Flats'], high: ['Heights', 'Ridge', 'Hills'], plain: ['Mesa', 'Flats', 'Commons', 'Park'] };

/** The four edges of a ward, as the direction they face. */
export const EDGES = ['north', 'east', 'south', 'west'];

export const wardId = (gx, gy) => gx + gy * WARDS;
export const wardXY = (id) => [id % WARDS, Math.floor(id / WARDS)];
export const wardOfTile = (x, y) => wardId(Math.floor(x / WARD), Math.floor(y / WARD));

/** Makes the wards (districts): their names, what they are like, and which one is the city's. */
export function initWards(world) {
  const rnd = mulberry32(world.seed ^ 0x2545f491);
  const used = new Set();
  const wards = [];
  for (let id = 0; id < WARDS * WARDS; id++) {
    const [gx, gy] = wardXY(id);
    const stats = measureWard(world, gx, gy);
    const trait = pickTrait(stats, gx, gy);
    let name;
    for (let tries = 0; ; tries++) {
      const base = `${pick(rnd, FIRST)}${pick(rnd, LAST)}`;
      name = rnd() < 0.55 ? base : `${pick(rnd, FIRST)} ${pick(rnd, TAIL[trait])}`;
      if (!used.has(name) || tries > 20) break;
    }
    used.add(name);
    wards.push({ id, gx, gy, name, trait, stats, owned: false, dig: null });
  }
  wards[wardId(HOME_WARD, HOME_WARD)].owned = true;
  wards[wardId(HOME_WARD, HOME_WARD)].name = `${pick(rnd, ['Nova', 'Vertex', 'Lumen', 'Quanta', 'Helix', 'Arcadia', 'Zenith', 'Cortex', 'Orbit', 'Nimbus'])} Island`;
  world.wards = wards;
  return wards;
}

/** How many of a ward's tiles are of each kind. */
export function measureWard(world, gx, gy) {
  const s = { tiles: WARD * WARD, arable: 0, forest: 0, rock: 0, ore: 0, water: 0, cliff: 0, rubble: 0, fert: 0 };
  let n = 0;
  for (let y = gy * WARD; y < (gy + 1) * WARD; y++) {
    for (let x = gx * WARD; x < (gx + 1) * WARD; x++) {
      const i = idx(x, y);
      const g = world.ground[i];
      if (g === GROUND.WATER) s.water++;
      else if (g === GROUND.CLIFF) s.cliff++;
      else if (g === GROUND.ROCK) s.rock++;
      else if (g === GROUND.ORE) s.ore++;
      else if (world.tree[i]) s.forest++;
      else if (world.fert[i] > 120) { const [lo, hi] = tileRange(world, x, y); if (hi - lo < 0.5) s.arable++; }
      s.fert += world.fert[i];
      n++;
    }
  }
  s.fert = s.fert / n / 255;
  s.hardness = Math.min(1, (s.cliff * 1 + s.rock * 0.5 + s.ore * 0.5 + s.forest * 0.18 + s.water * 0.3) / s.tiles * 1.6);
  return s;
}

function pickTrait(s, gx, gy) {
  const edge = gx === 0 || gy === 0 || gx === WARDS - 1 || gy === WARDS - 1;
  if (s.cliff + s.rock > s.tiles * 0.3 || (edge && s.hardness > 0.3)) return s.ore > 4 ? 'ore' : s.cliff > s.tiles * 0.2 ? 'high' : 'rock';
  if (s.water > s.tiles * 0.18) return 'water';
  if (s.ore > 4) return 'ore';
  if (s.forest > s.tiles * 0.4) return 'wood';
  if (s.arable > s.tiles * 0.45) return 'fertile';
  return 'plain';
}

/** What a ward is good for, in words. */
export function wardTraits(ward) {
  const s = ward.stats;
  const out = [];
  if (s.arable > s.tiles * 0.4) out.push('Wide, flat lots');
  else if (s.arable > s.tiles * 0.2) out.push('Some flat land');
  if (s.forest > s.tiles * 0.4) out.push('Thick woods');
  else if (s.forest > s.tiles * 0.15) out.push('Trees');
  if (s.water > s.tiles * 0.05) out.push(s.water > s.tiles * 0.2 ? 'Lagoon and creek' : 'Waterfront');
  if (s.rock > 6) out.push('Rocky bluffs');
  if (s.cliff > s.tiles * 0.2) out.push('Steep hills');
  return out.length ? out : ['Open, rough ground'];
}

export const ownedWards = (world) => world.wards.filter((w) => w.owned);
export const ownedCount = (world) => ownedWards(world).length;

/** Does the ward touch the realm? */
export function bordersRealm(world, id) {
  const [gx, gy] = wardXY(id);
  return DIRS.some(([dx, dy]) => {
    const x = gx + dx, y = gy + dy;
    return x >= 0 && y >= 0 && x < WARDS && y < WARDS && world.wards[wardId(x, y)].owned;
  });
}

/** The borders between the realm and what is not yet in it: segments, with the ward inside and which way they face. */
export function exposedBorders(world) {
  const out = [];
  for (const w of world.wards) {
    if (!w.owned) continue;
    const x0 = w.gx * WARD, y0 = w.gy * WARD, x1 = x0 + WARD, y1 = y0 + WARD;
    const segs = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]];
    DIRS.forEach(([dx, dy], dir) => {
      const nx = w.gx + dx, ny = w.gy + dy;
      const inside = nx >= 0 && ny >= 0 && nx < WARDS && ny < WARDS;
      if (inside && world.wards[wardId(nx, ny)].owned) return;
      const [ax, ay, bx, by] = segs[dir];
      out.push({ ward: w.id, dir, x0: ax, y0: ay, x1: bx, y1: by, beyond: inside ? wardId(nx, ny) : null });
    });
  }
  return out;
}

const segDist = (s, x, y) => {
  const dx = Math.max(Math.min(s.x0, s.x1) - x, 0, x - Math.max(s.x0, s.x1));
  const dy = Math.max(Math.min(s.y0, s.y1) - y, 0, y - Math.max(s.y0, s.y1));
  return Math.hypot(dx, dy);
};

/** The tiles of the castle's drawbridge: two wide, three long, on the south side. */
export const CASTLE_BRIDGE = Object.freeze({ x: CENTER - 1, y: CENTER + 3, w: 2, d: 3 });
/** Where the town's first road starts: the tiles just beyond the drawbridge. */
export const CASTLE_ROOT = Object.freeze({ x: CENTER - 1, y: CENTER + 6, w: 2 });

/**
 * Works out where the moat is from which wards are the realm's: the distance
 * to it from every vertex, which tiles are water, which are bank, and which
 * are the realm's to build on. Also where the gates are, keeping the state of
 * any that were there before.
 */
export function computeMoat(world) {
  const borders = exposedBorders(world);
  world.borders = borders;
  const D = world.moatD;
  D.fill(99);
  const reach = MOAT_BANK + 5;
  for (const s of borders) {
    const vx0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - reach) * SUB)), vx1 = Math.min(HV - 1, Math.ceil((Math.max(s.x0, s.x1) + reach) * SUB));
    const vy0 = Math.max(0, Math.floor((Math.min(s.y0, s.y1) - reach) * SUB)), vy1 = Math.min(HV - 1, Math.ceil((Math.max(s.y0, s.y1) + reach) * SUB));
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const d = segDist(s, vx / SUB, vy / SUB);
        const i = vy * HV + vx;
        if (d < D[i]) D[i] = d;
      }
    }
  }
  const { moat, realm } = world;
  moat.fill(0);
  realm.fill(0);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = idx(x, y);
      const cx = x + 0.5, cy = y + 0.5;
      let d = 99;
      for (const s of borders) {
        const sd = segDist(s, cx, cy);
        if (sd < d) d = sd;
      }
      const cn = castleNorm(cx, cy);
      if (cn < CASTLE.bank + 0.2) moat[i] = cn >= 3.1 && cn <= 5.0 ? 1 : 2;
      else if (d < MOAT_HALF) moat[i] = 1;
      else if (d < MOAT_BANK) moat[i] = 2;
      const w = world.wards[wardId(Math.floor(x / WARD), Math.floor(y / WARD))];
      if (w.owned && !moat[i]) realm[i] = 1;
    }
  }
  // Gates: one at the middle of every border that has another ward across it.
  const old = new Map((world.gates ?? []).map((g) => [`${g.ward}:${g.dir}`, g]));
  const gates = [];
  for (const s of borders) {
    if (s.beyond === null) continue;
    const key = `${s.ward}:${s.dir}`;
    const horizontal = s.dir === 0 || s.dir === 2;
    const mid = (horizontal ? s.x0 : s.y0) + WARD / 2;
    const tiles = [];
    // Six tiles long across the moat, two wide.
    for (let k = -3; k < 3; k++) {
      for (let a = -1; a < 1; a++) {
        const along = mid + a;
        const across = (horizontal ? s.y0 : s.x0) + k;
        tiles.push(horizontal ? [along, across] : [across, along]);
      }
    }
    // Which end is the inside: the one nearer the ward's own middle.
    const gate = old.get(key) ?? { ward: s.ward, dir: s.dir, open: true, gatehouse: 0 };
    gate.tiles = tiles;
    gate.beyond = s.beyond;
    gate.mid = horizontal ? [mid, s.y0] : [s.x0, mid];
    gates.push(gate);
  }
  world.gates = gates;
  for (let i = 0; i < world.road.length; i++) if (world.road[i] === ROAD.BRIDGE) world.road[i] = ROAD.NONE;
  for (const g of gates) for (const [x, y] of g.tiles) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) world.road[idx(x, y)] = ROAD.BRIDGE;
  // And the castle's.
  const b = CASTLE_BRIDGE;
  for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) world.road[idx(x, y)] = ROAD.BRIDGE;
  touchAll(world);
  return world;
}

/** Shapes the castle's island: a mound for the keep, a moat around it, a bank beyond. Done once, into the base heights. */
export function shapeCastle(world) {
  if (!world.hBase) world.hBase = Float32Array.from(world.h);
  for (let vy = 0; vy < HV; vy++) {
    for (let vx = 0; vx < HV; vx++) {
      const dp = castleNorm(vx / SUB, vy / SUB);
      if (dp > 6) continue;
      const i = vy * HV + vx;
      let h;
      if (dp < 2.9) h = PLATEAU + 0.55;
      else if (dp < 3.5) h = lerp(PLATEAU + 0.55, -0.95, smoothstep(2.9, 3.5, dp));
      else if (dp < 4.6) h = -0.95;
      else h = lerp(-0.95, PLATEAU, smoothstep(4.6, 5.6, dp));
      world.hBase[i] = h;
    }
  }
  world.h.set(world.hBase);
  touchAll(world);
}

/** Cuts the trench of the moat along every exposed border into the base heights. The ground can only be lowered by it; where a border is gone the land comes back. */
export function carveMoat(world) {
  if (!world.hBase) world.hBase = Float32Array.from(world.h);
  const D = world.moatD;
  for (let i = 0; i < world.h.length; i++) {
    let h = world.hBase[i];
    const d = D[i];
    if (d < 7) {
      const cap = PLATEAU + 0.5 * Math.max(0, d - 2.5);
      const trench = -0.95 + (cap + 0.95) * smoothstep(0.7, 3.2, d);
      if (trench < h) h = trench;
    }
    world.h[i] = h;
  }
  clearMoatTrees(world);
  touchAll(world);
}

/** Trees do not stand in the water: the woods a new moat is dug through (the ward's own, or its neighbor's) lose the trees the water reaches. */
export function clearMoatTrees(world) {
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const i = idx(x, y);
      if (!world.tree[i] || !world.moat[i]) continue;
      let wet = world.moat[i] === 1;
      for (let j = 0; j <= SUB && !wet; j++) for (let k = 0; k <= SUB; k++) if (world.h[(y * SUB + j) * HV + x * SUB + k] < WATER_LEVEL + 0.04) { wet = true; break; }
      if (wet) world.tree[i] = 0;
    }
  }
}

/** Smooths the ground inside a ward the founder has taken, so there is somewhere flat to build. */
export function gradeWard(world, id, passes = 3) {
  const [gx, gy] = wardXY(id);
  const vx0 = gx * WARD * SUB, vx1 = (gx + 1) * WARD * SUB, vy0 = gy * WARD * SUB, vy1 = (gy + 1) * WARD * SUB;
  if (!world.hBase) world.hBase = Float32Array.from(world.h);
  for (let p = 0; p < passes; p++) {
    const copy = Float32Array.from(world.hBase);
    for (let vy = Math.max(1, vy0); vy < Math.min(HV - 1, vy1); vy++) {
      for (let vx = Math.max(1, vx0); vx < Math.min(HV - 1, vx1); vx++) {
        const i = vy * HV + vx;
        if (world.moatD[i] < 3.2 || castleNorm(vx / SUB, vy / SUB) < 6) continue;
        if (copy[i] < 0.08) continue;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += copy[i + dy * HV + dx];
        world.hBase[i] = lerp(copy[i], Math.max(0.12, sum / 9), 0.75);
      }
    }
  }
  carveMoat(world);
}

/** The gate whose bridge covers tile (x, y), if any. */
export function gateAt(world, x, y) {
  for (const g of world.gates) for (const [tx, ty] of g.tiles) if (tx === x && ty === y) return g;
  return null;
}

export const wardName = (world, id) => world.wards[id]?.name ?? '';
