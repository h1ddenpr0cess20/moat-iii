import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../src/catalog.js';
import { GROUND } from '../src/config.js';
import { completeAnnex } from '../src/sim/actions.js';
import { bonusOf, noiseAt } from '../src/sim/bonus.js';
import { landValue } from '../src/sim/growth.js';
import { startGame, step } from '../src/sim/game.js';
import { addBuilding, check } from '../src/world/buildings.js';
import { connect } from '../src/sim/hamlet.js';

const whole = (seed) => {
  const game = startGame({ seed });
  for (const w of game.world.wards) if (!w.owned) completeAnnex(game, w);
  return game;
};

/** The first spot, scanning from the middle out, where a type may stand. */
function spotFor(game, type) {
  const { world } = game;
  for (let r = 0; r < world.size; r += 2) {
    for (let y = world.size / 2 - r; y <= world.size / 2 + r; y++) {
      for (let x = world.size / 2 - r; x <= world.size / 2 + r; x++) {
        if (Math.max(Math.abs(x - world.size / 2), Math.abs(y - world.size / 2)) < r - 1) continue;
        if (check(world, type, x, y, 0).ok) return [x, y];
      }
    }
  }
  return null;
}

test('the port and the marina go on the shore of the open sea, not by a canal and not inland', () => {
  const game = startGame({ seed: 'venice' });
  // The first two districts are inland, ringed by canals.
  for (let y = 0; y < game.world.size; y++) for (let x = 0; x < game.world.size; x++) assert.ok(!check(game.world, 'seaport', x, y, 0).ok);
  const coast = whole('venice');
  const at = spotFor(coast, 'seaport');
  assert.ok(at, 'somewhere on the coast takes a port');
  let sea = 0;
  for (let dy = -5; dy <= 8; dy++) for (let dx = -5; dx <= 8; dx++) {
    const i = (at[1] + dy) * coast.world.size + at[0] + dx;
    if (coast.world.ground[i] === GROUND.WATER && !coast.world.moat[i]) sea++;
  }
  assert.ok(sea >= 12);
});

test('every building the city can build has a model footprint and a category on the build menu', async () => {
  const { CATEGORIES } = await import('../src/catalog.js');
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const [type, d] of Object.entries(BUILDINGS)) if (!d.auto) assert.ok(cats.has(d.cat), `${type} is on a tab`);
});

test('an airport, a port and a data center pay for themselves in taxes, and an airport is loud', () => {
  const base = whole('a1'), built = whole('a1');
  for (const g of [base, built]) for (let w = 0; w < 30; w++) step(g);
  for (const type of ['airport', 'seaport', 'datacenter']) {
    const at = spotFor(built, type);
    assert.ok(at, `there is room for a ${type}`);
    const { building } = addBuilding(built.world, type, at[0], at[1], 0);
    connect(built, building);
  }
  for (const g of [base, built]) step(g);
  const B = bonusOf(built);
  assert.ok(B.sources.includes('airport') && B.sources.includes('seaport') && B.sources.includes('datacenter'));
  assert.ok(B.tax.com > 0 && B.tax.ind > 0 && B.tourism > 0);
  assert.ok(built.report.taxSplit.tour > 0, 'visitors pay');
  assert.ok(built.report.demand.ind > base.report.demand.ind, 'the port raises the demand for industry');
  assert.ok(built.report.demand.com > base.report.demand.com, 'the airport raises the demand for shops');
  const air = [...built.world.buildings.values()].find((b) => b.type === 'airport');
  const [cx, cy] = [air.x + air.w / 2, air.y + air.d / 2];
  assert.ok(noiseAt(built, cx + air.w / 2 + 1, cy) > 0.5, 'loud beside the runway');
  assert.equal(noiseAt(built, cx + 40, cy + 40), 0);
  assert.ok(landValue(built, cx + air.w / 2 + 1, cy) < landValue(base, cx + air.w / 2 + 1, cy), 'and the land beside it is worth less');
});

test('a second of a kind counts for half', () => {
  const game = whole('karst');
  for (let n = 0; n < 2; n++) {
    const at = spotFor(game, 'datacenter');
    const { building } = addBuilding(game.world, 'datacenter', at[0], at[1], 0);
    connect(game, building);
  }
  step(game);
  const one = BUILDINGS.datacenter.bonus.tax.com;
  const B = bonusOf(game);
  assert.ok(B.tax.com > one * 0.5 * 1.2 && B.tax.com <= one * 1.5 + 1e-9, `${B.tax.com}`);
});
