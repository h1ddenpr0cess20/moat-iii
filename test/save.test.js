import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deserialize, serialize } from '../src/save.js';
import { completeAnnex, startGame, step } from '../src/sim/game.js';
import { bordersRealm } from '../src/world/wards.js';
import { createBot } from './bot.js';

function play(seed, weeks) {
  const game = startGame({ seed });
  const bot = createBot(game);
  for (let w = 0; w < weeks && !game.gameOver; w++) { bot.think(); step(game); }
  return game;
}

test('a saved game comes back as it was', () => {
  const game = play('moat', 140);
  // Take a ward the way the lord would: the moat is dug around it, and the old one filled.
  const next = game.world.wards.find((w) => !w.owned && bordersRealm(game.world, w.id));
  completeAnnex(game, next);
  assert.ok(game.world.wards.filter((w) => w.owned).length >= 2);
  const json = JSON.stringify(serialize(game));
  assert.ok(json.length < 900_000, `the save is ${json.length} bytes`);
  const back = deserialize(JSON.parse(json));
  assert.equal(back.week, game.week);
  assert.equal(back.seed, game.seed);
  assert.deepEqual(back.pop, game.pop);
  assert.deepEqual(back.stock, game.stock);
  assert.equal(back.world.buildings.size, game.world.buildings.size);
  for (const [id, b] of game.world.buildings) {
    const c = back.world.buildings.get(id);
    assert.ok(c, `building ${id} (${b.type}) is back`);
    assert.deepEqual([c.type, c.x, c.y, c.w, c.d, c.front, c.level, c.state], [b.type, b.x, b.y, b.w, b.d, b.front, b.level, b.state]);
  }
  for (const k of ['ground', 'tree', 'amount', 'road', 'zone', 'crop', 'bld', 'realm', 'moat']) assert.deepEqual(back.world[k], game.world[k], `the ${k} map is the same`);
  let worst = 0;
  for (let i = 0; i < game.world.h.length; i++) worst = Math.max(worst, Math.abs(game.world.h[i] - back.world.h[i]), Math.abs(game.world.hBase[i] - back.world.hBase[i]));
  assert.ok(worst < 0.001, `heights differ by ${worst}`);
  assert.deepEqual(back.world.wards.map((w) => w.owned), game.world.wards.map((w) => w.owned));
  assert.deepEqual(back.world.gates.map((g) => [g.ward, g.dir, g.open, g.gatehouse]), game.world.gates.map((g) => [g.ward, g.dir, g.open, g.gatehouse]));
});

test('a loaded game goes on playing', () => {
  const game = play('hollin', 70);
  const back = deserialize(JSON.parse(JSON.stringify(serialize(game))));
  const bot = createBot(back);
  for (let w = 0; w < 30 && !back.gameOver; w++) { bot.think(); step(back); }
  assert.ok(back.week >= game.week + 25 || back.gameOver);
  assert.ok(Number.isFinite(back.stock.gold));
});
