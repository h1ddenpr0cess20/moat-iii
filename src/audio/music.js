import { NOTE } from 'madness-engine/audio';
import { room } from 'madness-engine/music/theory';
import { hash2 } from '../rng.js';

/**
 * The score: a lute, a recorder, a low drone and a frame drum, made on the
 * spot, wandering through the modes of the year (D dorian in spring, G
 * mixolydian in summer, A aeolian in autumn, a slow D phrygian in winter) in
 * a lilting six-eight. Phrase follows phrase without a break (each opens on
 * a bar of the lute alone, so it breathes without going quiet); the drum
 * comes in when the town is busy or the raiders are near.
 */

const MODES = [
  { root: 62, scale: [0, 2, 3, 5, 7, 9, 10], name: 'dorian' },
  { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], name: 'mixolydian' },
  { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], name: 'aeolian' },
  { root: 50, scale: [0, 1, 3, 5, 7, 8, 10], name: 'phrygian' },
];

/** Progressions as scale degrees (0 is the tonic chord): four bars each. */
const PROGRESSIONS = [
  [0, 3, 0, 4], [0, 5, 3, 4], [0, 6, 3, 0], [0, 2, 3, 4], [5, 3, 0, 4], [0, 4, 5, 3],
];

/** The eighth note, in seconds, for each season. */
const EIGHTH = [0.25, 0.23, 0.28, 0.34];

/** Which eighths of the bar the arpeggio plucks, as chord tones. */
const ARPS = [[0, 2, 1, 2, 1, 2], [0, 1, 2, 1, 2, 1], [0, 2, 1, 2, 0, 1], [0, 1, 2, 3, 2, 1]];

/** Where the melody falls in the bar, as eighths. */
const RHYTHMS = [[0, 3], [0, 2, 3], [0, 1, 2, 3, 5], [0, 3, 4], [0, 2, 4], [0, 3, 5]];

export function createMusic(audio, { getState }) {
  let started = false;
  let timer = 0;
  let ctx, bus, wet, drone;
  let next = 0, phrase = null, seed = 1, melodyAt = 4;
  let last = null;

  const degree = (mode, d, octave = 0) => mode.root + mode.scale[((d % 7) + 7) % 7] + 12 * (octave + Math.floor(d / 7));

  const pluck = (at, midi, gain = 0.2, len = 1.1) => {
    const f = NOTE(midi);
    audio.tone({ at, freq: f, length: len, type: 'triangle', gain, attack: 0.004, out: bus });
    audio.tone({ at, freq: f * 2.002, length: len * 0.4, type: 'sine', gain: gain * 0.3, attack: 0.002, out: bus });
    audio.burst({ at, length: 0.03, type: 'bandpass', freq: f * 3, gain: gain * 0.22, q: 2, out: bus });
  };
  const flute = (at, midi, len, gain = 0.1) => {
    const f = NOTE(midi);
    audio.tone({ at, freq: f, length: len, type: 'sine', gain, attack: 0.07, vibrato: 2.5, out: bus });
    audio.tone({ at, freq: f * 2, length: len * 0.7, type: 'sine', gain: gain * 0.18, attack: 0.1, vibrato: 3, out: bus });
    audio.burst({ at, length: len * 0.5, type: 'bandpass', freq: f * 2.5, gain: gain * 0.07, q: 4, out: bus });
  };
  const drum = (at, soft = 1) => {
    audio.tone({ at, freq: 130, to: 58, length: 0.22, type: 'sine', gain: 0.32 * soft, out: bus });
    audio.burst({ at, length: 0.12, type: 'lowpass', freq: 380, gain: 0.3 * soft, out: bus });
  };
  const tap = (at, soft = 1) => audio.burst({ at, length: 0.05, type: 'bandpass', freq: 1700, q: 1.5, gain: 0.1 * soft, out: bus });

  const newPhrase = (state) => {
    seed++;
    const season = state.season;
    const mode = MODES[season];
    const prog = PROGRESSIONS[Math.floor(hash2(seed, season, 3) * PROGRESSIONS.length)];
    phrase = {
      mode, prog, arp: ARPS[Math.floor(hash2(seed, 5, 1) * ARPS.length)], bar: 0, e: EIGHTH[season],
      lead: hash2(seed, 9, 2) < (season === 1 || season === 0 ? 0.7 : 0.45) ? 'flute' : 'lute',
      drum: state.busy || state.threat,
    };
    melodyAt = 5 + Math.floor(hash2(seed, 4, 4) * 5);
  };

  const scheduleBar = (t0, state) => {
    if (!phrase) newPhrase(state);
    const { mode, prog, arp, e } = phrase;
    const chord = prog[phrase.bar % prog.length];
    const rel = (x) => Math.max(0, x - ctx.currentTime);
    const tones = [degree(mode, chord, 0), degree(mode, chord + 2, 0), degree(mode, chord + 4, 0), degree(mode, chord, 1)];
    for (let k = 0; k < 6; k++) {
      const tone = tones[arp[k]];
      pluck(rel(t0 + k * e), tone + 12, k === 0 ? 0.24 : 0.15 + 0.03 * ((k + 1) % 2), 1.1);
    }
    pluck(rel(t0), degree(mode, chord, -1) + 12, 0.2, 2.2);
    // The melody.
    if (phrase.bar >= 1 && phrase.bar < 8) {
      const rhythm = RHYTHMS[Math.floor(hash2(seed, phrase.bar, 6) * RHYTHMS.length)];
      for (let n = 0; n < rhythm.length; n++) {
        const slot = rhythm[n];
        const len = ((rhythm[n + 1] ?? 6) - slot) * e;
        melodyAt = Math.max(2, Math.min(11, melodyAt + Math.floor(hash2(seed, phrase.bar * 7 + n, 8) * 5) - 2));
        const midi = degree(mode, melodyAt, 1);
        if (phrase.lead === 'flute') flute(rel(t0 + slot * e), midi, len * 1.15);
        else pluck(rel(t0 + slot * e), midi + 12, 0.22, Math.max(0.6, len * 1.6));
      }
    }
    if (phrase.drum) {
      drum(rel(t0), 1);
      tap(rel(t0 + 2 * e), 0.8); drum(rel(t0 + 3 * e), 0.7); tap(rel(t0 + 5 * e), 0.6);
    }
    phrase.bar++;
    return 6 * e;
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
      drone = audio.loop({ source: 'sawtooth', freq: NOTE(MODES[1].root - 24), filters: [{ type: 'lowpass', freq: 220, q: 0.6 }], out: audio.music });
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
