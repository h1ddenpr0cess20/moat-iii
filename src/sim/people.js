import { BUILDINGS } from '../catalog.js';
import { clamp } from '../rng.js';
import { computeCoverage, covered } from './coverage.js';

/**
 * The people: how contented they are, who is born, who dies, and who moves
 * to town looking for a place to live. Three cohorts are enough: children,
 * the grown, and the old.
 */

/** Rooms in the tower on the island: none, it is offices. */
const CASTLE_ROOMS = 0;

/** Stochastic rounding: 2.3 is 2 seven times in ten and 3 the rest. */
const roll = (game, x) => Math.floor(x + game.rnd());

export const headcount = (game) => game.pop.children + game.pop.adults + game.pop.elders;

export function housingCap(game, { building = true } = {}) {
  let cap = CASTLE_ROOMS + (game.blockGain?.cap ?? 0);
  for (const b of game.world.buildings.values()) {
    const c = BUILDINGS[b.type]?.cap;
    if (c && (b.state === 'ready' || (building && b.state === 'building'))) cap += c;
  }
  return cap;
}

/** What the houses are looked after by, averaged over the people who live in them. */
function care(game) {
  const out = { security: 0, fire: 0, education: 0, cheer: 0, health: 0, smog: 0 };
  let weight = 0;
  for (const b of game.world.housing ?? []) {
    const w = BUILDINGS[b.type].cap;
    const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
    for (const k of Object.keys(out)) if (k !== 'smog') out[k] += covered(game, k, cx, cy) * w;
    out.smog += smogAt(game, cx, cy) * w;
    weight += w;
  }
  for (const k of Object.keys(out)) out[k] = weight ? out[k] / weight : 0;
  return out;
}

/** How much factory smoke reaches a spot, 0 to 1: each factory within six tiles adds some. */
export function smogAt(game, x, y) {
  let n = 0;
  for (const b of game.world.buildings.values()) {
    if (!BUILDINGS[b.type]?.smoky || b.state !== 'ready') continue;
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.d / 2 - y);
    if (d < 6) n += (6 - d) / 6;
  }
  return Math.min(1, n * 0.6);
}

export function mood(game) {
  const r = game.report;
  computeCoverage(game);
  const c = care(game);
  r.care = c;
  let h = 46;
  h += 9 * c.security + 4 * c.fire + 7 * c.education + 9 * c.cheer + 6 * c.health - 14 * c.smog;
  h -= (game.tax - 0.09) * 120;
  const idle = r.workforce ? (r.idle ?? 0) / r.workforce : 0;
  if (idle > 0.1) h -= (idle - 0.1) * 50;
  h += game.blockGain?.mood ?? 0;
  h -= game.shock;
  game.shock *= 0.93;
  // Crime: what the police do not reach, worse in a bigger and a poorer city.
  const people = headcount(game);
  r.crime = clamp((1 - c.security) * Math.min(1, people / 400) * (0.6 + idle) * 100, 0, 100);
  h -= r.crime * 0.12;
  game.happiness += (clamp(h, 0, 100) - game.happiness) * 0.25;
  r.happinessTarget = h;
  const hp = 60 + 30 * c.health - 20 * c.smog;
  game.health += (clamp(hp, 0, 100) - game.health) * 0.2;
}

export function births(game) {
  const r = game.report;
  const { pop } = game;
  const total = headcount(game);
  const cap = housingCap(game, { building: false });
  r.cap = cap;
  r.pop = total;

  // Born.
  const rate = pop.adults * 0.0018 * (game.happiness / 60);
  const born = total < cap ? roll(game, rate) : 0;
  pop.children += born;
  game.stats.births += born;

  // Growing up and growing old.
  const grown = roll(game, pop.children / (14 * 48));
  const aged = roll(game, pop.adults / (38 * 48));
  const grewUp = Math.min(pop.children, grown);
  pop.children -= grewUp;
  pop.adults += grewUp;
  const grewOld = Math.min(pop.adults, aged);
  pop.adults -= grewOld;
  pop.elders += grewOld;

  // Died.
  const frailty = (100 - game.health) * 0.00003;
  let dead = 0;
  for (const [kind, base] of [['children', 0.0004], ['adults', 0.0005], ['elders', 0.004]]) {
    const n = roll(game, pop[kind] * (base + frailty));
    const took = Math.min(pop[kind], n);
    pop[kind] -= took;
    dead += took;
  }
  game.stats.deaths += dead;

  // Moved away, or moved in.
  if (game.happiness < 40 && total > 20) {
    const gone = Math.min(pop.adults, roll(game, total * 0.01 * (40 - game.happiness) / 10));
    if (gone > 0) { pop.adults -= gone; if (gone >= 10) game.note(`${gone} moved away this week. People are unhappy.`, 'bad'); }
  }
  const free = cap - headcount(game);
  const want = r.demand?.res ?? 0.3;
  if (free >= 2 && want > -0.2 && game.happiness >= 42) {
    const size = Math.min(free, roll(game, 2 + free * (0.2 + 0.3 * Math.max(0, want))));
    if (size > 0) {
      const kids = roll(game, size * 0.25);
      pop.adults += size - kids;
      pop.children += kids;
      game.stats.arrivals += size;
      game.emit('arrival', { size });
    }
  }
  pop.children = Math.max(0, pop.children);
  pop.adults = Math.max(0, pop.adults);
  pop.elders = Math.max(0, pop.elders);
  if (headcount(game) < 1 && game.week > 4 && !game.gameOver) {
    game.gameOver = true;
    game.note('No one is left. The city is a ghost town.', 'bad');
    game.emit('gameover', {});
  }
}
