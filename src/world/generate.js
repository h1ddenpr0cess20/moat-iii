import { CENTER, GROUND, SIZE, WARD, WATER_LEVEL } from '../config.js';
import { clamp, fbm, lerp, mulberry32, noise2, range, ridged, smoothstep } from '../rng.js';
import { HV, SUB, idx, tileRange, touchAll } from './world.js';

/**
 * Makes a map from a seed: an island off the California coast, with a level
 * plaza for the tower in the middle, rolling lowland with a creek and its
 * lagoons, a few hills and bluffs, groves of trees, and beaches all round
 * falling away into the Pacific. Everything is a function of
 * the seed, so the same seed is the same land.
 */

/** The height the town's ground is level at. */
export const PLATEAU = 0.9;

/** The numbers below were tuned on wards of 24 tiles; this scales them to the ward's size. */
const K = WARD / 24;
const HALF = SIZE / 2;

/** The land's height with no water cut into it, at world (x, z); beyond the island's shore the sea floor falls away. */
export function baseHeight(seed, x, z) {
  const dx = x - CENTER, dz = z - CENTER;
  const cheb = Math.max(Math.abs(dx), Math.abs(dz));
  const r = Math.hypot(dx, dz);
  let h = 0.55 + fbm(x / 34, z / 34, seed, 4) * 1.5;
  const hills = fbm(x / 20 + 40, z / 20 - 17, seed + 7, 3);
  h += Math.max(0, hills - 0.56) * 6 * smoothstep(WARD * 0.42, WARD, r);
  // The home ward is level.
  const flat = smoothstep(WARD, WARD * 0.62, cheb);
  h = lerp(h, PLATEAU + (fbm(x / 6, z / 6, seed + 3, 2) - 0.5) * 0.08, flat);
  // The coast: the land runs down to a beach, and the beach into the sea, the shore wandering in coves and points.
  const warp = (fbm(x / 22 + 9, z / 22 + 3, seed + 11, 3) - 0.5) * 22 * K + (ridged(x / 40, z / 40, seed + 13, 3) - 0.5) * 10 * K;
  const shore = smoothstep(HALF * 0.66, HALF * 0.9, r + warp);
  h = lerp(h, 0.12, smoothstep(0, 0.5, shore));
  h -= smoothstep(0.45, 1, shore) * (1.8 + Math.max(0, r - HALF * 0.9) * 0.05);
  return h;
}

/** A river: a wandering line from one lake to another, well clear of the castle. */
function makeRiver(rnd, seed) {
  const vertical = rnd() < 0.5;
  const side = rnd() < 0.5 ? -1 : 1;
  const off = side * range(rnd, 0.8 * WARD, 1.08 * WARD);
  const phase = rnd() * 6.28;
  const pts = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const along = (t - 0.5) * SIZE * 0.6;
    let across = off + Math.sin(t * Math.PI * 2.2 + phase) * 6.5 * K + (fbm(t * 5, (seed % 97) + 3, seed, 2) - 0.5) * 8 * K;
    if (side * across < 0.73 * WARD) across = side * 0.73 * WARD;
    pts.push(vertical ? [CENTER + across, CENTER + along] : [CENTER + along, CENTER + across]);
  }
  return { pts, width: range(rnd, 1.8, 2.3), vertical, side };
}

const distToPath = (pts, x, z) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz));
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) best = d;
  }
  return best;
};

/** Fills `world` from its seed. */
export function generate(world) {
  const seed = world.seed;
  const rnd = mulberry32(seed ^ 0x51ed270b);
  const river = makeRiver(rnd, seed);
  const lakes = [
    { x: river.pts[0][0], z: river.pts[0][1], rx: range(rnd, 7, 9.5) * K, rz: range(rnd, 7, 9.5) * K },
    { x: river.pts.at(-1)[0], z: river.pts.at(-1)[1], rx: range(rnd, 8, 11) * K, rz: range(rnd, 8, 11) * K },
  ];
  // A pond on the far side of the castle from the river.
  const pa = rnd() * Math.PI * 2;
  const pondR = range(rnd, 1.25 * WARD, 1.75 * WARD);
  const pond = { x: CENTER + Math.cos(pa) * pondR * (river.vertical ? -river.side : 0.5), z: CENTER + Math.sin(pa) * pondR * (river.vertical ? 0.5 : -river.side), rx: range(rnd, 3.5, 5.5), rz: range(rnd, 3.5, 5.5) };
  lakes.push(pond);
  world.river = river;
  world.lakes = lakes;

  // Hills: where the crags go. The home ward gets a copse in two of its corners.
  const corner = Math.floor(rnd() * 4);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const copses = [corners[(corner + 1) % 4], corners[(corner + 2) % 4]];
  const crags = [];
  // A hill in a ring-one ward (not the river's side), another further out.
  const spots = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([a, b]) => !(river.vertical ? a === river.side && b === 0 : b === river.side && a === 0));
  const one = spots[Math.floor(rnd() * spots.length)];
  crags.push({ x: CENTER + one[0] * WARD + range(rnd, -4, 4), z: CENTER + one[1] * WARD + range(rnd, -4, 4), r: 3.4 });
  const two = corners[Math.floor(rnd() * 4)];
  crags.push({ x: CENTER + two[0] * WARD * 1.8 + range(rnd, -4, 4), z: CENTER + two[1] * WARD * 1.8 + range(rnd, -4, 4), r: 3.6 });
  world.crags = crags;

  // Heights.
  for (let vy = 0; vy < HV; vy++) {
    for (let vx = 0; vx < HV; vx++) {
      const x = vx / SUB, z = vy / SUB;
      let h = baseHeight(seed, x, z);
      for (const c of crags) {
        const d = Math.hypot(x - c.x, z - c.z) / (c.r * 1.6);
        if (d < 1) h += 1.6 * (1 - d * d) * (1 - d * d);
      }
      const rd = distToPath(river.pts, x, z);
      const w = river.width;
      if (rd < w * 4.6) {
        const bank = 0.45 + fbm(x / 8, z / 8, seed + 5, 2) * 0.25;
        const flat = 1 - smoothstep(w * 1.2, w * 4.6, rd);
        h = lerp(h, bank, 0.9 * flat);
        if (rd < w * 1.5) h = Math.min(h, lerp(-1.2, bank, smoothstep(w * 0.35, w * 1.5, rd)));
      }
      for (const l of lakes) {
        const warp = (noise2(x / 5, z / 5, seed + 17) - 0.5) * 0.5;
        const d = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz) + warp;
        if (d < 1.9) {
          const bank = 0.5 + fbm(x / 8, z / 8, seed + 6, 2) * 0.2;
          h = lerp(h, bank, 0.85 * (1 - smoothstep(1.05, 1.9, d)));
          if (d < 1.15) h = Math.min(h, lerp(-1.4, bank, smoothstep(0.5, 1.15, d)));
        }
      }
      world.h[vy * HV + vx] = h;
    }
  }

  // What each tile is.
  const { ground, tree, fert, amount } = world;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = idx(x, y);
      const [lo, hi] = tileRange(world, x, y);
      let under = 0;
      for (let j = 0; j <= SUB; j++) for (let k = 0; k <= SUB; k++) if (world.h[(y * SUB + j) * HV + x * SUB + k] < WATER_LEVEL + 0.02) under++;
      const mean = (lo + hi) / 2;
      const slope = hi - lo;
      const cheb = Math.max(Math.abs(x + 0.5 - CENTER), Math.abs(y + 0.5 - CENTER));
      // No bare rock on this island: what is not water or cliff is grass.
      let g = GROUND.GRASS;
      if (under >= 5) g = GROUND.WATER;
      else if (slope > 1.15 || mean > 8.5) g = GROUND.CLIFF;
      ground[i] = g;
      amount[i] = 0;
      // Fertility: the river's flood plain is the best, mountains the worst.
      let f = 0.42 + (fbm(x / 14 - 20, y / 14 + 40, seed + 47, 3) - 0.5) * 0.9;
      const rd = distToPath(river.pts, x + 0.5, y + 0.5);
      f += 0.3 * (1 - smoothstep(2, 18, rd));
      f -= Math.max(0, slope - 0.25) * 0.5 + Math.max(0, mean - 3) * 0.08;
      if (cheb < WARD * 0.8) f += 0.18;
      fert[i] = Math.round(clamp(f, 0.04, 1) * 255);
    }
  }

  // Shores.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = idx(x, y);
      if (ground[i] !== GROUND.GRASS) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && ground[idx(nx, ny)] === GROUND.WATER) { near = true; break; }
      }
      const hh = world.h[(y * SUB + 1) * HV + x * SUB + 1];
      // Beaches: wide and low on the sea, a strip on the canals and the creek.
      if ((near && hh < 0.85) || hh < 0.3) ground[i] = GROUND.SAND;
    }
  }

  // Forest.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = idx(x, y);
      if (ground[i] !== GROUND.GRASS && ground[i] !== GROUND.SAND) continue;
      const cheb = Math.max(Math.abs(x + 0.5 - CENTER), Math.abs(y + 0.5 - CENTER));
      if (cheb < 6.8) continue;
      const [lo, hi] = tileRange(world, x, y);
      if (hi - lo > 0.95 || hi > 8) continue;
      let n = fbm(x / 12 + 70, y / 12 - 33, seed + 21, 3);
      // Copses in two corners of the home ward.
      for (const c of copses) {
        const d = Math.hypot(x + 0.5 - (CENTER + c[0] * WARD * 0.29), y + 0.5 - (CENTER + c[1] * WARD * 0.29));
        if (d < 5.4) n = Math.max(n, 0.62 + (1 - d / 5.4) * 0.12 + noise2(x * 2, y * 2, seed) * 0.05 - 0.04 * (d / 5.4));
      }
      // The rest of the home ward stays clear, so there is room for the first houses.
      if (cheb < WARD * 0.5 && !copses.some((c) => Math.hypot(x + 0.5 - (CENTER + c[0] * WARD * 0.29), y + 0.5 - (CENTER + c[1] * WARD * 0.29)) < 5.6)) n = Math.min(n, 0.4);
      // A belt of trees inside the canal's bank: shade, and a view.
      const edge = WARD * 0.5 - cheb;
      if (edge > 3.2 && edge < 6.2) n = Math.max(n, 0.28 + fbm(x / 4 + 11, y / 4 - 7, seed + 5, 2) * 0.62);
      // Groves, not forests: this is a beach city, and the trees stand apart.
      if (n > 0.56) tree[i] = Math.min(2, 1 + Math.floor((n - 0.56) / 0.1));
    }
  }
  touchAll(world);
  return world;
}
