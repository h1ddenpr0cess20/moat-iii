import { saveSlot } from 'madness-engine/storage';
import { CENTER, MAP_SIZES, SIZE_NAME, TICK_SECONDS, WARDS } from './config.js';
import { createSound } from './audio/index.js';
import { createScene } from './render/scene.js';
import { deserialize, serialize } from './save.js';
import { createSaves } from './saves.js';
import { params, relaunch } from './launch.js';
import { startGame, step } from './sim/game.js';
import { createTitle } from './ui/title.js';
import { createUI } from './ui/index.js';

const host = document.getElementById('game');
const root = document.getElementById('ui');
const saves = createSaves();
const prefs = saveSlot('moat3.prefs.v1');
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const dev = import.meta.env.DEV;

const loading = {
  set(f, text) {
    const bar = document.getElementById('loading-bar'), label = document.getElementById('loading-text');
    if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    if (label && text) label.textContent = text;
    document.title = f >= 1 ? 'Moat' : `Moat · ${Math.round(f * 100)}%`;
  },
  done() { document.getElementById('loading')?.remove(); },
};

// ------------------------------------------------------------ which game

const difficulty = params.get('difficulty') ?? 'normal';
const disasters = params.get('disasters') !== '0';
const saved = saves.current();
try { localStorage.setItem('moat3.wards', String(WARDS)); } catch { /* no storage, no memory of the size */ }
let game = null;
let hasSave = false;
if (saved) {
  try {
    if ((saved.mapWards ?? 7) === WARDS && (params.has('load') || !params.has('new'))) { game = deserialize(saved); hasSave = true; }
  } catch (err) { console.warn('moat: the save could not be read', err); }
}
if (!game) game = startGame({ seed: params.get('seed') || randomSeed(), difficulty, disasters });

// Development: play a bot's hand first, to see a town.
const pre = +(params.get('bot') ?? 0);
if (pre && dev) {
  const { createBot } = await import('../test/bot.js');
  const bot = createBot(game);
  for (let w = 0; w < pre && !game.gameOver; w++) { bot.think(); step(game); }
} else if (+(params.get('week') ?? 0)) {
  for (let w = 0; w < +params.get('week'); w++) step(game);
}

loading.set(0.02, 'Raising the land');
const scene = await createScene({ host, game, progress: loading.set });
const { stage, camera, atmosphere } = scene;

// ------------------------------------------------------------ settings

const QUALITY = { low: { ratio: 1, shadows: false, map: 1024 }, medium: { ratio: 1, shadows: true, map: 1024 }, high: { ratio: 2, shadows: true, map: 2048 } };
const flow = {
  quality: prefs.read()?.quality ?? 'medium',
  setQuality(id) {
    const q = QUALITY[id] ?? QUALITY.high;
    flow.quality = id;
    stage.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, q.ratio));
    stage.renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    stage.key.castShadow = q.shadows;
    // The shadow map is sized once, before the first frame is drawn with it.
    if (!flow.mapSized) { flow.mapSized = true; stage.key.shadow.mapSize.set(q.map, q.map); }
    prefs.write({ quality: id });
  },
  saves,
  savedAt: () => { const t = saves.currentAt(); return t ? new Date(t).toLocaleString() : t === 0 ? 'some time ago' : null; },
  save() {
    if (!started || game.gameOver) return false;
    return saves.saveCurrent(serialize(game));
  },
  /** Saves the game by name, over the save `id` if given; the save's entry, or null if there was no room. */
  saveAs(opts) { return started && !game.gameOver ? saves.save(serialize(game), opts) : null; },
  /** Loads the game in play as last saved, or the named save `id`. */
  load(id) {
    if (id && !saves.restore(id)) return false;
    // Once the page goes, what it would save on the way out is not the save it is going to.
    leaving = true;
    relaunch({ load: 1 });
    return true;
  },
  newGame() { ui.dialogs.close(); showTitle({ canContinue: true }); },
};
flow.setQuality(flow.quality);

// ------------------------------------------------------------ the game

const clock = {
  speed: 0,
  last: 1,
  set(s) { if (s > 0) this.last = s; this.speed = s; },
  toggle() { this.set(this.speed === 0 ? this.last : 0); },
  cycle() { const order = [1, 2, 4]; this.set(order[(order.indexOf(this.speed) + 1) % order.length] ?? 1); },
};
const sound = createSound({ game, scene });
const ui = createUI({ game, scene, root, clock, sfx: (n) => sound.sfx(n), extra: { sound, flow } });

const p = (k, d) => (params.has(k) ? +params.get(k) : d);
camera.focus(p('x', CENTER), p('z', CENTER + 3), { zoom: p('zoom', 2.6), yaw: p('yaw', 0.3), instant: true });
stage.view.aim.pitch = p('pitch', 0.95);
stage.view.step(1, true);
if (params.has('tod')) { atmosphere.setMode('hold'); atmosphere.setTime(p('tod', 0.45)); }

let started = false;
let leaving = false;
let title = null;

const begin = () => {
  started = true;
  title?.remove();
  title = null;
  ui.hide(false);
  camera.drift(0);
  // A page opened with a camera of its own (for development) keeps it.
  if (!['x', 'z', 'zoom', 'yaw', 'pitch'].some((k) => params.has(k))) camera.focus(CENTER, CENTER + 3, { zoom: 2.3, yaw: 0.3 });
  clock.set(p('speed', 1));
  if (!hasSave || game.week < 6) ui.steward.hint('welcome');
};

function showTitle({ canContinue }) {
  title?.remove();
  ui.hide(true);
  clock.set(0);
  camera.drift(0.035);
  title = createTitle({
    seed: game.seed, difficulty: game.difficulty, disasters: game.disasters, size: SIZE_NAME, sizes: MAP_SIZES, canContinue, saves,
    onBegin: begin,
    onLoad: (id) => flow.load(id),
    onContinue: () => { if (started) { title.remove(); title = null; ui.hide(false); camera.drift(0); clock.set(clock.last); } else begin(); },
    onNew: (seed, level, size, on) => relaunch({ new: 1, seed, difficulty: level, size, disasters: on ? 1 : 0, play: 1 }),
  });
  document.body.append(title.el);
}

loading.done();
if (params.has('play') || params.has('load') || (dev && (pre || params.has('speed')))) {
  ui.hide(false);
  begin();
  if (params.has('speed')) clock.set(p('speed', 1));
} else showTitle({ canContinue: hasSave });

// ------------------------------------------------------------ saving

game.on('season', () => { if (flow.save()) ui.ctx.say('The game is saved.', 'quiet'); });
game.on('gameover', () => setTimeout(() => { if (game.gameOver) { saves.clearCurrent(); showTitle({ canContinue: false }); } }, 4000));
addEventListener('pagehide', () => { if (!leaving) flow.save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !leaving) flow.save(); });

let acc = 0;
stage.run((dt) => {
  if (started && clock.speed > 0 && !game.gameOver) {
    acc += dt * clock.speed;
    while (acc >= TICK_SECONDS) { acc -= TICK_SECONDS; step(game); }
  }
  scene.weekFrac = acc / TICK_SECONDS;
  scene.paused = started && !title && clock.speed === 0;
  scene.frame(dt);
  ui.update(dt);
  sound.update(dt);
});
globalThis.moat = { game, scene, ui, clock, sound, flow };
