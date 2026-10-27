import { BUILDINGS, RANKS } from '../catalog.js';
import { GROUND } from '../config.js';
import { countNear } from '../world/buildings.js';
import { calendar } from './calendar.js';
import { CENTER } from '../config.js';
import { removeBuilding } from '../world/buildings.js';
import { ownedCount } from '../world/wards.js';
import { setZone } from '../world/zoning.js';
import { qualityAt } from './blocks.js';
import { covered } from './coverage.js';
import { headcount } from './people.js';

/**
 * What happens to the city that the founder did not order: fires, the odd
 * earthquake, a hurricane in a bad autumn, and the day the city is called by
 * a bigger name.
 */

/** How readily each kind of building catches. */
const FLAMMABLE = { bungalow: 1, ranchhouse: 0.6, beachhouse: 0.5, dingbat: 0.9, aptblock: 0.5, condotower: 0.3, stripmall: 1, boutique: 0.6, officetower: 0.25, warehouse: 0.9, factory: 1.3, techpark: 0.4 };
/** The chance in a week that one building catches, before the fire stations. */
const IGNITE = 0.00008;
/** The chance that a fire takes the building next door. */
const SPREAD = 0.25;
/** The chance in a week of an earthquake. */
const QUAKE = 1 / 300;

const DIFFICULTY = { peaceful: 0, easy: 0.6, normal: 1, hard: 1.4 };

/** Nothing to weigh up any more: there is no harvest and no winter on this coast. */
export function weather() {}

/** Takes a building down, and leaves the lot zoned so it is built again. */
function wreck(game, b, why) {
  const { world } = game;
  const at = [b.x + b.w / 2, b.y + b.d / 2];
  removeBuilding(world, b.id);
  const zone = BUILDINGS[b.type].auto;
  if (zone) for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) setZone(world, x, y, zone);
  world.netVersion = (world.netVersion ?? 0) + 1;
  game.emit('fire', { at, building: b, why });
  return at;
}

export function burn(game, b, depth = 0) {
  const { world } = game;
  if (!world.buildings.has(b.id) || b.type === 'castle') return;
  const at = wreck(game, b, 'fire');
  game.note(`The ${BUILDINGS[b.type].name.toLowerCase()} burned down.`, 'bad', at);
  // A fire may take the roof next door; the fire department seldom lets it go further.
  if (depth < 1) {
    for (const o of [...world.buildings.values()]) {
      if (o.type === 'castle' || !FLAMMABLE[o.type]) continue;
      const d = Math.hypot(o.x + o.w / 2 - at[0], o.y + o.d / 2 - at[1]);
      if (d < 2.8 && game.rnd() < SPREAD * FLAMMABLE[o.type] * (1 - 0.9 * covered(game, 'fire', at[0], at[1])) * (1 - 0.5 * qualityAt(game, o.x + o.w / 2, o.y + o.d / 2))) burn(game, o, depth + 1);
    }
  }
}

export function fires(game) {
  if (!game.disasters) return;
  const k = DIFFICULTY[game.difficulty] ?? 1;
  for (const b of game.world.buildings.values()) {
    const f = FLAMMABLE[b.type];
    if (!f || b.state !== 'ready') continue;
    const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
    const p = IGNITE * f * k * (1 - 0.85 * covered(game, 'fire', cx, cy)) * (1 - 0.3 * qualityAt(game, cx, cy));
    if (game.rnd() < p) { burn(game, b); break; }
  }
}

/** Now and then the ground shakes: a few old buildings come down near the epicenter, and fires may start. */
export function quakes(game) {
  if (!game.disasters || game.week < 96 || game.rnd() > QUAKE * (DIFFICULTY[game.difficulty] ?? 1)) return;
  const { world } = game;
  const list = [...world.buildings.values()].filter((b) => b.type !== 'castle' && b.state === 'ready');
  if (!list.length) return;
  const c = list[Math.floor(game.rnd() * list.length)];
  const ex = c.x + c.w / 2, ey = c.y + c.d / 2;
  let down = 0;
  for (const b of list) {
    const d = Math.hypot(b.x + b.w / 2 - ex, b.y + b.d / 2 - ey);
    // Old, low buildings are the ones that come down; towers are built for it.
    if (d < 8 && game.rnd() < 0.18 * (1 - d / 8) * (b.level === 3 ? 0.2 : 1)) {
      if (FLAMMABLE[b.type] && game.rnd() < 0.3 * (1 - covered(game, 'fire', ex, ey))) burn(game, b);
      else wreck(game, b, 'quake');
      down++;
    }
  }
  game.shock += 8;
  game.emit('quake', { at: [ex, ey] });
  game.note(`An earthquake shook the city.${down ? ` ${down} building${down > 1 ? 's' : ''} came down.` : ' Nothing came down.'}`, 'bad', [ex, ey]);
}

/** The chance in a week of the hurricane season that a hurricane makes landfall, and how many weeks it blows. */
const HURRICANE = 1 / 90, BLOWS = 2;

/**
 * Hurricanes: in the late summer and the autumn one may come in off the
 * Pacific. A week's warning, then two weeks of storm: the sea gets up, the
 * rain comes down, and low buildings near the shore may be wrecked. Towers
 * stand; fire stations and police get people through it.
 */
export function hurricanes(game) {
  const h = game.hurricane;
  if (h) {
    if (h.warn > 0) {
      h.warn--;
      if (!h.warn) { game.note('The hurricane has made landfall.', 'bad', h.at); game.emit('hurricane', { phase: 'landfall' }); }
      return;
    }
    const { world } = game;
    let down = 0;
    for (const b of [...world.buildings.values()]) {
      if (b.type === 'castle' || b.state !== 'ready' || !BUILDINGS[b.type]) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
      const shore = countNear(world, cx, cy, 5, (i) => world.ground[i] === GROUND.WATER) / 50;
      const low = b.level === 3 ? 0.1 : b.level === 2 ? 0.5 : 1;
      const shelter = 1 - 0.5 * covered(game, 'fire', cx, cy) - 0.2 * covered(game, 'security', cx, cy);
      if (game.rnd() < 0.03 * low * shelter * (0.3 + 2 * Math.min(1, shore)) * (DIFFICULTY[game.difficulty] ?? 1)) { wreck(game, b, 'storm'); down++; }
    }
    game.shock += 1.5;
    if (down) game.note(`The hurricane wrecked ${down} building${down > 1 ? 's' : ''} this week.`, 'bad');
    if (--h.weeks <= 0) {
      game.hurricane = null;
      game.note('The hurricane has blown itself out.', 'good');
      game.emit('hurricane', { phase: 'over' });
    }
    return;
  }
  const month = calendar(game.week).month;
  // March is month 0: the season runs from August to November.
  if (!game.disasters || game.week < 48 || month < 5 || month > 8 || game.rnd() > HURRICANE * (DIFFICULTY[game.difficulty] ?? 1)) return;
  game.hurricane = { warn: 1, weeks: BLOWS, at: [game.world.size / 2, game.world.size / 2] };
  game.note('A hurricane is coming in off the Pacific! It makes landfall next week.', 'bad');
  game.emit('hurricane', { phase: 'warning' });
}

export function ranks(game) {
  if (game.week % 4 !== 0) return;
  const next = RANKS[game.rank + 1];
  if (!next) return;
  const n = next.need;
  const has = (type) => [...game.world.buildings.values()].some((b) => b.type === type && b.state === 'ready');
  if (n.pop && headcount(game) < n.pop) return;
  if (n.wards && ownedCount(game.world) < n.wards) return;
  if (n.castle && game.castleLevel < n.castle - 1) return;
  if (n.building && !has(n.building)) return;
  game.rank++;
  game.shock = Math.max(0, game.shock - 6);
  game.note(`Your island is a ${next.name} now. The press loves it, and new projects are open to you.`, 'good', [CENTER, CENTER]);
  game.emit('rank', { rank: game.rank });
}
