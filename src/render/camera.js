import { SIZE, WATER_LEVEL } from '../config.js';
import { clamp } from '../rng.js';
import { heightAt } from '../world/world.js';

/**
 * The founder's eye. It floats over the realm looking down at a point on the
 * ground: the keys slide the point about, the right button drags the land
 * under the cursor, the wheel draws in toward whatever the cursor is over,
 * and two fingers pinch, twist and drag. `pick` answers where on the ground a
 * spot on the screen is, which is what every tool wants to know.
 */

const EDGE = 3;

export function createCamera({ GFX, stage, world, viewDef, dom }) {
  const { view, target } = stage;
  const camera = stage.camera;
  const caster = new GFX.Raycaster();
  const ndc = { x: 0, y: 0 };
  const goal = { x: target.x, z: target.z };
  const keys = new Set();
  const touches = new Map();
  let grab = null;
  let rotate = null;
  let gesture = null;
  let glide = null;
  let fast = false;

  const surface = (x, z) => Math.max(WATER_LEVEL, heightAt(world, x, z));

  /** Where on the ground the screen point (clientX, clientY) is: { x, z, y } in world units, or null off the land. */
  const pick = (clientX, clientY) => {
    const r = dom.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -(((clientY - r.top) / r.height) * 2 - 1);
    caster.setFromCamera(ndc, camera);
    const o = caster.ray.origin, d = caster.ray.direction;
    if (d.y > -0.01) return null;
    const f = (t) => o.y + d.y * t - surface(o.x + d.x * t, o.z + d.z * t);
    let t0 = 0, t1 = 0, hit = false;
    for (let t = 0.2; t < camera.far; t += Math.max(0.3, t * 0.012)) {
      t1 = t;
      if (f(t) < 0) { hit = true; break; }
      t0 = t;
    }
    if (!hit) return null;
    for (let i = 0; i < 22; i++) {
      const m = (t0 + t1) / 2;
      if (f(m) < 0) t1 = m; else t0 = m;
    }
    const t = (t0 + t1) / 2;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (x < -8 || z < -8 || x > SIZE + 8 || z > SIZE + 8) return null;
    return { x, z, y: o.y + d.y * t };
  };

  const bound = () => {
    goal.x = clamp(goal.x, EDGE, SIZE - EDGE);
    goal.z = clamp(goal.z, EDGE, SIZE - EDGE);
  };
  const shiftBy = (dx, dz) => { goal.x += dx; goal.z += dz; bound(); };

  /** Drags the land: whatever was under the pointer when the grab began stays under it. */
  const grabAt = (x, y) => {
    const p = pick(x, y);
    if (grab && p) {
      grab.dx += grab.x0 - p.x;
      grab.dz += grab.z0 - p.z;
    }
  };

  const zoomAt = (factor, x, y) => {
    const p = x === undefined ? null : pick(x, y);
    const before = view.aim.zoom;
    view.zoomBy(factor);
    const k = 1 - view.aim.zoom / before;
    if (p) shiftBy((p.x - goal.x) * k, (p.z - goal.z) * k);
  };

  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '') || e.target?.isContentEditable;
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', KeyQ: 'turnL', KeyE: 'turnR', KeyZ: 'tiltUp', KeyX: 'tiltDown', PageUp: 'tiltUp', PageDown: 'tiltDown', Equal: 'in', NumpadAdd: 'in', Minus: 'out', NumpadSubtract: 'out' };

  const onKeyDown = (e) => {
    fast = e.shiftKey;
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); glide = null; if (e.code.startsWith('Arrow')) e.preventDefault(); }
    if (e.code === 'Home') { view.reset(); glide = null; }
  };
  const onKeyUp = (e) => { fast = e.shiftKey; const k = KEYMAP[e.code]; if (k) keys.delete(k); };
  const onBlur = () => keys.clear();

  /** An angle's change brought into -π..π, so fingers crossing the screen's left-pointing axis do not turn the map a whole way around. */
  const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

  const touchInfo = () => {
    const [a, b] = [...touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  const onDown = (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const t = touchInfo();
        const p = pick(t.cx, t.cy);
        // Where the fingers began, so a pinch need not turn the map and a twist need not zoom it until each is meant.
        gesture = { ...t, p, dist0: t.dist, angle0: t.angle, zooming: false, twisting: false };
        glide = null;
        grab = p ? { x0: p.x, z0: p.z, dx: 0, dz: 0, px: t.cx, py: t.cy } : null;
        dom.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (e.button === 2) {
      const p = pick(e.clientX, e.clientY);
      if (p) grab = { x0: p.x, z0: p.z, dx: 0, dz: 0, px: e.clientX, py: e.clientY };
      dom.setPointerCapture?.(e.pointerId);
      glide = null;
    } else if (e.button === 1) {
      rotate = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
  };
  const onMove = (e) => {
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && gesture) {
        const t = touchInfo();
        if (!gesture.zooming && Math.abs(Math.log(t.dist / gesture.dist0)) > 0.06) gesture.zooming = true;
        if (!gesture.twisting && Math.abs(wrap(t.angle - gesture.angle0)) > 0.12) gesture.twisting = true;
        if (gesture.zooming) view.zoomBy(gesture.dist / Math.max(20, t.dist));
        // Raising the yaw turns the land clockwise on the screen, as fingers turning clockwise raise their angle (y runs down): the land turns with them.
        if (gesture.twisting) view.aim.yaw += wrap(t.angle - gesture.angle);
        gesture.dist = t.dist;
        gesture.angle = t.angle;
        // Under the fingers the view is where they put it at once, not eased after, so the land stays under them.
        view.yaw = view.aim.yaw;
        view.zoom = view.aim.zoom;
        if (grab) { grab.px = t.cx; grab.py = t.cy; }
      }
      return;
    }
    if (grab && e.buttons & 2) { grab.px = e.clientX; grab.py = e.clientY; }
    if (rotate && e.buttons & 4) {
      view.turn(-(e.clientX - rotate.x) * 0.006, (e.clientY - rotate.y) * 0.005);
      rotate.x = e.clientX; rotate.y = e.clientY;
    }
  };
  const onUp = (e) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (touches.size < 2) { gesture = null; grab = null; }
      return;
    }
    if (e.button === 2) grab = null;
    if (e.button === 1) rotate = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, -240, 240) * 0.0016);
    zoomAt(k, e.clientX, e.clientY);
    glide = null;
  };
  const onMenu = (e) => e.preventDefault();

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('contextmenu', onMenu);
  dom.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  const api = {
    pick,
    /** The ray under a screen point: { o: origin, d: direction } in world units. */
    ray(clientX, clientY) {
      const r = dom.getBoundingClientRect();
      ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -(((clientY - r.top) / r.height) * 2 - 1);
      caster.setFromCamera(ndc, camera);
      const { origin, direction } = caster.ray;
      return { o: { x: origin.x, y: origin.y, z: origin.z }, d: { x: direction.x, y: direction.y, z: direction.z } };
    },
    /** Whether two fingers are on the screen: a tool should let go of what it was doing. */
    get gesturing() { return touches.size >= 2; },
    get distance() { return 12 * view.zoom; },
    /** Starts dragging the land from the screen point; the left button and one finger can use it where nothing else does. */
    beginGrab(x, y) { const p = pick(x, y); grab = p ? { x0: p.x, z0: p.z, dx: 0, dz: 0, px: x, py: y } : null; glide = null; },
    moveGrab(x, y) { if (grab) { grab.px = x; grab.py = y; } },
    endGrab() { grab = null; },
    get grabbing() { return grab !== null; },
    /** Glides to look at (x, z), drawing in to `zoom` if given. */
    focus(x, z, { zoom = null, yaw = null, instant = false } = {}) {
      goal.x = x; goal.z = z; bound();
      if (zoom !== null) view.aim.zoom = zoom;
      if (yaw !== null) view.aim.yaw = yaw;
      if (instant) { target.x = goal.x; target.z = goal.z; target.y = surface(goal.x, goal.z); view.step(1, true); }
      glide = null;
    },
    /** Nudges the view where the founder is not touching it: a slow turn for the title screen. */
    drift(rate) { glide = rate; },
    get goal() { return goal; },
    /** The point the camera looks at, and how far off it is, for the things that follow the eye. */
    get eye() { return { x: target.x, z: target.z, distance: 12 * view.zoom }; },
    update(dt) {
      if (grab) {
        grabAt(grab.px, grab.py);
        shiftBy(grab.dx, grab.dz);
        // Land under the pointer is followed at once, not eased after.
        target.x = goal.x; target.z = goal.z;
        grab.dx = 0; grab.dz = 0;
      }
      const axes = viewDef.groundAxes(view.aim.yaw);
      const x = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      const y = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0);
      if (x || y) {
        const speed = (0.55 + 0.4 * view.zoom) * 12 * (fast ? 2.2 : 1);
        shiftBy((x * axes.right[0] + y * axes.up[0]) * speed * dt, (x * axes.right[1] + y * axes.up[1]) * speed * dt);
      }
      if (keys.has('turnL')) view.aim.yaw -= 1.5 * dt;
      if (keys.has('turnR')) view.aim.yaw += 1.5 * dt;
      if (keys.has('tiltUp')) view.turn(0, 0.9 * dt);
      if (keys.has('tiltDown')) view.turn(0, -0.9 * dt);
      if (keys.has('in')) view.zoomBy(Math.exp(-1.4 * dt));
      if (keys.has('out')) view.zoomBy(Math.exp(1.4 * dt));
      if (glide) view.aim.yaw += glide * dt;
      view.step(dt);
      const k = 1 - Math.exp(-10 * dt);
      target.x += (goal.x - target.x) * k;
      target.z += (goal.z - target.z) * k;
      target.y += (surface(target.x, target.z) - target.y) * (1 - Math.exp(-6 * dt));
      // Close in, the near plane comes in too; far out, it keeps the depth buffer honest, and the far plane goes back far enough to hold the whole map.
      camera.near = clamp(0.012 * api.distance, 0.12, 3);
      camera.far = Math.max(900, api.distance * 1.3 + SIZE * 1.6);
    },
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('contextmenu', onMenu);
      dom.removeEventListener('wheel', onWheel);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
    },
  };
  return api;
}
