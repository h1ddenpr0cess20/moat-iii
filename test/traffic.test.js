import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRS } from '../src/config.js';
import { mulberry32 } from '../src/rng.js';
import { startGame, step } from '../src/sim/game.js';
import { createTrafficSim, signalFor, wrongWay } from '../src/world/traffic.js';
import { idx } from '../src/world/world.js';
import { CASTLE_BRIDGE } from '../src/world/wards.js';
import { createBot } from './bot.js';

const KINDS = [[0.46, 4], [0.4, 3], [0.52, 2], [0.66, 1]];
const CASTLE = new Set();
for (let y = CASTLE_BRIDGE.y; y < CASTLE_BRIDGE.y + CASTLE_BRIDGE.d; y++) for (let x = CASTLE_BRIDGE.x; x < CASTLE_BRIDGE.x + CASTLE_BRIDGE.w; x++) CASTLE.add(idx(x, y));

/** A city grown by the bot for two years, and its traffic run for `seconds`, watched every `every` frames. */
function drive(seed, cars, seconds, watch) {
  const game = startGame({ seed });
  const bot = createBot(game);
  for (let w = 0; w < 100; w++) { bot.think(); step(game); }
  const sim = createTrafficSim(game.world, { kinds: KINDS, rnd: mulberry32(7) });
  const prev = new Map();
  for (let f = 0; f < seconds * 30; f++) {
    for (const c of sim.cars) prev.set(c.id, { atLine: c.atLine, cur: c.cur, next: c.next, dOut: c.dOut, v: c.v });
    sim.step(1 / 30, cars);
    watch(sim, prev);
  }
  return sim;
}

test('cars keep to the right, never go the wrong way down an avenue, and do not run into each other', () => {
  let samples = 0, close = 0, pairs = 0;
  const sim = drive('c3', 60, 90, (sim) => {
    samples++;
    if (samples % 10) return;
    const cars = sim.cars;
    for (const c of cars) {
      assert.ok(!wrongWay(sim.net, c.cur[0], c.cur[1], c.dIn), `car ${c.id} the wrong way at ${c.cur}`);
      // On a straight stretch of street, the car is on the right of the middle.
      const [x, y] = c.cur;
      if (c.dIn === c.dOut && !sim.net.wide(x, y) && sim.net.junction[idx(x, y)] < 0) {
        const [rx, ry] = DIRS[(c.dIn + 1) % 4];
        const side = (c.x - x - 0.5) * rx + (c.z - y - 0.5) * ry;
        assert.ok(side > 0.1 && side < 0.3, `car ${c.id} ${side.toFixed(2)} off the middle`);
      }
    }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      pairs++;
      if (Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) < 0.25) close++;
    }
  });
  assert.ok(sim.cars.length >= 40, `${sim.cars.length} cars`);
  assert.ok(close <= pairs * 0.0005, `${close} near misses in ${pairs}`);
});

test('every car stops at a stop sign, and nobody goes in on a red light', () => {
  let stopped = 0, ran = 0, signed = 0;
  const seen = new Map();
  drive('venice', 50, 90, (sim, prev) => {
    for (const c of sim.cars) {
      const p = prev.get(c.id);
      if (c.atLine && c.v < 0.02) seen.set(c.id, true);
      if (!p || (p.cur[0] === c.cur[0] && p.cur[1] === c.cur[1])) continue;
      const halted = seen.get(c.id);
      seen.delete(c.id);
      // It has moved on a tile: did it just come into a crossing?
      const here = sim.net.junction[idx(c.cur[0], c.cur[1])], was = sim.net.junction[idx(p.cur[0], p.cur[1])];
      if (here < 0 || here === was) continue;
      const cl = sim.net.clusters[here];
      if (cl.signal) { if (signalFor(cl, p.dOut, sim.time) === 'red' && p.v < 0.3) ran++; continue; }
      signed++;
      if (halted) stopped++;
    }
  });
  assert.ok(signed > 10, `${signed} cars through stop signs`);
  assert.ok(stopped >= signed * 0.95, `${stopped} of ${signed} stopped first`);
  assert.equal(ran, 0);
});

test('the lights give each way in a green, an amber and a red', () => {
  const c = { phase: 0 };
  for (let d = 0; d < 4; d++) {
    const seen = new Set();
    for (let t = 0; t < 30; t += 0.1) seen.add(signalFor(c, d, t));
    assert.deepEqual([...seen].sort(), ['amber', 'green', 'red']);
  }
  // Never two ways green at once.
  for (let t = 0; t < 30; t += 0.1) assert.ok([0, 1, 2, 3].filter((d) => signalFor(c, d, t) !== 'red').length <= 1);
});

test('a car goes on and off a bridge without a step, and never up the drawbridge to the tower', () => {
  let ends = 0, worst = 0;
  const sim = drive('c3', 30, 20, (sim) => {
    for (const c of sim.cars) assert.ok(!CASTLE.has(idx(c.cur[0], c.cur[1])), `car ${c.id} on the drawbridge`);
  });
  const net = sim.net, size = net.size;
  for (const t of net.tiles) {
    if (net.rampOf[t] < 0) continue;
    const x = t % size, y = Math.floor(t / size);
    for (const [dx, dy] of DIRS) {
      if (!net.road(x + dx, y + dy) || net.rampOf[idx(x + dx, y + dy)] >= 0) continue;
      // Where the bridge meets the road: the deck's height there and the road's.
      const ex = x + 0.5 + dx * 0.5, ez = y + 0.5 + dy * 0.5;
      worst = Math.max(worst, Math.abs(net.groundAt(t, ex, ez) - net.groundAt(idx(x + dx, y + dy), ex, ez)));
      ends++;
    }
  }
  assert.ok(ends > 0, 'there are bridges');
  assert.ok(worst < 0.02, `a step of ${worst.toFixed(3)} at a bridge's end`);
});
