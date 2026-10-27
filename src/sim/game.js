import { newGame } from './state.js';
import { seedHamlet } from './hamlet.js';
import { allocate, assignFields, capacity, refresh, weekWork } from './economy.js';
import { computeCoverage } from './coverage.js';
import { births, mood } from './people.js';
import { construction, grow } from './growth.js';
import { fires, hurricanes, quakes, ranks } from './events.js';

/**
 * One week at a time. `step` is the whole simulation: who works, what the
 * taxes bring in, who moves in and who leaves, what is built, and whatever
 * the ground throws at the city.
 */

/** Makes a game and gives the founder a neighborhood to start from. */
export function startGame(options = {}) {
  const game = newGame(options);
  seedHamlet(game);
  prime(game);
  return game;
}

/** Works out the figures the interface shows, without moving the week on. */
export function prime(game) {
  game.cap = capacity(game);
  refresh(game, true);
  assignFields(game);
  allocate(game);
  computeCoverage(game, true);
  game.report.pop = game.pop.children + game.pop.adults + game.pop.elders;
}

export function step(game) {
  if (game.gameOver) return;
  weekWork(game);
  mood(game);
  births(game);
  construction(game);
  computeCoverage(game);
  grow(game);
  fires(game);
  quakes(game);
  hurricanes(game);
  ranks(game);
  game.week++;
  game.emit('week', { week: game.week });
}

export * from './actions.js';
export * from './calendar.js';
export { newGame } from './state.js';
export { capacity } from './economy.js';
export { headcount, housingCap } from './people.js';
