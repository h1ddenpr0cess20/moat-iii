import { h } from './dom.js';
import { icon } from './icons.js';
import { heightAt } from '../world/world.js';

/**
 * Floating plaques over the donut blocks: what each is worth, so that a
 * mayor can see at a glance which blocks have a heart and which are
 * still hollow. They follow the blocks as the camera moves.
 */
export function createLabels(ctx) {
  const { game, scene } = ctx;
  const { stage } = scene;
  const el = h('div.labels');
  const pool = [];
  const v = new scene.GFX.Vector3();

  const badge = (i) => {
    if (!pool[i]) {
      const node = h('button.plaque', { onclick: () => { const b = game.blocks[+node.dataset.block]; if (b) ctx.inspector.show({ kind: 'block', id: b.id }); } });
      pool[i] = node;
      el.append(node);
    }
    return pool[i];
  };

  return {
    el,
    update() {
      const dist = scene.camera.distance;
      const w = stage.renderer.domElement.clientWidth, hh = stage.renderer.domElement.clientHeight;
      let n = 0;
      if (dist < 95) {
        for (const b of game.blocks) {
          if (b.homes < 2 && b.rating === 0) continue;
          if (b.core.length < 4) continue;
          v.set(b.center[0], heightAt(game.world, b.center[0], b.center[1]) + 1.6, b.center[1]);
          v.project(stage.camera);
          if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
          const node = badge(n++);
          const k = `${b.rating}:${b.name}`;
          if (node.dataset.k !== k) {
            node.dataset.k = k;
            node.className = `plaque ${b.rating >= 70 ? 'fine' : b.rating >= 40 ? 'good' : b.rating > 0 ? 'ok' : 'hollow'}`;
            node.innerHTML = b.rating > 0 ? `${icon('crown', 14)}<b>${b.rating}</b>` : `${icon('block', 14)}<span>hollow</span>`;
            node.title = `${b.name}: ${b.standing}`;
          }
          node.dataset.block = b.id;
          node.style.transform = `translate(${Math.round((v.x * 0.5 + 0.5) * w)}px, ${Math.round((-v.y * 0.5 + 0.5) * hh)}px) translate(-50%, -50%)`;
          node.hidden = false;
        }
      }
      for (let i = n; i < pool.length; i++) pool[i].hidden = true;
    },
  };
}
