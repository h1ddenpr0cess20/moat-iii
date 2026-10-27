# Moat III: The Island

A California city builder on an island in the Pacific, built on the [Madness Engine](https://github.com/h1ddenpr0cess20/madness-engine).

You're a tech billionaire. You bought an island off the coast, put your tower in the middle with a canal around it, Venice Beach style, and now you're building the company town around it. Zone homes, shops and industry, SimCity-style. Run the police, fire stations, schools, parks and hospitals. Dig the canals wider to take in the next district. The best way to lay out a neighborhood is still the **donut block**.

It's a peaceful game: no raiders and no defenses. The only trouble is the odd fire, earthquake or hurricane, and you can turn all three off.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # a static site in dist/
npm test         # world, simulation, block and save tests
npm run lint
```

Node 22.12 or later. The game needs a browser with WebGPU or WebGL 2.

## How to play

| | |
|---|---|
| Slide the map | WASD or arrows; right button dragged; one finger on empty ground |
| Turn / tilt / zoom | Q E / Z X / wheel (or pinch and twist on touch) |
| Tools | 1 look · 2 streets · 3 zones · 4 blocks · 5 build · 6 bulldoze · Esc or right-click lets go |
| Turn a building | R while it is in your hand |
| Time | Space pauses, Tab speeds up |
| Pages | M districts · L budget · H news · C your tower · F10 settings |

**Zones.** Low Residential grows craftsman bungalows, then Spanish revivals, then modern beach houses. High Residential grows dingbats, then apartments, then condo towers. Commercial grows strip malls, then startup rows, then glass tech towers. Industrial grows fulfillment centers, then chip fabs, then tech campuses. Private money builds them, so they cost the city nothing; bulldoze one and you get nothing back.

**Demand.** The R C I meter at the top shows what the island wants. Homes want jobs. Shops want customers. Industry wants workers, and it sells off the island as well. High taxes and an unhappy island push all three down.

**Services.** Police keep crime down. Fire stations stop fires starting and spreading, and they get people through a hurricane. Schools educate, parks and plazas cheer, and hospitals heal. Each one reaches a circle of tiles and costs a weekly budget, which you set in the **Budget** (L) along with the tax rate. Buildings rise a level when the land is good: services nearby, a good block, and no smog. Chip fabs smoke, so keep industry back from the homes.

**Donut blocks.** Take the **Blocks** tool (4), pick **Open ★** for the core, and click to stamp a loop of street with a ring of lots inside it. Put a **Plaza** or a **Park** in the core and the block earns a rating from 0 to 100. A good block raises taxes, room, mood and safety, and its heart's services reach every door in the ring.

**Your tower.** It starts as a Startup HQ and grows to a Unicorn Tower, a Decacorn Spire and finally the Trillion-Dollar Tower. Each tier can run more districts. The island grows from Garage Town to Startup Town, Tech Hub, Silicon City and, last of all, Tech Capital of the World.

**Disasters.** Fires are rare. Earthquakes can bring down low old buildings near the epicenter; towers are built for it. From August to November a hurricane may come in off the Pacific. You get a week's warning, then two weeks of storm: the sea gets up, and low buildings by the shore suffer most.

## How it is made

* `src/world/`: the island from a seed (heightfield falling to the sea, the canal's distance field, districts, bridges, streets, zones, lots). Pure JS, no drawing.
* `src/sim/`: the weekly simulation (taxes and budgets, R C I demand, jobs, mood and crime, growth, fires, earthquakes, hurricanes, blocks, actions). Pure JS. `src/save.js` stores only what changed from the seeded land.
* `src/render/`: the picture, drawn with the engine's `gfx`, `stage` and `view`. The sea and the canals are the engine's `ocean`, calmed to its `river` canal water up close and stirred into its storm sea by a hurricane. The trees are the engine's `flora` (date palms, fan palms, redwoods, cypresses). The buildings are the engine's `buildings/california` models. The traffic is the engine's cars, driving the streets.
* `src/audio/`: sound and a generative score, all Web Audio, no samples.
