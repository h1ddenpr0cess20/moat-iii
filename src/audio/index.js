import { NOTE, createAudio } from 'madness-engine/audio';
import { pickSettings, saveSlot } from 'madness-engine/storage';
import { hash2 } from '../rng.js';
import { calendar } from '../sim/calendar.js';
import { GROUND } from '../config.js';
import { createMusic } from './music.js';

/**
 * The sound of the city: the clink and knock of what the founder does, the
 * ambience of the place the camera is over (wind, water, birds, rain,
 * crickets, hammers), and the score. Nothing plays until the first click.
 */

const DEFAULTS = Object.freeze({ music: 0.6, sfx: 0.8 });

export function createSound({ game, scene }) {
  const slot = saveSlot('moat3.sound.v1');
  const settings = { ...DEFAULTS, ...pickSettings(slot.read(), DEFAULTS) };
  const audio = createAudio({ storageKey: 'moat3.muted', level: 0.85, volume: settings, glue: true, onWake: () => wake() });
  const rate = new Map();
  let loops = null;
  let env = { water: 0, forest: 0, building: 0, t: 0 };
  let threat = 0;

  const ok = (name, gap = 0.08) => {
    const now = performance.now() / 1000;
    if (now - (rate.get(name) ?? -9) < gap) return false;
    rate.set(name, now);
    return true;
  };
  const bell = (at, note, len = 2.6, gain = 0.22) => {
    const f = NOTE(note);
    for (const [m, g, l] of [[1, 1, 1], [2.01, 0.5, 0.7], [2.76, 0.35, 0.5], [4.2, 0.2, 0.35]]) audio.tone({ at, freq: f * m, length: len * l, type: 'sine', gain: gain * g });
  };
  const knock = (at = 0, g = 0.4) => { audio.burst({ at, length: 0.07, type: 'bandpass', freq: 850, q: 1.4, gain: g }); audio.tone({ at, freq: 190, to: 110, length: 0.09, type: 'triangle', gain: g * 0.6 }); };

  const SFX = {
    place() { knock(0, 0.5); knock(0.14, 0.4); knock(0.3, 0.45); },
    road() { audio.burst({ length: 0.16, type: 'highpass', freq: 1500, gain: 0.25, sweep: 700 }); },
    zone() { audio.jingle([69, 73], { step: 0.07, type: 'triangle', gain: 0.14, length: 0.3 }); },
    block() { audio.jingle([62, 66, 69, 74], { step: 0.09, type: 'triangle', gain: 0.2, length: 0.6 }); },
    clear() { audio.burst({ length: 0.3, type: 'lowpass', freq: 900, sweep: 150, gain: 0.5 }); audio.tone({ freq: 90, to: 50, length: 0.3, type: 'sine', gain: 0.4 }); },
    no() { audio.tone({ freq: 120, to: 80, length: 0.18, type: 'square', gain: 0.1 }); audio.burst({ length: 0.08, type: 'lowpass', freq: 400, gain: 0.3 }); },
    open() { audio.burst({ length: 0.12, type: 'highpass', freq: 3000, gain: 0.12 }); },
    built() { bell(0, 81, 1.6, 0.14); knock(0, 0.25); },
    toll() { bell(0, 57, 4, 0.3); bell(1.6, 57, 4, 0.24); },
    // A storm siren: a wail that rises and falls, twice.
    horn() { for (const at of [0, 1.6]) { audio.tone({ at, freq: 420, to: 820, length: 0.8, type: 'sawtooth', gain: 0.07, attack: 0.1 }); audio.tone({ at: at + 0.8, freq: 820, to: 420, length: 0.8, type: 'sawtooth', gain: 0.07 }); } },
    alarm() { for (let k = 0; k < 6; k++) bell(k * 0.18, 84, 0.6, 0.2); audio.burst({ length: 1.4, type: 'bandpass', freq: 1800, q: 0.6, gain: 0.12 }); },
    fanfare() { audio.jingle([62, 69, 74, 78, 81], { step: 0.13, type: 'sawtooth', gain: 0.1, length: 0.6, attack: 0.02 }); },
    arrive() { audio.jingle([72, 76], { step: 0.14, type: 'sine', gain: 0.1, length: 0.5 }); },
    gate() { audio.tone({ freq: 70, to: 55, length: 0.9, type: 'sawtooth', gain: 0.08 }); for (let k = 0; k < 8; k++) audio.burst({ at: k * 0.1, length: 0.04, type: 'bandpass', freq: 600, gain: 0.2 }); },
    dirge() { audio.jingle([50, 48, 45, 43], { step: 0.9, type: 'triangle', gain: 0.25, length: 2.5 }); },
  };

  function wake() {
    if (loops) return;
    const mk = (opts) => audio.loop(opts);
    loops = {
      wind: mk({ filters: [{ type: 'bandpass', freq: 420, q: 0.5 }, { type: 'lowpass', freq: 900, q: 0.4 }] }),
      water: mk({ filters: [{ type: 'bandpass', freq: 520, q: 0.7 }, { type: 'lowpass', freq: 1100, q: 0.5 }] }),
      rain: mk({ filters: [{ type: 'highpass', freq: 1400, q: 0.5 }, { type: 'lowpass', freq: 7000, q: 0.5 }] }),
      crickets: mk({ source: 'sine', freq: 4300, filters: [{ type: 'bandpass', freq: 4300, q: 6 }] }),
    };
    music.start();
    // Whatever stops the context, try to start it again.
    const ctx = audio.ctx;
    ctx.addEventListener('statechange', () => { if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {}); });
  }

  const music = createMusic(audio, {
    getState: () => {
      const cal = calendar(game.week);
      return { season: cal.season, busy: game.pop.adults + game.pop.children + game.pop.elders > 40, threat: threat > 0, silent: game.gameOver, droneGain: 0.03 + 0.02 * threat };
    },
  });

  // The browser may suspend the sound (a tab put away, a laptop asleep, a phone call) and only a click or key lets it go on: every one brings it back, not just the first, and so does coming back to the tab.
  const wakeUp = () => { audio.wake(); };
  addEventListener('pointerdown', wakeUp);
  addEventListener('keydown', wakeUp);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && audio.ctx) wakeUp(); });

  // What the game tells the sound.
  game.on('built', () => { if (ok('built', 0.4)) SFX.built(); });
  game.on('annexed', () => SFX.toll());
  game.on('annexStart', () => SFX.place());
  game.on('fire', () => { if (ok('fire', 1)) SFX.alarm(); });
  game.on('hurricane', ({ phase }) => { threat = phase === 'over' ? 0 : 1; if (phase !== 'over') SFX.horn(); });
  game.on('castle', () => SFX.fanfare());
  game.on('rank', () => SFX.fanfare());
  game.on('arrival', () => { if (ok('arrive', 1.5)) SFX.arrive(); });
  game.on('gate', () => SFX.gate());
  game.on('gameover', () => SFX.dirge());

  const world = game.world;
  /** What is around the camera, counted every so often: water, trees, and sites where builders work. */
  const sample = () => {
    const tx = Math.floor(scene.stage.target.x), ty = Math.floor(scene.stage.target.z);
    let water = 0, forest = 0, building = 0;
    for (let y = ty - 10; y <= ty + 10; y += 2) {
      for (let x = tx - 10; x <= tx + 10; x += 2) {
        if (x < 0 || y < 0 || x >= world.size || y >= world.size) continue;
        const i = y * world.size + x;
        if (world.ground[i] === GROUND.WATER || world.moat[i] === 1) water++;
        if (world.tree[i]) forest++;
        const b = world.bld[i] ? world.buildings.get(world.bld[i]) : null;
        if (b && b.state === 'building') building++;
      }
    }
    env = { water: Math.min(1, water / 25), forest: Math.min(1, forest / 30), building: Math.min(1, building / 4), t: 0 };
  };

  let birdT = 0, hammerT = 0;
  const api = {
    audio,
    sfx(name) { const f = SFX[name]; if (f && audio.ctx && ok(`sfx:${name}`, name === 'road' ? 0.12 : 0.05)) f(); },
    get settings() { return settings; },
    setVolume(which, v) { settings[which] = v; audio.setVolume(which, v); slot.write(settings); },
    toggleMute() { return audio.toggleMute(); },
    get muted() { return audio.muted; },
    update(dt) {
      if (!audio.ctx || !loops) return;
      music.update();
      env.t -= dt;
      if (env.t <= 0) { sample(); env.t = 0.6; }
      const a = scene.atmosphere.state;
      const near = 1 / (0.6 + scene.camera.distance / 30);
      loops.wind.set({ gain: (0.018 + 0.03 * (a.rain ? 1 : 0) + 0.02 * a.snow) * near, filter: 380 + 260 * Math.sin(performance.now() * 0.0003) });
      loops.water.set({ gain: 0.05 * env.water * near });
      loops.rain.set({ gain: a.rain ? 0.05 * near : 0 });
      loops.crickets.set({ gain: a.night > 0.6 && a.season === 1 ? 0.0035 * (0.5 + 0.5 * Math.sin(performance.now() * 0.02)) : 0 });
      birdT -= dt;
      if (birdT <= 0) {
        birdT = 1.5 + hash2(Math.floor(performance.now()), 2, 7) * 4;
        if (a.day > 0.5 && !a.rain && a.season < 3 && env.forest > 0.15 && near > 0.35) {
          const f = 2300 + hash2(Math.floor(performance.now() / 7), 3, 9) * 2200;
          for (let k = 0; k < 2 + Math.floor(hash2(Math.floor(performance.now() / 13), 5, 1) * 3); k++) audio.tone({ at: k * 0.11, freq: f, to: f * 1.25, length: 0.07, type: 'sine', gain: 0.05 * near, attack: 0.01 });
        }
      }
      hammerT -= dt;
      if (hammerT <= 0) {
        hammerT = 0.55 + hash2(Math.floor(performance.now() / 3), 1, 5) * 0.4;
        if (env.building > 0 && a.day > 0.3 && near > 0.3) knock(0, 0.12 * near * env.building);
      }
    },
  };
  return api;
}
