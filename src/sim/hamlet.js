import { BUILDINGS } from '../catalog.js';
import { CENTER, DIRS, HOME_WARD } from '../config.js';
import { wardId } from '../world/wards.js';
import { check, addBuilding, frontFor } from '../world/buildings.js';
import { network, roadBlocked } from '../world/roads.js';
import { findLot } from '../world/zoning.js';
import { idx, inb } from '../world/world.js';
import { buildRoad, buildZone, completeAnnex, placeBuilding, rectTiles } from './actions.js';

/**
 * The founder does not start with nothing: an avenue from the tower's bridge to
 * the south, a cross street, homes zoned on one side and shops and industry on
 * the other, a few bungalows, a strip mall, a police and a fire station. A
 * neighborhood to grow from, and the district south of it, already the
 * founder's, with room for whole donut blocks.
 */

/** Looks outward from a spot for somewhere a building can stand (nearest first), with a road beside it if one can be had. */
export function autoPlace(game, type, cx, cy, radius = 12) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  let best = null, bestD = Infinity;
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        for (let front = 0; front < 4; front++) {
          const c = check(game.world, type, x, y, front);
          if (!c.ok) continue;
          const f = frontFor(game.world, c.rect.x, c.rect.y, c.rect.w, c.rect.d);
          if (f !== front) continue;
          const d = Math.hypot(dx, dy);
          if (d < bestD) { bestD = d; best = { x, y, front }; }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Builds a road from a rectangle to the nearest connected road, by the shortest open way. Returns whether it is connected after. */
export function connect(game, rect, { free = false } = {}) {
  const { world } = game;
  const { dist } = network(world);
  const touching = (x, y) => DIRS.some(([dx, dy]) => inb(x + dx, y + dy) && dist[idx(x + dx, y + dy)] >= 0);
  const starts = [];
  for (let x = rect.x - 1; x <= rect.x + rect.w; x++) for (let y = rect.y - 1; y <= rect.y + rect.d; y++) {
    const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.d;
    const corner = (x < rect.x || x >= rect.x + rect.w) && (y < rect.y || y >= rect.y + rect.d);
    if (!inside && !corner && inb(x, y)) starts.push([x, y]);
  }
  if (starts.some(([x, y]) => dist[idx(x, y)] >= 0)) return true;
  const prev = new Map();
  const queue = [];
  for (const [x, y] of starts) {
    if (roadBlocked(world, x, y) && !world.road[idx(x, y)]) continue;
    prev.set(idx(x, y), -1);
    queue.push([x, y]);
  }
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q];
    if (touching(x, y) || dist[idx(x, y)] >= 0) {
      const path = [];
      for (let i = idx(x, y); i !== -1; i = prev.get(i)) path.push([i % world.size, Math.floor(i / world.size)]);
      buildRoad(game, path.filter(([px, py]) => !world.road[idx(px, py)]), 'dirt', { free });
      return true;
    }
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny) || prev.has(idx(nx, ny))) continue;
      if (roadBlocked(world, nx, ny) && !world.road[idx(nx, ny)]) continue;
      prev.set(idx(nx, ny), idx(x, y));
      queue.push([nx, ny]);
    }
  }
  return false;
}

export function seedHamlet(game) {
  const C = CENTER;
  const free = { free: true };
  const { world } = game;
  // The founder bought the district south of the tower with the island: its canals are dug, and the avenue runs on into it.
  completeAnnex(game, world.wards[wardId(HOME_WARD, HOME_WARD + 1)]);
  game.log.length = 0;
  buildRoad(game, rectTiles(C - 1, C + 6, C - 1, C + 42), 'avenue', free);
  buildRoad(game, rectTiles(C - 11, C + 8, C + 10, C + 8), 'dirt', free);
  // On south into the new district, with a cross street halfway down it.
  buildRoad(game, rectTiles(C - 11, C + 28, C + 10, C + 28), 'dirt', free);
  // Homes on one side of the avenue, shops and a little industry on the other, clearing the trees where it must.
  const zones = [[C - 11, C + 9, C - 2, C + 11, 'res'], [C - 11, C + 6, C - 2, C + 7, 'res'], [C + 1, C + 6, C + 10, C + 7, 'com'], [C + 1, C + 9, C + 10, C + 11, 'ind']];
  for (const [x0, y0, x1, y1, zone] of zones) buildZone(game, rectTiles(x0, y0, x1, y1), zone, free);
  for (const [type, sx] of [['police', C - 14], ['firehouse', C + 13]]) {
    const spot = autoPlace(game, type, sx, C + 8, 8);
    if (spot) { const r = placeBuilding(game, type, spot.x, spot.y, spot.front, free); if (r.building) connect(game, r.building, free); }
  }
  for (const [type, zone, n] of [['bungalow', 'res', 6], ['stripmall', 'com', 2], ['warehouse', 'ind', 1]]) {
    for (let k = 0; k < n; k++) {
      const lot = findLot(world, zone, BUILDINGS[type].size, game.rnd, (x, y) => -Math.hypot(x - C, y - (C + 8)) * 0.1);
      if (!lot) break;
      addBuilding(world, type, lot.x, lot.y, lot.front, { state: 'ready', rect: lot });
    }
  }
  world.bver = (world.bver ?? 0) + 1;
}
