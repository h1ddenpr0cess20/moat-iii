import { FLOORS, ashlar, bedrock, clapboard, cobble, hedge, rubble, stucco, tiled, timber } from 'madness-engine/textures/painters';
import { ripples, roofTile, shingle, thatch } from './paint.js';

/**
 * Every material the world is drawn with, made once. Solid things carry their
 * color in their vertices and take their grain from a texture, so one
 * material serves cottages of any color. The leaves are a few materials
 * whose color the seasons turn.
 */

export function createMaterials(GFX) {
  const repeat = (t) => tiled(GFX, t, 1, 1);
  const textured = (pair, extra = {}) => new GFX.MeshStandardMaterial({
    vertexColors: true, map: repeat(pair.map), bumpMap: repeat(pair.bump), bumpScale: 1.1, roughness: 0.9, metalness: 0, ...extra,
  });

  const tex = {
    stucco: stucco(GFX), ashlar: ashlar(GFX), rubble: rubble(GFX), bedrock: bedrock(GFX), timber: timber(GFX), clapboard: clapboard(GFX), cobble: cobble(GFX), hedge: hedge(GFX),
    planks: FLOORS.planks(GFX), grass: FLOORS.grass(GFX), dirt: FLOORS.dirt(GFX), sand: FLOORS.sand(GFX), snow: FLOORS.snow(GFX),
    scree: FLOORS.scree(GFX), mud: FLOORS.mud(GFX),
    thatch: thatch(GFX), roofTile: roofTile(GFX), shingle: shingle(GFX), ripples: ripples(GFX),
  };

  const mat = {
    plaster: textured(tex.stucco, { bumpScale: 0.9 }),
    // Dressed stone in level courses, for walls, towers and trim; rubble, rough fieldstone, for footings and humble walling.
    stone: textured(tex.ashlar, { bumpScale: 1.2, roughness: 0.92 }),
    rubble: textured(tex.rubble, { bumpScale: 1.6, roughness: 0.96 }),
    // Natural rock: weathered grain, no mortar and no dark veins in it.
    rock: textured(tex.bedrock, { bumpScale: 1.8, roughness: 0.96 }),
    timber: textured(tex.timber, { bumpScale: 1.1 }),
    wood: textured(tex.planks, { bumpScale: 0.8, roughness: 0.85 }),
    siding: textured(tex.clapboard, { bumpScale: 1.0 }),
    thatch: textured(tex.thatch, { bumpScale: 1.6, roughness: 1 }),
    tile: textured(tex.roofTile, { bumpScale: 1.5, roughness: 0.7 }),
    slate: textured(tex.shingle, { bumpScale: 1.2, roughness: 0.75 }),
    hedge: textured(tex.hedge, { bumpScale: 1.4, roughness: 0.9 }),
    metal: new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.85 }),
    plain: new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    cloth: new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: GFX.DoubleSide }),
    glass: new GFX.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.03 }),
    // Lit windows and fires: added to the picture, so they are nothing by day.
    glow: new GFX.MeshBasicMaterial({ vertexColors: true, color: new GFX.Color(0x000000), transparent: true, blending: GFX.AdditiveBlending, depthWrite: false, toneMapped: false }),
    flame: new GFX.MeshBasicMaterial({ vertexColors: true, color: new GFX.Color(0xffffff), transparent: true, blending: GFX.AdditiveBlending, depthWrite: false, toneMapped: false, side: GFX.DoubleSide }),
    bark: new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: repeat(tex.timber.map), bumpMap: repeat(tex.timber.bump), bumpScale: 1.2 }),
    leafA: textured(tex.hedge, { roughness: 0.82, bumpScale: 1.6, color: new GFX.Color('#5f9a3a') }),
    leafB: textured(tex.hedge, { roughness: 0.82, bumpScale: 1.6, color: new GFX.Color('#78b043') }),
    leafC: textured(tex.hedge, { roughness: 0.82, bumpScale: 1.6, color: new GFX.Color('#4f8a34') }),
    needle: textured(tex.hedge, { roughness: 0.88, bumpScale: 1.8, color: new GFX.Color('#285c33') }),
  };
  // The trim of a wall (the beams of half-timbering, the bars of a window, the frame of a door) is timber, but is a few centimetres across, finer than the shadow map can draw, and can only throw a speckle of shadow on the wall beside it. It is its own part, so that it can take shadows without throwing any.
  mat.trim = mat.timber;
  // Only the plain-colored materials have no texture coordinates to read.
  return { tex, mat };
}

/** The parts of a model that are left out of the shadow map: what is added to the picture, what shows through, and what is too fine to be drawn there. */
const NO_SHADOW = new Set(['glow', 'glass', 'flame', 'trim']);
export const castsShadow = (name) => !NO_SHADOW.has(name);

/** The leaves' colors through the year: spring, summer, autumn, and what is left in winter. */
const LEAVES = {
  leafA: ['#a4d05a', '#5f9a3a', '#dc8a2a', '#6a5a44'],
  leafB: ['#b9de6c', '#78b043', '#e8c53c', '#7a6a50'],
  leafC: ['#92c656', '#4f8a34', '#c9452a', '#5a4a3a'],
  needle: ['#2f6a3c', '#285c33', '#27583a', '#c8dce4'],
};

/**
 * Colors the leaves for a moment of the year: `season` 0 to 3 and `k` 0 to 1
 * how far through it. Each season's color gives way to the next's over its
 * last stretch. Deciduous trees go bare through the winter; conifers take snow.
 */
export function colorLeaves(materials, GFX, season, k) {
  const { mat } = materials;
  const t = Math.max(0, (k - 0.55) / 0.45);
  for (const [name, palette] of Object.entries(LEAVES)) {
    mat[name].color.lerpColors(new GFX.Color(palette[season]), new GFX.Color(palette[(season + 1) % 4]), t);
    if (name !== 'needle') mat[name].visible = !(season === 3 || (season === 2 && k > 0.85));
  }
}
