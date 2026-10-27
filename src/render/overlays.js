import { WATER_LEVEL } from '../config.js';
import { heightAt } from '../world/world.js';
import { footprint } from '../world/buildings.js';
import { Batch } from 'madness-engine/mesher';
import { YAW } from './buildings.js';
import { modelFor } from './models/index.js';
import { freeGeometry } from './dispose.js';

/**
 * What the founder's hand draws on the land: the tiles under the cursor, the
 * stretch of road or the block he is laying out, the ghost of a building
 * before it is set down, outlines, rings that show how far a well or a
 * watchtower reaches, and the borders of the wards. Everything is draped over
 * the ground, a hand above it, and all of it is rebuilt only when it changes.
 */

const LIFT = 0.07;
const HALF = 0.5;

export const TINTS = Object.freeze({
  ok: '#6ee07a', bad: '#f0604d', info: '#f2e3a0', road: '#d8c9a8', cursor: '#fff4c2', select: '#ffe27a', ward: '#f6d98a', home: '#ffd35c', foe: '#e8806a', sight: '#9fd8ff',
});

export function createOverlays(GFX, world, scene) {
  const group = new GFX.Group();
  group.name = 'overlays';
  scene.add(group);
  const layers = new Map();
  let clock = 0;
  const surface = (x, z) => Math.max(WATER_LEVEL, heightAt(world, x, z));

  const materialFor = (color, opacity) => new GFX.MeshBasicMaterial({ color: new GFX.Color(color), transparent: true, opacity, depthWrite: false, side: GFX.DoubleSide, toneMapped: false });

  /** A named layer: one mesh, replaced when it changes. `sig` skips a rebuild of what is the same. */
  const layer = (key, make, { color = '#ffffff', opacity = 0.4, order = 4, pulse = 0 } = {}) => {
    let l = layers.get(key);
    if (!l) {
      l = { key, mesh: null, material: materialFor(color, opacity), sig: '', base: opacity, pulse };
      layers.set(key, l);
    }
    l.material.color.set(color);
    l.base = opacity;
    l.pulse = pulse;
    const geometry = make();
    if (l.mesh) { group.remove(l.mesh); freeGeometry(l.mesh.geometry); l.mesh = null; }
    if (!geometry) return;
    l.mesh = new GFX.Mesh(geometry, l.material);
    l.mesh.renderOrder = order;
    l.mesh.frustumCulled = false;
    group.add(l.mesh);
  };

  const geometryOf = (pos) => {
    if (!pos.length) return null;
    const g = new GFX.BufferGeometry();
    g.setAttribute('position', new GFX.BufferAttribute(new Float32Array(pos), 3));
    return g;
  };

  /** Four half-tile squares over a tile, each on the ground's own slope. */
  const tileQuads = (pos, x, y) => {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const x0 = x + i * HALF, z0 = y + j * HALF, x1 = x0 + HALF, z1 = z0 + HALF;
        const a = [x0, surface(x0, z0) + LIFT, z0], b = [x1, surface(x1, z0) + LIFT, z0], c = [x1, surface(x1, z1) + LIFT, z1], d = [x0, surface(x0, z1) + LIFT, z1];
        pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      }
    }
  };

  /** A ribbon of width `w` along a polyline, resampled each half tile so it follows the ground. */
  const ribbon = (pos, pts, w, closed, lift = LIFT + 0.03) => {
    const dense = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / HALF));
      for (let s = 0; s < steps; s++) dense.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
    }
    if (!closed) dense.push(pts[pts.length - 1]);
    const m = dense.length;
    const at = (k) => dense[((k % m) + m) % m];
    const side = (k) => {
      const p = closed ? at(k - 1) : dense[Math.max(0, k - 1)];
      const q = closed ? at(k + 1) : dense[Math.min(m - 1, k + 1)];
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
      return [-dz / l * w / 2, dx / l * w / 2];
    };
    const vert = (k, s) => { const p = at(k), o = side(k); return [p[0] + o[0] * s, surface(p[0] + o[0] * s, p[1] + o[1] * s) + lift, p[1] + o[1] * s]; };
    const last = closed ? m : m - 1;
    for (let k = 0; k < last; k++) {
      const a = vert(k, 1), b = vert(k, -1), c = vert(k + 1, 1), d = vert(k + 1, -1);
      pos.push(...a, ...b, ...c, ...c, ...b, ...d);
    }
  };

  const signature = (tiles) => {
    let h = tiles.length;
    for (let k = 0; k < tiles.length; k += Math.max(1, tiles.length >> 6)) h = (h * 31 + (tiles[k][0] * 977 + tiles[k][1])) | 0;
    const t = tiles[tiles.length - 1];
    return `${tiles.length}:${h}:${t ? t[0] + ',' + t[1] : ''}`;
  };

  const api = {
    group,
    /** Colors tiles: `tiles` is a list of [x, y]; none clears the layer. */
    fill(key, tiles, style = {}) {
      const sig = tiles?.length ? `${signature(tiles)}|${style.color}|${style.opacity}` : '';
      const had = layers.get(key);
      if (had && had.sig === sig) return;
      if (!tiles?.length && !had?.mesh) return;
      layer(key, () => {
        const pos = [];
        for (const [x, y] of tiles ?? []) tileQuads(pos, x, y);
        return geometryOf(pos);
      }, { color: style.color ?? TINTS.cursor, opacity: style.opacity ?? 0.35, order: style.order ?? 4, pulse: style.pulse ?? 0 });
      layers.get(key).sig = sig;
    },
    /** A line along a path of world points [x, z]. */
    path(key, pts, style = {}) {
      const sig = pts?.length ? `${pts.length}:${pts[0]}:${pts[pts.length - 1]}:${style.color}:${style.width}:${style.closed}` : '';
      const had = layers.get(key);
      if (had && had.sig === sig) return;
      if (!pts?.length && !had?.mesh) return;
      layer(key, () => {
        const pos = [];
        if (pts?.length > 1) ribbon(pos, pts, style.width ?? 0.14, style.closed ?? false);
        return geometryOf(pos);
      }, { color: style.color ?? TINTS.select, opacity: style.opacity ?? 0.9, order: style.order ?? 5, pulse: style.pulse ?? 0 });
      layers.get(key).sig = sig;
    },
    /** An outline around a rectangle of tiles (x, y, w, d). */
    rect(key, r, style = {}) {
      if (!r) return api.path(key, null);
      const pad = style.pad ?? 0.04;
      const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.d + pad;
      api.path(key, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { ...style, closed: true });
    },
    /** A ring of `radius` tiles around (cx, cz) in world units. */
    ring(key, cx, cz, radius, style = {}) {
      if (!radius) return api.path(key, null);
      const pts = [];
      const n = Math.max(24, Math.round(radius * 5));
      for (let k = 0; k < n; k++) pts.push([cx + Math.cos((k / n) * Math.PI * 2) * radius, cz + Math.sin((k / n) * Math.PI * 2) * radius]);
      api.path(key, pts, { ...style, closed: true });
    },
    clear(key) {
      const l = layers.get(key);
      if (!l) return;
      if (l.mesh) { group.remove(l.mesh); freeGeometry(l.mesh.geometry); l.mesh = null; }
      l.sig = '';
    },
    clearAll() { for (const key of layers.keys()) api.clear(key); },
    update(dt) {
      clock += dt;
      for (const l of layers.values()) l.material.opacity = l.base * (1 + l.pulse * Math.sin(clock * 5.2));
    },
  };

  // The ghost of a building: its own model, drawn through a translucent tint.
  const ghostMat = new GFX.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.9, metalness: 0, emissive: new GFX.Color('#2a6a30'), depthWrite: false });
  const ghostGroup = new GFX.Group();
  ghostGroup.visible = false;
  scene.add(ghostGroup);
  const ghostCache = new Map();
  let ghostKey = '';
  const ghostFor = (type, level, variant) => {
    const key = `${type}:${level}:${variant}`;
    let g = ghostCache.get(key);
    if (g) return g;
    const t = modelFor(type, { level, variant });
    const batch = new Batch();
    batch.stamp(t.parts, 0, 0, 0, 0);
    g = new GFX.Group();
    for (const [name, acc] of batch.accs) {
      if (name === 'glow' || name === 'flame') continue;
      const geometry = acc.geometry(GFX);
      if (!geometry) continue;
      const mesh = new GFX.Mesh(geometry, ghostMat);
      mesh.renderOrder = 6;
      g.add(mesh);
    }
    ghostCache.set(key, g);
    return g;
  };

  api.ghost = {
    /** Shows a `type` at (x, y) facing `front`; `ok` tints it green or red. */
    show(type, x, y, front, { ok = true, level = 1, variant = 3 } = {}) {
      const key = `${type}:${level}:${variant}`;
      if (key !== ghostKey) {
        for (const child of [...ghostGroup.children]) ghostGroup.remove(child);
        ghostGroup.add(ghostFor(type, level, variant));
        ghostKey = key;
      }
      const [w, d] = type === 'castle' ? [6, 6] : footprint(type, front);
      const mx = x + w / 2, mz = y + d / 2;
      ghostGroup.position.set(mx, surface(mx, mz) + 0.02, mz);
      ghostGroup.rotation.y = YAW[front] ?? 0;
      ghostGroup.visible = true;
      ghostMat.emissive.set(ok ? '#2f7a38' : '#8a2b22');
      ghostMat.color.set(ok ? '#d8ffd8' : '#ffb8b0');
    },
    hide() { ghostGroup.visible = false; },
  };
  return api;
}
