import { createEffects } from 'madness-engine/effects';
import { hash2 } from '../rng.js';
import { heightAt } from '../world/world.js';

/**
 * Things in the air: chimney smoke drifting off on the wind, and the flames
 * and black smoke of a fire. (Rain and snow are shown by the light and the
 * ground, not by falling drops.) Smoke is a pool of soft puffs that rise,
 * swell and fade; every puff of one kind (chimney smoke, black smoke, flame)
 * is drawn in a single call.
 */

const MAX = 240;

export function createFx(GFX, scene, world) {
  const group = new GFX.Group();
  group.name = 'fx';
  scene.add(group);
  const geometry = new GFX.IcosahedronGeometry(1, 1);
  const smokeMat = new GFX.MeshBasicMaterial({ color: new GFX.Color('#d4d4d6'), transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
  const blackMat = new GFX.MeshBasicMaterial({ color: new GFX.Color('#2c2a2a'), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
  const flameMat = new GFX.MeshBasicMaterial({ color: new GFX.Color('#ff8a2a'), transparent: true, opacity: 0.85, blending: GFX.AdditiveBlending, depthWrite: false, toneMapped: false });
  const kinds = [smokeMat, blackMat, flameMat].map((material) => {
    const mesh = new GFX.InstancedMesh(geometry, material, MAX);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  const pool = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0, scale: 0, kind: 0, age: 0, life: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, live: false }));
  let cursor = 0;
  const timers = new Map();
  const fires = [];
  const ground = { heightAt: (x, z) => heightAt(world, x, z) };
  const effects = createEffects(GFX, scene, { ground });

  const puff = (x, y, z, { life = 4.5, size = 0.12, up = 0.34, vx = 0, vz = 0, grow = 2.6, material = smokeMat } = {}) => {
    for (let n = 0; n < MAX; n++) {
      const p = pool[(cursor + n) % MAX];
      if (p.live) continue;
      cursor = (cursor + n + 1) % MAX;
      Object.assign(p, { x, y, z, scale: size, kind: material === flameMat ? 2 : material === blackMat ? 1 : 0, age: 0, life, vx, vy: up, vz, size, grow, live: true });
      return p;
    }
    return null;
  };

  return {
    group, effects,
    /** Lights a fire for a few seconds at (x, z). */
    burn(x, z) { fires.push({ x, z, y: heightAt(world, x, z), t: 0, dur: 11 }); },
    /** A burst of dust or sparkle where something is done: a building finished. */
    dust(x, y, z) { for (let k = 0; k < 9; k++) puff(x + (hash2(k, 1, Math.floor(x)) - 0.5) * 0.9, y + 0.1, z + (hash2(k, 2, Math.floor(z)) - 0.5) * 0.9, { life: 1.6, size: 0.1, up: 0.3, grow: 2.4, vx: (hash2(k, 3, 5) - 0.5) * 0.5, vz: (hash2(k, 4, 5) - 0.5) * 0.5 }); },
    /**
     * `emitters`: chimneys, with `at` ([x, y, z]); `near`: the camera's place, so only what is in sight smokes.
     * `rate`: puffs a second for a chimney (more in the cold). `wind`: [x, z].
     */
    update(dt, { emitters = [], near = [0, 0], reach = 80, rate = 0.5, wind = [0.3, 0.1], time = 0 } = {}) {
      // Chimneys that have burned or been pulled down leave their timers behind: clear them out now and then.
      if (timers.size > emitters.length * 2 + 64) {
        const live = new Set(emitters.map((e) => e.key ?? `${e.id}:${e.at[0]}`));
        for (const key of timers.keys()) if (!live.has(key)) timers.delete(key);
      }
      for (const e of emitters) {
        const dx = e.at[0] - near[0], dz = e.at[2] - near[1];
        if (dx * dx + dz * dz > reach * reach) continue;
        const key = e.key ?? `${e.id}:${e.at[0]}`;
        let t = timers.get(key) ?? hash2(e.id, 7, 3) * 2;
        t -= dt * rate * (e.type === 'castle' ? 0.8 : 1);
        if (t <= 0) {
          puff(e.at[0], e.at[1], e.at[2], { vx: wind[0] * 0.5, vz: wind[1] * 0.5, size: 0.1 + hash2(e.id, Math.floor(time), 9) * 0.04 });
          t += 1.6 + hash2(e.id, Math.floor(time * 3), 11);
        }
        timers.set(key, t);
      }
      for (let k = fires.length - 1; k >= 0; k--) {
        const f = fires[k];
        f.t += dt;
        if (f.t > f.dur) { fires.splice(k, 1); continue; }
        const strength = Math.min(1, f.t / 1.5) * Math.min(1, (f.dur - f.t) / 3);
        if (hash2(Math.floor(f.t * 30), k, 1) < strength * 0.9) {
          const a = hash2(Math.floor(f.t * 60), k, 2) * 6.28, d = hash2(Math.floor(f.t * 60), k, 3) * 0.7;
          puff(f.x + Math.cos(a) * d, f.y + 0.3, f.z + Math.sin(a) * d, { life: 0.8, size: 0.2, up: 1.4, grow: 0.3, material: flameMat });
        }
        if (hash2(Math.floor(f.t * 20), k, 4) < strength * 0.5) puff(f.x + (hash2(Math.floor(f.t * 20), k, 5) - 0.5) * 0.8, f.y + 0.9, f.z + (hash2(Math.floor(f.t * 20), k, 6) - 0.5) * 0.8, { life: 4, size: 0.22, up: 0.9, vx: wind[0], vz: wind[1], grow: 3.5, material: blackMat });
      }
      for (const mesh of kinds) mesh.count = 0;
      for (const p of pool) {
        if (!p.live) continue;
        p.age += dt;
        const t = p.age / p.life;
        if (t >= 1) { p.live = false; continue; }
        p.x += (p.vx + wind[0] * t * 0.6) * dt;
        p.y += p.vy * dt * (1 - t * 0.5);
        p.z += (p.vz + wind[1] * t * 0.6) * dt;
        const fade = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
        p.scale = p.size * (1 + p.grow * t) * (0.2 + 0.8 * fade);
        const mesh = kinds[p.kind];
        mesh.setInstance(mesh.count++, p.x, p.y, p.z, 0, p.scale);
      }
      for (const mesh of kinds) { mesh.instancePlace.needsUpdate = true; mesh.instanceLook.needsUpdate = true; }
      effects.update(dt);
    },
    /** Smoke is lighter by day, darker against the night. */
    tint(night) { smokeMat.color.setRGB(0.83 - 0.5 * night, 0.83 - 0.5 * night, 0.84 - 0.42 * night); },
  };
}
