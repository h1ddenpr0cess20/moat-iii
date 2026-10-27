import { CENTER as C } from '../src/config.js';
import { buildBlock, placeBuilding, planBlock } from '../src/sim/game.js';
import { autoPlace, connect } from '../src/sim/hamlet.js';

/**
 * A mayor who plays without looking: every so often a donut block of
 * whatever the city wants most, a plaza in its heart when it can, and police,
 * fire stations, schools and parks as the city grows. Enough to exercise the
 * simulation for years at a time.
 */

const place = (game, type, cx, cy, radius = 12) => {
  const spot = autoPlace(game, type, cx, cy, radius);
  if (!spot) return null;
  const r = placeBuilding(game, type, spot.x, spot.y, spot.front);
  if (r.building) connect(game, r.building);
  return r.building;
};

export function createBot(game) {
  let blocks = 0;
  const has = (type) => [...game.world.buildings.values()].filter((b) => b.type === type).length;
  return {
    think() {
      if (game.week % 6 !== 3) return;
      const pop = game.pop.children + game.pop.adults + game.pop.elders;
      const d = game.report.demand ?? { res: 1, com: 0, ind: 0 };
      // A block of what is wanted most, if there is the money, somewhere near the middle.
      if (game.stock.gold > 400 && blocks < 12) {
        const ring = d.ind > d.res && d.ind > d.com ? 'ind' : d.com > d.res ? 'com' : blocks % 3 === 2 ? 'dense' : 'res';
        let done = false;
        for (const N of [12, 10]) for (let k = 0; k < 120 && !done; k++) {
          const a = k * 2.4, r = 8 + k * 0.3;
          const x = Math.round(C + Math.cos(a) * r - N / 2), y = Math.round(C + Math.sin(a) * r - N / 2);
          // A whole block, with a full ring of lots and a core to put a plaza in, not one squeezed against the canal.
          const plan = planBlock(game, x, y, x + N - 1, y + N - 1, { ring, core: 'res' });
          if (!plan.ok || plan.core.length < 9 || plan.ring.length < 4 * N) continue;
          done = true;
          if (!buildBlock(game, x, y, x + N - 1, y + N - 1, { ring, core: 'none' }).ok) break;
          connect(game, { x, y, w: N, d: N });
          placeBuilding(game, 'plaza', x + Math.floor(N / 2) - 1, y + Math.floor(N / 2) - 1, 0);
          blocks++;
        }
      }
      if (game.stock.gold > 300) {
        if (pop > 150 * has('police') + 100) place(game, 'police', C + 8, C - 8);
        else if (pop > 180 * has('firehouse') + 120) place(game, 'firehouse', C - 8, C + 8);
        else if (pop > 400 * has('school') + 200) place(game, 'school', C, C - 12);
        else if (pop > 120 * has('park')) place(game, 'park', C + 12, C);
      }
    },
  };
}
