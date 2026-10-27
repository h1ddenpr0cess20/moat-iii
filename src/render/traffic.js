import { bake, createStatic } from 'madness-engine/models/model';
import { createBakeLibrary } from 'madness-engine/models/bake';
import { boxtruck, hatchback, pickup, sedan } from 'madness-engine/scenery/vehicles';
import { ROAD } from '../config.js';
import { hash2 } from '../rng.js';
import { heightAt, idx, inb } from '../world/world.js';

/**
 * The traffic: the engine's sedans, hatchbacks, pickups and box trucks
 * driving the city's streets, more of them the bigger the city. Every few
 * seconds the streets are surveyed for straight runs (as Moat II finds a
 * street for its black cats), and each car drives one, there and back, in its
 * own lane. Their lamps light at night by themselves.
 *
 * A tile is about four and a half meters, so a car is a little under one.
 */

const DETAIL = 0.45;
const KINDS = [
  { def: sedan, size: 0.8, weight: 4 },
  { def: hatchback, size: 0.7, weight: 3 },
  { def: pickup, size: 0.86, weight: 2 },
  { def: boxtruck, size: 1.1, weight: 1 },
];
const PAINT = ['#e8e8e8', '#1a1a1e', '#b02a2a', '#2a4a8a', '#8a8e94', '#e8c440', '#3a7a5a', '#d87a3a', '#f0f0f0', '#5a2a4a'];
/** How fast they go, in tiles a second. */
const SPEED = 1.4;
/** Off the middle of the street to the right-hand lane. */
const LANE = 0.22;

/** The definitions by name, for the bake worker. */
export const SCULPTED = Object.fromEntries(KINDS.map((k) => [k.def.name, k.def]));

const isStreet = (world, x, y) => inb(x, y) && (world.road[idx(x, y)] === ROAD.DIRT || world.road[idx(x, y)] === ROAD.COBBLE || world.road[idx(x, y)] === ROAD.BRIDGE || world.road[idx(x, y)] === ROAD.SPAN);

export function createTraffic({ GFX, scene, game, world }) {
  const group = new GFX.Group();
  group.name = 'traffic';
  scene.add(group);
  const library = createBakeLibrary({
    sculpted: SCULPTED,
    spawn: () => new Worker(new URL('./traffic.worker.js', import.meta.url), { type: 'module' }),
    jobs: () => KINDS.map((k) => [k.def.name, DETAIL]),
    label: 'moat-iii traffic',
  });
  library.preload();
  const baked = (def) => typeof Worker !== 'undefined' && library.isBaked(def.name, DETAIL);

  /** How each kind is scaled so it is `size` tiles long, and where its wheels are. */
  const fits = new Map();
  const fitOf = (kind) => {
    if (fits.has(kind)) return fits.get(kind);
    const p = bake(kind.def, { detail: DETAIL }).position;
    let z0 = Infinity, z1 = -Infinity, y0 = Infinity;
    for (let i = 0; i < p.length; i += 3) { z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); y0 = Math.min(y0, p[i + 1]); }
    const s = kind.def.scale ?? 1;
    const k = kind.size / ((z1 - z0) * s);
    const fit = { k: k * s, foot: y0 * s * k };
    fits.set(kind, fit);
    return fit;
  };
  /** A car's materials with its own paint: the body takes its color from the `paint` material, so one bake does every color. */
  const painted = new Map();
  const paintOf = (mesh, def, color) => {
    const key = `${def.name}:${color}`;
    if (!painted.has(key)) {
      const names = Object.keys(def.materials);
      painted.set(key, mesh.material.map((m, i) => {
        if (names[i] !== 'paint') return m;
        const c = new GFX.MeshPhysicalMaterial({ name: `${def.name}-paint-${color}`, vertexColors: true, roughness: 0.6, ...def.materials.paint });
        c.color.set(color);
        return c;
      }));
    }
    return painted.get(key);
  };

  let runs = [];
  const cars = [];
  let surveyed = -1;

  /** The straight runs of street, three tiles or more, each once. */
  const survey = () => {
    runs = [];
    const seen = new Set();
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        if (!isStreet(world, x, y)) continue;
        for (const horiz of [true, false]) {
          const key = `${horiz ? 'h' : 'v'}${x},${y}`;
          if (seen.has(key)) continue;
          const before = horiz ? isStreet(world, x - 1, y) : isStreet(world, x, y - 1);
          if (before) continue;
          let n = 0;
          while (isStreet(world, horiz ? x + n : x, horiz ? y : y + n)) { seen.add(`${horiz ? 'h' : 'v'}${horiz ? x + n : x},${horiz ? y : y + n}`); n++; }
          if (n >= 3) runs.push({ from: [x + 0.5, y + 0.5], to: [horiz ? x + n - 0.5 : x + 0.5, horiz ? y + 0.5 : y + n - 0.5], len: n - 1 });
        }
      }
    }
    // The longest streets carry the most.
    runs.sort((a, b) => b.len - a.len);
  };

  const want = () => {
    const people = game.pop.children + game.pop.adults + game.pop.elders;
    return Math.min(90, Math.round(people / 25) + 3, runs.length * 3);
  };

  const pickKind = (n) => {
    const total = KINDS.reduce((s, k) => s + k.weight, 0);
    let r = hash2(n, 3, 7) * total;
    for (const k of KINDS) { r -= k.weight; if (r <= 0) return k; }
    return KINDS[0];
  };

  const add = (n) => {
    const kind = pickKind(n);
    if (!baked(kind.def)) return false;
    const mesh = createStatic(GFX, kind.def, { detail: DETAIL });
    mesh.material = paintOf(mesh, kind.def, PAINT[Math.floor(hash2(n, 5, 11) * PAINT.length)]);
    const fit = fitOf(kind);
    mesh.scale.setScalar(fit.k);
    group.add(mesh);
    cars.push({ mesh, fit, n, run: null, t: hash2(n, 9, 13) * 2 });
    return true;
  };

  return {
    group,
    /** Once a frame: `live` is the frame's time, 0 while paused. */
    update(dt, { live = dt } = {}) {
      const ver = world.netVersion ?? 0;
      if (ver !== surveyed) { surveyed = ver; survey(); for (const c of cars) c.run = null; }
      const n = want();
      while (cars.length < n && add(cars.length)) { /* one more car */ }
      while (cars.length > n) { const c = cars.pop(); group.remove(c.mesh); }
      cars.forEach((c, i) => {
        if (!runs.length) { c.mesh.visible = false; return; }
        if (!c.run || !runs.includes(c.run)) c.run = runs[(i * 7 + Math.floor(hash2(i, 1, 2) * runs.length)) % Math.min(runs.length, Math.max(4, Math.ceil(cars.length / 2)))];
        const r = c.run;
        // There and back: out along the run, a turn at the end, and home again.
        const period = r.len / SPEED;
        c.t = (c.t + live / period) % 2;
        const back = c.t > 1, f = back ? 2 - c.t : c.t;
        const dx = (r.to[0] - r.from[0]) / (r.len || 1), dz = (r.to[1] - r.from[1]) / (r.len || 1);
        const dir = back ? -1 : 1;
        // The right-hand lane, as they drive in California.
        const side = [-dz * dir * LANE, dx * dir * LANE];
        const x = r.from[0] + (r.to[0] - r.from[0]) * f + side[0];
        const z = r.from[1] + (r.to[1] - r.from[1]) * f + side[1];
        const y = Math.max(heightAt(world, x, z), 0) + 0.02;
        c.mesh.visible = true;
        c.mesh.position.set(x, y - c.fit.foot, z);
        c.mesh.rotation.y = Math.atan2(dx * dir, dz * dir);
      });
    },
    count: () => cars.length,
  };
}
