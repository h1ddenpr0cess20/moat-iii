import { BUILDINGS, RANKS, ROADS, ZONES, costText, money } from '../catalog.js';
import { CENTER, GROUND, ROAD } from '../config.js';
import { HEARTS, blockAt, computeBlocks } from '../sim/blocks.js';
import { buildBlock, buildRoad, buildZone, demolish, eraseZones, lineTiles, planBlock, planBuilding, placeBuilding, planRoad, planZone, rectTiles } from '../sim/actions.js';
import { buildingAt, footprint, gateRect } from '../world/buildings.js';
import { nearestRoadSide } from '../world/roads.js';
import { idx, inb } from '../world/world.js';
import { TINTS } from '../render/overlays.js';
import { modelFor } from '../render/models/index.js';
import { heightAt } from '../world/world.js';

/**
 * The founder's hand. A tool says what a click or a drag does on the ground:
 * look at things, lay a road, zone land, stamp a donut block, set down a
 * building, or clear. Whatever it would do is drawn first, in green and red,
 * with what it costs, and only a release (or a click) does it.
 */

export const TOOLS = [
  { id: 'select', icon: 'select', name: 'Look', key: '1', tip: 'Look at things and select them. Drag to move the map.' },
  { id: 'road', icon: 'road', name: 'Streets', key: '2', tip: 'Drag to lay a street. Every zone grows along streets.' },
  { id: 'zone', icon: 'zone', name: 'Zones', key: '3', tip: 'Drag to zone land for homes, shops and industry.' },
  { id: 'block', icon: 'block', name: 'Blocks', key: '4', tip: 'Stamp a donut block: a street loop, a ring of homes and a heart.' },
  { id: 'build', icon: 'build', name: 'Build', key: '5', tip: 'Set down a building.' },
  { id: 'demolish', icon: 'demolish', name: 'Bulldoze', key: '6', tip: 'Bulldoze buildings, roads and zones, and clear trees.' },
];

export const BLOCK_SIZES = { small: 10, medium: 14, large: 18 };

const tileOf = (p) => [Math.floor(p.x), Math.floor(p.z)];
const ZONE_TINT = Object.fromEntries(Object.entries(ZONES).map(([k, z]) => [k, z.color]));
const CORE_TINT = { res: '#8fd06a', veg: '#7fcf5a', orchard: '#d96a5a', pasture: '#9ec27a', wheat: '#e0b840', none: '#ffffff' };

export function createTools(ctx) {
  const { game, scene, tip } = ctx;
  const { camera, overlays } = scene;
  const { world } = game;
  const dom = scene.stage.renderer.domElement;

  const tools = {
    current: 'select',
    opts: {
      road: 'dirt',
      zone: 'res',
      block: { size: 'medium', ring: 'res', core: 'res', road: 'dirt' },
      build: { type: null, front: null },
    },
    hover: null,
    selection: null,
    listeners: new Set(),
  };
  let drag = null;
  let pending = null;
  let lastPointer = { x: 0, y: 0, type: 'mouse' };

  const changed = () => { for (const fn of tools.listeners) fn(); };
  Object.defineProperty(tools, 'pendingTouch', { get: () => pending !== null });
  tools.onChange = (fn) => { tools.listeners.add(fn); return () => tools.listeners.delete(fn); };

  const clearPreview = () => {
    for (const k of ['main', 'bad', 'ring', 'core', 'road', 'hover', 'range', 'blockCore', 'blockRing', 'foot']) overlays.clear(k);
    overlays.ghost.hide();
    tip.hide();
  };

  tools.set = (id, patch = {}) => {
    if (tools.current !== id) { clearPreview(); drag = null; pending = null; }
    tools.current = id;
    if (patch.build) Object.assign(tools.opts.build, patch.build);
    if (patch.road) tools.opts.road = patch.road;
    if (patch.zone) tools.opts.zone = patch.zone;
    if (patch.block) Object.assign(tools.opts.block, patch.block);
    scene.decals.setZoneBoost(id === 'zone' || id === 'block' ? 1 : 0);
    refresh();
    changed();
  };
  tools.cancel = () => {
    if (drag || pending) { drag = null; pending = null; clearPreview(); refresh(); changed(); return; }
    if (tools.current !== 'select') { tools.set('select'); return; }
    ctx.inspector?.close();
  };

  // ------------------------------------------------------------ helpers

  const gates = () => world.gates;
  const gateAtTile = (x, y) => {
    for (const g of gates()) {
      const r = gateRect(g);
      if (x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.d + 1) return g;
      if (world.road[idx(x, y)] === ROAD.BRIDGE && Math.hypot(x + 0.5 - g.mid[0], y + 0.5 - g.mid[1]) < 5) return g;
    }
    return null;
  };

  const short = (cost) => Object.entries(cost).filter(([r, n]) => (game.stock[r] ?? 0) < n).map(([r]) => r);
  const costHtml = (cost) => Object.entries(cost).filter(([, n]) => n > 0).map(([r, n]) => `<span class="${(game.stock[r] ?? 0) < n ? 'bad' : ''}">${money(n)}</span>`).join(', ') || 'free';

  /** The way a building turns to face its street, if the founder has not said. */
  const autoFront = (type, hx, hz) => {
    const def = BUILDINGS[type];
    const around = (f) => {
      const [w, d] = footprint(type, f);
      return { x: Math.round(hx - w / 2), y: Math.round(hz - d / 2), w, d };
    };
    if (def.where?.gate) return null;
    const order = [2, 0, 1, 3];
    for (const f of order) {
      const r = around(f);
      if (nearestRoadSide(world, r.x, r.y, r.w, r.d) === f && planBuilding(game, type, r.x, r.y, f).reason !== 'Too steep') return f;
    }
    for (const f of order) { const r = around(f); const s = nearestRoadSide(world, r.x, r.y, r.w, r.d); if (s !== null) return s; }
    const dx = CENTER - hx, dz = CENTER - hz;
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
  };

  const heartTip = (type, rect) => {
    const heart = HEARTS[type];
    const cx = Math.floor(rect.x + rect.w / 2), cy = Math.floor(rect.y + rect.d / 2);
    const block = blockAt(game, cx, cy);
    const inCore = block && block.core.includes(idx(cx, cy));
    if (inCore) return `<div class="good">In the heart of ${block.name === 'Hollow Block' ? 'a block' : 'the ' + block.name}: ${block.homes} homes around it will share it.</div>`;
    if (block) return '<div class="dim">This is in the ring: a heart goes in the middle of the block.</div>';
    if (heart) return '<div class="dim">★ Put this in the middle of a ring of homes (a donut block) and it serves them all, with a block bonus.</div>';
    return '';
  };

  let pinned = null;
  const showBlock = (hovered) => {
    const block = hovered ?? pinned;
    if (!block) { overlays.clear('blockCore'); overlays.clear('blockRing'); return; }
    const xy = (t) => [t % world.size, Math.floor(t / world.size)];
    overlays.fill('blockRing', block.ring.map(xy), { color: '#ffffff', opacity: 0.1 });
    overlays.fill('blockCore', block.core.map(xy), { color: TINTS.home, opacity: 0.24, pulse: 0.2 });
  };

  // ------------------------------------------------------------ previews and doing, per tool

  /** Keeps a block lit while it is the one being looked at. */
  tools.showBlockOverlay = (block) => { pinned = block; showBlock(null); };

  const rectOf = (a, b) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, d: Math.abs(a[1] - b[1]) + 1 });

  /** Whether the clearing tool has anything to do on a tile: a road, a zone, trees, or bare rock within the realm. */
  const clearable = (x, y) => {
    if (!inb(x, y)) return false;
    const i = idx(x, y);
    if (world.bld[i]) return false;
    if (world.road[i]) return world.road[i] !== ROAD.BRIDGE;
    return Boolean(world.zone[i] || (world.realm[i] && (world.tree[i] > 0 || (world.ground[i] === GROUND.ROCK && world.amount[i] > 0))));
  };

  /** How tall a building stands, in tiles, for picking it by its body and not only by its footprint. */
  const heightOf = (b) => (b.type === 'castle' ? (modelFor('castle', { level: b.level }).height ?? 4.4) : b.state === 'building' ? 1.4 : (modelFor(b.type, { level: b.level, variant: b.variant }).height ?? 1.5) + 0.35);

  /**
   * The building the pointer is over, if its body (not just the ground it
   * stands on) is under it: a ray from the eye against each building's box,
   * nearer than where the ray reaches the ground.
   */
  const buildingUnder = (clientX, clientY, ground) => {
    const { o, d } = camera.ray(clientX, clientY);
    let limit = ground ? Math.hypot(ground.x - o.x, ground.y - o.y, ground.z - o.z) : Infinity;
    let best = null;
    for (const b of world.buildings.values()) {
      const base = heightAt(world, b.x + b.w / 2, b.y + b.d / 2);
      const lo = [b.x, base - 0.1, b.y], hi = [b.x + b.w, base + heightOf(b), b.y + b.d];
      const org = [o.x, o.y, o.z], dir = [d.x, d.y, d.z];
      let t0 = 0, t1 = limit, hit = true;
      for (let a = 0; a < 3 && hit; a++) {
        if (Math.abs(dir[a]) < 1e-9) { if (org[a] < lo[a] || org[a] > hi[a]) hit = false; continue; }
        let ta = (lo[a] - org[a]) / dir[a], tb = (hi[a] - org[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) hit = false;
      }
      if (hit && t0 < limit) { limit = t0; best = b; }
    }
    return best;
  };

  const preview = {
    select(p, e) {
      if (!p) { overlays.clear('hover'); tip.hide(); return; }
      let [x, y] = tileOf(p);
      const b = buildingUnder(e.clientX, e.clientY, p) ?? buildingAt(world, x, y);
      if (b) { x = b.x; y = b.y; }
      const g = !b && gateAtTile(x, y);
      const block = !b && !g && blockAt(game, x, y);
      overlays.rect('hover', b ? { x: b.x, y: b.y, w: b.w, d: b.d } : g ? gateRect(g) : null, { color: '#ffffff', width: 0.1, opacity: 0.7 });
      showBlock(block);
      if (b) tip.show(ctx.describe.building(b), e.clientX, e.clientY);
      else if (g) tip.show(ctx.describe.gate(g), e.clientX, e.clientY);
      else if (block && block.core.length) tip.show(ctx.describe.block(block), e.clientX, e.clientY);
      else tip.show(ctx.describe.tile(x, y), e.clientX, e.clientY);
    },

    road(p, e) {
      if (!p) { overlays.clear('main'); overlays.clear('bad'); overlays.clear('ring'); tip.hide(); return; }
      const [x, y] = tileOf(p);
      const tiles = drag ? lineTiles(drag.start[0], drag.start[1], x, y) : [[x, y]];
      const plan = planRoad(game, tiles, tools.opts.road);
      overlays.fill('main', plan.tiles, { color: plan.afford ? TINTS.road : TINTS.bad, opacity: 0.55 });
      overlays.fill('ring', plan.spans ?? [], { color: plan.afford ? TINTS.sight : TINTS.bad, opacity: 0.7 });
      overlays.fill('bad', plan.blocked, { color: TINTS.bad, opacity: 0.45 });
      const what = ROADS[tools.opts.road].name;
      tip.show(plan.tiles.length ? `<b>${what}</b> · ${plan.tiles.length} tile${plan.tiles.length === 1 ? '' : 's'}<br>${costHtml(plan.cost)}${plan.afford ? '' : '<br><span class="bad">Not enough funds</span>'}` : `<span class="bad">${plan.reason ?? 'Nothing to build here'}</span>`, e.clientX, e.clientY);
      return plan;
    },

    zone(p, e) {
      if (!p) { overlays.clear('main'); overlays.clear('bad'); tip.hide(); return; }
      const [x, y] = tileOf(p);
      const tiles = drag ? rectTiles(drag.start[0], drag.start[1], x, y) : [[x, y]];
      const erase = tools.opts.zone === 'clear';
      if (erase) {
        const mine = tiles.filter(([tx, ty]) => inb(tx, ty) && world.zone[idx(tx, ty)] && !world.bld[idx(tx, ty)]);
        overlays.fill('main', mine, { color: TINTS.bad, opacity: 0.4 });
        overlays.clear('bad');
        tip.show(`<b>Clear zoning</b> · ${mine.length} tiles`, e.clientX, e.clientY);
        return { tiles: mine };
      }
      const plan = planZone(game, tiles, tools.opts.zone);
      overlays.fill('main', plan.tiles, { color: ZONE_TINT[tools.opts.zone], opacity: 0.5 });
      const okSet = new Set(plan.tiles.map(([tx, ty]) => ty * world.size + tx));
      overlays.fill('bad', tiles.filter(([tx, ty]) => !okSet.has(ty * world.size + tx) && !(inb(tx, ty) && world.zone[idx(tx, ty)])), { color: TINTS.bad, opacity: 0.18 });
      tip.show(plan.tiles.length ? `<b>${ZONES[tools.opts.zone].name}</b> · ${plan.tiles.length} tiles<br>${costHtml(plan.cost)}${plan.afford ? '' : '<br><span class="bad">Not enough gold</span>'}` : `<span class="bad">${plan.reason ?? 'Nothing new to zone'}</span>`, e.clientX, e.clientY);
      return plan;
    },

    block(p, e) {
      if (!p) { for (const k of ['main', 'ring', 'core', 'road', 'bad']) overlays.clear(k); tip.hide(); return; }
      const [x, y] = tileOf(p);
      const o = tools.opts.block;
      const size = BLOCK_SIZES[o.size];
      let r;
      if (drag && (Math.abs(x - drag.start[0]) >= 2 || Math.abs(y - drag.start[1]) >= 2)) {
        r = rectOf(drag.start, [x, y]);
        drag.custom = true;
      } else {
        const cx = drag ? drag.start[0] : x, cy = drag ? drag.start[1] : y;
        r = { x: cx - Math.floor((size - 1) / 2), y: cy - Math.floor((size - 1) / 2), w: size, d: size };
        if (drag) drag.custom = false;
      }
      const plan = planBlock(game, r.x, r.y, r.x + r.w - 1, r.y + r.d - 1, { ring: o.ring, core: o.core, road: o.road });
      const ok = plan.ok && plan.afford;
      overlays.fill('road', plan.roads ?? [], { color: ok ? TINTS.road : TINTS.bad, opacity: 0.6 });
      overlays.fill('ring', plan.ring ?? [], { color: ok ? ZONE_TINT[o.ring] : TINTS.bad, opacity: 0.5 });
      overlays.fill('core', plan.core ?? [], { color: ok ? CORE_TINT[o.core] : TINTS.bad, opacity: 0.5, pulse: 0.15 });
      overlays.rect('main', r, { color: ok ? TINTS.home : TINTS.bad, width: 0.16, opacity: 0.95 });
      overlays.clear('bad');
      let html;
      if (!plan.ok) html = `<span class="bad">${plan.reason}</span>`;
      else {
        const coreSide = Math.max(0, Math.min(r.w, r.d) - 2 * (3 + 1));
        html = `<b>Donut block</b> ${r.w}×${r.d} · ${plan.ring.length} plots around a ${coreSide > 0 ? `${coreSide}×${coreSide} core` : 'core too small'}<br>${costHtml(plan.cost)}`
          + (plan.afford ? '' : '<br><span class="bad">Not enough funds</span>')
          + `<div class="dim">${o.core === 'none' ? 'Leave the core open and put a plaza or a park in it.' : 'Back yards fill the core. Put a plaza or a park in some of it later.'}</div>`;
      }
      tip.show(html, e.clientX, e.clientY);
      return plan;
    },

    build(p, e) {
      const type = tools.opts.build.type;
      if (!type || !p) { overlays.ghost.hide(); for (const k of ['foot', 'range']) overlays.clear(k); tip.hide(); return; }
      const def = BUILDINGS[type];
      const hx = pending ? pending.hx : p.x, hz = pending ? pending.hz : p.z;
      const front = tools.opts.build.front ?? autoFront(type, hx, hz);
      const [w, d] = front === null ? [def.size[0], def.size[1]] : footprint(type, front);
      const x0 = Math.round(hx - w / 2), y0 = Math.round(hz - d / 2);
      const plan = planBuilding(game, type, x0, y0, front ?? 0);
      const rect = plan.rect ?? { x: x0, y: y0, w, d };
      const f = plan.front ?? front ?? 0;
      const ok = plan.ok;
      overlays.ghost.show(type, rect.x, rect.y, f, { ok, level: def.level ?? 1 });
      const foot = [];
      for (let ty = rect.y; ty < rect.y + rect.d; ty++) for (let tx = rect.x; tx < rect.x + rect.w; tx++) foot.push([tx, ty]);
      overlays.fill('foot', foot, { color: ok ? TINTS.ok : TINTS.bad, opacity: 0.35 });
      const reach = def.serve?.radius ?? (def.work?.radius) ?? 0;
      if (reach) overlays.ring('range', rect.x + rect.w / 2, rect.y + rect.d / 2, reach, { color: TINTS.sight, width: 0.12, opacity: 0.8 });
      else overlays.clear('range');
      const warn = (plan.warn ?? []).map((t) => `<div class="dim">⚠ ${t}</div>`).join('');
      tip.show(`<b>${def.name}</b><br>${costHtml(def.cost)}${plan.reason && plan.reason !== 'Not enough materials' ? `<br><span class="bad">${plan.reason}</span>` : plan.afford ? '' : '<br><span class="bad">Not enough materials</span>'}${ok ? warn : ''}${heartTip(type, rect)}`, e.clientX, e.clientY);
      return { plan, rect, front: f };
    },

    demolish(p, e) {
      if (!p) { overlays.clear('hover'); overlays.clear('main'); tip.hide(); return; }
      const [x, y] = tileOf(p);
      const b = buildingUnder(e.clientX, e.clientY, p) ?? buildingAt(world, x, y);
      const i = inb(x, y) ? idx(x, y) : -1;
      overlays.clear('main');
      if (b) {
        overlays.rect('hover', { x: b.x, y: b.y, w: b.w, d: b.d }, { color: TINTS.bad, width: 0.16, opacity: 0.9 });
        const back = b.id === 1 || BUILDINGS[b.type].auto ? [] : Object.entries(BUILDINGS[b.type].cost).map(([r, n]) => [r, Math.floor(n * (b.state === 'building' ? 0.8 : 0.4))]).filter(([, n]) => n > 0);
        tip.show(b.id === 1 ? '<span class="bad">The tower stands.</span>' : `<b>Bulldoze the ${BUILDINGS[b.type]?.name.toLowerCase()}</b><br><span class="dim">Gives back ${back.length ? back.map(([, n]) => money(n)).join(', ') : 'nothing'}</span>`, e.clientX, e.clientY);
      } else if (i >= 0 && clearable(x, y)) {
        overlays.clear('hover');
        const tiles = drag ? rectTiles(drag.start[0], drag.start[1], x, y) : [[x, y]];
        overlays.fill('main', tiles.filter(([tx, ty]) => inb(tx, ty) && clearable(tx, ty)), { color: TINTS.bad, opacity: 0.5 });
        tip.show(`<b>Clear ${world.road[i] ? 'road' : world.zone[i] ? 'zone' : world.tree[i] ? 'trees' : 'rock'}</b>`, e.clientX, e.clientY);
      } else { overlays.clear('hover'); tip.hide(); }
    },
  };

  const refresh = () => {
    if (!tools.hover || lastPointer.pointerType === 'touch' && !drag && !pending) return;
    preview[tools.current]?.(tools.hover, lastPointer);
  };
  tools.refresh = refresh;

  // ------------------------------------------------------------ doing

  const finishDrag = (p) => {
    const d = drag;
    drag = null;
    if (!d || !p) { clearPreview(); return; }
    const [x, y] = tileOf(p);
    const tool = tools.current;
    if (tool === 'road') {
      const r = buildRoad(game, lineTiles(d.start[0], d.start[1], x, y), tools.opts.road);
      if (!r.ok) ctx.say(r.reason ?? 'Nothing was built.', 'warn');
      else ctx.sfx('road');
    } else if (tool === 'zone') {
      const tiles = rectTiles(d.start[0], d.start[1], x, y);
      if (tools.opts.zone === 'clear') { if (eraseZones(game, tiles)) ctx.sfx('clear'); }
      else {
        const r = buildZone(game, tiles, tools.opts.zone);
        if (!r.ok) ctx.say(r.reason ?? 'Nothing to zone.', 'warn'); else ctx.sfx('zone');
      }
    } else if (tool === 'block') {
      const o = tools.opts.block;
      const size = BLOCK_SIZES[o.size];
      const a = d.custom ? d.start : [d.start[0] - Math.floor((size - 1) / 2), d.start[1] - Math.floor((size - 1) / 2)];
      const b = d.custom ? [x, y] : [a[0] + size - 1, a[1] + size - 1];
      const plan = buildBlock(game, a[0], a[1], b[0], b[1], { ring: o.ring, core: o.core, road: o.road });
      if (!plan.ok) ctx.say(plan.reason ?? 'The block could not be laid.', 'warn');
      else {
        ctx.sfx('block');
        computeBlocks(game, true);
        const made = blockAt(game, Math.floor((a[0] + b[0]) / 2), Math.floor((a[1] + b[1]) / 2));
        if (made) ctx.inspector.show({ kind: 'block', id: made.id });
        ctx.hint?.('block');
      }
    } else if (tool === 'demolish') {
      let n = 0;
      const tiles = d.custom ? rectTiles(d.start[0], d.start[1], x, y) : [d.start];
      for (const [tx, ty] of tiles) {
        if (!inb(tx, ty) || (d.custom && buildingAt(world, tx, ty))) continue;
        const r = demolish(game, tx, ty);
        if (r.ok) n++;
        else if (!d.custom && r.reason) ctx.say(r.reason, 'warn');
      }
      if (n) ctx.sfx('clear');
    } else if (tool === 'select') {
      if (!d.moved) selectAt(p);
    }
    clearPreview();
    refresh();
  };

  const commitBuild = (pt) => {
    const t = tools.opts.build.type;
    if (!t || !pt) return;
    const view = preview.build(pt, lastPointer);
    if (!view) return;
    const r = placeBuilding(game, t, view.rect.x, view.rect.y, view.front);
    if (!r.building) { ctx.say(r.reason ?? 'It cannot be built there.', 'warn'); ctx.sfx('no'); return; }
    ctx.sfx('place');
    ctx.hint?.('placed', r.building);
    computeBlocks(game, true);
    pending = null;
    changed();
  };
  tools.commit = () => { if (pending) commitBuild({ x: pending.hx, z: pending.hz }); };

  const selectAt = (p) => {
    const [x, y] = tileOf(p);
    const b = buildingUnder(lastPointer.clientX, lastPointer.clientY, p) ?? buildingAt(world, x, y);
    if (b) return ctx.inspector.show({ kind: 'building', id: b.id });
    const g = gateAtTile(x, y);
    if (g) return ctx.inspector.show({ kind: 'gate', id: world.gates.indexOf(g) });
    const block = blockAt(game, x, y);
    if (block && block.core.length) return ctx.inspector.show({ kind: 'block', id: block.id });
    return ctx.inspector.show({ kind: 'tile', x, y });
  };

  // ------------------------------------------------------------ pointer

  const pickFor = (e) => camera.pick(e.clientX, e.clientY);

  dom.addEventListener('pointermove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
    if (camera.gesturing) return;
    const p = pickFor(e);
    tools.hover = p;
    if (drag && tools.current === 'select') {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { if (!drag.moved) { drag.moved = true; camera.beginGrab(drag.sx, drag.sy); } camera.moveGrab(e.clientX, e.clientY); }
      return;
    }
    if (drag && tools.current === 'demolish' && p) {
      const [x, y] = tileOf(p);
      if (Math.abs(x - drag.start[0]) + Math.abs(y - drag.start[1]) > 0) drag.custom = true;
    }
    if (e.pointerType === 'touch' && !drag && !pending) return;
    preview[tools.current]?.(p, e);
  });
  dom.addEventListener('pointerleave', () => { if (!drag) { tip.hide(); if (tools.current !== 'build') overlays.clear('hover'); } });

  dom.addEventListener('pointerdown', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
    // A second finger down is a pinch or a twist of the view: whatever the first finger had begun to draw is let go,
    // so lifting the fingers after does not lay a road or a zone that was never meant.
    if (camera.gesturing) {
      if (drag) { if (camera.grabbing) camera.endGrab(); drag = null; clearPreview(); refresh(); }
      return;
    }
    if (e.button !== 0) return;
    const p = pickFor(e);
    tools.hover = p;
    if (!p) return;
    const tool = tools.current;
    if (tool === 'build') {
      if (e.pointerType === 'touch') { pending = { hx: p.x, hz: p.z }; preview.build(p, e); changed(); }
      else commitBuild(p);
      return;
    }
    drag = { start: tileOf(p), sx: e.clientX, sy: e.clientY, moved: false, custom: false };
    if (tool === 'demolish') {
      const under = buildingUnder(e.clientX, e.clientY, p);
      if (under) drag.start = [under.x, under.y];
      if (under || buildingAt(world, drag.start[0], drag.start[1])) { finishDrag(p); return; }
    }
    preview[tool]?.(p, e);
  });

  addEventListener('pointerup', (e) => {
    if (e.button === 2) {
      // A right click that did not drag lets go of the tool.
      if (ctx.rightDown && Math.hypot(e.clientX - ctx.rightDown.x, e.clientY - ctx.rightDown.y) < 5) tools.cancel();
      ctx.rightDown = null;
      return;
    }
    if (e.button !== 0 || !drag) return;
    if (camera.grabbing) camera.endGrab();
    lastPointer = { ...lastPointer, x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY };
    const p = e.target === dom ? pickFor(e) : tools.hover;
    finishDrag(p ?? tools.hover);
  });
  addEventListener('pointerdown', (e) => { if (e.button === 2 && e.target === dom) ctx.rightDown = { x: e.clientX, y: e.clientY }; });

  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') { tools.cancel(); return; }
    if (e.code === 'KeyR' && tools.current === 'build') {
      const cur = tools.opts.build.front;
      tools.set('build', { build: { front: cur === null ? 0 : cur === 3 ? null : cur + 1 } });
      refresh();
      return;
    }
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) tools.set(t.id);
  });

  tools.rankNeeded = (type) => (BUILDINGS[type].rank ? RANKS[BUILDINGS[type].rank].name : null);
  tools.costText = costText;
  tools.shortOf = short;
  return tools;
}
