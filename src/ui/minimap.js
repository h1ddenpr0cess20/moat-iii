import { GROUND, SIZE, WARD, WARDS } from '../config.js';
import { h } from './dom.js';

/**
 * A map in the corner: the land, the realm and its wards, roads, buildings
 * and blocks, and where the eye is. Click or drag on it to go there.
 */

const PX = 176;

export function createMinimap(ctx) {
  const { game, scene } = ctx;
  const { world } = game;
  const canvas = h('canvas', { width: PX * 2, height: PX * 2, 'aria-label': 'Map' });
  const el = h('div.panel.minimap', {}, canvas);
  const base = document.createElement('canvas');
  base.width = SIZE; base.height = SIZE;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(SIZE, SIZE);

  const paint = () => {
    const d = img.data;
    for (let t = 0; t < SIZE * SIZE; t++) {
      const g = world.ground[t];
      let c;
      if (world.bld[t]) c = world.bld[t] === 1 ? [200, 60, 50] : [226, 200, 150];
      else if (world.road[t]) c = [188, 160, 110];
      else if (g === GROUND.WATER || world.moat[t] === 1) c = [64, 120, 170];
      else if (g === GROUND.CLIFF) c = [110, 100, 90];
      else if (g === GROUND.ROCK || g === GROUND.ORE) c = [140, 134, 124];
      else if (world.zone[t]) c = [150, 190, 90];
      else if (world.tree[t]) c = [56, 100, 54];
      else c = [110, 150, 78];
      if (!world.realm[t] && !world.bld[t]) c = c.map((v) => v * 0.62);
      d[t * 4] = c[0]; d[t * 4 + 1] = c[1]; d[t * 4 + 2] = c[2]; d[t * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
  };

  const draw = () => {
    const c = canvas.getContext('2d');
    const k = canvas.width / SIZE;
    c.imageSmoothingEnabled = true;
    c.drawImage(base, 0, 0, canvas.width, canvas.height);
    c.strokeStyle = 'rgba(255,240,200,0.28)'; c.lineWidth = 1;
    for (let i = 1; i < WARDS; i++) { c.beginPath(); c.moveTo(i * WARD * k, 0); c.lineTo(i * WARD * k, canvas.height); c.moveTo(0, i * WARD * k); c.lineTo(canvas.width, i * WARD * k); c.stroke(); }
    for (const w of world.wards) {
      if (w.owned) { c.strokeStyle = 'rgba(240,200,90,0.9)'; c.lineWidth = 2; c.strokeRect(w.gx * WARD * k + 1, w.gy * WARD * k + 1, WARD * k - 2, WARD * k - 2); }
      if (w.dig) { c.fillStyle = 'rgba(90,150,220,0.35)'; c.fillRect(w.gx * WARD * k, w.gy * WARD * k, WARD * k, WARD * k); }
    }
    for (const b of game.blocks) if (b.rating > 0) { c.fillStyle = 'rgba(255,214,90,0.9)'; c.beginPath(); c.arc(b.center[0] * k, b.center[1] * k, 3 + b.q * 3, 0, 7); c.fill(); }
    const eye = scene.camera.eye;
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    const r = Math.max(5, eye.distance * 0.5 * k);
    c.strokeRect(eye.x * k - r, eye.z * k - r * 0.7, r * 2, r * 1.4);
  };

  const go = (e) => {
    const r = canvas.getBoundingClientRect();
    scene.focusOn(((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE);
  };
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); go(e); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) go(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  paint();
  draw();
  return {
    el,
    /** Redraws the land (it changes slowly), now and then. */
    repaint() { paint(); },
    update() { draw(); },
  };
}
