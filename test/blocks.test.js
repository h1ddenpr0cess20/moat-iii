import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLOT_DEPTH } from '../src/catalog.js';
import { blockAt, blockBonus, computeBlocks, blockReport } from '../src/sim/blocks.js';
import { computeCoverage } from '../src/sim/coverage.js';
import { buildBlock, placeBuilding, planBlock, startGame, step } from '../src/sim/game.js';
import { idx } from '../src/world/world.js';
import { connect } from '../src/sim/hamlet.js';

/** A game with the whole map open to build on, and a 14 by 14 block's worth of free ground found. */
function freeGround(seed = 'moat', N = 14) {
  const game = startGame({ seed });
  game.world.realm.fill(1);
  Object.assign(game.stock, { gold: 9000 });
  for (let y = 6; y < 190; y += 2) {
    for (let x = 6; x < 190; x += 2) {
      const p = planBlock(game, x, y, x + N - 1, y + N - 1, { ring: 'res', core: 'res' });
      if (p.ok && p.roads.length === 4 * N - 4 && p.core.length === (N - 2 * (PLOT_DEPTH + 1)) ** 2) return { game, x, y, N };
    }
  }
  throw new Error('no free ground');
}

const finish = (game) => { for (const b of game.world.buildings.values()) if (b.state === 'building') { b.state = 'ready'; b.progress = 1; } game.world.bver++; };

/** Houses along the whole ring, two tiles each, by hand. */
function fillRing(game, x, y, N) {
  let n = 0;
  const spots = [];
  for (let i = 1; i < N - 2; i += 2) spots.push([i, 1, 0], [i, N - 3, 2]);
  for (let j = 3; j < N - 3; j += 2) spots.push([1, j, 3], [N - 3, j, 1]);
  for (const [tx, ty, f] of spots) if (placeBuilding(game, 'bungalow', x + tx, y + ty, f, { free: true }).building) n++;
  finish(game);
  return n;
}

test('a closed street loop is a block; an unconnected one is called out', () => {
  const { game, x, y, N } = freeGround();
  buildBlock(game, x, y, x + N - 1, y + N - 1, { ring: 'res', core: 'none' }, { free: true });
  computeBlocks(game, true);
  const block = blockAt(game, x + N / 2, y + N / 2);
  assert.ok(block, 'the block is found');
  assert.equal(block.core.length, (N - 2 * (PLOT_DEPTH + 1)) ** 2);
  assert.equal(block.rating, 0);
  assert.equal(block.connected, false);
  assert.match(blockReport(block).tips.join(' '), /joins the city/);
});

test('a ring with no heart earns nothing; a plaza in the middle earns a bonus', () => {
  const { game, x, y, N } = freeGround();
  buildBlock(game, x, y, x + N - 1, y + N - 1, { ring: 'res', core: 'none' }, { free: true });
  connect(game, { x, y, w: N, d: N });
  const homes = fillRing(game, x, y, N);
  assert.ok(homes >= 12, `only ${homes} homes fit`);
  computeBlocks(game, true);
  let block = blockAt(game, x + N / 2, y + N / 2);
  assert.ok(block.fill > 0.6, `the ring is ${block.fill} built`);
  assert.equal(block.rating, 0, 'hollow');
  assert.equal(game.blockGain.tax, 0);

  // A plaza in the core.
  let green = null;
  for (const [a, b] of [[5, 5], [4, 4], [6, 6], [5, 4]]) { green = placeBuilding(game, 'plaza', x + a, y + b, 0, { free: true }).building; if (green) break; }
  assert.ok(green, 'the plaza fits');
  finish(game);
  computeBlocks(game, true);
  block = blockAt(game, x + N / 2, y + N / 2);
  assert.equal(block.hearts[0].type, 'plaza');
  assert.ok(block.rating >= 40, `rating ${block.rating}`);
  const gain = blockBonus(game);
  assert.ok(gain.tax > 0.03 && gain.mood > 1 && gain.cap >= 1, JSON.stringify(gain));
  // The plaza's cheer reaches every door in the ring, which its own circle would not.
  const corner = idx(x + 1, y + 1);
  computeCoverage(game, true);
  assert.ok(game.cover.cheer[corner] > 0.4, `cheer reaches the corner (${game.cover.cheer[corner]})`);

  // A second heart building makes it better still.
  const before = block.rating;
  for (const [a, b] of [[8, 5], [5, 8], [8, 8]]) if (placeBuilding(game, 'police', x + a, y + b, 0, { free: true }).building) break;
  finish(game);
  computeBlocks(game, true);
  assert.ok(blockAt(game, x + N / 2, y + N / 2).rating > before);
});

test('houses grow in the ring and never in the core', () => {
  const { game, x, y, N } = freeGround();
  buildBlock(game, x, y, x + N - 1, y + N - 1, { ring: 'res', core: 'res' }, { free: true });
  connect(game, { x, y, w: N, d: N });
  game.pop.adults = 120;
  for (let w = 0; w < 60; w++) {
    for (const b of game.world.buildings.values()) if (b.state === 'building') b.progress = Math.max(b.progress, 0.999);
    step(game);
    Object.assign(game.stock, { gold: 9000 });
  }
  computeBlocks(game, true);
  const homes = [...game.world.buildings.values()].filter((b) => b.type !== 'castle' && b.x >= x && b.x < x + N && b.y >= y && b.y < y + N);
  assert.ok(homes.length >= 8, `${homes.length} buildings grew`);
  const block = blockAt(game, x + N / 2, y + N / 2);
  // Nothing stands in the middle two tiles of the core.
  for (let ty = y + 6; ty < y + 8; ty++) for (let tx = x + 6; tx < x + 8; tx++) assert.equal(game.world.bld[idx(tx, ty)], 0, 'the core is clear');
  assert.ok(block.homes >= 8);
});

test('a service building in the heart of a joined-up block is reached by its streets', () => {
  const { game, x, y, N } = freeGround();
  buildBlock(game, x, y, x + N - 1, y + N - 1, { ring: 'res', core: 'none' }, { free: true });
  fillRing(game, x, y, N);
  let school = null;
  for (const [a, b] of [[5, 5], [4, 4], [6, 6], [5, 4]]) { school = placeBuilding(game, 'school', x + a, y + b, 0, { free: true }).building; if (school) break; }
  assert.ok(school, 'the school fits');
  finish(game);
  step(game);
  assert.equal(school.connected, false, 'not while the block is cut off from the city');
  connect(game, { x, y, w: N, d: N });
  step(game);
  assert.equal(school.connected, true, 'no street of its own, and none needed');
  assert.ok(school.eff > 0, 'people work there');
});
