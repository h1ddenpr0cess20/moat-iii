import { hash2, mulberry32 } from '../rng.js';

/**
 * The sky: three painted canvases (day, dusk, night) wrapped around the scene,
 * faded one into another as the sun goes around; and the sun and moon that
 * light the land. The day sky is the engine's own backdrop dome; dusk and
 * night are laid over it, see-through, a little inside.
 */

const W = 1024, H = 512;

function paintGradient(ctx, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Clouds: soft heaps of radial gradients, flat on the bottom, in a band above the horizon. */
function clouds(ctx, { seed = 1, count = 46, tint = '255,255,255', alpha = 0.34, band = [0.2, 0.46] } = {}) {
  const rnd = mulberry32(seed);
  for (let k = 0; k < count; k++) {
    const cx = rnd() * W, cy = H * (band[0] + rnd() * (band[1] - band[0]));
    const w = 40 + rnd() * 90, h = 8 + rnd() * 16;
    const puffs = 5 + Math.floor(rnd() * 6);
    for (let p = 0; p < puffs; p++) {
      const px = cx + (rnd() - 0.5) * w * 1.6, py = cy - rnd() * h * 0.6;
      const r = 12 + rnd() * 26;
      for (const ox of [-W, 0, W]) {
        const g = ctx.createRadialGradient(px + ox, py, 0, px + ox, py, r);
        g.addColorStop(0, `rgba(${tint},${alpha})`);
        g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(px + ox - r, py - r, r * 2, r * 2);
      }
    }
  }
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return [c, c.getContext('2d')];
}

/** A fair day: deep blue overhead, pale and hazy at the horizon, and the haze going to gray-green below it. */
export function paintDay() {
  const [c, ctx] = canvas();
  paintGradient(ctx, [[0, '#2f6fc4'], [0.22, '#4f90dc'], [0.38, '#8fc0ee'], [0.47, '#d4e6f4'], [0.5, '#dfe9ee'], [0.53, '#aebfb4'], [0.7, '#7d8f78'], [1, '#4a5a44']]);
  clouds(ctx, { seed: 5, count: 52, alpha: 0.3 });
  clouds(ctx, { seed: 9, count: 22, alpha: 0.2, band: [0.1, 0.3] });
  return c;
}

/** Sunset: a band of orange at the horizon going up through rose to a dusk blue. */
export function paintDusk() {
  const [c, ctx] = canvas();
  paintGradient(ctx, [[0, '#1c2a5a'], [0.2, '#3a4478'], [0.36, '#8a5a86'], [0.45, '#e8845a'], [0.49, '#ffc07a'], [0.52, '#8a6a5a'], [0.7, '#3a3a40'], [1, '#202428']]);
  clouds(ctx, { seed: 13, count: 40, tint: '255,170,130', alpha: 0.3, band: [0.28, 0.47] });
  return c;
}

/** Night: a deep blue going to black, stars, and the Milky Way's smear. */
export function paintNight() {
  const [c, ctx] = canvas();
  paintGradient(ctx, [[0, '#04060f'], [0.3, '#070b1c'], [0.45, '#10183a'], [0.5, '#1a2244'], [0.52, '#0a0e1a'], [0.7, '#05070c'], [1, '#030408']]);
  for (let k = 0; k < 700; k++) {
    const x = hash2(k, 1, 7) * W, y = hash2(k, 2, 7) * H * 0.48;
    const a = 0.25 + hash2(k, 3, 7) * 0.7;
    const r = hash2(k, 4, 7) < 0.06 ? 1.7 : 0.9;
    ctx.fillStyle = `rgba(255,${230 + Math.floor(hash2(k, 5, 7) * 25)},${210 + Math.floor(hash2(k, 6, 7) * 45)},${a})`;
    ctx.fillRect(x, y, r, r);
  }
  const g = ctx.createLinearGradient(0, H * 0.1, W, H * 0.4);
  g.addColorStop(0, 'rgba(140,160,230,0)');
  g.addColorStop(0.5, 'rgba(140,160,230,0.10)');
  g.addColorStop(1, 'rgba(140,160,230,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.5);
  return c;
}

/** What shiny things reflect, painted from the day sky and brought down to a studio-sized canvas. */
export function paintReflections(sky) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  c.getContext('2d').drawImage(sky, 0, 0, 512, 256);
  return c;
}

/** The sun's place and the light it makes: from the time of day (0 midnight, 0.5 noon) and the season's height. */
export function sunAt(t, maxElevation) {
  const angle = (t - 0.25) * Math.PI * 2;
  const e = Math.sin(angle);
  // Rises in the east, climbs to the south and sets in the west.
  const dir = [Math.cos(angle) * -0.9 - 0.15, e * maxElevation + 0.02, 0.62 * Math.max(0.2, 0.4 + Math.abs(e))];
  const l = Math.hypot(...dir);
  return { dir: dir.map((v) => v / l), elevation: e * maxElevation };
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The light at a moment: the sun's, or the moon's after dark, with the sky's wash. */
export function lightAt(t, maxElevation) {
  const sun = sunAt(t, maxElevation);
  const e = sun.elevation;
  const day = smooth(-0.02, 0.18, e);
  const low = 1 - smooth(0.05, 0.5, e);
  const dusk = smooth(-0.25, 0.0, e) * (1 - smooth(0.0, 0.25, e));
  const night = 1 - smooth(-0.3, 0.02, e);
  const warm = [1, 0.72 + 0.22 * (1 - low), 0.5 + 0.42 * (1 - low)];
  const moon = [0.62, 0.72, 1];
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const key = mix(moon, warm, day);
  // After dark the moon is opposite the sun and a good deal fainter.
  const dir = day > 0.02 ? sun.dir : [-sun.dir[0] * 0.8, Math.max(0.35, -sun.dir[1] + 0.3), 0.5];
  const l = Math.hypot(...dir);
  return {
    sun, dir: dir.map((v) => v / l), key, keyIntensity: 0.34 + 2.4 * day * (0.45 + 0.55 * (1 - low * 0.5)),
    hemiSky: mix([0.1, 0.14, 0.3], mix([0.8, 0.78, 0.72], [0.72, 0.84, 1], 1 - low), day), hemiGround: mix([0.03, 0.04, 0.08], [0.3, 0.26, 0.2], day),
    hemiIntensity: 0.4 + 0.55 * day,
    dusk, night, day,
  };
}

/** The domes' radius at their smallest, inside the backdrop's. */
const RADIUS = 296;

/** The domes laid over the backdrop: dusk and night, each fading in or out with `opacity`. */
export function createSkyDomes(GFX, scene) {
  const make = (canvas, order) => {
    const map = new GFX.CanvasTexture(canvas);
    map.colorSpace = GFX.SRGBColorSpace;
    const material = new GFX.MeshBasicMaterial({ map, side: GFX.BackSide, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const dome = new GFX.Mesh(new GFX.SphereGeometry(RADIUS, 48, 24), material);
    dome.renderOrder = order;
    dome.frustumCulled = false;
    // Always round the whole scene: drawn after the land (it is see-through), a dome smaller than the view would lay
    // the dusk or the night sky over the ground beyond it, and from far out the far side of the island went brown, or black.
    dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.position); dome.scale.setScalar(Math.max(1, (cam.far * 0.9) / RADIUS)); dome.updateMatrixWorld(); };
    scene.add(dome);
    return { dome, material };
  };
  const dusk = make(paintDusk(), -0.8);
  const night = make(paintNight(), -0.7);
  return {
    set(duskK, nightK) {
      dusk.material.opacity = duskK;
      dusk.dome.visible = duskK > 0.01;
      night.material.opacity = nightK;
      night.dome.visible = nightK > 0.01;
    },
  };
}
