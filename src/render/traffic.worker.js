import { serveBakes } from 'madness-engine/models/bake';
import { SCULPTED } from './traffic.js';

/** Bakes the cars off the main thread (see traffic.js). */
serveBakes(SCULPTED);
