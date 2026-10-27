import { createOcean } from 'madness-engine/ocean';
import { RIVERS, riverOf } from 'madness-engine/river';

/**
 * The water: the Pacific all round the island, and the canals, lagoons and
 * creeks inside it, all the engine's ocean (`madness-engine/ocean`): one sheet
 * of running water at the water level, out to the horizon, that the ground
 * hides wherever it stands above it. So the shore falls where the land meets
 * the sea, and a canal is wherever the ground is dug below it.
 *
 * Out on the open sea the waves are a calm swell; drawn in over the city, the
 * water settles to the engine's canal (`riverOf(RIVERS.canal)`), so the
 * canals lie still between their banks, as in Venice Beach. A hurricane
 * turns it all to the engine's storm sea.
 */

const CANAL = riverOf(RIVERS.canal).sea;
/** How high the camera stands, in tiles, when the water has settled to the canal's. */
const NEAR = 30, FAR = 90;

export function createWater(GFX, world, materials, scene) {
  const ocean = createOcean(GFX, { sea: 'calm', sky: 'noon', reach: 900, rings: 160, segments: 192 });
  // The game has its own sky; only the water is wanted. The dome is what sets the water up for each camera, so the water does it instead.
  ocean.group.remove(ocean.dome);
  ocean.water.onBeforeRender = ocean.dome.onBeforeRender;
  ocean.group.name = 'water';
  ocean.water.renderOrder = 2;
  scene.add(ocean.group);
  let sky = 'noon', sea = 'calm';

  return {
    group: ocean.group, ocean,
    build() { world.dirty.water.clear(); },
    sync() { world.dirty.water.clear(); },
    /**
     * Runs the sea on, and turns its sky with the day: `night` and `dusk` 0 to 1, `overcast` for a gray sky.
     * `height` is how high the camera is, so that the water calms as it comes down to the canals.
     */
    update(dt, { night = 0, dusk = 0, overcast = 0, storm = false, height = FAR } = {}) {
      const want = night > 0.55 ? 'night' : dusk > 0.45 ? 'dusk' : overcast > 0.6 ? 'storm' : 'noon';
      if (want !== sky) { sky = want; ocean.setSky(want, 4); }
      // A hurricane gets the whole sea up, canals and all.
      const settle = storm ? 'storm' : height < NEAR ? 'canal' : height > FAR || sea === 'storm' ? 'calm' : sea;
      if (settle !== sea) { sea = settle; ocean.setSea(settle === 'canal' ? CANAL : settle, settle === 'storm' ? 8 : 3); }
      ocean.update(dt);
    },
  };
}
