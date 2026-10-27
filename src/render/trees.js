import { CHUNK, CHUNKS, GROUND } from '../config.js';
import { ZONE_ID } from '../catalog.js';
import { hash2 } from '../rng.js';
import { HV, SUB, heightAt, idx } from '../world/world.js';
import { Mesher, partGeometry } from 'madness-engine/mesher';
import { cypress, fanPalm, palm, redwood } from 'madness-engine/flora';
import { freeInstances } from './dispose.js';

/**
 * The trees and what stands among them: date palms, fan palms, cypresses and
 * coast redwoods (the engine's `flora`) on the wooded tiles, and boulders on
 * the outcrops. Each
 * kind of tree is made once and sits on the graphics card once; a chunk only
 * lists where its copies stand (eight numbers a tree), and draws every copy of
 * a kind in one call. Far from the camera a cheaper set of the same trees is
 * shown instead; both sets are kept, so the camera moving only swaps which is
 * shown. Leaves are materials the seasons color, so a tree is built once and
 * is green in summer and bare in winter.
 */

/** The share of tiles that keep a tree in the far wood: about one tree to a tile, a few tiles bare. */
const FAR_KEEP = 0.72;

const LEAF = ['leafA', 'leafB', 'leafC'];

/** A color part of the way from one hex color to another. */
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** A clump of canopy in near-white (the leaf material colors it): lumpy, shaded round, pale on top and dark underneath. */
function blob(m, x, y, z, rx, ry, rz, mat, detail, seed, lump = 0.24) {
  m.crown(mat, x, y, z, rx, ry, rz, '#e8e8e8', { detail, lump, seed });
}

/** The trees, made once: `{ lod0, lod1 }` for each kind and variant, each a template of parts by material. */
export function buildTemplates() {
  const out = { palm: [], fanPalm: [], redwood: [], cypress: [], fruit: {}, boulder: [], ore: [] };
  const make = (fn) => {
    const hi = new Mesher(), lo = new Mesher();
    fn(hi, true);
    fn(lo, false);
    return { lod0: hi.finish(), lod1: lo.finish() };
  };
  // The engine's California trees: each kind in a few variants, the near one and the far one.
  for (let v = 0; v < 6; v++) out.palm.push(make((m, hi) => palm(m, { hi, seed: v, leaf: LEAF[v % 3] })));
  for (let v = 0; v < 4; v++) out.fanPalm.push(make((m, hi) => fanPalm(m, { hi, seed: v, leaf: LEAF[(v + 1) % 3] })));
  for (let v = 0; v < 4; v++) out.redwood.push(make((m, hi) => redwood(m, { hi, seed: v })));
  for (let v = 0; v < 3; v++) out.cypress.push(make((m, hi) => cypress(m, { hi, seed: v })));
  for (const [name, season] of [['spring', '#f6d8e8'], ['summer', null], ['autumn', '#d8402a'], ['winter', null]]) {
    out.fruit[name] = [0, 1].map((v) => make((m, hi) => {
      m.cylinder('bark', 0, -0.05, 0, 0.035, 0.055, 0.34, hi ? 6 : 4, '#5a3e26', { smooth: false });
      blob(m, 0, 0.5, 0, 0.3, 0.26, 0.3, v ? 'leafB' : 'leafA', hi ? 2 : 1, v + 9);
      if (hi && season) for (let k = 0; k < 9; k++) {
        const a = k * 2.4 + v, d = 0.18 + 0.1 * hash2(k, v, 4);
        m.sphere('plain', Math.cos(a) * d, 0.42 + 0.2 * hash2(k, 3, v), Math.sin(a) * d, 0.026, 0.026, 0.026, season, { detail: 0 });
      }
    }));
  }
  // Outcrops: a heap of knocked-about rock, a big one with smaller ones and chips against its foot, each variant its own color and shape.
  const GRAY = [['#7a756b', '#6a655d', '#8a8478'], ['#8a8478', '#756f66', '#7f796c'], ['#6a655d', '#5c5851', '#7a756b'], ['#7f796c', '#8c8676', '#6e695f']];
  const DARK = [['#5e5a52', '#4e4a44', '#6c675e'], ['#6c675e', '#58544c', '#625c54'], ['#4e4a44', '#5e5a52', '#403c38'], ['#625c54', '#6c675e', '#54504a']];
  for (let v = 0; v < 4; v++) {
    out.boulder.push(make((m, hi) => {
      const c = GRAY[v], d = 0, D = hi ? 1 : 0;
      m.rock('rock', 0, 0.1, 0, 0.3 + 0.05 * v, 0.2 + 0.03 * v, 0.26 + 0.04 * v, c[0], { detail: D, rough: 0.3, seed: v, cuts: 5 });
      m.rock('rock', 0.27 + 0.03 * v, 0.04, 0.12, 0.15, 0.11, 0.13, c[1], { detail: d, rough: 0.28, seed: v + 4, cuts: 3 });
      m.rock('rock', -0.2, 0.03, -0.24 + 0.04 * v, 0.12, 0.09, 0.11, c[2], { detail: d, rough: 0.28, seed: v + 8, cuts: 3 });
      if (hi) m.rock('rock', 0.1, 0.01, 0.3, 0.06, 0.04, 0.05, c[0], { detail: 0, rough: 0.2, seed: v + 12, cuts: 2 });
    }));
    out.ore.push(make((m, hi) => {
      const c = DARK[v], d = 0, D = hi ? 1 : 0;
      // Iron shows as rust-brown seams and stains through dark rock, not as lumps stuck on it.
      const seams = (dir, lump, grain) => {
        const s = Math.abs(Math.sin((dir[0] * 3.1 + dir[1] * 5.3 - dir[2] * 2.2 + v) * 2.6 + lump * 4));
        const w = Math.max(0, 1 - s * 7) * 0.9 + Math.max(0, grain - 0.72) * 2;
        return w > 0.08 ? { col: '#8a4a2e', w: Math.min(1, w) } : null;
      };
      const tint = (dir, lump, grain) => { const t = seams(dir, lump, grain); return t ? mix(c[0], t.col, t.w) : c[0]; };
      m.rock('rock', 0, 0.1, 0, 0.27 + 0.04 * v, 0.2 + 0.03 * v, 0.23 + 0.04 * v, c[0], { detail: D, rough: 0.28, seed: v + 20, cuts: 5, lichen: 0.15, colorFn: tint });
      m.rock('rock', -0.24, 0.03, 0.1, 0.13, 0.1, 0.12, c[1], { detail: d, rough: 0.26, seed: v + 24, cuts: 3, lichen: 0.15, colorFn: (dir, l, g) => { const t = seams(dir, l, g); return t ? mix(c[1], t.col, t.w) : c[1]; } });
      for (let k = 0; k < (hi ? 3 : 1); k++) {
        const a = k * 2.3 + v, r = 0.2 + 0.03 * hash2(k, v, 5);
        m.rock('rock', Math.cos(a) * r, 0.05 + 0.03 * k, Math.sin(a) * r * 0.9, 0.07, 0.05, 0.06, k % 2 ? '#7a4630' : '#69392a', { detail: 0, rough: 0.18, seed: k + v * 5, cuts: 3, base: 0.3 });
      }
    }));
  }
  return out;
}

/** Where the copies of each tree in a chunk stand, gathered before they are made into meshes. */
class Planting {
  constructor() { this.lists = new Map(); }
  /** The same arguments as the mesher's `Batch.stamp`. */
  stamp(template, x, y, z, yaw = 0, scale = 1, tint = null) {
    let list = this.lists.get(template);
    if (!list) { list = []; this.lists.set(template, list); }
    list.push(x, y, z, yaw, scale, tint ? tint[0] : 1, tint ? tint[1] : 1, tint ? tint[2] : 1);
  }
}

export function createTrees(GFX, world, materials, scene) {
  const { mat } = materials;
  const T = buildTemplates();
  // Each template's parts as indexed geometry, made the first time a tree of it is planted and kept for good.
  const geometries = new Map();
  const partsOf = (template) => {
    let parts = geometries.get(template);
    if (!parts) {
      parts = Object.entries(template).filter(([name]) => mat[name]).map(([name, part]) => [name, partGeometry(GFX, part)]);
      geometries.set(template, parts);
    }
    return parts;
  };
  const group = new GFX.Group();
  group.name = 'trees';
  scene.add(group);
  const chunks = Array.from({ length: CHUNKS * CHUNKS }, (_, i) => ({ i, lod0: null, lod1: null, built: false, near: false, season: -1, orchard: false }));
  const world_ = world;

  const stampTile = (b0, b1, x, y, orchard, season) => {
    const i = idx(x, y);
    const g = world_.ground[i];
    if (world_.tree[i] > 0) {
      const n = world_.tree[i];
      const alt = world_.h[(y * SUB + 1) * HV + x * SUB + 1];
      for (let k = 0; k < n; k++) {
        const fx = 0.12 + 0.76 * hash2(x * 3 + k, y, 11), fz = 0.12 + 0.76 * hash2(y * 3 + k, x, 13);
        const wx = x + fx, wz = y + fz;
        const wy = heightAt(world_, wx, wz) - 0.02;
        const r = hash2(x, y * 5 + k, 17);
        const s = 0.6 + 0.32 * hash2(x + k, y, 19) + (n - 1) * 0.04;
        const yaw = hash2(x, y, 23 + k) * 6.28;
        let kind;
        // Palms on the beaches and the flats, redwoods up in the hills, a cypress here and there.
        if (g === GROUND.SAND) kind = r < 0.5 ? T.fanPalm[(x + y + k) % 4] : T.palm[(x * 7 + y * 3 + k) % 6];
        else if (alt > 1.8 || r < 0.22) kind = T.redwood[(x + y + k) % 4];
        else if (r < 0.32) kind = T.cypress[(x * 3 + y + k) % 3];
        else if (r < 0.62) kind = T.fanPalm[(x * 5 + y + k) % 4];
        else kind = T.palm[(x * 7 + y * 3 + k) % 6];
        const tint = [0.9 + 0.2 * hash2(x, y + k, 29), 0.9 + 0.2 * hash2(x + 1, y, 31), 0.9 + 0.2 * hash2(x, y, 37 + k)];
        b0.stamp(kind.lod0, wx, wy, wz, yaw, s, tint);
        // Far off, a wood is drawn thin and a little larger: about a tree to a tile, and a few tiles bare (the ground is painted as forest floor).
        if (k < (n > 2 ? 2 : 1) && hash2(x, y, 77) < FAR_KEEP) b1.stamp(kind.lod1, wx, wy, wz, yaw, s * 1.22, tint);
      }
    } else if (g === GROUND.ROCK || g === GROUND.ORE) {
      const list = g === GROUND.ORE ? T.ore : T.boulder;
      const count = 1 + (hash2(x, y, 41) < 0.5 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const wx = x + 0.2 + 0.6 * hash2(x, y + k, 43), wz = y + 0.2 + 0.6 * hash2(y, x + k, 47);
        const wy = heightAt(world_, wx, wz) - 0.04;
        const t = list[(x * 3 + y + k) % list.length];
        const s = 0.9 + 0.5 * hash2(x, y, 53 + k);
        b0.stamp(t.lod0, wx, wy, wz, hash2(x, y, 59) * 6.28, s);
        b1.stamp(t.lod1, wx, wy, wz, hash2(x, y, 59) * 6.28, s);
      }
    } else if (orchard) {
      const wx = x + 0.5 + (hash2(x, y, 61) - 0.5) * 0.2, wz = y + 0.5 + (hash2(y, x, 67) - 0.5) * 0.2;
      const wy = heightAt(world_, wx, wz);
      const t = T.fruit[['spring', 'summer', 'autumn', 'winter'][season]][(x + y) % 2];
      b0.stamp(t.lod0, wx, wy, wz, hash2(x, y, 71) * 6.28, 0.95 + 0.2 * hash2(x, y, 73));
      b1.stamp(t.lod1, wx, wy, wz, hash2(x, y, 71) * 6.28, 0.95 + 0.2 * hash2(x, y, 73));
    }
  };

  const disposeOf = (c) => { for (const k of ['lod0', 'lod1']) if (c[k]) { group.remove(c[k]); freeInstances(c[k]); c[k] = null; } };

  const build = (i, season) => {
    const cx = i % CHUNKS, cy = Math.floor(i / CHUNKS);
    const c = chunks[i];
    disposeOf(c);
    const b0 = new Planting(), b1 = new Planting();
    let orchard = false;
    for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
      for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
        const t = idx(x, y);
        const isOrchard = world_.zone[t] === ZONE_ID.orchard && !world_.bld[t];
        if (isOrchard) orchard = true;
        if (world_.tree[t] > 0 || world_.ground[t] === GROUND.ROCK || world_.ground[t] === GROUND.ORE || isOrchard) stampTile(b0, b1, x, y, isOrchard, season);
      }
    }
    const wrap = (planting, shadows) => {
      const g = new GFX.Group();
      g.name = 'trees';
      for (const [template, list] of planting.lists) {
        const count = list.length / 8;
        let first = null;
        for (const [name, geometry] of partsOf(template)) {
          const mesh = new GFX.InstancedMesh(geometry, mat[name], count);
          if (first) {
            // The parts of one tree stand in the same places: they share the copies, which go up once.
            mesh.instancePlace = first.instancePlace;
            mesh.instanceLook = first.instanceLook;
            mesh.count = count;
            mesh.boundingSphere = first.boundingSphere;
          } else {
            for (let k = 0; k < count; k++) {
              const o = k * 8;
              mesh.setInstance(k, list[o], list[o + 1], list[o + 2], list[o + 3], list[o + 4], [list[o + 5], list[o + 6], list[o + 7]]);
            }
            mesh.count = count;
            mesh.update();
            first = mesh;
          }
          mesh.castShadow = shadows;
          mesh.receiveShadow = true;
          g.add(mesh);
        }
      }
      group.add(g);
      return g;
    };
    // Trees take shadows but do not throw them. Near trees threw them and far ones could not, so a straight line of shade ran along every chunk border; the forest floor is painted dark under the woods instead.
    c.lod0 = wrap(b0, false);
    c.lod1 = wrap(b1, false);
    c.lod0.visible = c.near;
    c.lod1.visible = !c.near;
    c.built = true;
    c.season = season;
    c.orchard = orchard;
  };

  return {
    group,
    /** Builds what has changed. `season` colors the orchards' blossom and fruit. */
    sync(season, budget = 1) {
      let n = 0;
      for (const i of [...world_.dirty.trees]) {
        world_.dirty.trees.delete(i);
        build(i, season);
        if (++n >= budget) return;
      }
      for (const c of chunks) {
        if (c.built && c.orchard && c.season !== season) { build(c.i, season); if (++n >= budget) return; }
      }
    },
    /** Builds every chunk that has not been, the nearest first. */
    async buildAll(season, near, progress = () => {}) {
      const order = chunks.map((c) => c.i).sort((a, b) => Math.hypot(((a % CHUNKS) + 0.5) * CHUNK - near[0], (Math.floor(a / CHUNKS) + 0.5) * CHUNK - near[1]) - Math.hypot(((b % CHUNKS) + 0.5) * CHUNK - near[0], (Math.floor(b / CHUNKS) + 0.5) * CHUNK - near[1]));
      let n = 0;
      for (const i of order) {
        build(i, season);
        world_.dirty.trees.delete(i);
        progress(++n / order.length);
        if (n % 3 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    },
    /** Shows the full trees in the chunks near the camera and the light ones in those far off. Both are kept, so this costs nothing to change. */
    updateLod(cx, cz, near = 45) {
      for (const c of chunks) {
        if (!c.built) continue;
        const x = ((c.i % CHUNKS) + 0.5) * CHUNK, z = (Math.floor(c.i / CHUNKS) + 0.5) * CHUNK;
        const d = Math.hypot(x - cx, z - cz);
        const want = c.near ? d < near + 14 : d < near - 6;
        if (want !== c.near) {
          c.near = want;
          c.lod0.visible = want;
          c.lod1.visible = !want;
        }
      }
    },
  };
}
