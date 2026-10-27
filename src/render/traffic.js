import { bake, createStatic } from 'madness-engine/models/model';
import { createBakeLibrary } from 'madness-engine/models/bake';
import { Batch, Mesher } from 'madness-engine/mesher';
import { boxtruck, hatchback, pickup, sedan } from 'madness-engine/scenery/vehicles';
import { DIRS } from '../config.js';
import { hash2, mulberry32 } from '../rng.js';
import { heightAt } from '../world/world.js';
import { createTrafficSim, signalFor } from '../world/traffic.js';
import { freeTree } from './dispose.js';

/**
 * The traffic: the engine's sedans, hatchbacks, pickups and box trucks on
 * the city's streets, more of them the bigger the city, driving by the rules
 * in `world/traffic.js`. A car is sized to its lane: a sedan is a little under
 * half a tile long and a quarter of one wide. The crossings get their lights
 * and their stop signs. Lamps light at night by themselves.
 */

const DETAIL = 0.45;
/** Each kind and its length in tiles, and how common it is. */
const KINDS = [
  { def: sedan, size: 0.46, weight: 4 },
  { def: hatchback, size: 0.4, weight: 3 },
  { def: pickup, size: 0.52, weight: 2 },
  { def: boxtruck, size: 0.66, weight: 1 },
];
const PAINT = ['#e8e8e8', '#1a1a1e', '#b02a2a', '#2a4a8a', '#8a8e94', '#e8c440', '#3a7a5a', '#d87a3a', '#f0f0f0', '#5a2a4a'];
const LIGHTS = { red: '#ff3a2a', amber: '#ffb020', green: '#3aff7a' };

/** The definitions by name, for the bake worker. */
export const SCULPTED = Object.fromEntries(KINDS.map((k) => [k.def.name, k.def]));

/** A stop sign on its post: a red octagon, facing the way the cars come. */
function stopSign(m) {
  m.cylinder('metal', 0, 0, 0, 0.012, 0.012, 0.42, 5, '#b8bcc0');
  m.cylinder('plain', 0, 0.36, 0.014, 0.075, 0.075, 0.012, 8, '#c8241c', { caps: true });
}

/** A traffic signal: a pole and an arm out over the lane, with the head the lamp hangs in. */
function signalPost(m) {
  m.cylinder('metal', 0, 0, 0, 0.016, 0.02, 0.62, 6, '#4a4e52');
  m.beam('metal', [0, 0.6, 0], [-0.3, 0.6, 0], 0.014, '#4a4e52');
  m.box('plain', -0.33, 0.48, -0.03, -0.27, 0.62, 0.03, '#2a2c30');
}

export function createTraffic({ GFX, scene, game, world, materials }) {
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
  const sim = createTrafficSim(world, { kinds: KINDS.map((k) => [k.size, k.weight]), rnd: mulberry32(world.seed ^ 0x5eed) });

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

  /** The meshes, by car id. A car not yet baked waits, unseen. */
  const meshes = new Map();
  const meshFor = (car) => {
    if (meshes.has(car.id)) return meshes.get(car.id);
    const kind = KINDS[car.kind];
    if (!baked(kind.def)) return null;
    const mesh = createStatic(GFX, kind.def, { detail: DETAIL });
    mesh.material = paintOf(mesh, kind.def, PAINT[Math.floor(hash2(car.id, 5, 11) * PAINT.length)]);
    mesh.scale.setScalar(fitOf(kind).k);
    group.add(mesh);
    const out = { mesh, fit: fitOf(kind) };
    meshes.set(car.id, out);
    return out;
  };

  // ------------------------------------------------------------ the crossings' furniture

  const furniture = new GFX.Group();
  furniture.name = 'traffic signs';
  group.add(furniture);
  const lampMats = Object.fromEntries(Object.entries(LIGHTS).map(([k, c]) => [k, new GFX.MeshBasicMaterial({ color: new GFX.Color(c), toneMapped: false })]));
  const lampGeo = new GFX.SphereGeometry(0.03, 8, 6);
  let lamps = [];
  let furnished = null;

  /** Where a sign stands for the cars coming into a crossing at (x, y) heading `d`: the right-hand curb of the tile they come from. */
  const curbOf = (x, y, d) => {
    const [dx, dy] = DIRS[d], [rx, ry] = DIRS[(d + 1) % 4];
    const off = 0.46;
    return [x + 0.5 - dx * 0.62 + rx * off, y + 0.5 - dy * 0.62 + ry * off];
  };

  /** Puts up a stop sign or a light at every way into every crossing. */
  const furnish = (net) => {
    furnished = net;
    freeTree(furniture);
    furniture.clear();
    lamps = [];
    const stop = new Mesher(), post = new Mesher();
    stopSign(stop);
    signalPost(post);
    const parts = { stop: stop.finish(), post: post.finish() };
    const batch = new Batch();
    for (const c of net.clusters) {
      const inside = new Set(c.tiles);
      for (const t of c.tiles) {
        const x = t % net.size, y = Math.floor(t / net.size);
        for (let d = 0; d < 4; d++) {
          // A way in: a road tile outside the crossing, behind (x, y) as seen heading `d`, that a car could drive in from.
          const bx = x - DIRS[d][0], by = y - DIRS[d][1];
          if (!net.road(bx, by) || inside.has(by * net.size + bx)) continue;
          if (net.wide(bx, by) && !net.wide(bx + DIRS[(d + 3) % 4][0], by + DIRS[(d + 3) % 4][1])) continue;
          const [sx, sz] = curbOf(x, y, d);
          const sy = heightAt(world, sx, sz);
          const yaw = Math.atan2(-DIRS[d][0], -DIRS[d][1]);
          if (!c.signal) { batch.stamp(parts.stop, sx, sy, sz, yaw); continue; }
          batch.stamp(parts.post, sx, sy, sz, yaw);
          const lamp = new GFX.Mesh(lampGeo, lampMats.red);
          // The head hangs out over the lane, on the arm.
          const ax = -0.3 * Math.cos(yaw), az = 0.3 * Math.sin(yaw);
          lamp.position.set(sx + ax, sy + 0.55, sz + az);
          furniture.add(lamp);
          lamps.push({ lamp, cluster: c, d });
        }
      }
    }
    for (const [name, acc] of batch.accs) {
      const geometry = acc.geometry(GFX);
      if (!geometry || !materials.mat[name]) continue;
      const mesh = new GFX.Mesh(geometry, materials.mat[name]);
      mesh.castShadow = true;
      furniture.add(mesh);
    }
  };

  const want = () => {
    const people = game.pop.children + game.pop.adults + game.pop.elders;
    return Math.min(140, Math.round(people / 22) + 4);
  };

  return {
    group,
    sim,
    /** Once a frame: `live` is the frame's time, 0 while paused. */
    update(dt, { live = dt } = {}) {
      if (live > 0) sim.step(live, want());
      else if (!sim.net) sim.step(0, 0);
      if (sim.net !== furnished) furnish(sim.net);
      for (const l of lamps) l.lamp.material = lampMats[signalFor(l.cluster, l.d, sim.time)];
      const alive = new Set();
      for (const car of sim.cars) {
        alive.add(car.id);
        const m = meshFor(car);
        if (!m) continue;
        m.mesh.position.set(car.x, car.y - m.fit.foot + 0.012, car.z);
        m.mesh.rotation.y = Math.atan2(car.hx, car.hz);
      }
      for (const [id, m] of meshes) if (!alive.has(id)) { group.remove(m.mesh); meshes.delete(id); }
    },
    count: () => sim.cars.length,
  };
}
