import { BUILDINGS, CASTLE_LEVELS, GROWN, ZONE_ID } from '../catalog.js';
import { CENTER, DIRS, GROUND } from '../config.js';
import { addBuilding } from '../world/buildings.js';
import { blocked } from '../world/roads.js';
import { findLot } from '../world/zoning.js';
import { idx, inb, touch } from '../world/world.js';
import { calendar } from './calendar.js';
import { qualityAt } from './blocks.js';
import { covered } from './coverage.js';
import { headcount, smogAt } from './people.js';
import { completeAnnex } from './actions.js';
import { demand } from './economy.js';

/**
 * Things being made: the buildings people and firms put up on zoned land as
 * the city wants them, the crews finishing what the founder ordered, and the
 * trees growing back.
 */

/** Builds up what is under construction, by how many hands the crews have. */
export function construction(game) {
  const { world } = game;
  for (const b of world.buildings.values()) {
    if (b.state !== 'building') continue;
    const def = BUILDINGS[b.type];
    b.progress = Math.min(1, b.progress + (b.crewK ?? 0) / def.weeks);
    if (b.progress >= 1) {
      b.state = 'ready';
      b.built = game.week;
      world.bver = (world.bver ?? 0) + 1;
      touch(world, 'buildings', b.x, b.y, b.x + b.w, b.y + b.d);
      game.stats.built++;
      game.emit('built', { building: b });
      if (!def.auto) game.note(`The ${def.name.toLowerCase()} is finished.`, 'good', [b.x + b.w / 2, b.y + b.d / 2]);
    }
  }
  const cw = game.castleWork;
  if (cw) {
    cw.progress += (cw.crewK ?? 0) / cw.weeks;
    if (cw.progress >= 1) {
      game.castleLevel = cw.level;
      game.castleWork = null;
      const castle = world.buildings.get(1);
      castle.level = game.castleLevel;
      world.bver = (world.bver ?? 0) + 1;
      touch(world, 'buildings', castle.x, castle.y, castle.x + castle.w, castle.y + castle.d, 3);
      game.emit('castle', { level: game.castleLevel });
      game.note(`The ${CASTLE_LEVELS[game.castleLevel].name} is finished.`, 'good', [CENTER, CENTER]);
    }
  }
  for (const w of world.wards) {
    if (!w.dig) continue;
    w.dig.progress += (w.dig.crewK ?? 0) / w.dig.weeks;
    game.emit('dig', { ward: w.id });
    if (w.dig.progress >= 1) completeAnnex(game, w);
  }
}

/** What land is worth for a home or a shop: what looks after it, a good block, the water, and no smoke. */
export const landValue = (game, x, y) => covered(game, 'cheer', x, y) * 0.8 + covered(game, 'security', x, y) * 0.5 + covered(game, 'education', x, y) * 0.5
  + covered(game, 'health', x, y) * 0.3 + qualityAt(game, x, y) * 1.4 - smogAt(game, x, y) * 1.2 - Math.hypot(x - CENTER, y - CENTER) * 0.012;

const valueAt = (game, zone) => (zone === 'ind' ? (x, y) => -Math.hypot(x - CENTER, y - CENTER) * 0.01 : (x, y) => landValue(game, x, y));

/** Starts a building of the zone's kind on the best plot there is: private money, so it costs the city nothing. Returns it, or null. */
export function spawn(game, zone, level) {
  const { world } = game;
  const type = GROWN[zone][level - 1];
  const def = BUILDINGS[type];
  const lot = findLot(world, zone, def.size, game.rnd, valueAt(game, zone));
  if (!lot) return null;
  const { building } = addBuilding(world, type, lot.x, lot.y, lot.front, { state: 'building', rect: lot });
  return building;
}

/** One row more behind a building: for the plots that grow as the house does. Null if the land behind is not free zone. */
function extendBack(game, b, zone) {
  const { world } = game;
  const [bx, by] = DIRS[(b.front + 2) % 4];
  const tiles = [];
  if (b.front === 0 || b.front === 2) { const y = by > 0 ? b.y + b.d : b.y - 1; for (let x = b.x; x < b.x + b.w; x++) tiles.push([x, y]); }
  else { const x = bx > 0 ? b.x + b.w : b.x - 1; for (let y = b.y; y < b.y + b.d; y++) tiles.push([x, y]); }
  for (const [x, y] of tiles) {
    if (!inb(x, y)) return null;
    const i = idx(x, y);
    if (world.zone[i] !== ZONE_ID[zone] || world.bld[i] || world.road[i] || blocked(world, x, y)) return null;
  }
  return tiles;
}

/** Raises a building a level, if its land and the city are good enough. */
function upgrade(game, b, zone, want) {
  const { world } = game;
  const next = GROWN[zone][b.level];
  if (!next) return false;
  const def = BUILDINGS[next];
  const [cx, cy] = [b.x + b.w / 2, b.y + b.d / 2];
  const people = headcount(game);
  const v = landValue(game, cx, cy);
  const edu = covered(game, 'education', cx, cy);
  const need = b.level === 1 ? { v: 0.45, pop: zone === 'com' ? 250 : 120 } : { v: 1.1, pop: zone === 'com' ? 2500 : zone === 'dense' ? 1500 : 800 };
  if (want < 0.05 || v < need.v || people < need.pop) return false;
  if (zone === 'ind' && b.level === 2 && edu < 0.3) return false;
  if (zone !== 'ind' && (b.eff ?? 1) < 0.5 && BUILDINGS[b.type].jobs) return false;
  let extra = null;
  const [w1, d1] = BUILDINGS[b.type].size, [w2, d2] = def.size;
  if (d2 > d1 || w2 > w1) { extra = extendBack(game, b, zone); if (!extra) return false; }
  if (extra) {
    for (const [x, y] of extra) world.bld[idx(x, y)] = b.id;
    const x0 = Math.min(b.x, ...extra.map((t) => t[0])), y0 = Math.min(b.y, ...extra.map((t) => t[1]));
    const x1 = Math.max(b.x + b.w, ...extra.map((t) => t[0] + 1)), y1 = Math.max(b.y + b.d, ...extra.map((t) => t[1] + 1));
    Object.assign(b, { x: x0, y: y0, w: x1 - x0, d: y1 - y0 });
  }
  b.type = next;
  b.level = def.level;
  b.state = 'building';
  b.progress = 0;
  b.upgrading = true;
  world.bver = (world.bver ?? 0) + 1;
  touch(world, ['buildings', 'flat'], b.x, b.y, b.x + b.w, b.y + b.d);
  return true;
}

/** The city grows where it is zoned, as fast as the demand for homes, shops and industry. */
export function grow(game) {
  const { world } = game;
  const d = game.report.demand ?? demand(game);
  game.starved = null;
  const tries = (x) => (x > 0 ? Math.min(4, 1 + Math.floor(x * 4 + game.rnd())) : 0);
  for (let n = tries(d.res); n > 0; n--) {
    // Dense housing when there is dense zoning and the city is past a village.
    const dense = headcount(game) > 60 && game.rnd() < 0.5;
    if (!spawn(game, dense ? 'dense' : 'res', 1) && !spawn(game, dense ? 'res' : 'dense', 1)) break;
  }
  for (let n = tries(d.com); n > 0; n--) if (!spawn(game, 'com', 1)) break;
  for (let n = tries(d.ind); n > 0; n--) if (!spawn(game, 'ind', 1)) break;

  // And what is already there gets better.
  if (game.week % 2 === 0) {
    const candidates = [...world.buildings.values()].filter((b) => b.state === 'ready' && BUILDINGS[b.type]?.auto && GROWN[BUILDINGS[b.type].auto][b.level]);
    for (let n = 0; n < 1 + Math.floor(candidates.length / 16) && candidates.length; n++) {
      const b = candidates.splice(Math.floor(game.rnd() * candidates.length), 1)[0];
      const zone = BUILDINGS[b.type].auto;
      upgrade(game, b, zone, zone === 'res' || zone === 'dense' ? d.res + 0.3 : d[zone] + 0.3);
    }
  }

  // The trees grow back.
  const cal = calendar(game.week);
  if (cal.season <= 1) {
    for (let n = 0; n < 6; n++) {
      const x = Math.floor(game.rnd() * world.size), y = Math.floor(game.rnd() * world.size);
      const i = idx(x, y);
      if (world.tree[i] > 0 && world.tree[i] < 3) {
        world.tree[i]++;
        touch(world, 'trees', x, y);
      } else if (world.tree[i] > 0 && game.rnd() < 0.25) {
        // Seed spreads to a neighbor.
        const [dx, dy] = DIRS[Math.floor(game.rnd() * 4)];
        const nx = x + dx, ny = y + dy;
        if (inb(nx, ny)) {
          const j = idx(nx, ny);
          if (!world.tree[j] && world.ground[j] === GROUND.GRASS && !world.bld[j] && !world.road[j] && !world.zone[j] && !world.moat[j] && (!world.realm[j] || game.rnd() < 0.3)) { world.tree[j] = 1; touch(world, 'trees', nx, ny); }
        }
      }
    }
  }
}
