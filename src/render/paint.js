import { fractal, grey, pair, pixels, random, smoothstep } from 'madness-engine/textures/painters';

/**
 * The textures the engine's painters don't have: the roofs (thatch, clay
 * tile, shingle) and the ripples of the water. Each is painted with the
 * engine's own helpers, as a map and a bump map that tile.
 */

/** Thatch: bundles of straw laid in courses, each strand running down the slope. */
export function thatch(GFX) {
  const strands = fractal(301, 24, 2);
  const blot = fractal(307, 4, 3);
  const rnd = random(311);
  const courses = 8;
  const shift = Array.from({ length: courses }, () => rnd());
  const paint = (relief) => (size) => pixels(size, (u, v) => {
    const c = Math.floor(v * courses), f = (v * courses) % 1;
    const uu = u + shift[c];
    // Straw runs down the slope (along v), so the strands change quickly along u and slowly along v.
    const s = strands(uu * 2, v * 0.6 + c * 0.13);
    const fine = 0.5 + 0.5 * Math.sin(uu * Math.PI * 2 * 38 + s * 9);
    const lip = smoothstep(0.78, 1, f);
    const base = 0.62 + blot(u, v) * 0.22 + (fine - 0.5) * 0.18;
    const k = relief ? 0.35 + f * 0.5 + fine * 0.18 : base * (1 - lip * 0.35) * (f < 0.05 ? 0.7 : 1);
    return grey(Math.round(255 * Math.min(1, k)));
  });
  return pair(GFX, 256, paint(false), paint(true));
}

/** Clay roof tiles: curved, overlapping, in courses, each a slightly different shade. */
export function roofTile(GFX) {
  const n = fractal(313, 6, 3);
  const rnd = random(317);
  const rows = 8, across = 6;
  const tones = Array.from({ length: rows * across }, () => 0.78 + rnd() * 0.22);
  const paint = (relief) => (size) => pixels(size, (u, v) => {
    const r = Math.floor(v * rows), f = (v * rows) % 1;
    const uu = u * across + (r % 2) * 0.5;
    const c = Math.floor(uu), fu = uu - c;
    // Each tile is round at its foot, the next course lying over its head.
    const round = Math.sqrt(Math.max(0, 1 - (fu * 2 - 1) ** 2));
    const foot = smoothstep(0.55, 1, f) * (1 - round * 0.5);
    const edge = Math.min(fu, 1 - fu) < 0.04;
    const tone = tones[(r * across + (c % across + across) % across) % tones.length];
    const k = relief ? (edge ? 0.15 : 0.4 + round * 0.45 - foot * 0.35 + f * 0.1) : (edge ? 0.3 : tone * (0.82 + n(u, v) * 0.18) * (1 - foot * 0.28 + round * 0.06));
    return grey(Math.round(255 * Math.min(1, Math.max(0, k))));
  });
  return pair(GFX, 256, paint(false), paint(true));
}

/** Wooden shingles or slates: flat, square-ended, in courses with the joints staggered. */
export function shingle(GFX) {
  const n = fractal(331, 8, 3);
  const rnd = random(337);
  const rows = 10, across = 7;
  const tones = Array.from({ length: rows * across }, () => 0.7 + rnd() * 0.3);
  const paint = (relief) => (size) => pixels(size, (u, v) => {
    const r = Math.floor(v * rows), f = (v * rows) % 1;
    const uu = u * across + ((r * 0.37) % 1);
    const c = Math.floor(uu), fu = uu - c;
    const joint = fu < 0.05 || f < 0.06;
    const lip = smoothstep(0.7, 1, f);
    const tone = tones[(r * across + ((c % across) + across) % across) % tones.length];
    const k = relief ? (joint ? 0.1 : 0.45 + f * 0.4) : (joint ? 0.28 : tone * (0.84 + n(u, v) * 0.16) * (1 - lip * 0.3));
    return grey(Math.round(255 * Math.min(1, k)));
  });
  return pair(GFX, 256, paint(false), paint(true));
}

/** Ripples: a few waves crossing, warped, that tile. Moves by its offset, not by repainting. */
export function ripples(GFX) {
  const warp = fractal(347, 4, 3);
  const fine = fractal(349, 10, 2);
  return pair(GFX, 256, () => pixels(256, () => grey(200)), (size) => pixels(size, (u, v) => {
    const w = warp(u, v) * 2.2;
    const a = Math.sin((u * 5 + v * 2 + w) * Math.PI * 2);
    const b = Math.sin((u * 3 - v * 6 + w * 1.3) * Math.PI * 2);
    const c = Math.sin((v * 9 + u + w * 0.7) * Math.PI * 2);
    const k = 0.5 + 0.22 * a + 0.18 * b + 0.1 * c + (fine(u, v) - 0.5) * 0.25;
    return grey(Math.round(255 * Math.min(1, Math.max(0, k))));
  }));
}
