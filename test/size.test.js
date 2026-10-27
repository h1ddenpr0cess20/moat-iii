import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/** The map's size is fixed when the game starts, so each size is tried in a process of its own. */
const run = (wards, code) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, MOAT_WARDS: String(wards) }, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }).trim().split('\n').pop());

const CODE = `
import { SIZE, WARDS, CENTER, HOME_WARD, WARD } from './src/config.js';
import { startGame, step } from './src/sim/game.js';
import { serialize, deserialize } from './src/save.js';
import { wardOfTile, wardId } from './src/world/index.js';
const g = startGame({ seed: 'sizes' });
for (let w = 0; w < 30; w++) step(g);
const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
console.log(JSON.stringify({ WARDS, SIZE, CENTER, wards: g.world.wards.length, homeOk: wardOfTile(CENTER, CENTER) === wardId(HOME_WARD, HOME_WARD), gates: g.world.gates.length, buildings: g.world.buildings.size, back: back.world.buildings.size, h: g.world.h.length }));
`;

for (const wards of [7, 9, 11]) {
  test(`a ${wards} by ${wards} ward map is made, played and saved`, () => {
    const r = run(wards, CODE);
    assert.equal(r.WARDS, wards);
    assert.equal(r.SIZE, wards * 30);
    assert.equal(r.wards, wards * wards);
    assert.equal(r.CENTER, (wards * 30) / 2);
    assert.ok(r.homeOk, 'the castle is in the middle ward');
    assert.equal(r.gates, 4);
    assert.equal(r.buildings, r.back, 'the save brings every building back');
    assert.equal(r.h, (wards * 60 + 1) ** 2);
  });
}

test('a save from a map of another size is refused, not misread', () => {
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { deserialize, serialize } from './src/save.js';
    import { startGame } from './src/sim/game.js';
    const data = serialize(startGame({ seed: 'a' }));
    data.mapWards = 11;
    try { deserialize(data); console.log(JSON.stringify({ ok: true })); } catch (e) { console.log(JSON.stringify({ ok: false, message: e.message })); }
  `], { env: { ...process.env, MOAT_WARDS: '7' }, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }).trim().split('\n').pop());
  assert.equal(r.ok, false);
  assert.match(r.message, /another size/);
});
