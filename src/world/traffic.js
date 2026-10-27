import { DIRS, ROAD, WATER_LEVEL } from '../config.js';
import { hash2 } from '../rng.js';
import { heightAt, idx, inb } from './world.js';

/**
 * The traffic, as rules and no drawing: where the lanes run, who may go, and
 * where each car is. Cars keep to the right, as in California. A street has
 * a lane each way; an avenue (and a canal bridge) is two tiles wide, each
 * tile one way with two lanes, and nobody turns across its double yellow line
 * except at a crossing. Where streets meet there is an all-way stop: each car
 * comes to a stop at the line, and goes when nobody from another way is in
 * the crossing. Where an avenue is crossed there are traffic lights, a green
 * arrow for each way in, in turn. Nobody enters a crossing that another way's
 * cars are still in, and nobody runs into the car in front.
 *
 * A tile is about five meters across, so a car is a little under half of one.
 */

/** Off the middle of a street to the middle of its right-hand lane, in tiles. */
export const STREET_LANE = 0.19;
/** On one tile of an avenue: the curb lane and the inside lane, off the tile's middle to the right of the way it runs. */
export const AVENUE_LANES = Object.freeze([0.16, -0.24]);
/** Top speeds, in tiles a second: a street, an avenue, and slowed down for a turn. */
export const SPEED = Object.freeze({ street: 1.0, avenue: 1.4, turn: 0.55 });
const ACCEL = 1.1, BRAKE = 3.2;
/** How long a car waits, stopped, at a stop sign before it goes. */
const STOP_WAIT = 0.45;
/** The traffic lights' cycle, in seconds: green, amber, all red, for one way and then the other. */
export const SIGNAL = Object.freeze({ green: 4, amber: 1.2, red: 1.2 });
const CYCLE = 4 * (SIGNAL.green + SIGNAL.amber + SIGNAL.red);

const right = (d) => (d + 1) % 4;
const left = (d) => (d + 3) % 4;
const back = (d) => (d + 2) % 4;

/** The streets as the cars see them: every lane, junction and bridge deck. Worked out again whenever the roads change. */
export function survey(world) {
  const N = world.size;
  const drive = new Uint8Array(N * N);
  for (let i = 0; i < drive.length; i++) {
    const r = world.road[i];
    drive[i] = r === ROAD.AVENUE || r === ROAD.BRIDGE ? 2 : r === ROAD.DIRT || r === ROAD.COBBLE || r === ROAD.SPAN ? 1 : 0;
  }
  const road = (x, y) => inb(x, y) && drive[idx(x, y)] > 0;
  const wide = (x, y) => inb(x, y) && drive[idx(x, y)] === 2;

  const net = { size: N, drive, road, wide };
  // A junction is where a car has a choice to make: some way in with more than one way out.
  const junction = new Int32Array(N * N).fill(-1);
  const isJunction = (x, y) => [0, 1, 2, 3].some((d) => road(x - DIRS[d][0], y - DIRS[d][1]) && !wrongWay(net, x, y, d) && exits(net, x, y, d).length > 1);
  const tiles = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (drive[idx(x, y)]) { tiles.push(idx(x, y)); if (isJunction(x, y)) junction[idx(x, y)] = -2; }

  // Junctions that touch are one crossing, up to three tiles by three (an avenue over an avenue, with a street beside). A crossing with an avenue in it has lights; the rest have stop signs.
  const clusters = [];
  for (const t of tiles) {
    if (junction[t] !== -2) continue;
    const c = { id: clusters.length, tiles: [], signal: false, phase: 0, ways: new Map(), longest: 0 };
    const stack = [t];
    junction[t] = c.id;
    let x0 = t % N, x1 = x0, y0 = Math.floor(t / N), y1 = y0;
    while (stack.length) {
      const i = stack.pop();
      c.tiles.push(i);
      if (drive[i] === 2) c.signal = true;
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const j = idx(nx, ny);
        if (junction[j] !== -2 || Math.max(x1, nx) - Math.min(x0, nx) > 2 || Math.max(y1, ny) - Math.min(y0, ny) > 2) continue;
        junction[j] = c.id;
        stack.push(j);
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
      }
    }
    c.phase = hash2(t % N, Math.floor(t / N), 41) * CYCLE;
    clusters.push(c);
  }

  // The bridges' decks are flat, at the height of their banks.
  const deck = new Float32Array(N * N).fill(NaN);
  const seen = new Uint8Array(N * N);
  for (const t of tiles) {
    const r = world.road[t];
    if (seen[t] || (r !== ROAD.BRIDGE && r !== ROAD.SPAN)) continue;
    const part = [t], stack = [t];
    seen[t] = 1;
    let sum = 0, n = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of DIRS) {
        if (!inb(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy);
        if (world.road[j] === r) { if (!seen[j]) { seen[j] = 1; part.push(j); stack.push(j); } continue; }
        const h = heightAt(world, x + dx + 0.5, y + dy + 0.5);
        if (h > WATER_LEVEL + 0.05) { sum += h; n++; }
      }
    }
    const y = (n ? sum / n : WATER_LEVEL) + 0.07;
    for (const i of part) deck[i] = y;
  }

  return Object.assign(net, { junction, clusters, deck, tiles });
}

/** Would a car heading `d` onto (x, y) be going the wrong way? On an avenue, the right half is the one with the other half on its left. */
export function wrongWay(net, x, y, d) {
  if (!net.wide(x, y)) return false;
  const [rx, ry] = DIRS[right(d)], [lx, ly] = DIRS[left(d)];
  return net.wide(x + rx, y + ry) && !net.wide(x + lx, y + ly);
}

/** How far to the right of the middle of (x, y) a car heading `d` in `lane` drives. */
export function laneOffset(net, x, y, d, lane) {
  if (!net.wide(x, y)) return STREET_LANE;
  // Through a crossing the lanes run on as they came: the half is the one the row of tiles behind (or ahead) is.
  const [dx, dy] = DIRS[d], [rx, ry] = DIRS[right(d)], [lx, ly] = DIRS[left(d)];
  for (const k of [0, -1, -2, -3, 1, 2, 3]) {
    const tx = x + dx * k, ty = y + dy * k;
    if (!net.wide(tx, ty)) continue;
    const l = net.wide(tx + lx, ty + ly), r = net.wide(tx + rx, ty + ry);
    if (l && !r) return AVENUE_LANES[lane];
    if (r && !l) return STREET_LANE;
  }
  return STREET_LANE;
}

/** Does the road at (x, y) run on both ways along `d`? */
const runsAlong = (net, x, y, d) => net.road(x + DIRS[d][0], y + DIRS[d][1]) && net.road(x - DIRS[d][0], y - DIRS[d][1]);

/**
 * The ways a car on (x, y), having come in heading `d`, may go on: never the
 * wrong way, back only at a dead end, and round a corner only onto a road
 * that goes on (so not over the double yellow between crossings, nor into
 * the street that happens to run alongside), unless the road turns there.
 */
export function exits(net, x, y, d) {
  const out = [];
  const ahead = net.road(x + DIRS[d][0], y + DIRS[d][1]) && !wrongWay(net, x + DIRS[d][0], y + DIRS[d][1], d);
  for (const nd of [d, right(d), left(d)]) {
    const [dx, dy] = DIRS[nd];
    const nx = x + dx, ny = y + dy;
    if (!net.road(nx, ny) || wrongWay(net, nx, ny, nd)) continue;
    if (nd !== d && ahead) {
      // Across whatever runs alongside (the avenue's other half, a street beside it) to a road that crosses it and goes on.
      let tx = nx, ty = ny;
      for (let k = 0; k < 4 && runsAlong(net, tx, ty, d); k++) { tx += dx; ty += dy; }
      if (!net.road(tx, ty) || !net.road(tx + dx, ty + dy)) continue;
    }
    out.push(nd);
  }
  if (!out.length) {
    const nd = back(d), nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
    if (net.road(nx, ny) && !wrongWay(net, nx, ny, nd)) out.push(nd);
  }
  return out;
}

/**
 * The light for a car heading `d` into a crossing at `time`: 'green', 'amber'
 * or 'red'. Each way in has its own green arrow in turn (north, east, south,
 * west), so a car turning left has nobody coming at it.
 */
export function signalFor(cluster, d, time) {
  const slot = SIGNAL.green + SIGNAL.amber + SIGNAL.red;
  const t = (time + cluster.phase) % CYCLE;
  const k = Math.floor(t / slot), u = t - k * slot;
  if (k !== d) return 'red';
  return u < SIGNAL.green ? 'green' : u < SIGNAL.green + SIGNAL.amber ? 'amber' : 'red';
}

// ---------------------------------------------------------------- the cars

const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
const dcubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c);
};

/** The curve a car follows across its tile: in at one edge, out at another, a lane to the right of the way it goes. */
function curveFor(net, [x, y], dI, dO, lane) {
  const cx = x + 0.5, cy = y + 0.5;
  const offIn = laneOffset(net, x, y, dI, lane);
  const offOut = laneOffset(net, x + DIRS[dO][0], y + DIRS[dO][1], dO, lane);
  const [ix, iy] = DIRS[dI], [ox, oy] = DIRS[dO];
  const p0 = [cx - ix * 0.5 + DIRS[right(dI)][0] * offIn, cy - iy * 0.5 + DIRS[right(dI)][1] * offIn];
  const p3 = [cx + ox * 0.5 + DIRS[right(dO)][0] * offOut, cy + oy * 0.5 + DIRS[right(dO)][1] * offOut];
  const k = dI === dO ? 0.33 : dO === back(dI) ? 0.45 : 0.3;
  return [p0, [p0[0] + ix * k, p0[1] + iy * k], [p3[0] - ox * k, p3[1] - oy * k], p3];
}

function shape(net, car) {
  car.curve = curveFor(net, car.cur, car.dIn, car.dOut, car.lane);
  const [p0, p1, p2, p3] = car.curve;
  let len = 0, px = p0[0], py = p0[1];
  for (let s = 1; s <= 8; s++) {
    const t = s / 8;
    const qx = cubic(p0[0], p1[0], p2[0], p3[0], t), qy = cubic(p0[1], p1[1], p2[1], p3[1], t);
    len += Math.hypot(qx - px, qy - py);
    px = qx; py = qy;
  }
  car.len = Math.max(0.05, len);
  car.turning = car.dIn !== car.dOut;
}

/** Where a car is: { x, z, hx, hz } (its heading as a unit vector). */
function place(car) {
  const [a, b, c, d] = car.curve;
  const t = car.s;
  const x = cubic(a[0], b[0], c[0], d[0], t), z = cubic(a[1], b[1], c[1], d[1], t);
  let hx = dcubic(a[0], b[0], c[0], d[0], t), hz = dcubic(a[1], b[1], c[1], d[1], t);
  const l = Math.hypot(hx, hz) || 1;
  hx /= l; hz /= l;
  car.x = x; car.z = z; car.hx = hx; car.hz = hz;
}

/**
 * A city's traffic. `kinds` are the sizes of car there are ([length in tiles,
 * weight]); `rnd` a random source. `step(dt, want)` moves every car on and
 * brings the number toward `want`.
 */
export function createTrafficSim(world, { kinds = [[0.46, 1]], rnd = Math.random } = {}) {
  let net = null, ver = -1;
  let time = 0, nextId = 1;
  const cars = [];

  const pickKind = () => {
    const total = kinds.reduce((s, k) => s + k[1], 0);
    let r = rnd() * total;
    for (let i = 0; i < kinds.length; i++) { r -= kinds[i][1]; if (r <= 0) return i; }
    return 0;
  };

  /** Which way a car in `lane` on (x, y), come in heading `dIn`, goes on: -1 if it cannot. */
  const pickWay = (x, y, dIn, lane) => {
    let opts = exits(net, x, y, dIn);
    if (!opts.length) return -1;
    // On an avenue, right turns are from the curb lane and left turns from the inside one, where there is a choice.
    if (laneOffset(net, x, y, dIn, 0) === AVENUE_LANES[0]) {
      const keep = opts.filter((d) => d !== (lane === 0 ? left(dIn) : right(dIn)));
      if (keep.length) opts = keep;
    }
    // Mostly straight on.
    const w = opts.map((d) => (d === dIn ? 3 : d === back(dIn) ? 0.3 : 1.4));
    let r = rnd() * w.reduce((s, v) => s + v, 0);
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  };

  /**
   * A car's way through the crossing ahead, chosen before it goes in, and the
   * tile it comes out on: so that it goes in only if there is room there.
   */
  const planThrough = (car, cluster) => {
    const plan = [];
    let [x, y] = car.next, d = car.dOut;
    for (let k = 0; k < 10; k++) {
      const nd = pickWay(x, y, d, car.lane);
      if (nd < 0) return null;
      plan.push(nd);
      x += DIRS[nd][0]; y += DIRS[nd][1]; d = nd;
      if (clusterAt(x, y) !== cluster) return { plan, exit: [x, y] };
    }
    return null;
  };

  /** Is there a car standing on, or about to stand on, the tile a car would come out of a crossing on? */
  const blocked = ([x, y]) => cars.some((o) => o.v < 0.3 && ((o.cur[0] === x && o.cur[1] === y && o.s < 0.75) || (o.next && o.next[0] === x && o.next[1] === y && o.s > 0.6)));

  const choose = (car) => {
    const [x, y] = car.cur;
    const pick = car.plan?.length ? car.plan.shift() : pickWay(x, y, car.dIn, car.lane);
    if (pick < 0) return false;
    car.dOut = pick;
    car.next = [x + DIRS[pick][0], y + DIRS[pick][1]];
    shape(net, car);
    return true;
  };

  const clusterAt = (x, y) => (inb(x, y) ? net.junction[idx(x, y)] : -1);


  /** A car on a random lane where there is room for it. */
  const spawn = () => {
    for (let tries = 0; tries < 12; tries++) {
      const t = net.tiles[Math.floor(rnd() * net.tiles.length)];
      if (net.junction[t] >= 0) continue;
      const x = t % net.size, y = Math.floor(t / net.size);
      const ds = [0, 1, 2, 3].filter((d) => !wrongWay(net, x, y, d) && net.road(x - DIRS[d][0], y - DIRS[d][1]));
      if (!ds.length) continue;
      const d = ds[Math.floor(rnd() * ds.length)];
      const kind = pickKind();
      const car = { id: nextId++, kind, size: kinds[kind][0], cur: [x, y], dIn: d, dOut: d, next: null, s: 0.5, v: 0, lane: net.wide(x, y) && rnd() < 0.5 ? 1 : 0, holds: -1, approach: d, plan: null, lineWait: 0, stopped: 0, stuck: 0, atLine: false, queued: false, x: 0, z: 0, hx: 0, hz: 0, y: 0, len: 1, curve: null };
      if (!choose(car)) continue;
      place(car);
      if (cars.some((o) => Math.hypot(o.x - car.x, o.z - car.z) < 0.9)) continue;
      car.v = SPEED.street * 0.5;
      cars.push(car);
      return car;
    }
    return null;
  };

  const remove = (i) => { cars.splice(i, 1); };

  /** Moves on to the next tile. False if there is nowhere to go. */
  const advance = (car) => {
    car.prev = car.cur;
    car.cur = car.next;
    car.dIn = car.dOut;
    car.s -= 1;
    if (car.holds >= 0 && clusterAt(car.cur[0], car.cur[1]) !== car.holds) car.holds = -1;
    car.stopped = 0;
    return choose(car);
  };

  /** Points along the road in front of a car, a tenth of a tile apart, two tiles on: [x, z, heading x, heading z, how far]. The way on from the next tile is chosen now, so it can look round that corner too. */
  const ahead = (car) => {
    const out = [];
    let dist = 0, px = car.x, pz = car.z;
    const along = ([a, b, c, d], t0) => {
      const n = Math.max(2, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1]) * 12));
      for (let i = 1; i <= n && dist < 2; i++) {
        const t = t0 + ((1 - t0) * i) / n;
        const x = cubic(a[0], b[0], c[0], d[0], t), z = cubic(a[1], b[1], c[1], d[1], t);
        let hx = dcubic(a[0], b[0], c[0], d[0], t), hz = dcubic(a[1], b[1], c[1], d[1], t);
        const l = Math.hypot(hx, hz) || 1;
        dist += Math.hypot(x - px, z - pz);
        out.push([x, z, hx / l, hz / l, dist]);
        px = x; pz = z;
      }
    };
    along(car.curve, car.s);
    if (!car.plan?.length) { const nd = pickWay(car.next[0], car.next[1], car.dOut, car.lane); car.plan = nd < 0 ? [] : [nd]; }
    if (car.plan.length) along(curveFor(net, car.next, car.dOut, car.plan[0], car.lane), 0);
    return out;
  };

  /** How fast a car may go, given what is ahead of it: the car in front, the stop line, the lights. */
  const limit = (car, grid) => {
    const [x, y] = car.cur;
    let v = car.turning ? SPEED.turn : net.wide(x, y) ? SPEED.avenue : SPEED.street;
    const remain = (1 - car.s) * car.len;
    const stopAt = (dist) => Math.sqrt(2 * BRAKE * Math.max(0, dist));
    // The crossing ahead, if this car is not in it already.
    const here = clusterAt(x, y), there = clusterAt(car.next[0], car.next[1]);
    car.atLine = false;
    car.queued = false;
    if (there >= 0 && there !== here && car.holds !== there) {
      const c = net.clusters[there];
      const d = car.dOut;
      let go;
      if (c.signal) {
        // Through on the green, and on the amber if it is too late to stop.
        const light = signalFor(c, d, time);
        go = light === 'green' || (light === 'amber' && remain < 0.3 && car.v > 0.4);
      } else {
        // A full stop at the sign first; then whoever has waited longest.
        if (remain < 0.14 && car.v < 0.06) car.stopped += car.dt;
        go = car.stopped > STOP_WAIT && car.stopped >= c.longest - 0.05;
      }
      // Nobody goes in while cars from another way are still in the crossing, nor without room to come out the other side.
      const clear = [...c.ways.keys()].every((k) => k === d);
      if (go && clear) {
        const route = remain < 0.6 || !c.signal ? planThrough(car, there) : null;
        if (route && !blocked(route.exit)) {
          car.holds = there;
          car.approach = d;
          car.plan = route.plan;
          c.ways.set(d, (c.ways.get(d) ?? 0) + 1);
        } else if (route || !c.signal) { v = Math.min(v, stopAt(remain - 0.06)); car.atLine = true; }
      } else {
        v = Math.min(v, stopAt(remain - 0.06));
        car.atLine = true;
      }
    }
    // The car in front: anyone on the way this car is going (round the bend, if it is turning), not coming the other way.
    {
      const path = ahead(car);
      const gx = Math.floor(car.x), gz = Math.floor(car.z);
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        for (const o of grid.get((gx + ox) * 4096 + gz + oy) ?? []) {
          if (o === car) continue;
          let along = -1;
          for (const [px, pz, hx, hz, dist] of path) {
            if (Math.hypot(o.x - px, o.z - pz) > 0.16 || o.hx * hx + o.hz * hz < -0.5) continue;
            along = dist;
            break;
          }
          if (along < 0) continue;
          const gap = along - (car.size + o.size) / 2 - 0.12;
          const w = Math.min(stopAt(gap), Math.max(0, o.v + gap * 2));
          if (w < v) { v = w; if (o.v < 0.1 && (o.atLine || o.queued)) car.queued = true; }
        }
      }
    }
    return Math.max(0, v);
  };

  return {
    cars,
    get net() { return net; },
    get time() { return time; },
    /** Moves the cars on by `dt` seconds, and adds or takes away cars toward `want`. */
    step(dt, want = 0) {
      dt = Math.min(dt, 0.1);
      if ((world.netVersion ?? 0) !== ver || !net) {
        ver = world.netVersion ?? 0;
        net = survey(world);
        // The cars whose lane is still there drive on; the rest are gone.
        for (let i = cars.length - 1; i >= 0; i--) {
          const car = cars[i];
          const [nx, ny] = car.next;
          car.holds = clusterAt(car.cur[0], car.cur[1]);
          car.approach = car.dIn;
          car.plan = null;
          if (!net.road(car.cur[0], car.cur[1]) || !net.road(nx, ny) || wrongWay(net, nx, ny, car.dOut)) cars.splice(i, 1);
          else shape(net, car);
        }
      }
      time += dt;
      want = Math.min(want, Math.floor(net.tiles.length / 4));
      if (cars.length < want) spawn();
      while (cars.length > want) remove(cars.length - 1);
      // Who is in each crossing, by the way they came in; and who has waited longest at its stop signs.
      for (const c of net.clusters) { c.ways = new Map(); c.longest = 0; }
      for (const car of cars) {
        if (car.holds >= 0) { const c = net.clusters[car.holds]; c.ways.set(car.approach, (c.ways.get(car.approach) ?? 0) + 1); }
        if (car.atLine && car.next) { const t = clusterAt(car.next[0], car.next[1]); if (t >= 0) net.clusters[t].longest = Math.max(net.clusters[t].longest, car.stopped); }
      }
      const grid = new Map();
      for (const car of cars) {
        const k = Math.floor(car.x) * 4096 + Math.floor(car.z);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(car);
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        car.dt = dt;
        const top = limit(car, grid);
        car.v = top > car.v ? Math.min(top, car.v + ACCEL * dt) : Math.max(top, car.v - BRAKE * 1.6 * dt);
        // Gridlock happens: a car stuck behind another for a long while (not at a light) edges past.
        if (car.v < 0.02 && !car.atLine && !car.queued) car.stuck += dt; else car.stuck = 0;
        if (car.v < 0.02 && car.atLine) car.lineWait += dt; else if (car.v > 0.1) car.lineWait = 0;
        // Gridlock happens: a driver stuck for good, not in a queue that is moving, turns off into a driveway and is gone.
        if (car.stuck > 8 || car.lineWait > 40) { remove(i); continue; }
        car.s += (car.v * dt) / car.len;
        let ok = true;
        while (car.s >= 1 && ok) ok = advance(car);
        if (!ok) { remove(i); continue; }
        place(car);
        const [tx, ty] = car.cur;
        const deck = net.deck[idx(tx, ty)];
        car.y = Number.isNaN(deck) ? Math.max(heightAt(world, car.x, car.z), WATER_LEVEL) : deck;
      }
    },
  };
}
