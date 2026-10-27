import { CASTLE_BRIDGE } from '../world/wards.js';
import { heightAt } from '../world/world.js';
import { CENTER, ROAD } from '../config.js';
import { Batch, Mesher } from 'madness-engine/mesher';
import { castsShadow } from './materials.js';
import { PALETTE } from 'madness-engine/buildings/common';
import { freeTree } from './dispose.js';

/**
 * The bridges over the moat: a plank deck with rails and trestles, stone
 * abutments at both banks, and (where a gatehouse has been built) a drawbridge
 * leaf hinged at the gate that swings up when the founder raises it. The castle has
 * a bridge of its own to its courtyard.
 */

const STONE = ['#a8a090', '#9a9283', '#b4ac9a', '#8f887a'];

/** A deck of planks `len` long, `width` wide, with a plank's lines drawn across it. Along local x from x0 to x1. */
function deck(m, x0, x1, y, width, col = PALETTE.wood[0]) {
  const w = width / 2;
  m.box('wood', x0, y - 0.1, -w, x1, y, w, col, { skip: ['bottom'], uvScale: 1.4 });
  const n = Math.max(2, Math.round((x1 - x0) / 0.22));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    m.box('plain', x - 0.006, y + 0.0, -w, x + 0.006, y + 0.006, w, '#2a1c10', { skip: ['bottom'] });
  }
  // Two stringers under it.
  for (const z of [-w * 0.6, w * 0.6]) m.box('wood', x0, y - 0.22, z - 0.05, x1, y - 0.1, z + 0.05, PALETTE.wood[1], { skip: ['bottom'] });
}

/** Rails along both sides of a deck. */
function rails(m, x0, x1, y, width, { posts = 0.7, h = 0.4 } = {}) {
  const w = width / 2;
  const n = Math.max(1, Math.round((x1 - x0) / posts));
  for (const z of [-w, w]) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      m.box('wood', x - 0.035, y, z - 0.035, x + 0.035, y + h, z + 0.035, PALETTE.wood[1], { skip: ['bottom'], uvScale: 2 });
    }
    m.beam('wood', [x0, y + h, z], [x1, y + h, z], 0.045, PALETTE.wood[0]);
    m.beam('wood', [x0, y + h * 0.55, z], [x1, y + h * 0.55, z], 0.03, PALETTE.wood[0]);
  }
}

/** The fixed parts of a bridge `len` long (local x from 0 at the inner end): abutments, trestles, deck and rails where the leaf is not. */
function fixedBridge(len, leaf, y, depth, w = 2) {
  const m = new Mesher();
  // Stone footings at each end, down into the bank.
  for (const x of [0, len]) m.box('stone', x - 0.25, y - depth, -w / 2 - 0.15, x + 0.25, y - 0.05, w / 2 + 0.15, STONE[0], { skip: ['bottom'] });
  // Trestles into the water.
  for (let x = 1.2; x < len - 0.8; x += 1.5) {
    for (const z of [-w / 2 + 0.1, w / 2 - 0.1]) m.box('wood', x - 0.07, y - depth, z - 0.07, x + 0.07, y - 0.1, z + 0.07, PALETTE.wood[1], { skip: ['bottom'], uvScale: 2 });
    m.beam('wood', [x, y - 0.5, -w / 2 + 0.1], [x, y - 0.5, w / 2 - 0.1], 0.05, PALETTE.wood[0]);
  }
  if (!leaf) {
    deck(m, 0, len, y, w);
    rails(m, 0, len, y, w);
  } else {
    deck(m, 0, leaf[0], y, w);
    rails(m, 0, leaf[0], y, w);
    deck(m, leaf[1], len, y, w);
    rails(m, leaf[1], len, y, w);
  }
  // A lantern on a post at each end.
  for (const x of [0.15, len - 0.15]) {
    m.box('wood', x - 0.03, y, -w / 2 - 0.0, x + 0.03, y + 0.75, -w / 2 + 0.06, PALETTE.wood[1], { skip: ['bottom'] });
    m.box('glow', x - 0.05, y + 0.62, -w / 2 - 0.05, x + 0.05, y + 0.75, -w / 2 + 0.05, '#ffb45a', { skip: ['bottom'] });
  }
  return m.finish();
}

/** The leaf: a deck hinged at its inner end (local origin) that runs out along +x for `len`. */
function leafParts(len) {
  const m = new Mesher();
  const w = 2;
  deck(m, 0, len, 0, w, PALETTE.wood[2]);
  rails(m, 0.1, len, 0, w, { posts: 0.6, h: 0.3 });
  for (let x = 0.5; x < len; x += 1) m.beam('wood', [x, 0, -w / 2], [x, 0, w / 2], 0.06, PALETTE.wood[1]);
  return m.finish();
}

const yawOut = (dx, dz) => Math.atan2(-dz, dx);

export function createGates(GFX, world, materials, scene) {
  const { mat } = materials;
  const group = new GFX.Group();
  group.name = 'bridges';
  scene.add(group);
  let items = [];

  const meshes = (parts, parent) => {
    const batch = new Batch();
    batch.stamp(parts, 0, 0, 0, 0);
    for (const [name, acc] of batch.accs) {
      const geometry = acc.geometry(GFX);
      if (!geometry || !mat[name]) continue;
      const mesh = new GFX.Mesh(geometry, mat[name]);
      mesh.castShadow = castsShadow(name);
      mesh.receiveShadow = true;
      if (name === 'glow') mesh.renderOrder = 3;
      parent.add(mesh);
    }
  };

  /** One bridge from a world point (the inner end) outward along (dx, dz). */
  const bridge = (sx, sz, dx, dz, len, { leaf = null, hinge = 0, width = 2 } = {}) => {
    const ex = sx + dx * len, ez = sz + dz * len;
    const y = (heightAt(world, sx, sz) + heightAt(world, ex, ez)) / 2 + 0.07;
    const root = new GFX.Group();
    root.position.set(sx, y, sz);
    root.rotation.y = yawOut(dx, dz);
    const fixed = new GFX.Group();
    meshes(fixedBridge(len, leaf, 0, 1.6, width), fixed);
    root.add(fixed);
    let pivot = null;
    if (leaf) {
      pivot = new GFX.Group();
      pivot.position.set(hinge, 0, 0);
      meshes(leafParts(leaf[1] - leaf[0]), pivot);
      root.add(pivot);
    }
    group.add(root);
    return { root, pivot, angle: 0 };
  };

  const clear = () => {
    for (const it of items) { group.remove(it.root); freeTree(it.root); }
    items = [];
  };

  const build = () => {
    clear();
    for (const g of world.gates) {
      const [mx, my] = g.mid;
      // The inner end and the way outward.
      const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][g.dir];
      const inner = [mx - out[0] * 3, my - out[1] * 3];
      const house = g.gatehouse && world.buildings.get(g.gatehouse);
      const hasHouse = house && house.state === 'ready';
      const leaf = hasHouse ? [2, 5] : null;
      const it = bridge(inner[0], inner[1], out[0], out[1], 6, { leaf, hinge: 2 });
      it.gate = g;
      it.angle = hasHouse && !g.open ? 1.4 : 0;
      if (it.pivot) it.pivot.rotation.z = it.angle;
      items.push(it);
    }
    // The founder's own bridges over rivers and lakes: each straight run of span tiles, with a tile of bank at either end.
    const seen = new Set();
    const span = (x, y) => x >= 0 && y >= 0 && x < world.size && y < world.size && world.road[y * world.size + x] === ROAD.SPAN;
    for (let y = 0; y < world.size; y++) {
      for (let x = 0; x < world.size; x++) {
        if (!span(x, y) || seen.has(y * world.size + x)) continue;
        const horizontal = span(x + 1, y) || !span(x, y + 1);
        let n = 0;
        while (horizontal ? span(x + n, y) : span(x, y + n)) { seen.add((horizontal ? y : y + n) * world.size + (horizontal ? x + n : x)); n++; }
        const it = horizontal ? bridge(x - 1, y + 0.5, 1, 0, n + 2, { width: 1.05 }) : bridge(x + 0.5, y - 1, 0, 1, n + 2, { width: 1.05 });
        items.push(it);
      }
    }
    // The castle's own, from the courtyard gate to the far bank, always down.
    const cb = CASTLE_BRIDGE;
    const it = bridge(CENTER, cb.y - 0.1, 0, 1, 2.8, { leaf: [0.6, 2.4], hinge: 0.6 });
    it.castle = true;
    items.push(it);
  };

  return {
    group,
    build,
    /** Rebuilds the bridges when gates or gatehouses have changed. */
    refresh() { build(); },
    /** Swings the leaves toward their set angle: down if the gate is open, up if it is raised. */
    update(dt) {
      for (const it of items) {
        if (!it.pivot || !it.gate) continue;
        const house = it.gate.gatehouse && world.buildings.get(it.gate.gatehouse);
        const want = house && house.state === 'ready' && !it.gate.open ? 1.4 : 0;
        const d = want - it.angle;
        if (Math.abs(d) > 1e-3) { it.angle += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9); it.pivot.rotation.z = it.angle; }
      }
    },
  };
}
