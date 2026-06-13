# Stellar Conquest

A mobile-first 3D space conquest game for the browser. Inspired by *Konquest*
and *Galcon*: start on a single world, grow fleets, and conquer the galaxy —
planet by planet — against the AI.

Built with [Three.js](https://threejs.org/) and vanilla ES modules. No build
step, no framework.

## Play

It's a static site, so any web server works:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000` on your phone or desktop. (Opening
`index.html` via `file://` won't work — browsers block ES module loading from
the filesystem.)

> Three.js is loaded from the jsDelivr CDN via an import map, so the page needs
> internet access on first load. To run fully offline, download
> `three.module.js` (v0.161.0) into `vendor/` and point the import map in
> `index.html` at it.

## How to play

- **Tap a world you own** to select it. A panel shows its garrison.
- **Tap another world** to open the fleet dispatcher — choose how many ships to
  send with the slider or the 25% / 50% / 75% / All buttons, then **Launch**.
- **Drag** to orbit the camera, **pinch** (or scroll wheel) to zoom.
- Worlds you own grow new ships over time. Capture neutral and enemy worlds by
  arriving with more ships than the defenders.
- **Fog of war:** you only see ship counts and enemy fleets near your worlds and
  fleets. Unseen worlds show `?`.
- **Fleets clash in transit** — if your ships cross an enemy fleet on the way,
  they fight, and the larger force survives with the difference.
- **Capital ships:** once your empire reaches **Tech 3** (5+ worlds), select a
  world and build a Capital Ship. It becomes a **warp hub** — fleets launched
  from it travel far faster, letting you project power across the galaxy.

Win by eliminating every rival empire. Lose if you lose every world.

## Project layout

```
index.html        markup + import map + UI overlay
css/style.css     mobile-first HUD / panels
js/
  main.js         bootstrap + render loop
  game.js         galaxy generation, simulation, fog, combat, win/lose
  scene.js        renderer, camera, lights, starfield, touch controls
  planet.js       rotating planets, atmospheres, ownership rings, capital markers
  fleet.js        fleets of dots, travel, warp, interception
  ai.js           enemy empire logic
  ui.js           HUD, labels, panels, toasts, overlays
  textures.js     procedural planet / cloud / star / sprite textures
  noise.js        seedable 3D simplex noise + fBm
  constants.js    owners, colours, tech thresholds, difficulty tuning
```

No music, no story — just conquest.
