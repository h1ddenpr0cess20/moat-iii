import { saveSlot } from 'madness-engine/storage';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * The chief of staff: an adviser at the founder's elbow who says what to do next,
 * once, when it matters. The hints teach the game in the order a founder needs
 * it, and the donut block above all: stamp a ring of homes, leave the heart
 * open, put a plaza or a park in the middle.
 */

const HINTS = {
  welcome: {
    text: 'You bought an island. Welcome home, boss. Slide the map with <b>WASD</b> or the <b>right button</b>, turn it with <b>Q</b> and <b>E</b>, and zoom with the wheel. Zone <b>homes</b>, <b>shops</b> and <b>industry</b> along streets; the meter up top says which the city wants.',
    touch: 'You bought an island. Welcome home, boss. Slide the map with a <b>finger</b>, and <b>pinch</b> and <b>twist</b> with two to zoom and turn it. Tap anything to look at it. Zone <b>homes</b>, <b>shops</b> and <b>industry</b> along streets; the meter up top says which the city wants.',
    next: 'block',
  },
  block: {
    text: 'The best way to lay out a neighborhood is the <b>donut block</b>. Take the <b>Blocks</b> tool (<b>4</b>), choose <b>Open ★</b> for the core, and click on open ground to stamp a street loop with a ring of lots. Join one of its streets to the city’s.',
    touch: 'The best way to lay out a neighborhood is the <b>donut block</b>. Take the <b>Blocks</b> tool, choose <b>Open ★</b> for the core, and tap open ground to stamp a street loop with a ring of lots. Join one of its streets to the city’s. While a tool is in hand, two fingers move the map; <b>Done</b> puts it down.',
    after: 14,
  },
  blockMade: { text: 'Homes will grow around the ring. Now give it a <b>heart</b>: with the <b>Build</b> tool, set a <b>Plaza</b> or a <b>Park</b> in the middle. A good heart serves every door in the ring, and the block earns a bonus.' },
  heart: { text: 'A donut! The plaque over the block shows its rating. It climbs as the ring fills, and as the heart grows: taxes, room, mood and safety all improve. Make another, and join it to the first.' },
  red: { text: 'The city is spending more than it takes in. Raise the tax a point in the <b>Budget</b> (<b>L</b>), trim the service budget, or zone more: every home, shop and factory pays.' },
  crime: { text: 'Crime is rising where the police do not reach. Build a <b>Police Station</b> (Build, <b>5</b>) near the busy streets.' },
  smog: { text: 'Factory smoke is reaching homes, and nobody pays much to live in smog. Keep <b>Industrial</b> zones back from where people live, with shops or a park between.' },
  moat: { text: 'The bank is full. Open the <b>District map</b> (<b>M</b>) and dig the canals around another district: more land to build on. A taller tower can run more districts.' },
  idle: { text: 'People are out of work. Zone <b>Commercial</b> or <b>Industrial</b> land along a street, and firms will move in.' },
  hurricane: { text: 'A hurricane is coming! It makes landfall next week and blows for two. Low buildings by the shore suffer most; <b>fire stations</b> and <b>police</b> nearby get people through it, and towers stand.' },
  noroad: { text: 'A building here has no street to the tower, and no one can work in it. Lay a street from it to the city.' },
};

export function createSteward(ctx) {
  const slot = saveSlot('moat3.hints.v1');
  const seen = new Set(slot.read() ?? []);
  const el = h('div.panel.steward');
  el.hidden = true;
  let hideT = 0;
  let queue = [];

  const show = (id) => {
    const hint = HINTS[id];
    if (!hint) return;
    seen.add(id);
    slot.write([...seen]);
    el.replaceChildren(
      h('div.portrait', { html: icon('crown', 22) }),
      h('div.words', { html: (globalThis.matchMedia?.('(pointer: coarse)').matches && hint.touch) || hint.text }),
      h('button.btn.small.skip', { onclick: () => { el.hidden = true; clearTimeout(hideT); next(); } }, 'Thank you'));
    el.hidden = false;
    ctx.sfx('open');
    clearTimeout(hideT);
    hideT = setTimeout(() => { el.hidden = true; next(); }, 22000);
  };
  const next = () => { const id = queue.shift(); if (id) setTimeout(() => show(id), 1200); };

  const steward = {
    el,
    /** Says a hint, if it has not been heard (or the one before is still up, then after). */
    hint(id) {
      if (seen.has(id) || off || queue.includes(id)) return;
      if (!el.hidden) { queue.push(id); return; }
      show(id);
    },
    get seen() { return seen; },
    reset() { seen.clear(); slot.write([]); },
    /** Checks the state of the city for something worth saying; once a week. */
    watch() {
      const { game } = ctx;
      const r = game.report;
          if (game.week > 4) steward.hint('block');
      if ((r.delta ?? 0) < 0 && game.week > 12) steward.hint('red');
      if ((r.crime ?? 0) > 30 && game.week > 20) steward.hint('crime');
      if ((r.care?.smog ?? 0) > 0.15) steward.hint('smog');
      if (game.stock.gold > 1500 && game.week > 60) steward.hint('moat');
      if ((r.idle ?? 0) > 15 && game.week > 30) steward.hint('idle');
      for (const b of game.world.buildings.values()) if (b.state === 'ready' && !b.connected && b.type !== 'park' && b.type !== 'plaza' && b.type !== 'castle' && game.week > 8) { steward.hint('noroad'); break; }
    },
  };
  ctx.game.on('hurricane', ({ phase }) => { if (phase === 'warning') steward.hint('hurricane'); });
  let off = false;
  steward.disable = (v) => { off = v; if (v) el.hidden = true; };
  return steward;
}
