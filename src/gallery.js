import * as GFX from 'madness-engine/gfx';
import { createStage } from 'madness-engine/stage';
import { defineView } from 'madness-engine/view';
import { castsShadow, createMaterials, colorLeaves } from './render/materials.js';
import { Batch } from 'madness-engine/mesher';
import { modelFor } from './render/models/index.js';
import { lightAt, paintDay, paintReflections } from './render/sky.js';
import { BUILDINGS } from './catalog.js';
import { buildTemplates } from './render/trees.js';

/**
 * A page for looking at the models by themselves, on flat ground:
 * `gallery.html?types=bungalow,dingbat&level=2&night=1&building=0.5&yaw=0.5&zoom=1`.
 */
const params = new URLSearchParams(location.search);
const types = (params.get('types') ?? Object.keys(BUILDINGS).join(',')).split(',').filter(Boolean);
const host = document.getElementById('game');
const viewDef = defineView({ home: { yaw: 0, pitch: 0.7, zoom: 1 }, limits: { pitch: [0.1, 1.5], zoom: [0.1, 30] } });
const sunDir = new GFX.Vector3(-0.4, 1, 0.7).normalize();
const day = paintDay();
const stage = await createStage(host, { lens: { distance: 8, fov: 34 }, view: viewDef.createView(), sky: day, room: paintReflections(day), lights: { key: { from: sunDir }, fill: null }, backdrop: '#9fb8c8', label: 'gallery' });
stage.camera.far = 600;
const materials = createMaterials(GFX);
const { mat } = materials;
const ground = new GFX.Mesh(new GFX.PlaneGeometry(200, 200), new GFX.MeshStandardMaterial({ color: new GFX.Color('#6f9a45'), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
stage.scene.add(ground);

const night = params.get('night') === '1';
const L = lightAt(night ? 0.02 : +(params.get('tod') ?? 0.42), 0.95);
sunDir.set(...L.dir);
stage.key.color.setRGB(...L.key);
stage.key.intensity = L.keyIntensity;
stage.hemi.color.setRGB(...L.hemiSky);
stage.hemi.groundColor.setRGB(...L.hemiGround);
stage.hemi.intensity = L.hemiIntensity;
mat.glow.color.setScalar(night ? 1 : 0);
colorLeaves(materials, GFX, 1, 0.3);

const batch = new Batch();
let x = 0;
const level = +(params.get('level') ?? 0);
const building = +(params.get('building') ?? -1);
const smoke = [];
const rocks = params.get('rocks') ? buildTemplates() : null;
for (const type of rocks ? [] : types) {
  const def = type === 'castle' ? { size: [6, 6], level: 0 } : BUILDINGS[type];
  if (!def) continue;
  const lv = level >= 0 && params.has('level') ? level : def.level || 1;
  const t = modelFor(type, { level: lv, variant: +(params.get('variant') ?? 0), building: building >= 0, progress: building });
  const [w] = def.size;
  batch.stamp(t.parts, x + w / 2, 0, 0, 0);
  smoke.push(...t.smoke.map((s) => [x + w / 2 + s[0], s[1], s[2]]));
  x += w + 1.4;
}
if (rocks) {
  for (const kind of params.get('rocks').split(',')) for (const t of rocks[kind].slice(0, +(params.get('n') ?? 4))) { batch.stamp(t[params.get('lod') === '1' ? 'lod1' : 'lod0'], x, 0, 0, 0); x += +(params.get('gap') ?? 1.1); }
}
for (const [name, acc] of batch.accs) {
  const g = acc.geometry(GFX);
  if (!g) continue;
  const material = mat[name];
  if (!material) { console.warn('no material', name); continue; }
  const mesh = new GFX.Mesh(g, material);
  mesh.castShadow = castsShadow(name);
  mesh.receiveShadow = true;
  if (name === 'glow') mesh.renderOrder = 3;
  stage.scene.add(mesh);
}
stage.target.set(x / 2, 0.5, 0);
stage.view.aim.zoom = +(params.get('zoom') ?? Math.max(0.5, x / 7));
stage.view.aim.pitch = +(params.get('pitch') ?? 0.55);
stage.view.aim.yaw = +(params.get('yaw') ?? 0.5);
stage.view.step(1, true);
stage.run(() => {});
globalThis.gallery = { stage, smoke };
document.title = 'ready';
