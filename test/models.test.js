import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOOTPRINTS } from 'madness-engine/buildings';
import { BUILDINGS } from '../src/catalog.js';
import { modelFor, sizeOf } from '../src/render/models/index.js';

/**
 * The models are the engine's, and it tests their faces (`madness-engine`'s
 * test/buildings.test.js). What is the game's to check is that the catalog
 * and the models agree.
 */

test('every building in the catalog has a model drawn for the size the catalog gives it', () => {
  for (const [type, b] of Object.entries(BUILDINGS)) {
    assert.deepEqual(FOOTPRINTS[type], b.size, `${type} is ${b.size} in the catalog and ${FOOTPRINTS[type]} in the model`);
    assert.deepEqual(sizeOf(type), b.size);
    const parts = modelFor(type, { level: 1, variant: 0 }).parts;
    assert.ok(Object.values(parts).some((p) => p.count > 0), `${type} has no model`);
  }
});

test('a building going up has a model at every stage', () => {
  for (const type of Object.keys(BUILDINGS)) {
    for (const progress of [0.1, 0.4, 0.7, 0.9]) {
      assert.ok(Object.values(modelFor(type, { building: true, progress }).parts).some((p) => p.count > 0), `${type} at ${progress}`);
    }
  }
});
