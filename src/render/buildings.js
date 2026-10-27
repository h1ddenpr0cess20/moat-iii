import { CHUNK, CHUNKS } from '../config.js';
import { heightAt } from '../world/world.js';
import { Batch } from 'madness-engine/mesher';
import { castsShadow } from './materials.js';
import { castleScaffold, modelFor } from './models/index.js';
import { freeTree } from './dispose.js';

/**
 * The buildings: each chunk's are stamped into a mesh a material, so a whole
 * ward draws in a handful of calls. What moves by itself (a windmill's sails)
 * is a mesh of its own, turned each frame. Where chimneys are, and where fires
 * burn, are noted for the smoke. A building going up is drawn on its own, so
 * that each stage of the work redraws only it and not the whole ward.
 */

/** The turn to put a model's front (+z) toward each way a building can face: north, east, south, west. */
export const YAW = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

export function createBuildings(GFX, world, materials, scene) {
  const { mat } = materials;
  const group = new GFX.Group();
  group.name = 'buildings';
  scene.add(group);
  const cell = () => ({ group: null, sig: null, anims: [], smoke: [], lights: [] });
  const chunks = Array.from({ length: CHUNKS * CHUNKS }, (_, i) => ({ i, cells: [cell(), cell(), cell(), cell()], anims: [], smoke: [], lights: [] }));
  const scaffold = { group: null, parts: castleScaffold() };
  /** Building sites, by building id: { group, stage, chunk }. */
  const sites = new Map();

  const meshesFor = (batch, parent) => {
    for (const [name, acc] of batch.accs) {
      const geometry = acc.geometry(GFX);
      if (!geometry) continue;
      const material = mat[name];
      if (!material) { console.warn('moat: no material', name); continue; }
      const mesh = new GFX.Mesh(geometry, material);
      mesh.castShadow = castsShadow(name);
      mesh.receiveShadow = true;
      if (name === 'glow' || name === 'flame') mesh.renderOrder = 3;
      parent.add(mesh);
    }
  };

  const clear = (c) => {
    if (c.group) { group.remove(c.group); freeTree(c.group); c.group = null; }
    c.anims = []; c.smoke = []; c.lights = [];
  };

  const dropSite = (id) => {
    const s = sites.get(id);
    if (!s) return;
    group.remove(s.group);
    freeTree(s.group);
    sites.delete(id);
  };

  const stageOf = (b) => Math.min(3, Math.floor(b.progress * 4));

  /** Draws a building that is going up, as it stands at this stage of the work. */
  const site = (b, chunk) => {
    dropSite(b.id);
    const mx = b.x + b.w / 2, mz = b.y + b.d / 2;
    const t = modelFor(b.type, { level: b.level, variant: b.variant, building: true, progress: b.progress });
    const batch = new Batch();
    batch.stamp(t.parts, mx, heightAt(world, mx, mz), mz, YAW[b.front] ?? 0);
    const g = new GFX.Group();
    g.name = `buildings site ${b.id}`;
    meshesFor(batch, g);
    group.add(g);
    sites.set(b.id, { group: g, stage: stageOf(b), chunk });
  };

  /** What a cell holds that it is drawn from: when this has not changed, neither has the cell. */
  const signature = (list) => list.map((b) => `${b.id}:${b.type}:${b.level}:${b.variant}:${b.front}:${b.x}:${b.y}:${b.w}:${b.d}:${heightAt(world, b.x + b.w / 2, b.y + b.d / 2).toFixed(3)}`).join('|');

  /** Draws one cell's finished buildings into a mesh a material, with their sails, chimneys and lights. */
  const buildCell = (cell, list, name) => {
    clear(cell);
    const batch = new Batch();
    const g = new GFX.Group();
    g.name = name;
    for (const b of list) {
      const mx = b.x + b.w / 2, mz = b.y + b.d / 2;
      const t = modelFor(b.type, { level: b.level, variant: b.variant, building: false, progress: b.progress });
      const baseY = heightAt(world, mx, mz);
      const yaw = YAW[b.front] ?? 0;
      batch.stamp(t.parts, mx, baseY, mz, yaw);
      const sy = Math.sin(yaw), cs = Math.cos(yaw);
      const at = (p) => [mx + p[0] * cs + p[2] * sy, baseY + p[1], mz - p[0] * sy + p[2] * cs];
      for (const s of t.smoke) { const p = at(s); cell.smoke.push({ at: p, id: b.id, type: b.type, key: `${b.id}:${p[0]}` }); }
      for (const l of t.lights) cell.lights.push({ at: at(l.at), color: l.color, reach: l.reach, id: b.id });
      for (const a of t.anim) {
        const pivot = new GFX.Group();
        const holder = new GFX.Group();
        holder.position.set(mx, baseY, mz);
        holder.rotation.y = yaw;
        pivot.position.set(...a.pivot);
        holder.add(pivot);
        const sub = new Batch();
        sub.stamp(a.parts, 0, 0, 0, 0);
        meshesFor(sub, pivot);
        g.add(holder);
        cell.anims.push({ pivot, rate: a.rate, kind: a.kind, phase: (b.id * 1.37) % 6.28 });
      }
    }
    meshesFor(batch, g);
    group.add(g);
    cell.group = g;
  };

  /**
   * Brings a chunk up to date. Its finished buildings are drawn in four cells, and only a cell whose
   * buildings have changed is stamped again: a cottage finished beside the castle does not redraw the castle.
   */
  const build = (i) => {
    const c = chunks[i];
    const cx = i % CHUNKS, cy = Math.floor(i / CHUNKS);
    const lists = [[], [], [], []];
    const going = new Set();
    for (const b of world.buildings.values()) {
      const mx = b.x + b.w / 2, mz = b.y + b.d / 2;
      if (Math.floor(mx / CHUNK) !== cx || Math.floor(mz / CHUNK) !== cy) continue;
      if (b.state === 'building') {
        going.add(b.id);
        if (!sites.has(b.id)) site(b, i);
        continue;
      }
      const k = (mx - cx * CHUNK >= CHUNK / 2 ? 1 : 0) + (mz - cy * CHUNK >= CHUNK / 2 ? 2 : 0);
      lists[k].push(b);
    }
    // Sites that are finished, pulled down or burned go.
    for (const [id, s] of sites) if (s.chunk === i && !going.has(id)) dropSite(id);
    lists.forEach((list, k) => {
      const cell = c.cells[k];
      const sig = signature(list);
      if (cell.group && sig === cell.sig) return;
      cell.sig = sig;
      buildCell(cell, list, `buildings ${cx},${cy}/${k}`);
    });
    c.anims = c.cells.flatMap((cell) => cell.anims);
    c.smoke = c.cells.flatMap((cell) => cell.smoke);
    c.lights = c.cells.flatMap((cell) => cell.lights);
  };

  return {
    group,
    chunks,
    sync(budget = 2) {
      let n = 0;
      for (const i of [...world.dirty.buildings]) {
        world.dirty.buildings.delete(i);
        build(i);
        if (++n >= budget) return;
      }
    },
    buildAll() { for (let i = 0; i < chunks.length; i++) build(i); world.dirty.buildings.clear(); },
    /** Redraws the sites whose work has gone on a stage since they were drawn; at most `budget` of them. */
    restage(budget = 4) {
      let n = 0;
      for (const [id, s] of sites) {
        const b = world.buildings.get(id);
        if (!b || b.state !== 'building' || stageOf(b) === s.stage) continue;
        site(b, s.chunk);
        if (++n >= budget) return;
      }
    },
    /** Turns the sails, once a frame. */
    update(dt, wind = 1) {
      for (const c of chunks) for (const a of c.anims) if (a.kind === 'spin') a.pivot.rotation.z += a.rate * dt * wind;
    },
    /** Every chimney and fire worth a puff of smoke. */
    emitters() {
      return chunks.flatMap((c) => c.smoke);
    },
    lights() {
      return chunks.flatMap((c) => c.lights);
    },
    /** The scaffolding around the castle while masons work. */
    setCastleWork(on, y) {
      if (on && !scaffold.group) {
        const batch = new Batch();
        batch.stamp(scaffold.parts, 0, 0, 0, 0);
        const g = new GFX.Group();
        meshesFor(batch, g);
        g.position.set(world.size / 2, y, world.size / 2);
        scene.add(g);
        scaffold.group = g;
      } else if (!on && scaffold.group) {
        scene.remove(scaffold.group);
        freeTree(scaffold.group);
        scaffold.group = null;
      }
    },
  };
}
