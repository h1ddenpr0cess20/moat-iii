/**
 * The maps that change as the barony is built, and the heights (which a moat
 * or a leveled plot changes). `snapshot` keeps a copy of them as the land
 * was made, so that a save need keep only what has changed since.
 */
export const MAPS = ['ground', 'tree', 'amount', 'road', 'zone', 'crop'];
export const HEIGHTS = ['h', 'hBase'];

export function snapshot(world) {
  world.base = Object.fromEntries([...MAPS, ...HEIGHTS].map((k) => [k, world[k].slice()]));
  return world;
}
