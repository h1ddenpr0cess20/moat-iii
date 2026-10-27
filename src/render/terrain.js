import { CHUNK, CHUNKS, GROUND, SIZE, WARD, WATER_LEVEL } from '../config.js';
import { tiled } from 'madness-engine/textures/painters';
import { FARM_ZONES, ZONE_ID } from '../catalog.js';
import { fbm, smoothstep } from '../rng.js';
import { baseHeight } from '../world/generate.js';
import { HV, SUB, heightAt, idx } from '../world/world.js';
import { freeGeometry } from './dispose.js';

/**
 * The ground: a smooth heightfield cut into chunks the size of a ward, each
 * drawn with a texture painted for it from what the land is — grass lush or
 * thin as the soil is, the floor of the forest, rock where it is steep, snow
 * on the high mountains, sand and wet mud about the water, bare earth where
 * people have been. Beyond the edge of the map the mountains go on, cheaply.
 */

/** Pixels the ground texture has to a tile, and how many tiles around a chunk it paints so that chunks join. */
const PX = 16;
const MARGIN = 1;
const SPAN = CHUNK + MARGIN * 2;
const SIDE = SPAN * PX;

/** Tiles a chunk's own data covers: its own, and two more all around for the soft edges. */
const PAD = 2;
const DATA = CHUNK + PAD * 2;

const lerp = (a, b, t) => a + (b - a) * t;

/** The zones that are plowed ground, painted as earth under the crops. */
const FIELD_IDS = new Set(FARM_ZONES.map((z) => ZONE_ID[z]));

let blotCache = null;
/** One tile of low-frequency noise (64 tiles across), shared by every chunk. */
function blotTable() {
  if (blotCache) return blotCache;
  const N = 256;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Wrapped by blending the noise with itself shifted half a period: cheap and seamless.
      const a = fbm(x / 22, y / 22, 11, 4), b = fbm((x - N) / 22, y / 22, 11, 4), c = fbm(x / 22, (y - N) / 22, 11, 4), d = fbm((x - N) / 22, (y - N) / 22, 11, 4);
      const u = x / N, v = y / N;
      out[y * N + x] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
  }
  blotCache = { N, data: out };
  return blotCache;
}

/** A texture's luminance as a flat array, for painting with. Null where there is no canvas (under node). */
function luminance(texture) {
  const image = texture?.image;
  if (!image?.getContext) return null;
  const { width, height } = image;
  const px = image.getContext('2d').getImageData(0, 0, width, height).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
  return { data: out, w: width, h: height };
}

const COLORS = {
  dry: [150, 142, 82], lush: [92, 140, 58], forest: [52, 70, 36], litter: [92, 72, 40], dirt: [134, 102, 66], mud: [66, 52, 38],
  sand: [210, 192, 146], rock: [134, 128, 120], rockDark: [92, 88, 84], snow: [238, 244, 250], wet: [84, 70, 50], foam: [230, 238, 235], scree: [150, 140, 126],
};

/** Everything a chunk's painter looks at, gathered once: the tile data with a margin, and the heights. */
function gather(world, cx, cy) {
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const n = DATA * DATA;
  const forest = new Float32Array(n), rock = new Float32Array(n), fert = new Float32Array(n), sand = new Float32Array(n);
  const bank = new Float32Array(n), dirt = new Float32Array(n), water = new Float32Array(n), field = new Float32Array(n);
  const bld = new Uint8Array(n);
  for (let j = 0; j < DATA; j++) {
    for (let i = 0; i < DATA; i++) {
      const x = Math.max(0, Math.min(SIZE - 1, x0 - PAD + i)), y = Math.max(0, Math.min(SIZE - 1, y0 - PAD + j));
      const t = idx(x, y), k = j * DATA + i;
      const g = world.ground[t];
      forest[k] = world.tree[t] ? 0.55 + world.tree[t] * 0.15 : 0;
      rock[k] = g === GROUND.ROCK || g === GROUND.ORE ? 1 : g === GROUND.CLIFF ? 0.8 : 0;
      fert[k] = world.fert[t] / 255;
      sand[k] = g === GROUND.SAND ? 1 : 0;
      bank[k] = world.moat[t] === 2 ? 1 : 0;
      water[k] = g === GROUND.WATER || world.moat[t] === 1 ? 1 : 0;
      bld[k] = world.bld[t] ? 1 : 0;
      field[k] = FIELD_IDS.has(world.zone[t]) ? 1 : 0;
    }
  }
  for (let j = 1; j < DATA - 1; j++) {
    for (let i = 1; i < DATA - 1; i++) {
      const k = j * DATA + i;
      dirt[k] = bld[k] ? 1 : (bld[k - 1] || bld[k + 1] || bld[k - DATA] || bld[k + DATA]) ? 0.55 : 0;
      if (field[k]) dirt[k] = Math.max(dirt[k], 0.7);
    }
  }
  // Heights over the chunk and a tile all around, a vertex every half tile, and the slope at each.
  const hs = SPAN * SUB + 1;
  const H = new Float32Array(hs * hs), S = new Float32Array(hs * hs);
  const hx0 = (x0 - MARGIN) * SUB, hy0 = (y0 - MARGIN) * SUB;
  const at = (vx, vy) => world.h[Math.max(0, Math.min(HV - 1, vy)) * HV + Math.max(0, Math.min(HV - 1, vx))];
  for (let j = 0; j < hs; j++) for (let i = 0; i < hs; i++) H[j * hs + i] = at(hx0 + i, hy0 + j);
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < hs; i++) {
      const dx = (at(hx0 + i + 1, hy0 + j) - at(hx0 + i - 1, hy0 + j)) * SUB / 2, dz = (at(hx0 + i, hy0 + j + 1) - at(hx0 + i, hy0 + j - 1)) * SUB / 2;
      S[j * hs + i] = Math.hypot(dx, dz);
    }
  }
  return { x0, y0, forest, rock, fert, sand, bank, dirt, water, H, S, hs };
}

/**
 * Paints a chunk's ground. `sources` are the luminance arrays of the engine's grass, dirt and rock textures.
 * `box` ([x0, y0, x1, y1] in tiles) paints only the ground around those tiles, for a change that touched a few.
 */
function paint(world, cx, cy, sources, canvas, box = null) {
  const d = gather(world, cx, cy);
  const ctx = canvas.getContext('2d');
  // A tile's look blends into its neighbors two tiles out (the soft edges, the trodden earth around a wall).
  const B = 2;
  const toPx = (t) => Math.max(0, Math.min(SIDE, Math.floor((t - (cx * CHUNK - MARGIN)) * PX / B) * B));
  const [px0, py0, px1, py1] = box ? [toPx(box[0] - 2), toPx(box[1] - 2), toPx(box[2] + 3), toPx(box[3] + 3)] : [0, 0, SIDE, SIDE];
  if (px1 <= px0 || py1 <= py0) return;
  const W = px1 - px0;
  const image = ctx.createImageData(W, py1 - py0);
  const out = image.data;
  const blot = blotTable();
  const grass = sources.grass, dirtL = sources.dirt, rockL = sources.rock;
  const inv = 1 / PX;
  const wx0 = d.x0 - MARGIN, wy0 = d.y0 - MARGIN;
  const tileAt = (arr, wx, wz) => {
    // Bilinear between tile centers.
    const u = wx - d.x0 + PAD - 0.5, v = wz - d.y0 + PAD - 0.5;
    const i = Math.max(0, Math.min(DATA - 2, Math.floor(u))), j = Math.max(0, Math.min(DATA - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i)), fv = Math.max(0, Math.min(1, v - j));
    const k = j * DATA + i;
    return (arr[k] * (1 - fu) + arr[k + 1] * fu) * (1 - fv) + (arr[k + DATA] * (1 - fu) + arr[k + DATA + 1] * fu) * fv;
  };
  const sampleSub = (arr, wx, wz) => {
    const u = (wx - wx0) * SUB, v = (wz - wy0) * SUB;
    const i = Math.max(0, Math.min(d.hs - 2, Math.floor(u))), j = Math.max(0, Math.min(d.hs - 2, Math.floor(v)));
    const fu = u - i, fv = v - j;
    const k = j * d.hs + i;
    return (arr[k] * (1 - fu) + arr[k + 1] * fu) * (1 - fv) + (arr[k + d.hs] * (1 - fu) + arr[k + d.hs + 1] * fu) * fv;
  };
  const attr = new Float32Array(6);
  for (let by = py0; by < py1; by += B) {
    for (let bx = px0; bx < px1; bx += B) {
      // What the tiles say changes slowly, so it is looked up once for each block of pixels.
      const mx = wx0 + (bx + B / 2) * inv, mz = wy0 + (by + B / 2) * inv;
      attr[0] = tileAt(d.forest, mx, mz); attr[1] = tileAt(d.rock, mx, mz); attr[2] = tileAt(d.fert, mx, mz);
      attr[3] = tileAt(d.sand, mx, mz); attr[4] = tileAt(d.bank, mx, mz); attr[5] = tileAt(d.dirt, mx, mz);
      const forest = attr[0], rockA = attr[1], fert = attr[2], sandA = attr[3], bank = attr[4], dirtA = attr[5];
      for (let py = by; py < by + B; py++) {
        const wz = wy0 + (py + 0.5) * inv;
        for (let px = bx; px < bx + B; px++) {
          const wx = wx0 + (px + 0.5) * inv;
          const h = sampleSub(d.H, wx, wz);
          const slope = sampleSub(d.S, wx, wz);
          const b = blot.data[(Math.floor(wz * 4) & 255) * blot.N + (Math.floor(wx * 4) & 255)];
          const micro = grass ? grass.data[(Math.floor(wz * 16) & 255) * grass.w + (Math.floor(wx * 16) & 255)] : 0.7;
          const micro2 = dirtL ? dirtL.data[(Math.floor(wz * 16 + 97) & 255) * dirtL.w + (Math.floor(wx * 16 + 31) & 255)] : 0.7;
          const stone = rockL ? rockL.data[(Math.floor(wz * 8) & 255) * rockL.w + (Math.floor(wx * 8) & 255)] : 0.7;

          // Steep ground is rock, but not the banks of a moat, which are earth.
          let wRock = Math.min(1, smoothstep(0.7, 1.2, slope) * smoothstep(0.6, 1.8, h) * (1 - bank * 0.9) + rockA * 0.95);
          const wSnow = smoothstep(7.2, 9.2, h + (b - 0.5) * 2.2) * (1 - 0.65 * smoothstep(0.7, 1.3, slope));
          const wMud = smoothstep(0.1, -0.35, h);
          const wWet = smoothstep(0.5, 0.0, h) * (1 - wMud) * 0.8;
          const wSand = sandA * (1 - wRock) * smoothstep(0.9, 0.3, h + (b - 0.5) * 0.3);
          const wForest = forest * (1 - wRock) * (1 - wSnow);
          const wDirt = Math.min(1, dirtA * 0.9 + bank * 0.45) * (1 - wRock);
          wRock *= 1 - wSnow * 0.5;
          const wGrass = Math.max(0.05, 1 - wRock - wSnow - wMud - wWet - wSand - wForest - wDirt);
          const wsum = wGrass + wRock + wSnow + wMud + wWet + wSand + wForest + wDirt;

          const lush = Math.min(1, fert * 1.1 + 0.1);
          // Patches of the meadow are lighter or darker, yellower or greener.
          const gm = 0.62 + 0.8 * micro * micro + 0.1, gb = 0.8 + 0.4 * b;
          let r = 0, g = 0, bl = 0;
          const add = (w, c, k) => { r += w * c[0] * k; g += w * c[1] * k; bl += w * c[2] * k; };
          const gr = lerp(COLORS.dry[0], COLORS.lush[0], lush) * (1 + (b - 0.5) * 0.25), gg = lerp(COLORS.dry[1], COLORS.lush[1], lush), gbl = lerp(COLORS.dry[2], COLORS.lush[2], lush) * (1 - (b - 0.5) * 0.2);
          add(wGrass, [gr, gg, gbl], gm * gb);
          add(wForest, b > 0.62 ? COLORS.litter : COLORS.forest, 0.7 + 0.5 * micro);
          add(wDirt, COLORS.dirt, 0.75 + 0.45 * micro2);
          add(wMud, COLORS.mud, 0.7 + 0.4 * micro2);
          add(wWet, COLORS.wet, 0.75 + 0.35 * micro2);
          add(wSand, COLORS.sand, 0.85 + 0.2 * micro2);
          const strata = 0.7 + 0.45 * Math.sin(h * 4.5 + b * 5) * 0.5 + 0.3 * stone;
          add(wRock, slope > 0.9 ? COLORS.rockDark : COLORS.rock, strata);
          add(wSnow, COLORS.snow, 0.92 + 0.1 * micro2);
          r /= wsum; g /= wsum; bl /= wsum;
          // A line of foam where the water meets the shore.
          const foam = smoothstep(0.09, 0.0, Math.abs(h - WATER_LEVEL + 0.02)) * 0.45 * (1 - wRock);
          r = lerp(r, COLORS.foam[0], foam); g = lerp(g, COLORS.foam[1], foam); bl = lerp(bl, COLORS.foam[2], foam);
          const o = ((py - py0) * W + px - px0) * 4;
          out[o] = r > 255 ? 255 : r; out[o + 1] = g > 255 ? 255 : g; out[o + 2] = bl > 255 ? 255 : bl; out[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(image, px0, py0);
}

/** The seasons' tints on the ground: spring, summer, autumn, winter. */
export const GROUND_TINT = ['#f3ffd8', '#ffffff', '#f2c690', '#cfdceb'];

export function createTerrain(GFX, world, materials, scene) {
  const { tex } = materials;
  const group = new GFX.Group();
  group.name = 'terrain';
  scene.add(group);
  const sources = { grass: luminance(tex.grass.map), dirt: luminance(tex.dirt.map), rock: luminance(tex.scree.map) };
  const chunks = [];
  const skirt = [];

  const makeMaterial = (canvas, cx, cy) => {
    const map = new GFX.CanvasTexture(canvas);
    map.colorSpace = GFX.SRGBColorSpace;
    map.anisotropy = 8;
    // The mesh's v runs down the chunk as the canvas's rows do: left flipped (the default), each chunk's ground ran backwards and met its neighbor in a seam.
    map.flipY = false;
    // A bump of its own, shifted so the grain runs on across chunks.
    const bump = new GFX.CanvasTexture(tex.grass.bump.image);
    bump.wrapS = bump.wrapT = GFX.RepeatWrapping;
    const period = 4;
    bump.repeat.set(SPAN / period, SPAN / period);
    bump.offset.set((((cx * CHUNK - MARGIN) % period) + period) % period / period, (((cy * CHUNK - MARGIN) % period) + period) % period / period);
    bump.anisotropy = 8;
    const material = new GFX.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.9, roughness: 0.97, metalness: 0 });
    return { material, map };
  };

  /** The mesh for a chunk's ground. */
  const geometryFor = (cx, cy) => {
    const n = CHUNK * SUB + 1;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    const at = (vx, vy) => world.h[Math.max(0, Math.min(HV - 1, vy)) * HV + Math.max(0, Math.min(HV - 1, vx))];
    const step = 1 / SUB;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const vx = x0 * SUB + i, vy = y0 * SUB + j;
        const k = j * n + i;
        pos[k * 3] = x0 + i * step;
        pos[k * 3 + 1] = at(vx, vy);
        pos[k * 3 + 2] = y0 + j * step;
        const dx = (at(vx + 1, vy) - at(vx - 1, vy)) / (2 * step), dz = (at(vx, vy + 1) - at(vx, vy - 1)) / (2 * step);
        const l = Math.hypot(dx, 1, dz);
        nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
        uv[k * 2] = (i * step + MARGIN) / SPAN;
        uv[k * 2 + 1] = (j * step + MARGIN) / SPAN;
      }
    }
    const index = new Uint16Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index[o++] = a; index[o++] = d; index[o++] = b;
        index[o++] = a; index[o++] = c; index[o++] = d;
      }
    }
    const g = new GFX.BufferGeometry();
    g.setAttribute('position', new GFX.BufferAttribute(pos, 3));
    g.setAttribute('normal', new GFX.BufferAttribute(nor, 3));
    g.setAttribute('uv', new GFX.BufferAttribute(uv, 2));
    g.setIndex(new GFX.Uint16BufferAttribute(index, 1));
    g.computeBoundingSphere();
    return g;
  };

  for (let cy = 0; cy < CHUNKS; cy++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIDE;
      const { material, map } = makeMaterial(canvas, cx, cy);
      const mesh = new GFX.Mesh(geometryFor(cx, cy), material);
      mesh.receiveShadow = true;
      mesh.name = `ground ${cx},${cy}`;
      group.add(mesh);
      // Snow lies over the ground in winter.
      const snow = new GFX.Mesh(mesh.geometry, new GFX.MeshStandardMaterial({ color: new GFX.Color('#f2f6fb'), roughness: 0.9, transparent: true, opacity: 0, depthWrite: false, map: tiled(GFX, tex.snow.map, SPAN / 6) }));
      snow.position.y = 0.012;
      snow.receiveShadow = true;
      snow.visible = false;
      snow.renderOrder = 1;
      group.add(snow);
      chunks.push({ cx, cy, canvas, map, mesh, snow, painted: false });
    }
  }

  // The mountains around the map, in low detail: a ring of chunks two deep. They are colored by the rules the painted
  // ground uses (in sRGB, as the paint is, then made linear for the vertex colors), and where they meet the map they
  // take the map's own heights and ease from them into the mountains, so no seam or step runs around the border.
  // Four deep, so that drawn right out the land does not end in sky: the outer two at half the detail.
  const RING = 4;
  const EASE = 4;
  const skirtMaterial = new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 });
  const lin = (c) => Math.pow(c / 255, 2.2);
  const HAZE = [1, 3, 5].map((i) => lin(parseInt('#8c9eab'.slice(i, i + 2), 16)));
  const toLin = (c) => c.map(lin);
  const PAL = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, toLin(c)]));
  const edgeHeight = (x, z) => heightAt(world, Math.max(0, Math.min(SIZE, x)), Math.max(0, Math.min(SIZE, z)));
  const skirtHeight = (x, z) => {
    const out = Math.max(0, -x, x - SIZE, -z, z - SIZE);
    const base = baseHeight(world.seed, x, z);
    if (out >= EASE) return base;
    return lerp(edgeHeight(x, z), base, smoothstep(0, EASE, out));
  };
  const skirtColor = (x, z, y, slope, out) => {
    const b = fbm(x / 9, z / 9, world.seed + 3, 2);
    const wRock = Math.min(1, smoothstep(0.7, 1.2, slope) * smoothstep(0.6, 1.8, y));
    const wSnow = smoothstep(7.2, 9.2, y + (b - 0.5) * 2.2) * (1 - 0.65 * smoothstep(0.7, 1.3, slope));
    const wForest = smoothstep(5.5, 3, y) * 0.55 * smoothstep(0.35, 0.65, b) * (1 - wRock);
    const wGrass = Math.max(0.05, 1 - wRock - wSnow - wForest);
    const grass = PAL.dry.map((c, i) => lerp(c, PAL.lush[i], 0.55 + 0.3 * (b - 0.5)));
    const rock = slope > 0.9 ? PAL.rockDark : PAL.rock;
    const sum = wGrass + wRock * (1 - wSnow * 0.5) + wSnow + wForest;
    // Far out, the mountains fade into the blue of the distance, so the ring does not end in a hard line.
    const haze = smoothstep(CHUNK * 0.8, CHUNK * RING, out) * 0.75;
    return [0, 1, 2].map((i) => lerp((grass[i] * wGrass + rock[i] * wRock * (1 - wSnow * 0.5) + PAL.snow[i] * wSnow + PAL.forest[i] * wForest) / sum, HAZE[i], haze));
  };
  const skirtIndex = (n) => {
    const index = new Uint16Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index[o++] = a; index[o++] = d; index[o++] = b;
        index[o++] = a; index[o++] = c; index[o++] = d;
      }
    }
    return index;
  };
  const skirtGeometry = (cx, cy) => {
    const ring = Math.max(-cx, cx - CHUNKS + 1, -cy, cy - CHUNKS + 1);
    const step = ring > 2 ? 2 : 1;
    const n = CHUNK / step + 1;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx * CHUNK + i * step, z = cy * CHUNK + j * step, k = j * n + i;
        const y = skirtHeight(x, z);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const dx = (skirtHeight(x + 1, z) - skirtHeight(x - 1, z)) / 2, dz = (skirtHeight(x, z + 1) - skirtHeight(x, z - 1)) / 2;
        const l = Math.hypot(dx, 1, dz);
        nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
        col.set(skirtColor(x, z, y, Math.hypot(dx, dz), Math.max(0, -x, x - SIZE, -z, z - SIZE)), k * 3);
      }
    }
    const g = new GFX.BufferGeometry();
    g.setAttribute('position', new GFX.BufferAttribute(pos, 3));
    g.setAttribute('normal', new GFX.BufferAttribute(nor, 3));
    g.setAttribute('color', new GFX.BufferAttribute(col, 3));
    g.setIndex(new GFX.Uint16BufferAttribute(skirtIndex(n), 1));
    g.computeBoundingSphere();
    return g;
  };
  const skirtAt = new Map();
  for (let cy = -RING; cy < CHUNKS + RING; cy++) {
    for (let cx = -RING; cx < CHUNKS + RING; cx++) {
      if (cx >= 0 && cy >= 0 && cx < CHUNKS && cy < CHUNKS) continue;
      const mesh = new GFX.Mesh(skirtGeometry(cx, cy), skirtMaterial);
      mesh.receiveShadow = true;
      mesh.name = `skirt ${cx},${cy}`;
      group.add(mesh);
      skirt.push(mesh);
      skirtAt.set(`${cx},${cy}`, mesh);
    }
  }

  // A curtain hung under the border: the map has a vertex every half tile and the mountains every tile, so between
  // them a sliver of sky could show through. The curtain runs down from the map's edge, colored as the ground there.
  const curtainGeometry = () => {
    const pts = [];
    const step = 1 / SUB;
    for (let t = 0; t < SIZE; t += step) pts.push([t, 0], [t + step, 0]);
    for (let t = 0; t < SIZE; t += step) pts.push([SIZE, t], [SIZE, t + step]);
    for (let t = SIZE; t > 0; t -= step) pts.push([t, SIZE], [t - step, SIZE]);
    for (let t = SIZE; t > 0; t -= step) pts.push([0, t], [0, t - step]);
    const pos = [], nor = [], col = [];
    for (let k = 0; k < pts.length; k += 2) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const ay = edgeHeight(ax, az), by = edgeHeight(bx, bz);
      const c = skirtColor(ax, az, ay, 0.3, 0);
      const quad = [[ax, ay + 0.02, az], [bx, by + 0.02, bz], [bx, by - 2.5, bz], [ax, ay + 0.02, az], [bx, by - 2.5, bz], [ax, ay - 2.5, az]];
      for (const q of quad) { pos.push(...q); nor.push(0, 1, 0); col.push(...c.map((v) => v * 0.8)); }
    }
    const g = new GFX.BufferGeometry();
    g.setAttribute('position', new GFX.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new GFX.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('color', new GFX.BufferAttribute(new Float32Array(col), 3));
    g.computeBoundingSphere();
    return g;
  };
  const curtain = new GFX.Mesh(curtainGeometry(), new GFX.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: GFX.DoubleSide }));
  curtain.name = 'border curtain';
  group.add(curtain);

  /** The mountains and the curtain beside a chunk of the map on its edge, made again after the map's heights there change. */
  const reskirt = (cx, cy) => {
    if (cx > 0 && cy > 0 && cx < CHUNKS - 1 && cy < CHUNKS - 1) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const mesh = skirtAt.get(`${cx + dx},${cy + dy}`);
        if (!mesh) continue;
        freeGeometry(mesh.geometry);
        mesh.geometry = skirtGeometry(cx + dx, cy + dy);
      }
    }
    freeGeometry(curtain.geometry);
    curtain.geometry = curtainGeometry();
  };

  const terrain = {
    group, chunks, skirt, WARD,
    chunk: (cx, cy) => chunks[cy * CHUNKS + cx],

    /** Paints every chunk's ground, the nearest to (x, y) first, giving the page a breath between chunks. */
    async paintAll(near = [SIZE / 2, SIZE / 2], progress = () => {}) {
      const order = [...chunks].sort((a, b) => Math.hypot((a.cx + 0.5) * CHUNK - near[0], (a.cy + 0.5) * CHUNK - near[1]) - Math.hypot((b.cx + 0.5) * CHUNK - near[0], (b.cy + 0.5) * CHUNK - near[1]));
      let n = 0;
      for (const c of order) {
        paint(world, c.cx, c.cy, sources, c.canvas);
        c.map.needsUpdate = true;
        c.painted = true;
        progress(++n / order.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      world.dirty.ground.clear();
      world.dirty.terrain.clear();
      world.groundBox?.clear();
    },

    /** Redraws what has changed in the land, a chunk or two at a time. */
    sync(budget = 2) {
      let spent = 0;
      for (const i of [...world.dirty.terrain]) {
        const c = chunks[i];
        world.dirty.terrain.delete(i);
        const geometry = geometryFor(c.cx, c.cy);
        freeGeometry(c.mesh.geometry);
        c.mesh.geometry = geometry;
        c.snow.geometry = geometry;
        reskirt(c.cx, c.cy);
        // The heights have changed, and the ground over them is painted again: only around what changed, for every
        // change of height is touched with a box of ground. Without one (the whole map at once), the whole chunk is.
        world.dirty.ground.add(i);
        spent += 0.2;
        if (spent >= budget) return;
      }
      for (const i of [...world.dirty.ground]) {
        const c = chunks[i];
        world.dirty.ground.delete(i);
        const box = world.groundBox?.get(i) ?? null;
        world.groundBox?.delete(i);
        if (!c.painted) continue;
        paint(world, c.cx, c.cy, sources, c.canvas, box);
        c.map.needsUpdate = true;
        // A few tiles' worth of painting is cheap; a whole chunk is the budget's full share.
        spent += box ? Math.min(1, ((box[2] - box[0] + 5) * (box[3] - box[1] + 5)) / (SPAN * SPAN)) : 1;
        if (spent >= budget) return;
      }
    },

    /** The ground in a season: its tint, and how much snow lies on it. */
    setSeason(season, k, snow) {
      const tint = new GFX.Color(GROUND_TINT[season]);
      const next = new GFX.Color(GROUND_TINT[(season + 1) % 4]);
      const t = Math.max(0, (k - 0.6) / 0.4);
      tint.lerp(next, t);
      for (const c of chunks) {
        c.mesh.material.color.copy(tint);
        c.snow.visible = snow > 0.02;
        c.snow.material.opacity = snow;
      }
      // The mountains take the season's tint as the ground does, so the two meet in the same light.
      skirtMaterial.color.copy(tint);
      curtain.material.color.copy(tint);
    },

    /** The chunk a tile is in. */
    chunkAt: (x, y) => chunks[Math.floor(y / CHUNK) * CHUNKS + Math.floor(x / CHUNK)],
  };
  return terrain;
}
