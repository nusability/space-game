import * as THREE from 'three';
import { Planet } from './planet.js?v=10';
import { Fleet } from './fleet.js?v=10';
import { AIController } from './ai.js?v=10';
import { PLANET_TYPES } from './textures.js?v=10';
import {
  NEUTRAL, PLAYER, DIFFICULTY, techLevel, ownerColor, OWNER_NAMES,
  CAPITAL_TECH_LEVEL, CAPITAL_COST, WARP_MULTIPLIER,
} from './constants.js?v=10';

const INTERCEPT_DIST = 6.5;

const GREEK = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi','Rho','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega'];
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII'];

const TYPE_WEIGHTS = [
  ['barren', 3], ['desert', 3], ['ice', 2], ['ocean', 2], ['gas', 2], ['lava', 1.5],
];

function weightedType() {
  const total = TYPE_WEIGHTS.reduce((s, t) => s + t[1], 0);
  let r = Math.random() * total;
  for (const [t, w] of TYPE_WEIGHTS) { if ((r -= w) <= 0) return t; }
  return PLANET_TYPES[0];
}

export class Game {
  constructor(scene, ui) {
    this.scene = scene;
    this.ui = ui;
    this.planets = [];
    this.fleets = [];
    this.ais = [];
    this.started = false;
    this.over = false;
    this.gameSpeed = 1;

    this.CAPITAL_COST = CAPITAL_COST;

    this.selected = null;
    this.pendingTarget = null;

    this._wireUI();
    scene.onTap = (x, y) => this.handleTap(x, y);
  }

  _wireUI() {
    const ui = this.ui;
    ui.onStart = (opts) => this.start(opts);
    ui.onSend = (amount) => this.confirmSend(amount);
    ui.onCancel = () => this.cancelSend();
    ui.onBuildCapital = () => this.buildCapitalSelected();
    ui.onClosePlanet = () => this.deselect();
    ui.onPause = () => { this.paused = true; };
    ui.onResume = () => { this.paused = false; };
    ui.onRestart = () => { this.paused = true; this.deselect(); }; // setup overlay shown by UI
  }

  // ---------------- setup ----------------
  // opts: { difficulty, planets, ai, spectate }
  start(opts = {}) {
    this._teardown();
    const clamp = THREE.MathUtils.clamp;
    const cfg = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.cfg = cfg;
    this.over = false;
    this.started = true;
    this.ui.hideOverlay();

    this.spectate = !!opts.spectate;
    this.fogEnabled = !this.spectate;
    this.paused = false;
    this.ui.showPauseButton(true);

    const aiCount = clamp(Math.round(opts.ai ?? cfg.ai), this.spectate ? 2 : 1, this.spectate ? 4 : 3);

    // Which owner ids get a homeworld (and thus an empire).
    const homeOwners = this.spectate
      ? Array.from({ length: aiCount }, (_, i) => 1 + i)        // all AI
      : [PLAYER, ...Array.from({ length: aiCount }, (_, i) => 2 + i)];

    let planetCount = clamp(Math.round(opts.planets ?? (12 + aiCount * 3)), 6, 40);
    planetCount = Math.max(planetCount, homeOwners.length + 2);

    this._generateGalaxy(planetCount, homeOwners);

    // AI controllers for every non-human empire.
    const aiOwners = this.spectate ? homeOwners : homeOwners.filter(o => o !== PLAYER);
    this.ais = aiOwners.map(o => new AIController(this, o, cfg));

    this.ui.initLabels(this.planets);

    // Frame the action: player's home, or the whole galaxy when spectating.
    if (this.spectate) {
      this.scene.target.set(0, 0, 0);
      this.scene.focusOn(new THREE.Vector3(0, 0, 0), this.galaxyRadius * 1.7);
    } else {
      const home = this.planets.find(p => p.owner === PLAYER);
      this.scene.target.copy(home.position);
      this.scene.focusOn(home.position, this.galaxyRadius * 1.05);
    }

    this.ui.toast(this.spectate ? 'Spectating — AI vs AI' : 'Conquer the galaxy.');
  }

  _teardown() {
    this._hideLink();
    for (const f of this.fleets) { this.scene.scene.remove(f.points); f.dispose(); }
    for (const p of this.planets) { this.scene.scene.remove(p.group); }
    this.fleets = [];
    this.planets = [];
    this.selected = null;
    this.pendingTarget = null;
  }

  _generateGalaxy(count, homeOwners) {
    // Grow the galaxy with the count so worlds stay well spaced.
    const R = 80 + count * 5.6;
    this.galaxyRadius = R;
    this.scene.setBounds(R * 3.0); // allow zooming out a fair bit further
    this.scene.radius = R * 1.4;
    this.scene.panLimit = R * 1.3; // keep two-finger panning near the galaxy

    // Scale per-planet texture detail down for crowded galaxies (keeps the
    // synchronous generation responsive on mobile).
    const texSize = count > 28 ? 128 : count > 18 ? 160 : 224;

    // Poisson-ish placement. Start with a generous separation and relax it if
    // we struggle to fit them all, so we always end up with exactly `count`.
    const positions = [];
    let minDist = 40;
    let attempts = 0;
    const maxAttempts = count * 1200;
    while (positions.length < count && attempts < maxAttempts) {
      attempts++;
      // Sample within an oblate volume (flatter galaxy looks better).
      const u = Math.random(), v = Math.random();
      const r = R * Math.cbrt(Math.random());
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const p = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.45, // flatten Y
        r * Math.sin(phi) * Math.sin(theta)
      );
      if (positions.every(q => q.distanceTo(p) >= minDist)) positions.push(p);
      // If placement keeps failing, gradually loosen the spacing requirement.
      else if (attempts % (count * 30) === 0) minDist *= 0.9;
    }
    // Guarantee the requested world count even in the worst case.
    while (positions.length < count) {
      const u = Math.random(), v = Math.random();
      const r = R * Math.cbrt(Math.random());
      const theta = u * Math.PI * 2, phi = Math.acos(2 * v - 1);
      positions.push(new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.45,
        r * Math.sin(phi) * Math.sin(theta)
      ));
    }

    // Build planets.
    this.planets = positions.map((pos, i) => {
      const radius = 3.6 + Math.random() * 4.6;
      const greek = GREEK[i % GREEK.length];
      const roman = ROMAN[Math.floor(i / GREEK.length) % ROMAN.length];
      const planet = new Planet({
        name: `${greek} ${roman}`,
        position: pos,
        radius,
        type: weightedType(),
        seed: 1 + Math.floor(Math.random() * 99999),
        owner: NEUTRAL,
        ships: 4 + Math.floor(Math.random() * 14),
        production: radius * 0.5, // owner multipliers applied per-frame
        texSize,
      });
      this.scene.scene.add(planet.group);
      return planet;
    });

    // Assign homeworlds to each empire, spread far apart.
    const homeIdx = this._pickSpreadHomes(homeOwners.length);
    homeIdx.forEach((idx, k) => {
      const owner = homeOwners[k];
      const p = this.planets[idx];
      p.setOwner(owner);
      // Small head start for a human player; equal footing otherwise.
      p.ships = (!this.spectate && owner === PLAYER) ? 40 : 30;
      // Homeworlds are a touch more productive than the radius alone implies.
      p.production = p.radius * 0.7;
      // Only the human's home starts revealed (spectate reveals everything later).
      p.discovered = this.spectate || owner === PLAYER;
      p.visible = p.discovered;
    });

    // Fog state defaults.
    for (const p of this.planets) {
      if (p.discovered === undefined) { p.discovered = false; p.visible = false; }
    }
  }

  // Pick n planets that are mutually far apart (greedy farthest-point).
  _pickSpreadHomes(n) {
    const idx = [Math.floor(Math.random() * this.planets.length)];
    while (idx.length < n) {
      let best = -1, bestD = -1;
      for (let i = 0; i < this.planets.length; i++) {
        if (idx.includes(i)) continue;
        const d = Math.min(...idx.map(j => this.planets[i].position.distanceTo(this.planets[j].position)));
        if (d > bestD) { bestD = d; best = i; }
      }
      idx.push(best);
    }
    return idx;
  }

  // ---------------- interaction ----------------
  // Forgiving tap pick: choose the planet whose projected centre is nearest
  // the tap, within a generous radius, so tiny far-away worlds are easy to hit.
  pickPlanet(x, y) {
    let best = null, bestD = Infinity;
    for (const p of this.planets) {
      const s = this.scene.worldToScreen(p.position);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    const projR = this.scene.projectedRadius(best.position, best.radius);
    // Accept generously; only a tap far from every world counts as "empty".
    const threshold = Math.max(projR * 1.4, minDim * 0.22);
    return bestD <= threshold ? best : null;
  }

  handleTap(x, y) {
    if (!this.started || this.over || this.paused) return;
    const planet = this.pickPlanet(x, y);

    // Spectating: you only watch — tapping just re-centres the camera.
    if (this.spectate) {
      if (planet) this.scene.focusOn(planet.position);
      return;
    }

    if (!planet) { this.deselect(); return; }

    if (!this.selected) {
      if (planet.owner === PLAYER) {
        this.select(planet);
      } else {
        this.scene.focusOn(planet.position);
      }
      return;
    }

    if (planet === this.selected) {
      this.showPlanetPanel();
      return;
    }

    // A source is selected and a different world tapped -> choose target.
    this._setTarget(planet);
    this.ui.showSendPanel(this.selected.shipCount);
  }

  select(planet) {
    this._clearTarget();
    if (this.selected) this.selected.setHighlight(null);
    this.selected = planet;
    planet.setHighlight('select');
    this.scene.focusOn(planet.position);
    this.showPlanetPanel();
  }

  _setTarget(planet) {
    this._clearTarget();
    this.pendingTarget = planet;
    planet.setHighlight('target');
    this._showLink(this.selected, planet);
  }

  _clearTarget() {
    if (this.pendingTarget && this.pendingTarget !== this.selected) {
      this.pendingTarget.setHighlight(null);
    }
    this.pendingTarget = null;
    this._hideLink();
  }

  showPlanetPanel() {
    const p = this.selected;
    if (!p) return;
    const canBuild = this.techLevelOf(p.owner) >= CAPITAL_TECH_LEVEL;
    this.ui.showPlanetPanel(p, canBuild, CAPITAL_COST);
  }

  deselect() {
    this._clearTarget();
    if (this.selected) this.selected.setHighlight(null);
    this.selected = null;
    this.ui.hidePanels();
  }

  cancelSend() {
    this._clearTarget();
    this.showPlanetPanel();
  }

  confirmSend(amount) {
    if (this.selected && this.pendingTarget) {
      this.launchFleet(this.selected, this.pendingTarget, amount);
    }
    this.deselect(); // deselect after sending
  }

  buildCapitalSelected() {
    if (this.selected) {
      this.buildCapitalAt(this.selected);
      this.showPlanetPanel();
    }
  }

  // ---------------- selection link ----------------
  // A gently arced "energy beam" from source to target: gradient from the
  // player's colour to the target's colour, with pulses flowing toward it.
  _showLink(source, target) {
    this._hideLink();
    if (!source || !target) return;
    const a = source.position, b = target.position;
    const mid = a.clone().lerp(b, 0.5);
    mid.y += a.distanceTo(b) * 0.18; // lift for a graceful arc
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const geo = new THREE.TubeGeometry(curve, 48, 0.55, 8, false);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        colorA: { value: ownerColor(PLAYER) },
        colorB: { value: ownerColor(target.owner) },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 colorA; uniform vec3 colorB; uniform float time;
        varying vec2 vUv;
        void main() {
          float t = vUv.x;
          vec3 col = mix(colorA, colorB, t);
          // Pulses streaming from source toward target.
          float flow = fract(t * 4.0 - time * 1.1);
          float pulse = smoothstep(0.0, 0.12, flow) * (1.0 - smoothstep(0.12, 0.6, flow));
          float glow = 0.4 + 1.3 * pulse;
          gl_FragColor = vec4(col * glow, 0.85);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._link = new THREE.Mesh(geo, mat);
    this._link.frustumCulled = false;
    this.scene.scene.add(this._link);
  }

  _hideLink() {
    if (!this._link) return;
    this.scene.scene.remove(this._link);
    this._link.geometry.dispose();
    this._link.material.dispose();
    this._link = null;
  }

  // ---------------- actions ----------------
  launchFleet(source, target, amount) {
    amount = Math.min(Math.floor(amount), source.shipCount);
    if (amount < 1) return null;
    source.ships -= amount;
    const warp = source.hasCapital;
    const fleet = new Fleet({
      owner: source.owner,
      count: amount,
      from: source.position,
      target,
      warp,
      warpMul: warp ? WARP_MULTIPLIER : 1,
    });
    this.scene.scene.add(fleet.points);
    this.fleets.push(fleet);
    return fleet;
  }

  buildCapitalAt(planet) {
    if (planet.hasCapital) return false;
    if (this.techLevelOf(planet.owner) < CAPITAL_TECH_LEVEL) return false;
    if (planet.shipCount < CAPITAL_COST) return false;
    planet.ships -= CAPITAL_COST;
    planet.buildCapital();
    if (planet.owner === PLAYER) this.ui.toast(`Capital ship built at ${planet.name} — warp online!`);
    return true;
  }

  techLevelOf(owner) {
    const count = this.planets.filter(p => p.owner === owner).length;
    return techLevel(count);
  }

  // Per-owner production multiplier (economy handicap / player advantage).
  prodMulFor(owner) {
    if (owner === NEUTRAL) return 1;
    if (this.spectate) return this.cfg.aiProd; // all empires equal when spectating
    if (owner === PLAYER) return this.cfg.playerProd;
    return this.cfg.aiProd;
  }

  // ---------------- loop ----------------
  update(dt) {
    if (!this.started || this.over || this.paused) return;
    const gs = this.gameSpeed;

    for (const p of this.planets) p.update(dt, gs * this.prodMulFor(p.owner));
    for (const f of this.fleets) f.update(dt, gs);

    this._resolveInterceptions();
    this._resolveArrivals();
    this._cullFleets();

    for (const ai of this.ais) ai.update(dt);

    this._updateFog();
    this._updateStats();
    this._checkEnd();

    if (this._link) this._link.material.uniforms.time.value += dt;

    // Deselect if we lost the selected world.
    if (this.selected && this.selected.owner !== PLAYER) this.deselect();
  }

  _resolveInterceptions() {
    const f = this.fleets;
    for (let i = 0; i < f.length; i++) {
      if (f[i].dead || f[i].arrived) continue;
      for (let j = i + 1; j < f.length; j++) {
        if (f[j].dead || f[j].arrived) continue;
        if (f[i].owner === f[j].owner) continue;
        if (f[i].pos.distanceToSquared(f[j].pos) < INTERCEPT_DIST * INTERCEPT_DIST) {
          f[i].clashWith(f[j]);
        }
      }
    }
  }

  _resolveArrivals() {
    for (const f of this.fleets) {
      if (f.dead || !f.arrived) continue;
      const t = f.target;
      if (t.owner === f.owner) {
        t.ships += f.count;
      } else if (f.count > t.ships) {
        const remaining = f.count - t.ships;
        const wasPlayerLoss = t.owner === PLAYER;
        const conquerorIsPlayer = f.owner === PLAYER;
        t.ships = remaining;
        t.setOwner(f.owner);
        t.discovered = true;
        if (conquerorIsPlayer) this.ui.toast(`Captured ${t.name}`);
        else if (wasPlayerLoss) this.ui.toast(`Lost ${t.name}!`);
      } else {
        t.ships -= f.count;
      }
      f.dead = true;
    }
  }

  _cullFleets() {
    if (!this.fleets.some(f => f.dead)) return;
    const alive = [];
    for (const f of this.fleets) {
      if (f.dead) { this.scene.scene.remove(f.points); f.dispose(); }
      else alive.push(f);
    }
    this.fleets = alive;
  }

  _updateFog() {
    // Spectate / no-fog: reveal the entire galaxy.
    if (!this.fogEnabled) {
      for (const p of this.planets) {
        p.visible = true; p.discovered = true;
        p.ring.material.opacity = 0.9;
        p.marker.material.opacity = p.hasCapital ? 0.95 : 0;
      }
      for (const f of this.fleets) f.points.visible = true;
      return;
    }

    for (const p of this.planets) {
      if (p.owner === PLAYER) { p.visible = true; p.discovered = true; }
      else p.visible = false;
    }
    // Reveal around player worlds.
    const sources = [];
    for (const p of this.planets) {
      if (p.owner === PLAYER) sources.push({ pos: p.position, r: 34 + p.radius * 3.5 });
    }
    for (const f of this.fleets) {
      if (f.owner === PLAYER) sources.push({ pos: f.pos, r: 26 });
    }
    for (const p of this.planets) {
      if (p.visible) continue;
      for (const s of sources) {
        if (p.position.distanceToSquared(s.pos) < s.r * s.r) { p.visible = true; p.discovered = true; break; }
      }
    }

    // Apply visuals + hide enemy fleets in fog.
    for (const p of this.planets) {
      const ring = p.ring.material;
      if (!p.discovered) ring.opacity = 0.22;
      else ring.opacity = p.visible ? 0.9 : 0.45;
      p.marker.material.opacity = (p.hasCapital && p.visible) ? 0.95 : (p.hasCapital && p.discovered ? 0.4 : 0);
    }
    for (const f of this.fleets) {
      if (f.owner === PLAYER) { f.points.visible = true; continue; }
      let seen = false;
      for (const s of sources) {
        if (f.pos.distanceToSquared(s.pos) < s.r * s.r) { seen = true; break; }
      }
      f.points.visible = seen;
    }
  }

  _empireName(owner) {
    // Owner 1 is "You" with a human; in spectate it's just the cyan empire.
    if (this.spectate && owner === PLAYER) return 'Azure';
    return OWNER_NAMES[owner] || `Empire ${owner}`;
  }

  _updateStats() {
    if (this.spectate) {
      // Show the leading empire's standing.
      const tally = new Map();
      const bump = (o, w, s) => {
        const e = tally.get(o) || { w: 0, s: 0 };
        e.w += w; e.s += s; tally.set(o, e);
      };
      for (const p of this.planets) if (p.owner !== NEUTRAL) bump(p.owner, 1, p.shipCount);
      for (const f of this.fleets) bump(f.owner, 0, Math.floor(f.count));
      let lead = null;
      for (const [o, e] of tally) if (!lead || e.w > tally.get(lead).w) lead = o;
      if (lead != null) this.ui.updateStats(tally.get(lead).w, tally.get(lead).s, this.techLevelOf(lead));
      else this.ui.updateStats(0, 0, 1);
      return;
    }
    let worlds = 0, ships = 0;
    for (const p of this.planets) if (p.owner === PLAYER) { worlds++; ships += p.shipCount; }
    for (const f of this.fleets) if (f.owner === PLAYER) ships += Math.floor(f.count);
    this.ui.updateStats(worlds, ships, this.techLevelOf(PLAYER));
  }

  _checkEnd() {
    // Owners that still hold a world or a fleet in flight.
    const alive = new Set();
    for (const p of this.planets) if (p.owner !== NEUTRAL) alive.add(p.owner);
    for (const f of this.fleets) alive.add(f.owner);

    if (this.spectate) {
      if (alive.size <= 1) {
        this.over = true;
        const w = [...alive][0];
        if (w != null) {
          const name = this._empireName(w);
          this.ui.showEnd(true, `${name} conquers the galaxy.`, `${name} Wins`);
        } else {
          this.ui.showEnd(true, 'The galaxy lies empty.', 'Stalemate');
        }
      }
      return;
    }

    const playerAlive = alive.has(PLAYER);
    const enemiesAlive = [...alive].some(o => o !== PLAYER);
    if (!playerAlive) {
      this.over = true;
      this.ui.showEnd(false, 'Your empire has fallen. The galaxy belongs to another.');
    } else if (!enemiesAlive) {
      this.over = true;
      this.ui.showEnd(true, 'All rival empires crushed. The galaxy is yours.');
    }
  }
}
