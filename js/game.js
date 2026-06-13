import * as THREE from 'three';
import { Planet } from './planet.js';
import { Fleet } from './fleet.js';
import { AIController } from './ai.js';
import { PLANET_TYPES } from './textures.js';
import {
  NEUTRAL, PLAYER, DIFFICULTY, techLevel,
  CAPITAL_TECH_LEVEL, CAPITAL_COST, WARP_MULTIPLIER,
} from './constants.js';

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
    ui.onStart = (diff) => this.start(diff);
    ui.onSend = (amount) => this.confirmSend(amount);
    ui.onCancel = () => this.cancelSend();
    ui.onBuildCapital = () => this.buildCapitalSelected();
    ui.onClosePlanet = () => this.deselect();
  }

  // ---------------- setup ----------------
  start(difficulty) {
    this._teardown();
    const cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.cfg = cfg;
    this.over = false;
    this.started = true;
    this.ui.hideOverlay();

    const aiCount = cfg.ai;
    const planetCount = 12 + aiCount * 3 + Math.floor(Math.random() * 3);
    this._generateGalaxy(planetCount, aiCount);

    // AI controllers for owners 2..(1+aiCount)
    this.ais = [];
    for (let i = 0; i < aiCount; i++) {
      this.ais.push(new AIController(this, 2 + i, cfg));
    }

    this.pickMeshes = this.planets.map(p => p.surface);
    this.ui.initLabels(this.planets);

    // Frame the player's home world.
    const home = this.planets.find(p => p.owner === PLAYER);
    this.scene.target.copy(home.position);
    this.scene.focusOn(home.position, this.galaxyRadius * 1.05);

    this.ui.toast('Conquer the galaxy.');
  }

  _teardown() {
    for (const f of this.fleets) { this.scene.scene.remove(f.points); f.dispose(); }
    for (const p of this.planets) { this.scene.scene.remove(p.group); }
    this.fleets = [];
    this.planets = [];
    this.selected = null;
    this.pendingTarget = null;
  }

  _generateGalaxy(count, aiCount) {
    const R = 70 + count * 4.5;
    this.galaxyRadius = R;
    this.scene.setBounds(R * 2.4);
    this.scene.radius = R * 1.4;

    const positions = [];
    const minDist = 24;
    let guard = 0;
    while (positions.length < count && guard < count * 400) {
      guard++;
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
        production: radius * 0.5 * this.cfg.prodMul,
      });
      this.scene.scene.add(planet.group);
      return planet;
    });

    // Assign homeworlds: player + AI, spread far apart.
    const homeIdx = this._pickSpreadHomes(1 + aiCount);
    homeIdx.forEach((idx, k) => {
      const owner = k === 0 ? PLAYER : (1 + k); // 1 player, 2,3,4 AI
      const p = this.planets[idx];
      p.setOwner(owner);
      p.ships = 30;
      // Homeworlds are a touch more productive than the radius alone implies.
      p.production = p.radius * 0.7 * this.cfg.prodMul;
      p.discovered = true;
      p.visible = true;
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
  handleTap(x, y) {
    if (!this.started || this.over) return;
    const hit = this.scene.pick(x, y, this.pickMeshes);
    const planet = hit ? hit.object.userData.planet : null;

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
    this.pendingTarget = planet;
    this.ui.showSendPanel(this.selected.shipCount);
  }

  select(planet) {
    if (this.selected) this.selected.setSelected(false);
    this.selected = planet;
    this.pendingTarget = null;
    planet.setSelected(true);
    this.scene.focusOn(planet.position);
    this.showPlanetPanel();
  }

  showPlanetPanel() {
    const p = this.selected;
    if (!p) return;
    const canBuild = this.techLevelOf(p.owner) >= CAPITAL_TECH_LEVEL;
    this.ui.showPlanetPanel(p, canBuild, CAPITAL_COST);
  }

  deselect() {
    if (this.selected) this.selected.setSelected(false);
    this.selected = null;
    this.pendingTarget = null;
    this.ui.hidePanels();
  }

  cancelSend() {
    this.pendingTarget = null;
    this.showPlanetPanel();
  }

  confirmSend(amount) {
    if (this.selected && this.pendingTarget) {
      this.launchFleet(this.selected, this.pendingTarget, amount);
    }
    this.pendingTarget = null;
    // Stay on source so the player can keep dispatching.
    if (this.selected && this.selected.owner === PLAYER) this.showPlanetPanel();
    else this.deselect();
  }

  buildCapitalSelected() {
    if (this.selected) {
      this.buildCapitalAt(this.selected);
      this.showPlanetPanel();
    }
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

  // ---------------- loop ----------------
  update(dt) {
    if (!this.started || this.over) return;
    const gs = this.gameSpeed;

    for (const p of this.planets) p.update(dt, gs);
    for (const f of this.fleets) f.update(dt, gs);

    this._resolveInterceptions();
    this._resolveArrivals();
    this._cullFleets();

    for (const ai of this.ais) ai.update(dt);

    this._updateFog();
    this._updateStats();
    this._checkEnd();

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

  _updateStats() {
    let worlds = 0, ships = 0;
    for (const p of this.planets) if (p.owner === PLAYER) { worlds++; ships += p.shipCount; }
    for (const f of this.fleets) if (f.owner === PLAYER) ships += Math.floor(f.count);
    this.ui.updateStats(worlds, ships, this.techLevelOf(PLAYER));
  }

  _checkEnd() {
    let playerP = 0, playerF = 0, enemyP = 0, enemyF = 0;
    for (const p of this.planets) {
      if (p.owner === PLAYER) playerP++;
      else if (p.owner !== NEUTRAL) enemyP++;
    }
    for (const f of this.fleets) {
      if (f.owner === PLAYER) playerF++;
      else enemyF++;
    }
    if (playerP === 0 && playerF === 0) {
      this.over = true;
      this.ui.showEnd(false, 'Your empire has fallen. The galaxy belongs to another.');
    } else if (enemyP === 0 && enemyF === 0) {
      this.over = true;
      this.ui.showEnd(true, 'All rival empires crushed. The galaxy is yours.');
    }
  }
}
