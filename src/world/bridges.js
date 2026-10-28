import { WATER_LEVEL } from '../config.js';
import { heightAt, inb } from './world.js';

/**
 * How high a bridge's deck is along it. A deck runs straight from bank to
 * bank: from the ground at one end of its tiles to the ground at the
 * other, so it meets the road at both ends with no step, whatever the
 * banks do. The cars drive on it (`world/traffic.js`) and the bridge
 * is drawn on it (`render/gates.js`), so the two agree. Heights are of the
 * ground, as a road's are: the road surface is drawn a little above.
 */

/** The least a deck clears the water by. */
const CLEAR = 0.07;

/**
 * The ramp over a bridge's tiles (indices into the map): the axis it runs
 * along, where its tiles start and end along it, and the heights there.
 */
export function rampOver(world, tiles) {
  const N = world.size;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of tiles) {
    const x = t % N, y = Math.floor(t / N);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
  }
  // Along its longer side; a square one (a single tile) the way the road goes on from it.
  const road = (x, y) => inb(x, y) && world.road[y * N + x] > 0;
  const alongX = x1 - x0 !== y1 - y0 ? x1 - x0 > y1 - y0 : road(x0 - 1, y0) || road(x1, y0);
  const [s0, s1] = alongX ? [x0, x1] : [y0, y1];
  const mid = alongX ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const bank = (s) => {
    const [px, pz] = alongX ? [s, mid] : [mid, s];
    const h = inb(Math.floor(px), Math.floor(pz)) ? heightAt(world, px, pz) : WATER_LEVEL;
    return Math.max(h, WATER_LEVEL + CLEAR);
  };
  return { alongX, s0, s1, h0: bank(s0), h1: bank(s1) };
}

/** The deck's height at (x, z) on a ramp; off its ends, the height at that end (or, with `extend`, the slope carried on). */
export function deckAt(ramp, x, z, { extend = false } = {}) {
  const s = ramp.alongX ? x : z;
  const f = (s - ramp.s0) / (ramp.s1 - ramp.s0);
  const t = extend ? f : Math.min(1, Math.max(0, f));
  return ramp.h0 + (ramp.h1 - ramp.h0) * t;
}
