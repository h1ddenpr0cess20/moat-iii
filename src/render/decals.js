import { FARM_ZONES, ZONES, ZONE_ID } from '../catalog.js';

/** The zones drawn as crops rather than as a wash of the zone's color. */
const FIELDS = new Set(FARM_ZONES.map((z) => ZONE_ID[z]));
import { CHUNK, CHUNKS, ROAD } from '../config.js';
import { HV, SUB, heightAt, idx, inb } from '../world/world.js';
import { rgb } from 'madness-engine/mesher';
import { freeGeometry } from './dispose.js';

/**
 * What lies on the ground: roads (autotiled from an atlas, so every bend and
 * junction joins its neighbors), fields (which sow, grow, ripen and are cut
 * as the year goes), kitchen gardens, and the faint color of land set aside
 * for houses and shops. All are thin quads that follow the ground.
 */

const CELL = 64;
const LIFT = 0.03;
/**
 * The atlases leave a margin around every cell. The smaller mip levels a far-off tile is drawn from blend each
 * texel with its neighbors, and with no margin the neighbor is the next cell, so a road bends toward a shape
 * it is not and a field takes the color of the one beside it in the atlas, differently as the camera moves.
 */
const PAD = 8;
const STRIDE = CELL + 2 * PAD;
/** The roads' atlas: a column for each of the 16 ways a road meets its neighbors, and one that is solid. */
const ROAD_COLS = 17, ROAD_ROWS = 8;
const SOLID = 16;
/** The fields' atlas: a column for each stage of the year, a row for each crop and each way its rows run. */
const FIELD_COLS = 6, FIELD_ROWS = 8;

/** Where a cell lies in texture coordinates: left, top, right, bottom. */
const cellUV = (col, row, cols, rows) => [
  (col * STRIDE + PAD) / (cols * STRIDE), 1 - (row * STRIDE + PAD) / (rows * STRIDE),
  (col * STRIDE + PAD + CELL) / (cols * STRIDE), 1 - (row * STRIDE + PAD + CELL) / (rows * STRIDE),
];

/**
 * Fills the margin around the cell at (ox, oy): by running the cell's edge on (`clamp`, for the roads, whose edge
 * is where a road leaves the tile) or by bringing the opposite edge around (`wrap`, for the fields, which repeat).
 */
function pad(ctx, ox, oy, wrap) {
  const a = ctx.canvas;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, y, w, h] of [[ox - PAD, oy - PAD, STRIDE, PAD], [ox - PAD, oy + CELL, STRIDE, PAD], [ox - PAD, oy, PAD, CELL], [ox + CELL, oy, PAD, CELL]]) ctx.clearRect(x, y, w, h);
  if (wrap) {
    ctx.drawImage(a, ox + CELL - PAD, oy, PAD, CELL, ox - PAD, oy, PAD, CELL);
    ctx.drawImage(a, ox, oy, PAD, CELL, ox + CELL, oy, PAD, CELL);
    ctx.drawImage(a, ox - PAD, oy + CELL - PAD, STRIDE, PAD, ox - PAD, oy - PAD, STRIDE, PAD);
    ctx.drawImage(a, ox - PAD, oy, STRIDE, PAD, ox - PAD, oy + CELL, STRIDE, PAD);
  } else {
    ctx.drawImage(a, ox, oy, 1, CELL, ox - PAD, oy, PAD, CELL);
    ctx.drawImage(a, ox + CELL - 1, oy, 1, CELL, ox + CELL, oy, PAD, CELL);
    ctx.drawImage(a, ox - PAD, oy, STRIDE, 1, ox - PAD, oy - PAD, STRIDE, PAD);
    ctx.drawImage(a, ox - PAD, oy + CELL - 1, STRIDE, 1, ox - PAD, oy + CELL, STRIDE, PAD);
  }
  ctx.restore();
}

function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

const seeded = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

/** The roads: 16 shapes (which of N, E, S, W it joins) and a solid one, by 4 variants by 2 kinds. */
function paintRoads(_cobble) {
  const [atlas, ctx] = surface(STRIDE * ROAD_COLS, STRIDE * ROAD_ROWS);
  // The corner of a tile where its neighbors on both sides are roads is the solid one's (see `build`), so the shapes need no more than the 8 by 8 that leaves.
  const m = 8, r = 12, out = 16;
  const rnd = seeded(77);
  for (let type = 0; type < 2; type++) {
    for (let variant = 0; variant < 4; variant++) {
      for (let mask = 0; mask < ROAD_COLS; mask++) {
        const solid = mask === SOLID;
        const ox = mask * STRIDE + PAD, oy = (type * 4 + variant) * STRIDE + PAD;
        // The arms run on past the edge of the cell, so that the worn verge drawn around the road does not close across where it goes on.
        const path = () => {
          ctx.beginPath();
          if (solid) { ctx.rect(ox, oy, CELL, CELL); return; }
          ctx.roundRect(ox + m, oy + m, CELL - 2 * m, CELL - 2 * m, r);
          if (mask & 1) ctx.rect(ox + m, oy - out, CELL - 2 * m, m + r + out);
          if (mask & 2) ctx.rect(ox + CELL - m - r, oy + m, m + r + out, CELL - 2 * m);
          if (mask & 4) ctx.rect(ox + m, oy + CELL - m - r, CELL - 2 * m, m + r + out);
          if (mask & 8) ctx.rect(ox - out, oy + m, m + r + out, CELL - 2 * m);
        };
        // The sidewalk: a pale curb around the road.
        if (!solid) {
          ctx.save();
          ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
          if ('filter' in ctx) ctx.filter = 'blur(2px)';
          path();
          ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(206,202,192,0.95)'; ctx.stroke();
          ctx.fillStyle = 'rgba(206,202,192,0.95)'; ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
        path();
        ctx.clip();
        // Asphalt, a little speckled; a street has a dashed yellow line down the middle, a boulevard a double one and a median.
        const open = solid ? 0 : mask;
        ctx.fillStyle = type === 0 ? '#4a4b4f' : '#3e3f44'; ctx.fillRect(ox, oy, CELL, CELL);
        for (let k = 0; k < 160; k++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(20,20,22,0.3)' : 'rgba(150,150,150,0.18)'; ctx.fillRect(ox + rnd() * CELL, oy + rnd() * CELL, 1 + rnd() * 2, 1 + rnd()); }
        const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
        const straight = open === 5 || open === 10;
        if (straight || (open && (open & (open - 1)) === 0)) {
          const v = open & 5;
          ctx.lineWidth = type === 0 ? 2 : 6;
          ctx.strokeStyle = type === 0 ? '#e8c440' : '#6a9a4a';
          ctx.setLineDash(type === 0 ? [7, 6] : []);
          if (v) line(ox + CELL / 2, oy + (open & 1 ? 0 : CELL / 2), ox + CELL / 2, oy + (open & 4 ? CELL : CELL / 2));
          else line(ox + (open & 8 ? 0 : CELL / 2), oy + CELL / 2, ox + (open & 2 ? CELL : CELL / 2), oy + CELL / 2);
          ctx.setLineDash([]);
        }
        ctx.restore();
        pad(ctx, ox, oy, false);
      }
    }
  }
  return atlas;
}

const STAGES = FIELD_COLS;

/** The fields: for each crop and each stage of its year, with the rows running either way. */
function paintFields() {
  const [atlas, ctx] = surface(STRIDE * FIELD_COLS, STRIDE * FIELD_ROWS);
  const rnd = seeded(91);
  const S = CELL;
  for (let crop = 0; crop < 4; crop++) {
    for (let orient = 0; orient < 2; orient++) {
      for (let stage = 0; stage < STAGES; stage++) {
        const ox = stage * STRIDE + PAD, oy = (crop * 2 + orient) * STRIDE + PAD;
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, S, S); ctx.clip();
        ctx.translate(ox + S / 2, oy + S / 2);
        if (orient) ctx.rotate(Math.PI / 2);
        ctx.translate(-S / 2, -S / 2);
        const frost = stage === 5;
        const soil = frost ? '#7a6a5a' : '#6e5034';
        const rows = 12, sp = S / rows;
        const plant = (cols, w) => { for (let r = 0; r < rows; r++) { ctx.strokeStyle = cols[0]; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, r * sp + sp * 0.3); ctx.lineTo(S, r * sp + sp * 0.3); ctx.stroke(); ctx.strokeStyle = cols[1]; ctx.lineWidth = w * 0.4; ctx.beginPath(); ctx.moveTo(0, r * sp + sp * 0.3 - w * 0.2); ctx.lineTo(S, r * sp + sp * 0.3 - w * 0.2); ctx.stroke(); } };
        if (crop === 0 || crop === 1) {
          ctx.fillStyle = soil; ctx.fillRect(0, 0, S, S);
          // Plowed earth: dark troughs, pale ridges, and clods.
          for (let r = 0; r < rows; r++) {
            ctx.fillStyle = frost ? '#6e6052' : '#523a24'; ctx.fillRect(0, r * sp + sp * 0.62, S, sp * 0.38);
            ctx.fillStyle = frost ? '#9a8a7a' : '#86663f'; ctx.fillRect(0, r * sp + sp * 0.18, S, sp * 0.22);
          }
          for (let k = 0; k < 140; k++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,26,14,0.3)' : 'rgba(180,150,100,0.26)'; ctx.fillRect(rnd() * S, rnd() * S, 1.6, 1.2); }
          if (crop === 0) {
            if (stage === 1) for (let r = 0; r < rows; r++) for (let k = 0; k < 12; k++) { ctx.fillStyle = '#86b84e'; ctx.fillRect(k * 5.4 + (r % 2) * 2.5, r * sp + sp * 0.3, 1.6, 2.4); }
            if (stage === 2) plant(['#5e9a34', '#84c04e'], 4);
            if (stage === 3) { plant(['#cfa63e', '#ecd26e'], 5.4); for (let k = 0; k < 90; k++) { ctx.fillStyle = 'rgba(240,215,120,0.6)'; ctx.fillRect(rnd() * S, rnd() * S, 1.4, 1.4); } }
            if (stage === 4) { ctx.strokeStyle = '#c4a766'; ctx.lineWidth = 1.6; for (let r = 0; r < rows; r++) { ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(0, r * sp + sp * 0.3); ctx.lineTo(S, r * sp + sp * 0.3); ctx.stroke(); } ctx.setLineDash([]); }
          } else {
            // Vegetables: round heads in rows.
            const heads = stage === 0 ? 0 : stage === 1 ? 0.5 : stage === 2 ? 0.8 : stage === 3 ? 1 : 0.35;
            if (stage < 5) for (let r = 0; r < rows; r++) for (let k = 0; k < 7; k++) {
              const x = k * 9.4 + 4 + (r % 2) * 3, y = r * sp + sp * 0.3;
              ctx.fillStyle = stage === 3 ? (rnd() < 0.2 ? '#a64a6a' : '#8ab84e') : '#6aa23a';
              ctx.beginPath(); ctx.arc(x, y, 1.2 + 2.6 * heads, 0, 7); ctx.fill();
              ctx.fillStyle = 'rgba(210,235,150,0.5)'; ctx.beginPath(); ctx.arc(x - 0.8, y - 0.8, 0.9 * heads + 0.3, 0, 7); ctx.fill();
            }
          }
        } else if (crop === 2) {
          // Pasture: grass, greener as the year ripens, with clumps and flowers.
          const g = ['#7a9a46', '#7fa84a', '#88b650', '#7aa84a', '#a49a56', '#9aa48a'][stage];
          ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
          for (let k = 0; k < 170; k++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,70,20,0.28)' : 'rgba(190,220,120,0.3)'; ctx.fillRect(rnd() * S, rnd() * S, 1.5, 2.2); }
          if (stage >= 1 && stage <= 3) for (let k = 0; k < 7; k++) { ctx.fillStyle = ['#f4ecc8', '#e8c84a', '#d88aa8'][k % 3]; ctx.fillRect(rnd() * S, rnd() * S, 1.6, 1.6); }
        } else {
          // Kitchen garden: raised beds with paths between.
          ctx.fillStyle = frost ? '#9a8a78' : '#8a7458'; ctx.fillRect(0, 0, S, S);
          for (let b = 0; b < 3; b++) {
            const by = 3 + b * 20;
            ctx.fillStyle = frost ? '#6a5c4e' : '#4e3a26'; ctx.fillRect(4, by, S - 8, 15);
            const n = stage === 0 || frost ? 0 : stage;
            for (let k = 0; k < 9; k++) {
              const x = 8 + k * 6.4, y = by + 7.5;
              ctx.fillStyle = n >= 3 ? (k % 3 === 0 ? '#c45a5a' : '#7ab048') : n >= 1 ? '#6aa23a' : 'transparent';
              ctx.beginPath(); ctx.arc(x, y, 1 + n * 0.8, 0, 7); ctx.fill();
            }
          }
        }
        ctx.restore();
        pad(ctx, ox, oy, true);
      }
    }
  }
  return atlas;
}

/** The corners of a tile: which two sides meet there (N 1, E 2, S 4, W 8), and which way the diagonal neighbor is. */
const CORNERS = [[0, 1, 2, 1, -1], [1, 2, 4, 1, 1], [2, 4, 8, -1, 1], [3, 8, 1, -1, -1]];

/** The stage of a field's year, 0 to 5. */
export function fieldStage(zone, crop, cal) {
  const { season, weekInSeason } = cal;
  if (zone === ZONE_ID.pasture || zone === ZONE_ID.orchard) return [2, 3, 4, 5][season] ?? 3;
  if (season === 3) return 5;
  if (season === 2) return crop >= 120 ? (weekInSeason < 7 ? 3 : 4) : crop > 20 ? 2 : 0;
  return crop < 8 ? 0 : crop < 60 ? 1 : crop < 150 ? 2 : 3;
}

export function createDecals(GFX, world, materials, scene) {
  const group = new GFX.Group();
  group.name = 'decals';
  scene.add(group);
  const roadAtlas = new GFX.CanvasTexture(paintRoads(materials.tex.cobble.map.image));
  roadAtlas.colorSpace = GFX.SRGBColorSpace;
  roadAtlas.anisotropy = 8;
  const fieldAtlas = new GFX.CanvasTexture(paintFields());
  fieldAtlas.colorSpace = GFX.SRGBColorSpace;
  fieldAtlas.anisotropy = 8;
  const roadMat = new GFX.MeshStandardMaterial({ map: roadAtlas, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false });
  const fieldMat = new GFX.MeshStandardMaterial({ map: fieldAtlas, roughness: 0.95, metalness: 0, transparent: true, depthWrite: false });
  const zoneMat = new GFX.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false });
  const chunks = Array.from({ length: CHUNKS * CHUNKS }, () => ({ road: null, field: null, zone: null, fields: false }));
  let zoneBoost = 0;
  let cal = { season: 1, weekInSeason: 0 };

  /** Rows run along the longer way a field goes: 0 along x, 1 along y. */
  const runsAlong = (x, y, z) => {
    let hx = 1, hy = 1;
    for (let k = 1; k < 12 && inb(x - k, y) && world.zone[idx(x - k, y)] === z; k++) hx++;
    for (let k = 1; k < 12 && inb(x + k, y) && world.zone[idx(x + k, y)] === z; k++) hx++;
    for (let k = 1; k < 12 && inb(x, y - k) && world.zone[idx(x, y - k)] === z; k++) hy++;
    for (let k = 1; k < 12 && inb(x, y + k) && world.zone[idx(x, y + k)] === z; k++) hy++;
    return hx >= hy ? 0 : 1;
  };

  const hAt = (vx, vy) => world.h[Math.max(0, Math.min(HV - 1, vy)) * HV + Math.max(0, Math.min(HV - 1, vx))];

  /** A tile's quad as 2x2 pieces that follow the ground. `uv` is [u0, v0, u1, v1] across the whole tile. */
  const tileQuads = (out, x, y, uv, color = null) => {
    const step = 1 / SUB;
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const vx = x * SUB + i, vy = y * SUB + j;
        const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => ({ x: x + (i + a) * step, z: y + (j + b) * step, y: hAt(vx + a, vy + b) + LIFT, u: (i + a) / SUB, v: (j + b) / SUB }));
        for (const k of [0, 2, 1, 0, 3, 2]) {
          const p = pts[k];
          out.pos.push(p.x, p.y, p.z);
          out.nor.push(0, 1, 0);
          if (uv) out.uv.push(uv[0] + (uv[2] - uv[0]) * p.u, uv[1] + (uv[3] - uv[1]) * p.v);
          if (color) out.col.push(color[0], color[1], color[2]);
        }
      }
    }
  };

  /**
   * A square of a tile's corner, `size` of the tile along its sides, on the ground. `corner` is 0 for the
   * north-east, 1 south-east, 2 south-west, 3 north-west; `uv` is the cell it is cut from, as for `tileQuads`.
   */
  const cornerQuad = (out, x, y, corner, uv, size) => {
    const east = corner === 0 || corner === 1, south = corner === 1 || corner === 2;
    const fu = east ? 1 - size : 0, fv = south ? 1 - size : 0;
    const pts = [[fu, fv], [fu + size, fv], [fu + size, fv + size], [fu, fv + size]].map(([u, v]) => ({ x: x + u, z: y + v, y: heightAt(world, x + u, y + v) + LIFT, u, v }));
    for (const k of [0, 2, 1, 0, 3, 2]) {
      const p = pts[k];
      out.pos.push(p.x, p.y, p.z);
      out.nor.push(0, 1, 0);
      out.uv.push(uv[0] + (uv[2] - uv[0]) * p.u, uv[1] + (uv[3] - uv[1]) * p.v);
    }
  };

  const geometry = (out, withUv, withColor) => {
    if (!out.pos.length) return null;
    const g = new GFX.BufferGeometry();
    g.setAttribute('position', new GFX.BufferAttribute(new Float32Array(out.pos), 3));
    g.setAttribute('normal', new GFX.BufferAttribute(new Float32Array(out.nor), 3));
    if (withUv) g.setAttribute('uv', new GFX.BufferAttribute(new Float32Array(out.uv), 2));
    if (withColor) g.setAttribute('color', new GFX.BufferAttribute(new Float32Array(out.col), 3));
    g.computeBoundingSphere();
    return g;
  };

  const place = (slot, c, g, material, order) => {
    if (c[slot]) { group.remove(c[slot]); freeGeometry(c[slot].geometry); c[slot] = null; }
    if (!g) return;
    const mesh = new GFX.Mesh(g, material);
    mesh.renderOrder = order;
    mesh.receiveShadow = true;
    group.add(mesh);
    c[slot] = mesh;
  };

  const build = (i) => {
    const cx = i % CHUNKS, cy = Math.floor(i / CHUNKS);
    const roads = { pos: [], nor: [], uv: [] }, fields = { pos: [], nor: [], uv: [] }, zones = { pos: [], nor: [], col: [] };
    const c = chunks[i];
    let any = false;
    const roadAt = (x, y) => inb(x, y) && world.road[idx(x, y)] !== ROAD.NONE;
    for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
      for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
        const t = idx(x, y);
        const r = world.road[t];
        if (r === ROAD.DIRT || r === ROAD.COBBLE) {
          const mask = (roadAt(x, y - 1) ? 1 : 0) | (roadAt(x + 1, y) ? 2 : 0) | (roadAt(x, y + 1) ? 4 : 0) | (roadAt(x - 1, y) ? 8 : 0);
          const variant = Math.floor(((x * 73856093) ^ (y * 19349663)) >>> 0) % 4;
          const row = (r === ROAD.COBBLE ? 4 : 0) + variant;
          tileQuads(roads, x, y, cellUV(mask, row, ROAD_COLS, ROAD_ROWS));
          // Where the road goes on both ways and on the diagonal too, the tile's corner is road: the shape has a notch there that a road two tiles wide would show as a hole at every crossing of the tiles.
          for (const [corner, a, b, dx, dy] of CORNERS) {
            if ((mask & a) && (mask & b) && roadAt(x + dx, y + dy)) cornerQuad(roads, x, y, corner, cellUV(SOLID, row, ROAD_COLS, ROAD_ROWS), 0.135);
          }
          continue;
        }
        const z = world.zone[t];
        if (!z || world.bld[t] || world.road[t]) continue;
        if (FIELDS.has(z)) {
          const name = z === ZONE_ID.wheat ? 0 : z === ZONE_ID.veg ? 1 : 2;
          const orient = runsAlong(x, y, z);
          const stage = fieldStage(z, world.crop[t], cal);
          const row = name * 2 + orient;
          tileQuads(fields, x, y, cellUV(stage, row, FIELD_COLS, FIELD_ROWS));
          any = true;
        } else {
          const color = rgb(ZONES[Object.keys(ZONES)[z - 1]].color);
          tileQuads(zones, x, y, null, color);
        }
      }
    }
    // Kitchen gardens in the land behind the houses.
    if (world.cores) {
      for (const t of world.cores) {
        const x = t % world.size, y = Math.floor(t / world.size);
        if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy || world.bld[t]) continue;
        const orient = (x + y) & 1;
        const stage = [1, 3, 3, 0][cal.season] ?? 1;
        const row = 6 + orient;
        tileQuads(fields, x, y, cellUV(stage, row, FIELD_COLS, FIELD_ROWS));
      }
    }
    place('road', c, geometry(roads, true, false), roadMat, 1.5);
    place('field', c, geometry(fields, true, false), fieldMat, 1.2);
    place('zone', c, geometry(zones, false, true), zoneMat, 1.8);
    c.fields = any;
  };

  return {
    group,
    sync(calendar, budget = 3) {
      cal = calendar;
      let n = 0;
      for (const i of [...world.dirty.flat]) {
        world.dirty.flat.delete(i);
        build(i);
        if (++n >= budget) break;
      }
    },
    buildAll() { for (let i = 0; i < chunks.length; i++) build(i); world.dirty.flat.clear(); },
    /** The crops change with the year: redraw the chunks with fields in them. */
    refreshFields(calendar) {
      cal = calendar;
      chunks.forEach((c, i) => { if (c.fields) world.dirty.flat.add(i); });
    },
    /** How strongly the zones show: faint, or bold while the founder is zoning. */
    setZoneBoost(b) {
      zoneBoost = b;
      zoneMat.opacity = 0.2 + 0.28 * zoneBoost;
    },
    get zoneBoost() { return zoneBoost; },
  };
}
