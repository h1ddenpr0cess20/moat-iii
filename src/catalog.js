/**
 * Everything the game knows by name: the zones, the buildings, City Hall's
 * tiers and the ranks a city rises through. The simulation and the interface
 * both read this; nothing here does anything by itself.
 *
 * A week is a tick. Money is in thousands of dollars.
 */

/** The one good: the city's funds. */
export const RESOURCES = Object.freeze({
  gold: { name: 'Funds', store: null, spoil: 0 },
});
export const GOODS = Object.keys(RESOURCES);

/** Zones: land set aside for people and firms to build on themselves. */
export const ZONES = Object.freeze({
  res: { id: 'res', name: 'Low Residential', short: 'R', color: '#59b35f', cost: 1, desc: 'Bungalows, Spanish revivals and beach houses on their own lots, with a palm out front.' },
  dense: { id: 'dense', name: 'High Residential', short: 'R+', color: '#2f8a3a', cost: 2, desc: 'Dingbats, mid-rise apartments and condo towers. Many more people to a lot, but they want services close.' },
  com: { id: 'com', name: 'Commercial', short: 'C', color: '#4f8fd6', cost: 2, desc: 'Strip malls, startup rows and, once the city is big, glass tech towers. They want customers: people nearby.' },
  ind: { id: 'ind', name: 'Industrial', short: 'I', color: '#d6b24f', cost: 1, industry: true, desc: 'Fulfillment centers, chip fabs and tech campuses: jobs, but noise and smoke. Keep them back from the homes.' },
});
export const ZONE_LIST = Object.keys(ZONES);
/** Zone numbers as they are stored on the map: 0 is none. */
export const ZONE_ID = Object.freeze(Object.fromEntries(ZONE_LIST.map((z, i) => [z, i + 1])));
export const ZONE_NAME = [null, ...ZONE_LIST];
/** There are no fields in this city. */
export const FARM_ZONES = [];
/** The zones industry grows on. */
export const INDUSTRY_ZONES = ['ind'];
/** The zones people live on. */
export const HOME_ZONES = ['res', 'dense'];

/** How many tiles a lot reaches back from the street before the block's core begins. */
export const PLOT_DEPTH = 3;
/** Kept for the tools: nothing in this city needs a farm. */
export const FARM_RADIUS = 0;

/**
 * The buildings. `size` is [width along the street, depth]; `cost` is what
 * they cost; `weeks` how long they take; `jobs` how many work there; `cap`
 * how many live there. `auto` ones grow by themselves on zoned land. `serve`
 * is what a civic building gives the tiles around it; `upkeep` its weekly
 * budget.
 */
export const BUILDINGS = Object.freeze({
  // Grown on the zones.
  bungalow: { name: 'Craftsman Bungalow', cat: 'housing', size: [2, 2], cost: { gold: 8 }, weeks: 3, crew: 2, cap: 4, auto: 'res', level: 1, desc: 'A deep porch, a low gable and a lawn.' },
  ranchhouse: { name: 'Spanish Revival', cat: 'housing', size: [2, 2], cost: { gold: 14 }, weeks: 3, crew: 2, cap: 5, auto: 'res', level: 2, desc: 'White stucco, red tile and a little tower by the door.' },
  beachhouse: { name: 'Modern Beach House', cat: 'housing', size: [2, 2], cost: { gold: 24 }, weeks: 4, crew: 2, cap: 6, auto: 'res', level: 3, desc: 'Glass and white boxes and a roof deck. Wants a good address.' },
  dingbat: { name: 'Dingbat', cat: 'housing', size: [2, 2], cost: { gold: 16 }, weeks: 3, crew: 2, cap: 12, auto: 'dense', level: 1, desc: 'Two floors of stucco over a carport, a name in script on the front.' },
  aptblock: { name: 'Apartments', cat: 'housing', size: [2, 3], cost: { gold: 36 }, weeks: 5, crew: 3, cap: 30, auto: 'dense', level: 2, desc: 'Five floors of balconies with a garden on the roof.' },
  condotower: { name: 'Condo Tower', cat: 'housing', size: [2, 3], cost: { gold: 80 }, weeks: 8, crew: 4, cap: 70, auto: 'dense', level: 3, desc: 'Glass and white, a balcony on every floor, an ocean view at the top.' },
  stripmall: { name: 'Strip Mall', cat: 'market', size: [2, 2], cost: { gold: 12 }, weeks: 2, crew: 2, jobs: 6, shop: 1.2, auto: 'com', level: 1, desc: 'A taco stand, a boba shop and a co-working space, and parking out front.' },
  boutique: { name: 'Startup Row', cat: 'market', size: [2, 2], cost: { gold: 26 }, weeks: 4, crew: 2, jobs: 14, shop: 2.8, auto: 'com', level: 2, desc: 'A café under the awning and three startups upstairs.' },
  officetower: { name: 'Tech Tower', cat: 'market', size: [2, 3], cost: { gold: 90 }, weeks: 10, crew: 4, jobs: 60, shop: 7, auto: 'com', level: 3, desc: 'Forty floors of glass: a social network, a search engine, a chip designer. Wants a big city around it.' },
  warehouse: { name: 'Fulfillment Center', cat: 'industry', size: [2, 3], cost: { gold: 12 }, weeks: 3, crew: 2, jobs: 10, shop: 0.8, auto: 'ind', level: 1, desc: 'Tilt-up concrete, roll-up doors and same-day delivery.' },
  factory: { name: 'Chip Fab', cat: 'industry', size: [2, 3], cost: { gold: 28 }, weeks: 4, crew: 3, jobs: 22, shop: 1.6, auto: 'ind', level: 2, smoky: true, desc: 'Clean rooms under a sawtooth roof, and a stack that is not so clean. Good jobs, and nobody wants to live next door.' },
  techpark: { name: 'Tech Campus', cat: 'industry', size: [2, 3], cost: { gold: 70 }, weeks: 6, crew: 3, jobs: 40, shop: 4, auto: 'ind', level: 3, desc: 'A glass pavilion, a green roof, scooters and free lunch. Wants schools.' },

  // The city's own.
  police: { name: 'Police Station', cat: 'safety', size: [2, 2], cost: { gold: 60 }, weeks: 6, crew: 3, jobs: 8, upkeep: 1.6, serve: { security: 1, radius: 14 }, desc: 'Keeps crime down within fourteen tiles.' },
  firehouse: { name: 'Fire Station', cat: 'safety', size: [2, 3], cost: { gold: 60 }, weeks: 6, crew: 3, jobs: 8, upkeep: 1.4, serve: { fire: 1, radius: 14 }, desc: 'Fires start less and are put out sooner within fourteen tiles.' },
  hospital: { name: 'Hospital', cat: 'safety', size: [3, 4], cost: { gold: 180 }, weeks: 12, crew: 4, jobs: 30, upkeep: 3, serve: { health: 1, radius: 20 }, rank: 1, desc: 'Healthier people, who live longer and stay.' },
  school: { name: 'School', cat: 'civic', size: [3, 3], cost: { gold: 90 }, weeks: 8, crew: 3, jobs: 12, upkeep: 1.8, serve: { education: 1, radius: 14 }, desc: 'Educated people want better homes and bring better firms.' },
  park: { name: 'Park', cat: 'civic', size: [3, 3], cost: { gold: 20 }, weeks: 2, crew: 2, upkeep: 0.3, serve: { cheer: 0.7, radius: 9 }, desc: 'Palms, a lawn, a fountain. Raises the land around it.' },
  plaza: { name: 'Plaza', cat: 'civic', size: [3, 3], cost: { gold: 45 }, weeks: 3, crew: 2, upkeep: 0.5, serve: { cheer: 1, radius: 11 }, desc: 'Pavers, cypresses and café umbrellas. The best heart for a donut block.' },
});

/** The order the build menu shows them in. */
export const CATEGORIES = Object.freeze([
  { id: 'safety', name: 'Safety' },
  { id: 'civic', name: 'Civic' },
]);

/** The buildings the zones grow, by zone and level. */
export const GROWN = Object.freeze({
  res: ['bungalow', 'ranchhouse', 'beachhouse'],
  dense: ['dingbat', 'aptblock', 'condotower'],
  com: ['stripmall', 'boutique', 'officetower'],
  ind: ['warehouse', 'factory', 'techpark'],
});

/** The tower on the island, the founder's HQ, as it grows: what the work costs, how many districts the city may keep, and the staff. */
export const CASTLE_LEVELS = Object.freeze([
  { name: 'Startup HQ', cost: null, weeks: 0, wards: 3, jobs: 4, rank: 0, desc: 'Your company’s first tower, and your penthouse on top. Glass and white stone on a plaza of palms.' },
  { name: 'Unicorn Tower', cost: { gold: 600 }, weeks: 16, wards: 6, jobs: 8, rank: 1, desc: 'A billion-dollar valuation deserves a third setback and a taller spire.' },
  { name: 'Decacorn Spire', cost: { gold: 1800 }, weeks: 28, wards: 12, jobs: 14, rank: 2, desc: 'A gold crown you can see from the pier, and a helipad for the board.' },
  { name: 'Trillion-Dollar Tower', cost: { gold: 5000 }, weeks: 48, wards: 49, jobs: 24, rank: 3, desc: 'The tallest tower on the coast, lit gold all night. You have won tech.' },
]);

/** The ranks, and what a city needs to be called one. */
export const RANKS = Object.freeze([
  { name: 'Garage Town', short: 'Garage Town', need: {} },
  { name: 'Startup Town', short: 'Startup Town', need: { pop: 300, wards: 2 } },
  { name: 'Tech Hub', short: 'Tech Hub', need: { pop: 1500, wards: 4, building: 'school' } },
  { name: 'Silicon City', short: 'Silicon City', need: { pop: 5000, wards: 8, castle: 3 } },
  { name: 'Tech Capital of the World', short: 'Tech Capital', need: { pop: 12000, wards: 12, building: 'hospital' } },
]);

/** Roads, and what they cost a tile. */
export const ROADS = Object.freeze({
  dirt: { name: 'Street', cost: { gold: 1 }, desc: 'Two lanes of asphalt.' },
  avenue: { name: 'Avenue', cost: { gold: 2 }, desc: 'Four lanes, two tiles wide, with a double yellow line down the middle. Drag along the ground: it is laid on the tiles you drag over and the row beside them.' },
  bridge: { name: 'Canal Bridge', cost: { gold: 6 }, desc: 'A bridge over a canal or a lagoon: drag from one bank to the other, up to six tiles of water, in a straight line. The grand canal is crossed only at its bridges.' },
  cobble: { name: 'Boulevard', cost: { gold: 3 }, desc: 'Palms down the median. Land along it is worth more.' },
});

/** The cost of digging canals around a new district: it grows with the city and with how hard the ground is. */
export function annexCost(owned, hardness = 0) {
  const k = 1 + hardness * 0.8;
  return { gold: Math.round((300 + owned * 180) * k / 10) * 10 };
}

/** How many weeks the digging takes, and how many hands it wants. */
export function annexWork(owned) {
  return { weeks: 10 + owned * 2, crew: Math.min(24, 8 + owned * 2) };
}

/** What the city starts with. */
export const START = Object.freeze({
  stock: { gold: 1200 },
  pop: { children: 3, adults: 10, elders: 1 },
});

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}k`;
export const costText = (cost) => Object.entries(cost).filter(([, n]) => n > 0).map(([, n]) => money(n)).join(', ');
export const canPay = (stock, cost) => Object.entries(cost).every(([k, n]) => (stock[k] ?? 0) >= n);
export function pay(stock, cost, k = 1) {
  for (const [r, n] of Object.entries(cost)) stock[r] = (stock[r] ?? 0) - n * k;
}
