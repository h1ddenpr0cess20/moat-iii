import { hash2, smoothstep } from '../rng.js';
import { WEEKS_PER_YEAR } from '../config.js';
import { colorLeaves } from './materials.js';
import { lightAt } from './sky.js';

/**
 * The look of the hour and the year: where the sun is, how warm its light,
 * the color of the sky and of the leaves, how much snow lies, whether it
 * rains, and the film the picture is shot on. The day goes around on its own
 * clock; the year follows the game's calendar.
 */

/** Seconds a day takes to go around. */
const DAY = 150;

/** How much snow lies on the ground, 0 to 1, by the week of the year. */
export const snowAt = (inYear) => (inYear >= 36 ? Math.min(1, (inYear - 35) / 4) * 0.9 : inYear < 3 ? Math.max(0, 1 - inYear / 3) * 0.9 : 0);

/** Is it raining? Showers in spring and autumn, now and then in summer, in three-week spells. */
export function rainAt(week, seed) {
  const season = Math.floor(((week % WEEKS_PER_YEAR) % 48) / 12);
  const p = [0.24, 0.1, 0.3, 0][season];
  return hash2(Math.floor(week / 3), season, seed) < p;
}

const FILMS = [
  'saturate(1.1) contrast(1.03) brightness(1.03)',
  'saturate(1.12) contrast(1.05)',
  'saturate(1.14) sepia(0.14) contrast(1.06) brightness(1.01)',
  'saturate(0.82) contrast(1.06) brightness(1.04) hue-rotate(-6deg)',
];
const VIGNETTE = 'radial-gradient(ellipse at center, transparent 58%, rgba(10,16,28,0.34) 100%)';

export function createAtmosphere({ GFX, stage, sunDir, materials, terrain, water, domes, fx, seed }) {
  const { mat } = materials;
  let clock = 0.38;
  let mode = 'auto';
  let filmKey = '';
  // The stage's own backdrop dome (drawn first, behind everything): its color dims the sky when it clouds over.
  const backdrop = stage.scene.children.find((o) => o.renderOrder === -1 && o.material?.side === GFX.BackSide);
  stage.renderer.domElement.style.transition = 'filter 1.5s linear';
  let overcast = 0;
  let slow = 0, first = true, flicker = 0;
  const state = { night: 0, day: 1, rain: false, snow: 0, season: 1, tod: 0.4 };

  const atm = {
    state,
    get time() { return clock; },
    setMode(m) { mode = m; },
    get mode() { return mode; },
    setTime(t) { clock = t; },
    /**
     * `week` and `frac` (how far through it) place the year; `lightK` lets the
     * game dim the day (a storm, say). Call it every frame.
     */
    update(dt, { week, frac = 0, storm = false }) {
      const inYearF = (week % WEEKS_PER_YEAR) + frac;
      const yearT = inYearF / WEEKS_PER_YEAR;
      const season = Math.floor(inYearF / 12);
      const k = (inYearF % 12) / 12;
      flicker += dt;
      if (mode === 'auto') clock = (clock + dt / DAY) % 1;
      else clock = { day: 0.45, dusk: 0.74, night: 0.0 }[mode] ?? clock;
      const maxElev = 0.7 + 0.3 * Math.cos(Math.PI * 2 * (yearT - 0.4));
      const L = lightAt(clock, maxElev);
      // A hurricane brings its own rain, and a sky as dark as it gets.
      const rain = storm || rainAt(week, seed);
      overcast += ((rain ? 1 : 0) - overcast) * Math.min(1, dt * 0.8);
      const dim = 1 - 0.38 * overcast;
      sunDir.set(...L.dir);
      stage.key.color.setRGB(...L.key);
      stage.key.intensity = L.keyIntensity * dim * (season === 3 ? 0.92 : 1);
      stage.hemi.color.setRGB(L.hemiSky[0], L.hemiSky[1], L.hemiSky[2]);
      stage.hemi.groundColor.setRGB(...L.hemiGround);
      stage.hemi.intensity = L.hemiIntensity * (0.9 + 0.2 * overcast);
      domes.set(L.dusk * 0.95, L.night);
      if (backdrop) {
        const g = 1 - 0.38 * overcast;
        backdrop.material.color.setRGB(g * (0.82 + 0.18 * L.day), g * (0.86 + 0.14 * L.day), g * (0.94 + 0.06 * L.day));
        // By night the day sky is covered by the night dome; keep it from showing through.
        backdrop.material.color.multiplyScalar(0.15 + 0.85 * smoothstep(0.0, 0.5, L.day + L.dusk * 0.3));
      }
      // Windows light up as it gets dark, and early on dull days.
      const glow = Math.max(L.night, 0.55 * overcast * (1 - L.night) * 0.3, L.dusk * 0.8);
      mat.glow.color.setScalar(Math.min(1, glow * 1.15));
      mat.flame.color.setScalar(0.85 + 0.15 * Math.sin(flicker * 20));
      // Southern California: it never snows on the coast, and the palms are green all year.
      const snow = 0;
      // The year turns slowly: the leaves, the ground and the roofs need touching up a few times a second, not every frame.
      slow += dt;
      if (slow > 0.25 || first) {
        slow = 0; first = false;
        colorLeaves(materials, GFX, 1, 0.3);
        terrain.setSeason(season, k, snow);
        for (const name of ['thatch', 'tile', 'slate']) mat[name].emissive.setRGB(0.12 * snow * L.day, 0.13 * snow * L.day, 0.15 * snow * L.day);
      }
      water.update(dt, { night: L.night, dusk: L.dusk, overcast, storm, height: stage.camera.position.y });
      fx.tint(L.night);
      const key = `${season}:${Math.round(L.night * 4)}:${Math.round(overcast * 3)}`;
      if (key !== filmKey) {
        filmKey = key;
        const base = FILMS[season];
        const night = L.night > 0.5 ? ' brightness(1.12) saturate(0.9)' : '';
        const gray = overcast > 0.5 ? ' saturate(0.85)' : '';
        stage.film.set({ filter: base + night + gray, vignette: VIGNETTE, grain: null, ui: null });
      }
      Object.assign(state, { night: L.night, day: L.day, rain: rain && season !== 3, snow, season, tod: clock, overcast });
    },
  };
  return atm;
}
