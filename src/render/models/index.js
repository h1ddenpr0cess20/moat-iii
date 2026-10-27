import { createBuildings, MODELS } from 'madness-engine/buildings';
import { BUILDINGS } from '../../catalog.js';

/**
 * Every building's model, by type, built once per variant and kept. The models
 * are the engine's (`madness-engine/buildings`); the footprints they are drawn
 * for are the catalog's.
 */

/** The footprint a type's model is drawn for: [width along the street, depth] in tiles. */
export const sizeOf = (type) => (type === 'castle' ? [6, 6] : BUILDINGS[type]?.size ?? [1, 1]);

// The castle of the other games is, here, the tower on the island.
const library = createBuildings({ sizeOf, models: { castle: MODELS.cityhall } });

export const { modelFor } = library;
export const clearModels = library.clear;
export { castleScaffold } from 'madness-engine/buildings';
