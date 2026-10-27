import { BUILDINGS, CASTLE_LEVELS, HOME_ZONES, INDUSTRY_ZONES } from '../catalog.js';
import { clamp } from '../rng.js';
import { qualityAt } from './blocks.js';
import { covered } from './coverage.js';
import { needsRoad } from '../world/buildings.js';
import { accessOf, network, rootTiles, walkRoads } from '../world/roads.js';
import { idx } from '../world/world.js';

/**
 * The week's money: who works where, what the zones want, the taxes that
 * come in and the budgets that go out. Nothing here draws.
 */

/** The share of grown adults who look for work. */
const FIT = 0.9;
/** Tax paid each week by a resident, by a worker in a shop, and by a worker in industry, at a rate of 10%. */
const TAX = { res: 0.05, com: 0.06, ind: 0.05 };
/** The share of the people the shops and the industry would employ, if they could. */
const WANT = { com: 0.22, ind: 0.28 };

export function capacity() {
  return { food: Infinity, goods: Infinity };
}

export const capFor = () => Infinity;

/** Which of the buildings has a road to the castle, and how far its goods must go to a store. Kept until roads or buildings change. */
export function refresh(game, force = false) {
  const { world } = game;
  const ver = `${world.bver ?? 0}:${world.netVersion ?? 0}`;
  if (!force && game.refreshVer === ver) return;
  game.refreshVer = ver;
  network(world);
  const sources = [...rootTiles()];
  for (const b of world.buildings.values()) {
    if (b.state !== 'ready') continue;
    const a = accessOf(world, b.x, b.y, b.w, b.d);
    if (a) sources.push([a.x, a.y]);
  }
  game.store = walkRoads(world, sources);
  for (const b of world.buildings.values()) {
    if (b.type === 'castle') { b.connected = true; b.haul = 0; continue; }
    const a = accessOf(world, b.x, b.y, b.w, b.d);
    b.access = a;
    b.connected = Boolean(a) || !needsRoad(b);
    b.haul = a ? Math.max(0, game.store[idx(a.x, a.y)] >= 0 ? game.store[idx(a.x, a.y)] : a.d) : 99;
  }
  // Housing that people can live in: ready, and a road reaches it.
  world.housing = [...world.buildings.values()].filter((b) => BUILDINGS[b.type]?.cap && b.state === 'ready');
}

/** Kept for the inspector: everything a road reaches gets there. */
export const haulK = () => 1;

/** There are no fields to share out. */
export function assignFields() {}

export const jobsOf = (b) => (b.type === 'castle' ? CASTLE_LEVELS[b.level - 1]?.jobs ?? 0 : BUILDINGS[b.type]?.jobs ?? 0);

/** Who fills a job first: the city's own services, then shops and industry. The ledger may raise or lower a type. */
export const priorityOf = (game, type) => game.prio[type] ?? (BUILDINGS[type]?.serve ? 3 : 2);

const zoneOf = (b) => BUILDINGS[b.type]?.auto ?? null;

/**
 * Shares out the workers: the places of the highest priority first, the same
 * share to each of equal priority. Fills in each building's `workers` and
 * `eff`. Building sites are the builders' own and need no one: each has a full
 * crew.
 */
export function allocate(game) {
  const { world } = game;
  const workforce = game.pop.adults * FIT;
  let labor = workforce;
  const places = [];
  for (const b of world.buildings.values()) {
    b.workers = 0;
    b.eff = 0;
    if (b.state !== 'ready' || !b.connected) continue;
    const jobs = jobsOf(b);
    if (jobs) places.push({ b, jobs, prio: b.type === 'castle' ? 4 : priorityOf(game, b.type) });
  }
  const jobsTotal = places.reduce((n, p) => n + p.jobs, 0);
  for (const prio of [4, 3, 2, 1]) {
    const tier = places.filter((p) => p.prio === prio);
    const want = tier.reduce((n, p) => n + p.jobs, 0);
    if (!want) continue;
    const k = Math.min(1, labor / want);
    for (const p of tier) { p.b.workers = p.jobs * k; p.b.eff = k; }
    labor -= want * k;
  }
  for (const b of world.buildings.values()) if (b.state === 'building') b.crewK = 1;
  for (const w of world.wards) if (w.dig) w.dig.crewK = 1;
  if (game.castleWork) game.castleWork.crewK = 1;
  const r = game.report;
  r.workforce = workforce;
  r.employed = workforce - labor;
  r.idle = Math.max(0, labor);
  r.jobs = jobsTotal;
  r.jobsOpen = Math.max(0, jobsTotal - (workforce - labor));
}

/** What the people want built, -1 to 1 for each of homes, shops and industry: SimCity's R, C and I. */
export function demand(game) {
  const { world } = game;
  const people = game.pop.children + game.pop.adults + game.pop.elders;
  let comJobs = 0, indJobs = 0, cap = 0;
  for (const b of world.buildings.values()) {
    const def = BUILDINGS[b.type];
    if (!def) continue;
    if (def.auto === 'com') comJobs += def.jobs;
    if (INDUSTRY_ZONES.includes(def.auto)) indJobs += def.jobs;
    if (HOME_ZONES.includes(def.auto)) cap += def.cap;
  }
  const r = game.report;
  const workforce = r.workforce ?? game.pop.adults * FIT;
  const taxK = (game.tax - 0.09) * 6;
  const mood = (game.happiness - 55) / 100;
  // Homes are wanted when there are jobs going, and by people who would come anyway to a pleasant city.
  const res = clamp(((r.jobs ?? 0) * 1.1 + 24 - workforce) / (workforce + 24) + mood - taxK, -1, 1);
  // Shops want customers; industry wants hands, and sells outside the city too.
  const wantCom = people * WANT.com + 4, wantInd = people * WANT.ind + 10;
  const com = clamp((wantCom - comJobs) / wantCom + mood * 0.5 - taxK, -1, 1);
  const ind = clamp((wantInd - indJobs) / wantInd - taxK * 0.8, -1, 1);
  return { res, com, ind, cap };
}

/** The week's books: taxes in, budgets out. */
export function weekWork(game) {
  const { world } = game;
  game.flows = { made: {}, used: {} };
  refresh(game);
  allocate(game);
  const r = game.report;
  const people = game.pop.children + game.pop.adults + game.pop.elders;
  const t = game.tax / 0.1;
  let resTax = 0, comTax = 0, indTax = 0, upkeep = 0.5 + 0.25 * game.castleLevel;
  for (const b of world.buildings.values()) {
    const def = BUILDINGS[b.type];
    if (!def || b.state !== 'ready') continue;
    const zone = zoneOf(b);
    const q = 1 + 0.18 * qualityAt(game, b.x + b.w / 2, b.y + b.d / 2);
    if (zone === 'com') comTax += b.workers * TAX.com * t * q;
    else if (zone === 'ind') indTax += b.workers * TAX.ind * t;
    if (def.upkeep) upkeep += def.upkeep * (game.budget ?? 1);
  }
  // Residents pay by how well off they are: homes in good blocks and near parks pay more.
  for (const b of world.housing ?? []) {
    const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
    const share = BUILDINGS[b.type].cap / Math.max(1, r.cap ?? 1);
    const value = 1 + 0.18 * qualityAt(game, cx, cy) + 0.15 * covered(game, 'cheer', cx, cy) + 0.1 * covered(game, 'education', cx, cy);
    resTax += people * share * TAX.res * t * value;
  }
  const taxes = resTax + comTax + indTax;
  game.stock.gold += taxes - upkeep;
  game.takings += taxes;
  game.flows.made.gold = taxes;
  game.flows.used.gold = upkeep;
  r.taxes = taxes;
  r.taxSplit = { res: resTax, com: comTax, ind: indTax };
  r.upkeep = upkeep;
  r.income = taxes;
  r.delta = taxes - upkeep;
  r.demand = demand(game);
  if (game.stock.gold < 0 && game.week % 4 === 0) game.note('The city is in the red. Raise taxes or cut the budget, or the bonds will come due.', 'bad');
}
