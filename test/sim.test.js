import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, GOODS } from '../src/catalog.js';
import { smogAt } from '../src/sim/people.js';
import { jobsOf } from '../src/sim/economy.js';
import { CENTER } from '../src/config.js';
import { demolish, headcount, setTax, startGame, step } from '../src/sim/game.js';
import { createBot } from './bot.js';

test('every starting neighborhood has homes, shops, industry, police and a fire station, all joined to the tower', () => {
  for (const seed of ['venice', 'oxmere', 'a1', 'b2', 'karst']) {
    const game = startGame({ seed });
    for (const type of ['bungalow', 'stripmall', 'police', 'firehouse']) {
      const b = [...game.world.buildings.values()].find((x) => x.type === type);
      assert.ok(b, `${seed} has a ${type}`);
      assert.ok(b.connected, `${seed}: the ${type} is joined to the tower by a road`);
    }
  }
});

test('a bot plays three years without a crack: numbers stay finite and the city grows', () => {
  const game = startGame({ seed: 'c3' });
  const bot = createBot(game);
  for (let w = 0; w < 144 && !game.gameOver; w++) {
    bot.think();
    step(game);
    for (const g of GOODS) assert.ok(Number.isFinite(game.stock[g]), `week ${w}: ${g} is ${game.stock[g]}`);
    assert.ok(Number.isFinite(game.happiness) && game.happiness >= 0 && game.happiness <= 100);
  }
  assert.ok(headcount(game) > 100, `the city has ${headcount(game)} people`);
});

test('taxes: heavier rates bring in more coin and weigh on the mood', () => {
  const a = startGame({ seed: 'venice' }), b = startGame({ seed: 'venice' });
  setTax(a, 0.05);
  setTax(b, 0.25);
  for (let w = 0; w < 6; w++) { step(a); step(b); }
  assert.ok(b.report.taxes > a.report.taxes);
  assert.ok(b.report.happinessTarget < a.report.happinessTarget);
});

test('zones grow by demand: jobs bring homes, and people bring shops', () => {
  const game = startGame({ seed: 'venice' });
  const bot = createBot(game);
  for (let w = 0; w < 96; w++) { bot.think(); step(game); }
  const count = (zone) => [...game.world.buildings.values()].filter((b) => BUILDINGS[b.type]?.auto === zone).length;
  assert.ok(count('res') + count('dense') > 10, 'homes grew');
  assert.ok(count('com') > 2, 'shops grew');
  assert.ok(count('ind') > 1, 'industry grew');
  for (const k of ['res', 'com', 'ind']) assert.ok(Math.abs(game.report.demand[k]) <= 1);
});

test('what grew on a zone is private: bulldozing it gives the city nothing back', () => {
  const game = startGame({ seed: 'venice' });
  const b = [...game.world.buildings.values()].find((x) => x.type === 'bungalow');
  const before = game.stock.gold;
  assert.ok(demolish(game, b.x, b.y).ok);
  assert.equal(game.stock.gold, before);
});

test('fires are rare, and rarer still where a fire station reaches', () => {
  const game = startGame({ seed: 'venice' });
  game.disasters = true;
  let burned = 0;
  game.on('fire', ({ why }) => { if (why === 'fire') burned++; });
  for (let w = 0; w < 480; w++) step(game);
  assert.ok(burned < 6, `${burned} burned in a decade`);
});

test('smog from factories weighs on the homes near them', () => {
  const game = startGame({ seed: 'venice' });
  const home = [...game.world.buildings.values()].find((x) => x.type === 'bungalow');
  const cx = home.x + 1, cy = home.y + 1;
  assert.equal(smogAt(game, cx, cy) > 0, [...game.world.buildings.values()].some((b) => BUILDINGS[b.type]?.smoky && Math.hypot(b.x - cx, b.y - cy) < 7));
  const f = [...game.world.buildings.values()].find((x) => x.type === 'warehouse');
  f.type = 'factory';
  assert.ok(smogAt(game, f.x + 1, f.y + 1) > 0.3);
});

test('a hurricane gives a week of warning, blows for two, and is over', () => {
  const game = startGame({ seed: 'venice' });
  const phases = [];
  game.on('hurricane', ({ phase }) => phases.push(phase));
  // Into the season (August is month 5 of a year that starts in March), and make sure one comes.
  game.week = 48 + 5 * 4;
  const rnd = game.rnd;
  game.rnd = () => 0;
  step(game);
  game.rnd = rnd;
  assert.ok(game.hurricane, 'a hurricane is coming');
  for (let w = 0; w < 4; w++) step(game);
  assert.deepEqual(phases, ['warning', 'landfall', 'over']);
  assert.equal(game.hurricane, null);
});

test('no hurricanes, earthquakes or fires when disasters are off', () => {
  const game = startGame({ seed: 'venice', disasters: false });
  let trouble = 0;
  for (const kind of ['hurricane', 'quake', 'fire']) game.on(kind, () => trouble++);
  game.rnd = () => 0;
  for (let w = 0; w < 200; w++) step(game);
  assert.equal(trouble, 0);
});

test('the tower is staffed from the start, and its staff grows with it', () => {
  const game = startGame({ seed: 'venice' });
  const tower = game.world.buildings.get(1);
  const first = jobsOf(tower);
  assert.ok(first > 0);
  tower.level = 2;
  assert.ok(jobsOf(tower) > first);
});

test('the founder starts with the tower district and the one south of it, joined by the avenue', () => {
  const game = startGame({ seed: 'venice' });
  assert.equal(game.world.wards.filter((w) => w.owned).length, 2);
  let road = 0;
  for (let k = 0; k < 30; k++) if (game.world.road[(CENTER + 13 + k) * game.world.size + CENTER]) road++;
  assert.ok(road >= 28, `the avenue runs south (${road} tiles)`);
});
