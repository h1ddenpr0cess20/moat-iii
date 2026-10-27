import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTER, GROUND, HOME_WARD, ROAD, SIZE, WARD } from '../src/config.js';
import { newWorld, heightAt, SUB, HV, idx, wardId, wardOfTile, ownedCount, exposedBorders, bordersRealm } from '../src/world/index.js';
import { startGame, completeAnnex, buildRoad, buildZone, rectTiles, lineTiles } from '../src/sim/game.js';
import { network, setRoad } from '../src/world/roads.js';

test('the same seed makes the same land, and another seed another', () => {
  const a = newWorld('oxmere'), b = newWorld('oxmere'), c = newWorld('hollin');
  assert.deepEqual(a.h, b.h);
  assert.deepEqual(a.ground, b.ground);
  assert.deepEqual(a.tree, b.tree);
  assert.deepEqual(a.wards.map((w) => w.name), b.wards.map((w) => w.name));
  assert.notDeepEqual(a.h, c.h);
});

test('the castle stands on an island in the middle of the home ward', () => {
  const w = newWorld('moat');
  assert.equal(wardOfTile(CENTER, CENTER), wardId(HOME_WARD, HOME_WARD));
  assert.equal(ownedCount(w), 1);
  const castle = w.buildings.get(1);
  assert.equal(castle.type, 'castle');
  // Water all around the island, and the home ward is the realm's but for its banks.
  const wet = (x, y) => w.moat[idx(x, y)] === 1;
  assert.ok(wet(CENTER - 4, CENTER) && wet(CENTER + 4, CENTER) && wet(CENTER, CENTER - 4));
  let realm = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (w.realm[idx(x, y)]) realm++;
  assert.ok(realm > WARD * WARD * 0.4 && realm < WARD * WARD * 0.8, `the realm is ${realm} tiles`);
  // The moat is below the plain, the plain above the water.
  assert.ok(heightAt(w, CENTER - 4, CENTER) < 0, 'the inner moat is dug');
  assert.ok(heightAt(w, CENTER - 8, CENTER - 8) > 0.12, 'the plain is dry');
});

test('every border with another ward has a bridge', () => {
  const w = newWorld('moat');
  assert.equal(w.gates.length, 4);
  for (const g of w.gates) {
    for (const [x, y] of g.tiles) assert.equal(w.road[idx(x, y)], ROAD.BRIDGE);
  }
  assert.equal(exposedBorders(w).filter((s) => s.beyond !== null).length, 4);
});

test('heightAt agrees with the heights it was made from', () => {
  const w = newWorld('moat');
  for (const [vx, vy] of [[10, 10], [200, 300], [HV - 1, HV - 1], [CENTER * SUB, CENTER * SUB]]) {
    assert.ok(Math.abs(heightAt(w, vx / SUB, vy / SUB) - w.h[vy * HV + vx]) < 1e-4);
  }
});

test('digging the moat out around a ward takes it in, and fills the old moat', () => {
  const game = startGame({ seed: 'moat' });
  const { world } = game;
  const home = wardId(HOME_WARD, HOME_WARD);
  const east = wardId(HOME_WARD + 1, HOME_WARD);
  assert.ok(bordersRealm(world, east));
  const before = heightAt(world, (HOME_WARD + 1) * WARD, CENTER);
  assert.ok(before < 0, 'the old moat holds water');
  completeAnnex(game, world.wards[east]);
  assert.ok(world.wards[east].owned && world.wards[home].owned);
  assert.equal(ownedCount(world), 3, 'the home district, the one south of it that comes with the island, and this one');
  assert.ok(heightAt(world, (HOME_WARD + 1) * WARD, CENTER) > 0.12, 'the old moat is filled in');
  assert.ok(heightAt(world, (HOME_WARD + 2) * WARD, CENTER) < 0, 'the new border is a moat');
  assert.ok(world.gates.some((g) => g.ward === east), 'the new ward has a gate of its own');
});

test('roads: not on water, joined to the castle by the network', () => {
  const game = startGame({ seed: 'moat' });
  const { world } = game;
  let wet = null;
  for (let i = 0; i < world.ground.length && !wet; i++) if (world.ground[i] === GROUND.WATER) wet = [i % SIZE, Math.floor(i / SIZE)];
  assert.ok(setRoad(world, wet[0], wet[1], ROAD.DIRT) < 0, 'no road on water');
  const { dist } = network(world);
  // The hamlet's avenue runs from the castle's bridge.
  assert.ok(dist[idx(CENTER, CENTER + 6)] >= 0);
  const out = buildRoad(game, lineTiles(CENTER - 8, CENTER - 8, CENTER + 8, CENTER - 8), 'dirt');
  assert.ok(out.ok && out.placed > 8);
  assert.ok(game.stock.gold < 1200);
});

test('zones cost coin and need open land', () => {
  const game = startGame({ seed: 'moat' });
  const gold = game.stock.gold;
  const r = buildZone(game, rectTiles(CENTER + 8, CENTER + 10, CENTER + 11, CENTER + 12), 'res');
  assert.ok(r.ok);
  assert.equal(game.stock.gold, gold - r.placed);
  const outside = buildZone(game, rectTiles(2, 2, 4, 4), 'res');
  assert.equal(outside.ok, false, 'no zoning outside the moat');
});

test('bridges cross a river inside the realm, but not the moat, and not too far', async () => {
  const { GROUND: G } = await import('../src/config.js');
  const { planRoad, demolish } = await import('../src/sim/game.js');
  const game = startGame({ seed: 'moat' });
  const { world } = game;
  // An open row of eleven tiles in the realm to run a stream across (three tiles wide, in the middle).
  const { roadBlocked } = await import('../src/world/roads.js');
  let y = null, x0 = null;
  for (let yy = CENTER - 12; yy <= CENTER - 6 && y === null; yy++) for (let xx = 94; xx <= 105 && y === null; xx++) {
    if (Array.from({ length: 12 }, (_, k) => roadBlocked(world, xx + k, yy)).every((r) => !r)) { y = yy; x0 = xx; }
  }
  assert.ok(y !== null, 'an open row');
  const wx = x0 + 5;
  for (let x = wx; x <= wx + 2; x++) world.ground[idx(x, y)] = G.WATER;
  game.stock.wood = 100; game.stock.gold = 100;
  assert.equal(planRoad(game, lineTiles(x0, y, x0 + 11, y), 'dirt').tiles.length < 11, true, 'a road cannot cross the water');
  const over = buildRoad(game, lineTiles(x0, y, x0 + 11, y), 'bridge');
  assert.ok(over.ok, over.reason);
  for (let x = wx; x <= wx + 2; x++) assert.equal(world.road[idx(x, y)], ROAD.SPAN);
  assert.equal(game.stock.gold, 100 - (3 * 6 + 9), 'three spans at $6k, nine dry tiles at $1k');
  // A bridge needs water, and both ends on land.
  assert.match(planRoad(game, lineTiles(x0, y, x0 + 3, y), 'bridge').reason, /needs water/);
  assert.match(planRoad(game, lineTiles(wx, y, x0 + 11, y), 'bridge').reason, /bank/);
  // Too long a span.
  for (let x = x0 + 1; x <= x0 + 9; x++) world.ground[idx(x, y)] = G.WATER;
  world.road[idx(wx, y)] = 0; world.road[idx(wx + 1, y)] = 0; world.road[idx(wx + 2, y)] = 0;
  assert.match(planRoad(game, lineTiles(x0, y, x0 + 11, y), 'bridge').reason, /Too long/);
  // It can be taken down.
  world.ground[idx(wx, y)] = G.WATER;
  world.road[idx(wx, y)] = ROAD.SPAN;
  assert.equal(demolish(game, wx, y).what, 'Bridge');
  assert.equal(world.road[idx(wx, y)], ROAD.NONE);
  // The moat is crossed only at the gates.
  const moatTile = [CENTER - 4, CENTER];
  assert.equal(planRoad(game, lineTiles(moatTile[0] - 3, moatTile[1], moatTile[0] + 3, moatTile[1]), 'bridge').tiles.length, 0);
});

test('a bridge may start on marshy bank: low ground counts as part of the span', async () => {
  const { GROUND: G } = await import('../src/config.js');
  const { planRoad } = await import('../src/sim/game.js');
  const { roadBlocked } = await import('../src/world/roads.js');
  const game = startGame({ seed: 'moat' });
  const { world } = game;
  let y = null, x0 = null;
  for (let yy = CENTER - 12; yy <= CENTER - 6 && y === null; yy++) for (let xx = 94; xx <= 105 && y === null; xx++) {
    if (Array.from({ length: 12 }, (_, k) => roadBlocked(world, xx + k, yy)).every((r) => !r)) { y = yy; x0 = xx; }
  }
  for (let x = x0 + 5; x <= x0 + 6; x++) world.ground[idx(x, y)] = G.WATER;
  // The banks either side are low and wet: no road, but a boardwalk.
  for (const bx of [x0 + 4, x0 + 7]) for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) world.h[(y * SUB + dy) * HV + bx * SUB + dx] = 0.04;
  assert.equal(roadBlocked(world, x0 + 4, y), 'Waterlogged');
  assert.match(planRoad(game, lineTiles(x0 + 4, y, x0 + 4, y), 'dirt').reason, /bridge/, 'a plain road tells you to use a bridge');
  const plan = planRoad(game, lineTiles(x0, y, x0 + 11, y), 'bridge');
  assert.equal(plan.reason, null, plan.reason);
  assert.ok(plan.spans.length >= 4, 'two water tiles and the marshy banks either side');
});

test('no tree stands in a moat, however many wards are dug around', () => {
  const game = startGame({ seed: 'oxmere' });
  const { world } = game;
  const drowned = () => {
    let n = 0;
    for (let i = 0; i < world.tree.length; i++) if (world.tree[i] && world.moat[i] === 1) n++;
    return n;
  };
  assert.equal(drowned(), 0);
  // Woods in the way of the next moat: plant every tile of the ring around the home ward, then take the ward beside it.
  world.tree.fill(1);
  const next = world.wards.find((w) => !w.owned && bordersRealm(world, w.id));
  completeAnnex(game, next);
  assert.equal(drowned(), 0);
});
