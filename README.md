# Moat III: The Island

A California city builder on an island in the Pacific, built on the [Madness Engine](https://github.com/h1ddenpr0cess20/madness-engine).

You're a tech billionaire. You bought an island off the coast, put your tower in the middle with a canal around it, Venice Beach style, and now you're building the company town around it. Zone homes, shops and industry, SimCity-style. Run the police, fire stations, schools, parks and hospitals. You start with two districts, the tower's and the open one south of it. Dig the canals wider to take in more. The best way to lay out a neighborhood is still the **donut block**.

It's a peaceful game: no raiders and no defenses. The only trouble is the odd fire, earthquake or hurricane, and you can turn all three off.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # a static site in dist/
npm test         # world, simulation, block, landmark, traffic and save tests
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

**Infrastructure and leisure.** Some buildings do something for the whole island, not just the tiles around them. A **Container Port** (on the shore of the open sea, not a canal) ships what industry makes: more demand for industry, higher industrial taxes, and new industry grows toward it. An **Airport** brings business and tourists: more demand for shops, higher commercial taxes, half as many visitors again to every attraction, and towers going up in a smaller city. A **Data Center** runs the island's startups, and a **University** educates a wide circle and spins out firms. A **Marina** and a **Stadium** cheer the people around them and draw visitors, who pay hotel and sales taxes (the **Visitors** line in the budget). The first of each kind counts in full, a second for half as much again. The airport, the port, the stadium and the data center are noisy, and noise lowers the land value and the mood of the homes beside them. Smaller services fill the gaps: **Urgent Care** clinics and **Public Libraries**.

**Traffic.** Cars drive the streets by the rules: on the right, two lanes each way on an avenue with no U-turns over its double yellow line, an all-way stop where streets cross, traffic lights (a green arrow for each way in, in turn) where an avenue is crossed, nobody entering a crossing without room to leave it, and nobody running into the car in front. More people, more cars.

**Donut blocks.** Take the **Blocks** tool (4), pick **Open ★** for the core, and click to stamp a loop of street with a ring of lots inside it. Put a **Plaza** or a **Park** in the core and the block earns a rating from 0 to 100. A good block raises taxes, room, mood and safety, and its heart's services reach every door in the ring.

**Your tower.** It starts as a Startup HQ and grows to a Unicorn Tower, a Decacorn Spire and finally the Trillion-Dollar Tower. Each tier can run more districts. The island grows from Garage Town to Startup Town, Tech Hub, Silicon City and, last of all, Tech Capital of the World.

**Disasters.** Fires are rare. Earthquakes can bring down low old buildings near the epicenter; towers are built for it. From August to November a hurricane may come in off the Pacific. You get a week's warning, then two weeks of storm: the sea gets up, and low buildings by the shore suffer most.

## How it is made

* `src/world/`: the island from a seed (heightfield falling to the sea, the canal's distance field, districts, bridges, streets, zones, lots), and the traffic's rules of the road. Pure JS, no drawing.
* `src/sim/`: the weekly simulation (taxes and budgets, R C I demand, jobs, mood and crime, growth, the island-wide bonuses of ports, airports and the like, fires, earthquakes, hurricanes, blocks, actions). Pure JS. `src/save.js` stores only what changed from the seeded land.
* `src/render/`: the picture, drawn with the engine's `gfx`, `stage` and `view`. The sea and the canals are one sheet of water over every tile the ground dips under, as in Moat; a hurricane roughens it and sets its ripples racing. The trees are the engine's `flora` (date palms, fan palms, redwoods, cypresses). The buildings are the engine's `buildings/california` models. The traffic is the engine's cars, with stop signs and traffic lights at the crossings.
* `src/audio/`: sound effects and a generative California lo-fi score (electric piano, bass, a soft synth lead and a swung beat, in bright modes that change with the year), all Web Audio, no samples.
