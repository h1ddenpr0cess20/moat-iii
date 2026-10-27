import { START } from '../catalog.js';
import { mulberry32 } from '../rng.js';
import { newWorld } from '../world/index.js';
import { snapshot } from '../world/snapshot.js';

/** No merchants come to this city: kept for old callers. */
export const PRICES = Object.freeze({});
export const defaultTrade = () => ({});

/**
 * The game: the land, the city's funds, the people, the calendar, and the
 * standing orders. `emit` tells whoever is listening (the interface, the
 * sound) that something happened.
 */
export function newGame({ seed = 'venice', difficulty = 'normal', disasters = true } = {}) {
  const world = snapshot(newWorld(seed));
  const game = {
    version: 1,
    seed: world.seedText,
    difficulty,
    /** Fires and earthquakes: off, the city only has its budget to answer to. */
    disasters,
    world,
    week: 0,
    stock: { ...START.stock },
    pop: { ...START.pop },
    happiness: 62,
    health: 80,
    shock: 0,
    tax: 0.09,
    /** How fully the city's services are funded, 0.5 to 1.5. */
    budget: 1,
    /** A hurricane on its way or blowing: `{ warn, weeks }`, or null. */
    hurricane: null,
    castleLevel: 0,
    castleWork: null,
    rank: 0,
    trade: defaultTrade(),
    prio: {},
    /** Taxes taken in, all told. */
    takings: 0,
    /** What each good did last week: made and used. */
    flows: { made: {}, used: {} },
    /** Figures worked out each week for the interface. */
    report: {},
    log: [],
    gameOver: false,
    rnd: mulberry32(world.seed ^ 0xa5a5a5a5),
    listeners: new Map(),
    stats: { births: 0, deaths: 0, arrivals: 0, built: 0 },
  };
  game.on = (type, fn) => {
    if (!game.listeners.has(type)) game.listeners.set(type, new Set());
    game.listeners.get(type).add(fn);
    return () => game.listeners.get(type).delete(fn);
  };
  game.emit = (type, data = {}) => {
    for (const fn of game.listeners.get(type) ?? []) fn(data);
    for (const fn of game.listeners.get('*') ?? []) fn({ type, ...data });
  };
  /** Writes to the news the founder reads, and tells the sound about it. */
  game.note = (text, kind = 'info', at = null) => {
    game.log.unshift({ week: game.week, text, kind, at });
    if (game.log.length > 80) game.log.length = 80;
    game.emit('note', { text, kind, at });
  };
  return game;
}

export const population = (game) => Math.round(game.pop.children + game.pop.adults + game.pop.elders);
