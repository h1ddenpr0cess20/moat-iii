import { BUILDINGS, money } from '../catalog.js';
import { clamp } from '../rng.js';

/**
 * What the island's big buildings do for all of it, not only the tiles around
 * them: a port that ships the factories' goods, an airport that flies the
 * tourists in, a university whose graduates found startups. Each kind counts
 * in full once; a second of a kind adds half as much again, a third a quarter.
 * A place short of staff does half its work with nobody in it, as the
 * services do.
 */

const empty = () => ({ demand: { res: 0, com: 0, ind: 0 }, tax: { res: 0, com: 0, ind: 0 }, tourism: 0, tourismK: 0, growth: 0, mood: 0, sources: [] });

/** Works out `game.bonus` from what stands, ready and joined to the tower. Call once the workers are shared out. */
export function computeBonus(game) {
  const out = empty();
  const seen = {};
  for (const b of game.world.buildings.values()) {
    const def = BUILDINGS[b.type];
    const B = def?.bonus;
    if (!B || b.state !== 'ready' || !b.connected) continue;
    const n = seen[b.type] = (seen[b.type] ?? 0) + 1;
    const k = 0.5 ** (n - 1) * (def.jobs ? 0.5 + 0.5 * Math.min(1, b.eff || 0) : 1);
    for (const z of ['res', 'com', 'ind']) {
      out.demand[z] += (B.demand?.[z] ?? 0) * k;
      out.tax[z] += (B.tax?.[z] ?? 0) * k;
    }
    out.tourism += (B.tourism ?? 0) * k;
    out.tourismK += (B.tourismK ?? 0) * k;
    out.growth += (B.growth ?? 0) * k;
    out.mood += (B.mood ?? 0) * k;
    if (n === 1) out.sources.push(b.type);
  }
  out.growth = clamp(out.growth, 0, 0.4);
  game.bonus = out;
  return out;
}

export const bonusOf = (game) => game.bonus ?? empty();

/**
 * The week's visitors' money, in thousands at a 10% tax: what draws them,
 * more with an airport to fly them in, and more again when the island is a
 * happy place with parks to show.
 */
export function tourism(game, cheer = 0) {
  const B = bonusOf(game);
  if (!B.tourism) return 0;
  return B.tourism * (1 + B.tourismK) * (0.5 + game.happiness / 100) * (0.7 + 0.3 * cheer);
}

/** Is a building of this type standing, ready and joined up? For the pull of ports and airports on the firms. */
export function pullers(game, zone) {
  const out = [];
  for (const b of game.world.buildings.values()) if (BUILDINGS[b.type]?.bonus?.pull === zone && b.state === 'ready' && b.connected) out.push([b.x + b.w / 2, b.y + b.d / 2]);
  return out;
}

/** How loud a spot is, 0 to 1: each noisy place within its reach adds some. */
export function noiseAt(game, x, y) {
  let n = 0;
  for (const b of game.world.buildings.values()) {
    const loud = BUILDINGS[b.type]?.noisy;
    if (!loud || b.state !== 'ready') continue;
    const reach = 4 + Math.max(b.w, b.d) * 0.8 + loud * 4;
    const d = Math.max(0, Math.hypot(b.x + b.w / 2 - x, b.y + b.d / 2 - y) - Math.max(b.w, b.d) / 2);
    if (d < reach) n += loud * (reach - d) / reach;
  }
  return Math.min(1, n);
}

const ZONE_WORD = { res: 'homes', com: 'shops', ind: 'industry' };
const TAX_WORD = { res: 'Homes pay', com: 'Shops pay', ind: 'Industry pays' };
const pc = (x) => `${Math.round(x * 100)}%`;

/** What a kind of building does for the island, in words, for the build menu and the inspector. */
export function bonusLines(def) {
  const B = def.bonus;
  const out = [];
  if (!B) return out;
  for (const z of ['res', 'com', 'ind']) if (B.demand?.[z]) out.push(`+${Math.round(B.demand[z] * 100)} demand for ${ZONE_WORD[z]}`);
  for (const z of ['res', 'com', 'ind']) if (B.tax?.[z]) out.push(`${TAX_WORD[z]} ${pc(B.tax[z])} more tax`);
  if (B.tourism) out.push(`Visitors: about ${money(B.tourism)} a week in hotel and sales taxes`);
  if (B.tourismK) out.push(`Every attraction draws ${pc(B.tourismK)} more visitors`);
  if (B.growth) out.push(`Buildings grow up in a city ${pc(B.growth)} smaller`);
  if (B.mood) out.push(`+${B.mood} mood across the island`);
  if (B.pull) out.push(`New ${ZONE_WORD[B.pull]} grow toward it`);
  return out;
}
