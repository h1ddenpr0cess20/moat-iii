import { CASTLE_LEVELS, annexCost, annexWork, money } from '../catalog.js';
import { CENTER, GROUND, SIZE, WARD, WARDS } from '../config.js';
import { startAnnex, planAnnex } from '../sim/game.js';
import { bordersRealm, ownedCount, wardTraits } from '../world/wards.js';
import { HV, SUB } from '../world/world.js';
import { fill, h } from './dom.js';

/**
 * The map of the coast, drawn like a surveyor's: the districts,
 * what each is made of, which are the city's, which can be taken by digging
 * the moat out around them, and what it will cost.
 */

const PX = 3;
const PAPER = [226, 208, 160];

function terrainImage(world) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * PX; canvas.height = SIZE * PX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const put = (x, y, c) => {
    for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
      const o = ((y * PX + j) * canvas.width + x * PX + i) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const g = world.ground[i];
      const hh = (a, b) => world.h[Math.min(HV - 1, Math.max(0, b * SUB)) * HV + Math.min(HV - 1, Math.max(0, a * SUB))];
      const shade = Math.max(0.72, Math.min(1.18, 1 + (hh(x - 1, y - 1) - hh(x + 1, y + 1)) * 0.16));
      let c;
      if (g === GROUND.WATER) c = [112, 156, 186];
      else if (g === GROUND.CLIFF) c = [150, 132, 108];
      else if (g === GROUND.ROCK || g === GROUND.ORE) c = [164, 150, 128];
      else if (world.tree[i]) c = [112, 134, 78];
      else c = [196, 190, 128];
      put(x, y, c.map((v, k) => Math.round((v * 0.72 + PAPER[k] * 0.28) * shade)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let cached = null;

export function realmDialog(ctx, { ward: initial = null } = {}) {
  const { game } = ctx;
  const { world } = game;
  let selected = initial ?? world.wards.find((w) => !w.owned && bordersRealm(world, w.id))?.id ?? world.wards.find((w) => w.owned).id;
  if (!cached || cached.seed !== world.seedText) cached = { seed: world.seedText, img: terrainImage(world) };

  const canvas = h('canvas', { width: SIZE * PX, height: SIZE * PX, 'aria-label': 'Map of the realm' });
  const info = h('div.ward-info');
  let timer = 0;

  const draw = () => {
    const c = canvas.getContext('2d');
    c.drawImage(cached.img, 0, 0);
    const S = WARD * PX;
    const now = performance.now() / 1000;
    for (const w of world.wards) {
      const x = w.gx * S, y = w.gy * S;
      const reach = !w.owned && bordersRealm(world, w.id);
      if (!w.owned) { c.fillStyle = reach ? 'rgba(90,70,40,0.10)' : 'rgba(60,45,25,0.32)'; c.fillRect(x, y, S, S); }
      if (w.dig) {
        c.save(); c.beginPath(); c.rect(x, y, S, S); c.clip();
        c.strokeStyle = 'rgba(80,130,180,0.55)'; c.lineWidth = 5;
        for (let k = -S; k < S * 2; k += 14) { c.beginPath(); c.moveTo(x + k + ((now * 12) % 14), y); c.lineTo(x + k + S + ((now * 12) % 14), y + S); c.stroke(); }
        c.restore();
      }
      c.lineWidth = w.id === selected ? 4 : w.owned ? 3 : 1.5;
      c.strokeStyle = w.id === selected ? '#fff2b0' : w.owned ? '#a8761c' : reach ? 'rgba(70,52,28,0.75)' : 'rgba(70,52,28,0.4)';
      c.setLineDash(w.owned || w.id === selected ? [] : reach ? [8, 5] : [3, 5]);
      c.strokeRect(x + 1.5, y + 1.5, S - 3, S - 3);
      c.setLineDash([]);
      c.font = `italic ${w.owned ? 700 : 400} ${Math.max(10, Math.round(13 * 7 / WARDS + 3))}px Palatino, Georgia, serif`;
      c.textAlign = 'center';
      c.fillStyle = w.owned ? '#2b1d08' : 'rgba(43,29,18,0.82)';
      c.strokeStyle = 'rgba(240,228,190,0.8)'; c.lineWidth = 3;
      c.strokeText(w.name, x + S / 2, y + 16); c.fillText(w.name, x + S / 2, y + 16);
      if (reach) { c.font = '15px serif'; c.fillText('⚒', x + S / 2, y + S - 8); }
    }
    // The realm's own works: roads, buildings and blocks.
    for (let t = 0; t < SIZE * SIZE; t++) {
      const x = t % SIZE, y = (t - x) / SIZE;
      if (world.road[t]) { c.fillStyle = 'rgba(96,70,40,0.85)'; c.fillRect(x * PX, y * PX, PX, PX); }
      else if (world.bld[t]) { c.fillStyle = world.bld[t] === 1 ? '#8a2a1c' : '#5a4630'; c.fillRect(x * PX, y * PX, PX, PX); }
    }
    for (const b of game.blocks) if (b.rating > 0) { c.fillStyle = 'rgba(240,196,70,0.6)'; c.beginPath(); c.arc(b.center[0] * PX, b.center[1] * PX, 4 + b.q * 5, 0, 7); c.fill(); }
    c.font = '20px serif'; c.textAlign = 'center'; c.fillStyle = '#8a2a1c';
    c.fillText('♜', CENTER * PX, CENTER * PX + 7);
  };

  const meter = (name, v, kind = '') => h('div.meter', {}, h('span', {}, name), h('div.bar' + (kind ? '.' + kind : ''), {}, h('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` } })));

  const showInfo = () => {
    const w = world.wards[selected];
    const s = w.stats;
    const plan = planAnnex(game, w.id);
    const owned = ownedCount(world);
    const cap = CASTLE_LEVELS[game.castleLevel].wards;
    const parts = [h('h3', {}, w.name), h('div.badge-line', {}, ...wardTraits(w).map((t) => h('span.tag', {}, t))),
      meter('Open land', s.arable / s.tiles * 2.2), meter('Trees', s.forest / s.tiles * 1.8), meter('Waterfront', s.water / s.tiles * 3), meter('Hard to dig', s.hardness, s.hardness > 0.5 ? 'bad' : s.hardness > 0.3 ? 'warn' : '')];
    if (w.owned) parts.push(h('p', { html: '<b class="good">Part of your city.</b>' }));
    else if (w.dig) {
      parts.push(h('p', {}, h('b', {}, 'The diggers are at work.')), h('div.meter', {}, h('span', {}, 'Canals'), h('div.bar.warn', {}, h('i', { style: { width: `${Math.round(w.dig.progress * 100)}%` } }))), h('p.dim', {}, `About ${Math.max(1, Math.ceil((1 - w.dig.progress) * w.dig.weeks))} weeks to go with a full crew of ${w.dig.crew}.`));
    } else {
      const cost = plan.cost ?? annexCost(owned, s.hardness);
      const work = plan.work ?? annexWork(owned);
      parts.push(h('h3', {}, 'Dig the canals around it'), h('div.kv', { style: { color: 'inherit' } }, h('span', {}, 'Cost'), h('span', { html: `<span class="${game.stock.gold < cost.gold ? 'bad' : ''}">${money(cost.gold)}</span>` }), h('span', {}, 'Time'), h('span', {}, `${work.weeks} weeks`), h('span', {}, 'Diggers'), h('span', {}, `${work.crew} hands`)),
        h('p.dim', {}, 'The old canal between is filled in, the ground is graded and the new canal floods, with a bridge to the next district.'),
        h('div.actions', {}, h('button.btn.gold', { disabled: !plan.ok, onclick: () => { const r = startAnnex(game, w.id); if (!r.ok) ctx.say(r.reason, 'warn'); else { ctx.sfx('place'); } draw(); showInfo(); } }, 'Dig the canals'), plan.ok ? null : h('span', { class: plan.capped ? 'warn' : 'bad' }, plan.reason)));
      if (plan.capped) parts.push(h('p', { html: `Your tower can run ${cap} ${cap === 1 ? 'district' : 'districts'}. <b>Build it taller</b> to take more.` }), h('button.btn.small', { onclick: () => { ctx.dialogs.close(); ctx.inspector.show({ kind: 'building', id: 1 }); } }, 'Look at the tower'));
    }
    parts.push(h('p.dim', {}, `City: ${owned} of ${cap} districts your ${CASTLE_LEVELS[game.castleLevel].name} can run.`));
    fill(info, parts);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - r.left) / r.width) * WARDS), gy = Math.floor(((e.clientY - r.top) / r.height) * WARDS);
    if (gx < 0 || gy < 0 || gx >= WARDS || gy >= WARDS) return;
    selected = gy * WARDS + gx;
    draw(); showInfo();
  });
  canvas.addEventListener('dblclick', () => {
    const w = world.wards[selected];
    ctx.dialogs.close();
    ctx.scene.focusOn(w.gx * WARD + WARD / 2, w.gy * WARD + WARD / 2, { zoom: 6 });
  });

  return {
    title: 'Districts',
    icon: 'map',
    refresh: true,
    width: 940,
    draw(body) {
      if (!body.contains(canvas)) fill(body, h('div.realm-map', {}, h('div', {}, canvas, h('p.dim', { style: { marginTop: '6px' } }, 'Click a ward. Double-click to fly there.')), info));
      draw(); showInfo();
      clearInterval(timer);
      timer = setInterval(draw, 120);
    },
    close() { clearInterval(timer); },
  };
}
