import { CASTLE_BRIDGE } from '../world/wards.js';
import { deckAt, rampOver } from '../world/bridges.js';
import { idx, inb } from '../world/world.js';
import { CENTER, ROAD } from '../config.js';
import { LIFT } from './decals.js';
import { Batch, Mesher } from 'madness-engine/mesher';
import { castsShadow } from './materials.js';
import { freeTree } from './dispose.js';

/**
 * The bridges over the canals: concrete, as in Venice Beach. An asphalt deck
 * with a yellow line and a sidewalk each side, low parapet walls, round piers
 * into the water, and a streetlight at each end. The tower has a bridge of
 * its own to its plaza. Each deck runs straight from bank to bank, on the
 * same ramp the cars drive (`world/bridges.js`), meeting the road at both ends.
 */

const CONCRETE = '#c9c6be', CURB = '#dedbd2', ASPHALT = '#4a4b4f';

/** A deck `width` wide along local x from x0 to x1: a concrete slab, asphalt down the middle, sidewalks either side. */
function deck(m, x0, x1, y, width) {
  const w = width / 2;
  m.box('stone', x0, y - 0.14, -w, x1, y - 0.004, w, CONCRETE, { skip: ['bottom'], uvScale: 1.4 });
  m.box('plain', x0, y - 0.004, -w + 0.24, x1, y, w - 0.24, ASPHALT, { skip: ['bottom', 'front', 'back', 'left', 'right'] });
  // The yellow line, dashed.
  for (let x = x0 + 0.1; x < x1 - 0.1; x += 0.5) m.box('plain', x, y, -0.02, Math.min(x1 - 0.1, x + 0.28), y + 0.004, 0.02, '#e8c440', { skip: ['bottom', 'front', 'back', 'left', 'right'] });
  // The sidewalks, a curb up from the road.
  for (const s of [-1, 1]) m.box('stone', x0, y - 0.004, s > 0 ? w - 0.24 : -w, x1, y + 0.04, s > 0 ? w : -w + 0.24, CURB, { skip: ['bottom'] });
}

/** Low concrete parapet walls along both sides. */
function rails(m, x0, x1, y, width, { h = 0.26 } = {}) {
  const w = width / 2;
  for (const z of [-w, w]) m.box('stone', x0, y + 0.04, z - 0.05, x1, y + h, z + 0.05, CONCRETE, { skip: ['bottom'] });
}

/** A streetlight: a gray pole, an arm over the road and a lamp. */
function lamp(m, x, y, z, side) {
  m.cylinder('metal', x, y + 0.04, z, 0.018, 0.024, 0.8, 6, '#8a8e94');
  m.beam('metal', [x, y + 0.82, z], [x, y + 0.84, z - side * 0.28], 0.02, '#8a8e94');
  m.box('glow', x - 0.05, y + 0.78, z - side * 0.32, x + 0.05, y + 0.82, z - side * 0.22, '#ffe2a8', { skip: [] });
}

/** The fixed parts of a bridge `len` long (local x from 0 at the inner end): abutments, piers, deck and parapets where the leaf is not. */
function fixedBridge(len, leaf, y, depth, w = 2) {
  const m = new Mesher();
  // Concrete abutments at each end, down into the bank.
  for (const x of [0, len]) m.box('stone', x - 0.25, y - depth, -w / 2 - 0.12, x + 0.25, y - 0.14, w / 2 + 0.12, CONCRETE, { skip: ['bottom'] });
  // Round piers into the water, a pair across under each span.
  for (let x = 1.5; x < len - 1; x += 2) {
    for (const z of [-w / 2 + 0.3, w / 2 - 0.3]) m.cylinder('stone', x, y - depth, z, 0.12, 0.14, depth - 0.14, 10, CONCRETE, { caps: false });
    m.box('stone', x - 0.14, y - 0.3, -w / 2 + 0.16, x + 0.14, y - 0.14, w / 2 - 0.16, CONCRETE, { skip: ['bottom'] });
  }
  for (const [a, b] of leaf ? [[0, leaf[0]], [leaf[1], len]] : [[0, len]]) {
    deck(m, a, b, y, w);
    rails(m, a, b, y, w);
  }
  lamp(m, 0.3, y, -w / 2 + 0.1, -1);
  lamp(m, len - 0.3, y, w / 2 - 0.1, 1);
  return m.finish();
}

/** A lifting span (kept for saves from before): a deck hinged at its inner end that runs out along +x for `len`. */
function leafParts(len) {
  const m = new Mesher();
  deck(m, 0, len, 0, 2);
  rails(m, 0, len, 0, 2);
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

  /** One bridge from a world point (the inner end) outward along (dx, dz), on `ramp`: tilted to rise or fall with it. */
  const bridge = (sx, sz, dx, dz, len, ramp, { leaf = null, hinge = 0, width = 2 } = {}) => {
    const ex = sx + dx * len, ez = sz + dz * len;
    const y = deckAt(ramp, sx, sz, { extend: true }) + LIFT, y1 = deckAt(ramp, ex, ez, { extend: true }) + LIFT;
    const root = new GFX.Group();
    root.position.set(sx, y, sz);
    root.rotation.y = yawOut(dx, dz);
    // Tilted about its own z after the turn: its +x, the way out, rises by y1 − y over its length.
    root.rotation.z = Math.atan2(y1 - y, len);
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
      const ramp = rampOver(world, g.tiles.filter(([x, y]) => inb(x, y)).map(([x, y]) => idx(x, y)));
      const it = bridge(inner[0], inner[1], out[0], out[1], 6, ramp, { leaf, hinge: 2 });
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
        const run = [];
        while (horizontal ? span(x + n, y) : span(x, y + n)) { run.push((horizontal ? y : y + n) * world.size + (horizontal ? x + n : x)); n++; }
        for (const t of run) seen.add(t);
        const ramp = rampOver(world, run);
        const it = horizontal ? bridge(x - 1, y + 0.5, 1, 0, n + 2, ramp, { width: 1.05 }) : bridge(x + 0.5, y - 1, 0, 1, n + 2, ramp, { width: 1.05 });
        items.push(it);
      }
    }
    // The castle's own, from the courtyard gate to the road beyond the moat, always down: from the courtyard's height to the road's.
    const cb = CASTLE_BRIDGE;
    const tiles = [];
    for (let y = cb.y; y < cb.y + cb.d; y++) for (let x = cb.x; x < cb.x + cb.w; x++) tiles.push(idx(x, y));
    const it = bridge(CENTER, cb.y, 0, 1, cb.d, rampOver(world, tiles), { leaf: [0.6, 2.4], hinge: 0.6 });
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
