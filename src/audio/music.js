import { NOTE } from 'madness-engine/audio';
import { room } from 'madness-engine/music/theory';
import { hash2 } from '../rng.js';

/**
 * The score: California lo-fi, made on the spot. An electric piano on
 * seventh chords, a round bass, a soft synth lead and a lazy swung beat,
 * wandering through bright modes with the year (F lydian in spring, C major
 * in summer, G mixolydian in autumn, a slower D dorian in winter). Phrase
 * follows phrase without a break; the beat sits back when the island is
 * quiet and comes forward when it is busy or a hurricane is coming.
 */

const MODES = [
  { root: 53, scale: [0, 2, 4, 6, 7, 9, 11], name: 'lydian' },
  { root: 60, scale: [0, 2, 4, 5, 7, 9, 11], name: 'ionian' },
  { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], name: 'mixolydian' },
  { root: 50, scale: [0, 2, 3, 5, 7, 9, 10], name: 'dorian' },
];

/** Progressions as scale degrees (0 is the tonic chord): four bars each. */
const PROGRESSIONS = [
  [0, 5, 3, 4], [0, 3, 0, 4], [1, 4, 0, 0], [0, 2, 5, 4], [3, 4, 2, 5], [0, 5, 1, 4],
];

/** The eighth note, in seconds, for each season: about ninety beats a minute, a little slower in winter. */
const EIGHTH = [0.33, 0.31, 0.33, 0.37];
/** How far the off-beats are pushed late. */
const SWING = 0.18;

/** Where the chord is struck in the bar, as eighths, and where the bass plays. */
const COMPS = [[0, 3], [0, 3, 6], [0, 2.5, 5], [0, 4, 7]];
const BASSES = [[0, 3.5, 4], [0, 4, 6.5], [0, 2, 4, 7], [0, 5]];

/** Where the melody falls in the bar, as eighths. */
const RHYTHMS = [[0, 3], [1, 3, 4], [0, 2, 3, 6], [2, 5], [0, 1.5, 4], [3, 5, 6]];

export function createMusic(audio, { getState }) {
  let started = false;
  let timer = 0;
  let ctx, bus, wet, drone;
  let next = 0, phrase = null, seed = 1, melodyAt = 4;
  let last = null;

  const degree = (mode, d, octave = 0) => mode.root + mode.scale[((d % 7) + 7) % 7] + 12 * (octave + Math.floor(d / 7));
  const swung = (t0, e, slot) => t0 + slot * e + (Math.floor(slot) % 2 === 1 && slot % 1 === 0 ? SWING * e : 0);

  /** An electric piano: a sine with a bell on top, a slow wobble, a soft attack. */
  const keys = (at, midi, gain = 0.07, len = 1.6) => {
    const f = NOTE(midi);
    audio.tone({ at, freq: f, length: len, type: 'sine', gain, attack: 0.008, vibrato: 4.5, out: bus });
    audio.tone({ at, freq: f * 1.003, length: len * 0.8, type: 'triangle', gain: gain * 0.35, attack: 0.01, out: bus });
    audio.tone({ at, freq: f * 4, length: 0.25, type: 'sine', gain: gain * 0.12, attack: 0.002, out: bus });
  };
  const bass = (at, midi, len = 0.6, gain = 0.22) => {
    const f = NOTE(midi);
    audio.tone({ at, freq: f, length: len, type: 'sine', gain, attack: 0.01, out: bus });
    audio.tone({ at, freq: f * 2, length: len * 0.5, type: 'triangle', gain: gain * 0.15, attack: 0.01, out: bus });
  };
  const lead = (at, midi, len, gain = 0.07) => {
    const f = NOTE(midi);
    audio.tone({ at, freq: f, length: len, type: 'triangle', gain, attack: 0.04, vibrato: 3, out: bus });
    audio.tone({ at, freq: f * 2, length: len * 0.6, type: 'sine', gain: gain * 0.2, attack: 0.06, out: bus });
  };
  const kick = (at, soft = 1) => {
    audio.tone({ at, freq: 110, to: 45, length: 0.28, type: 'sine', gain: 0.34 * soft, out: bus });
    audio.burst({ at, length: 0.03, type: 'lowpass', freq: 900, gain: 0.08 * soft, out: bus });
  };
  const snare = (at, soft = 1) => {
    audio.burst({ at, length: 0.16, type: 'bandpass', freq: 1900, q: 0.8, gain: 0.16 * soft, out: bus });
    audio.tone({ at, freq: 190, length: 0.08, type: 'triangle', gain: 0.06 * soft, out: bus });
  };
  const hat = (at, soft = 1) => audio.burst({ at, length: 0.035, type: 'highpass', freq: 7000, q: 0.7, gain: 0.05 * soft, out: bus });

  const newPhrase = (state) => {
    seed++;
    const season = state.season;
    const mode = MODES[season];
    phrase = {
      mode, prog: PROGRESSIONS[Math.floor(hash2(seed, season, 3) * PROGRESSIONS.length)],
      comp: COMPS[Math.floor(hash2(seed, 5, 1) * COMPS.length)], low: BASSES[Math.floor(hash2(seed, 6, 2) * BASSES.length)],
      bar: 0, e: EIGHTH[season], busy: state.busy || state.threat,
    };
    melodyAt = 5 + Math.floor(hash2(seed, 4, 4) * 4);
  };

  const scheduleBar = (t0, state) => {
    if (!phrase) newPhrase(state);
    const { mode, prog, comp, low, e } = phrase;
    const chord = prog[phrase.bar % prog.length];
    const rel = (x) => Math.max(0, x - ctx.currentTime);
    // The chord, as a seventh, voiced close and low in the middle of the piano.
    const tones = [0, 2, 4, 6].map((d) => degree(mode, chord + d, 0));
    for (const slot of comp) tones.forEach((m, i) => keys(rel(swung(t0, e, slot) + i * 0.012), m, slot ? 0.05 : 0.065, slot ? 1.1 : 1.8));
    for (const slot of low) bass(rel(swung(t0, e, slot)), degree(mode, slot === 4 ? chord + 4 : chord, -2), e * 1.6);
    // The melody, from the second bar.
    if (phrase.bar >= 1 && phrase.bar < 8) {
      const rhythm = RHYTHMS[Math.floor(hash2(seed, phrase.bar, 6) * RHYTHMS.length)];
      for (let n = 0; n < rhythm.length; n++) {
        const slot = rhythm[n];
        const len = ((rhythm[n + 1] ?? 8) - slot) * e;
        melodyAt = Math.max(3, Math.min(11, melodyAt + Math.floor(hash2(seed, phrase.bar * 7 + n, 8) * 5) - 2));
        lead(rel(swung(t0, e, slot)), degree(mode, melodyAt, 1), Math.min(1.6, len * 1.1));
      }
    }
    // The beat: kick on one and three, the snare on two and four, hats on the eighths; it sits back when the island is quiet.
    const soft = phrase.busy ? 1 : 0.55;
    kick(rel(t0), soft); kick(rel(swung(t0, e, 4)), soft * 0.9);
    if (hash2(seed, phrase.bar, 9) < 0.5) kick(rel(swung(t0, e, 5)), soft * 0.6);
    snare(rel(swung(t0, e, 2)), soft); snare(rel(swung(t0, e, 6)), soft);
    for (let k = 0; k < 8; k++) hat(rel(swung(t0, e, k)), soft * (k % 2 ? 0.6 : 1));
    phrase.bar++;
    return 8 * e;
  };

  const tick = () => {
    if (!ctx) return;
    const state = getState();
    if (last !== state.season && drone) { last = state.season; drone.set({ freq: NOTE(MODES[state.season].root - 24) }); }
    if (state.silent) return;
    // Far enough ahead that a timer the browser slows down (a tab in the background, a frame that takes long) does not leave a gap.
    while (next < ctx.currentTime + 4) {
      // Fallen behind (the page was put away): pick up on the next beat rather than crowd the missed bars in at once.
      if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
      next += scheduleBar(next, state);
      if (phrase.bar >= 8) phrase = null;
    }
    if (drone) drone.set({ gain: state.droneGain });
  };

  return {
    start() {
      if (started || !audio.ctx) return;
      started = true;
      ctx = audio.ctx;
      bus = ctx.createGain();
      bus.gain.value = 1;
      wet = ctx.createGain();
      wet.gain.value = 0.34;
      const verb = ctx.createConvolver();
      verb.buffer = room(ctx, 2.4, 2.2);
      bus.connect(audio.music);
      bus.connect(verb).connect(wet).connect(audio.music);
      // A warm pad under it all, like tape hiss with a note in it.
      drone = audio.loop({ source: 'triangle', freq: NOTE(MODES[1].root - 24), filters: [{ type: 'lowpass', freq: 400, q: 0.5 }], out: audio.music });
      drone?.set({ gain: 0.03 });
      next = ctx.currentTime + 1.5;
      timer = setInterval(tick, 250);
    },
    stop() { clearInterval(timer); started = false; drone?.stop(); },
    /** Schedules what is due; the interval does it too, but a frame never misses, so the music never runs dry while the game is drawing. */
    update() { if (started) tick(); },
    get started() { return started; },
  };
}
