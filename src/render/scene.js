import * as GFX from 'madness-engine/gfx';
import { createStage } from 'madness-engine/stage';
import { defineView } from 'madness-engine/view';
import { CENTER } from '../config.js';
import { calendar } from '../sim/calendar.js';
import { heightAt } from '../world/world.js';
import { createAtmosphere } from './atmosphere.js';
import { createBuildings } from './buildings.js';
import { createCamera } from './camera.js';
import { createDecals } from './decals.js';
import { createFx } from './effects.js';
import { createGates } from './gates.js';
import { createMaterials } from './materials.js';
import { createOverlays } from './overlays.js';
import { createSkyDomes, paintDay, paintReflections } from './sky.js';
import { createTerrain } from './terrain.js';
import { createTrees } from './trees.js';
import { createWater } from './water.js';
import { createTraffic } from './traffic.js';
import { useRenderer } from './dispose.js';

/**
 * The picture of the city: the engine's stage with the land, water, trees,
 * roads and fields, buildings and bridges, weather and light all put on it,
 * and the work of keeping them up to date as the game changes the world.
 */

export async function createScene({ host, game, progress = () => {} }) {
  const { world } = game;
  const viewDef = defineView({ home: { yaw: 0.3, pitch: 0.95, zoom: 2.4 }, limits: { pitch: [0.3, 1.5], zoom: [0.22, 48] } });
  const sunDir = new GFX.Vector3(-0.3, 1, 0.6).normalize();
  const day = paintDay();
  const stage = await createStage(host, {
    lens: { distance: 12, fov: 34 }, view: viewDef.createView(), sky: day, room: paintReflections(day),
    lights: { key: { from: sunDir }, fill: null }, shadowSize: 2048, backdrop: '#9fb8c8', label: 'moat',
  });
  useRenderer(stage.renderer);
  progress(0.04, 'Raising the island');
  const materials = createMaterials(GFX);
  const terrain = createTerrain(GFX, world, materials, stage.scene);
  const water = createWater(GFX, world, materials, stage.scene);
  const domes = createSkyDomes(GFX, stage.scene);
  const trees = createTrees(GFX, world, materials, stage.scene);
  const decals = createDecals(GFX, world, materials, stage.scene);
  const buildings = createBuildings(GFX, world, materials, stage.scene);
  const gates = createGates(GFX, world, materials, stage.scene);
  const traffic = createTraffic({ GFX, scene: stage.scene, game, world, materials });
  const fx = createFx(GFX, stage.scene, world);
  const overlays = createOverlays(GFX, world, stage.scene);
  const camera = createCamera({ GFX, stage, world, viewDef, dom: stage.renderer.domElement });
  const atmosphere = createAtmosphere({ GFX, stage, sunDir, materials, terrain, water, domes, fx, seed: world.seed });

  const cal0 = calendar(game.week);
  water.build();
  progress(0.08, 'Painting the beaches and the lawns');
  await terrain.paintAll([CENTER, CENTER], (f) => progress(0.08 + f * 0.55, 'Painting the beaches and the lawns'));
  progress(0.64, 'Planting the palms');
  await trees.buildAll(cal0.season, [CENTER, CENTER], (f) => progress(0.64 + f * 0.2, 'Planting the palms'));
  progress(0.86, 'Paving the streets and raising the towers');
  trees.updateLod(stage.target.x, stage.target.z, 30);
  decals.refreshFields(cal0);
  decals.buildAll();
  buildings.buildAll();
  gates.build();
  progress(1, 'Ready');

  const castleY = () => heightAt(world, CENTER, CENTER);
  const unsubscribe = [
    game.on('week', () => {
      if (game.week % 4 === 0) decals.refreshFields(calendar(game.week));
      buildings.setCastleWork(Boolean(game.castleWork), castleY());
    }),
    game.on('built', ({ building: b }) => {
      fx.dust(b.x + b.w / 2, heightAt(world, b.x + b.w / 2, b.y + b.d / 2), b.y + b.d / 2);
      if (b.type === 'gatehouse') gates.refresh();
    }),
    game.on('placed', ({ building: b }) => { if (b.type === 'gatehouse') gates.refresh(); }),
    game.on('demolished', ({ building: b }) => { if (b.type === 'gatehouse') gates.refresh(); }),
    game.on('fire', ({ at, why }) => { if (why === 'fire') fx.burn(at[0], at[1]); }),
    game.on('annexed', () => gates.refresh()),
    game.on('bridge', () => gates.refresh()),
    game.on('castleStart', () => buildings.setCastleWork(true, castleY())),
  ];
  buildings.setCastleWork(Boolean(game.castleWork), castleY());

  let emitters = [];
  let emitClock = 0;
  let lodClock = 0;
  let time = 0;

  const scene = {
    GFX, stage, camera, viewDef, materials, terrain, water, trees, decals, buildings, gates, traffic, fx, overlays, atmosphere,
    /** Where, in the sun's day, the game is: how far through the current week (0 to 1). */
    weekFrac: 0,
    /** The game stands still: the world's own motion stops. */
    paused: false,
    focusOn(x, z, opts) { camera.focus(x, z, opts); },
    /** Once a frame. */
    frame(dt) {
      // The world's own motion (the sails, the smoke, the weather, the water, the sun) stops with the game; the camera, the gates and the founder's overlays go on.
      const live = scene.paused ? 0 : dt;
      time += live;
      camera.update(dt);
      const cal = calendar(game.week);
      terrain.sync(1);
      water.sync();
      trees.sync(cal.season, 1);
      decals.sync(cal, 3);
      buildings.sync(1);
      buildings.restage(4);
      lodClock -= dt;
      if (lodClock <= 0) { lodClock = 0.3; trees.updateLod(stage.target.x, stage.target.z, Math.max(22, Math.min(55, 8 + camera.distance * 0.55))); }
      emitClock -= dt;
      if (emitClock <= 0) { emitClock = 1.5; emitters = buildings.emitters(); }
      buildings.update(live, 0.6 + 0.4 * Math.sin(time * 0.3));
      gates.update(dt);
      traffic.update(dt, { live });
      overlays.update(dt);
      const frac = Math.min(1, scene.weekFrac);
      atmosphere.update(live, { week: game.week, frac, storm: Boolean(game.hurricane && !game.hurricane.warn) });
      const cold = cal.season === 3 ? 1.7 : cal.season === 2 ? 1.2 : 0.8;
      fx.update(live, { emitters, near: [stage.target.x, stage.target.z], reach: 20 + 4 * camera.distance, rate: 0.5 * cold, wind: [0.35, 0.12], time });
    },
    dispose() { for (const off of unsubscribe) off(); camera.dispose(); },
  };
  return scene;
}
