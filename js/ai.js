import { NEUTRAL } from './constants.js?v=13';

// One controller per AI empire. Difficulty tunes cadence, aggression, mistake
// rate and the per-WINDOW move cap. When `advanced` is set the empire also
// uses coordinated multi-world strikes and rear-to-front reserve movements.
//
// Target selection favours EXPANSION: safe, weakly-held, uncontested worlds
// (especially neutrals) score highest, while worlds sitting next to strong
// enemy forces are penalised so the AI doesn't pour everything into a
// meat-grinder over one contested world and neglect easy growth.
const WINDOW = 10; // seconds

export class AIController {
  constructor(game, ownerId, params, advanced = false) {
    this.game = game;
    this.owner = ownerId;
    this.interval = params.interval;
    this.aggression = params.aggression;
    this.maxMoves = params.maxMoves;
    this.mistakeChance = params.mistakeChance;
    this.advanced = advanced;
    this.timer = Math.random() * this.interval;
    this.clock = 0;        // local game-time accumulator
    this.moveTimes = [];   // timestamps of recent budget-counted decisions
    this.scheduled = [];   // staggered launches: { source, target, amount, at }
    this.recent = new Map(); // target id -> clock when last committed (anti-spam)
  }

  get mine() { return this.game.planets.filter(p => p.owner === this.owner); }
  get _contestR() { return (this.game.galaxyRadius || 200) * 0.33; }

  update(dt) {
    this.clock += dt;
    if (this.scheduled.length) this._flushScheduled();

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval * (0.7 + Math.random() * 0.6);

    this.moveTimes = this.moveTimes.filter(t => this.clock - t < WINDOW);
    if (this.moveTimes.length >= this.maxMoves) return;

    if (this.act()) this.moveTimes.push(this.clock);
  }

  _flushScheduled() {
    const remaining = [];
    for (const s of this.scheduled) {
      if (s.at > this.clock) { remaining.push(s); continue; }
      if (s.source.owner !== this.owner) continue; // lost the staging world
      const amount = Math.min(s.amount, s.source.shipCount);
      if (amount >= 1) this.game.launchFleet(s.source, s.target, amount);
    }
    this.scheduled = remaining;
  }

  // ---- scoring ----
  // Enemy ship strength near a world (force that could quickly retake it).
  _nearbyEnemyStrength(t) {
    const R = this._contestR;
    let s = 0;
    for (const e of this.game.planets) {
      if (e === t || e.owner === this.owner || e.owner === NEUTRAL) continue;
      const d = e.position.distanceTo(t.position);
      if (d < R) s += e.shipCount * (1 - d / R);
    }
    return s;
  }

  _scoreTarget(t, mine) {
    const dist = Math.min(...mine.map(p => p.position.distanceTo(t.position)));
    const expansion = (t.owner === NEUTRAL ? 6 : 3) + (t.hasCapital ? 5 : 0);
    const contention = this._nearbyEnemyStrength(t);
    const rt = this.recent.get(t.id);
    const recentPen = (rt != null && this.clock - rt < 5) ? 5 : 0; // don't spam one world
    return expansion - t.shipCount * 0.05 - dist * 0.03 - contention * 0.06 - recentPen;
  }

  _chooseTarget(mine) {
    let best = null, bestScore = -Infinity;
    const cands = [];
    for (const t of this.game.planets) {
      if (t.owner === this.owner) continue;
      const s = this._scoreTarget(t, mine);
      cands.push(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    if (!best) return null;
    // Occasional blunder (keeps lower difficulties beatable).
    if (cands.length > 1 && Math.random() < this.mistakeChance) {
      return cands[Math.floor(Math.random() * cands.length)];
    }
    return best;
  }

  _bestSourceFor(target, mine) {
    let best = null, bestVal = -Infinity;
    for (const p of mine) {
      if (p.shipCount < 10) continue;
      const val = p.shipCount - p.position.distanceTo(target.position) * 0.15;
      if (val > bestVal) { bestVal = val; best = p; }
    }
    return best;
  }

  // ---- decision ----
  act() {
    const g = this.game;
    const mine = this.mine;
    if (mine.length === 0) return false;

    // Maybe build a capital ship on the richest world to enable warp.
    if (g.techLevelOf(this.owner) >= 3) {
      const noHub = mine.filter(p => !p.hasCapital);
      const richest = noHub.sort((a, b) => b.ships - a.ships)[0];
      const hubs = mine.filter(p => p.hasCapital).length;
      if (richest && richest.shipCount > g.CAPITAL_COST + 35 && hubs < Math.ceil(mine.length / 3)) {
        return g.buildCapitalAt(richest);
      }
    }

    const target = this._chooseTarget(mine);
    if (!target) {
      return this.advanced ? this._tryReserveMove(mine) : false;
    }

    const defenders = target.shipCount;
    const source = this._bestSourceFor(target, mine);
    const sendFrac = Math.min(0.9, 0.4 + this.aggression * 0.3);
    const single = source ? Math.floor(source.shipCount * sendFrac) : 0;

    // Cheap grab: one world can take it with margin — expand and keep reserves.
    if (source && single > defenders + 4 && single >= 8) {
      this.recent.set(target.id, this.clock);
      return !!g.launchFleet(source, target, single);
    }

    // Too tough for one world: an advanced empire combines several worlds.
    if (this.advanced && this._tryCoordinatedAttackOn(target, mine)) {
      this.recent.set(target.id, this.clock);
      return true;
    }

    // Baseline fallback: commit anyway if it's a plausible/neutral grab.
    if (source && single >= 8 && (target.owner === NEUTRAL || single > defenders)) {
      this.recent.set(target.id, this.clock);
      return !!g.launchFleet(source, target, single);
    }

    // Can't take it right now — shore up the frontier instead.
    if (this.advanced && Math.random() < 0.5) return this._tryReserveMove(mine);
    return false;
  }

  // ---- coordinated multi-world strike, timed to arrive together ----
  _tryCoordinatedAttackOn(target, mine) {
    if (mine.length < 2) return false;
    const g = this.game;
    const needed = target.shipCount * 1.3 + 6;

    const stagers = mine
      .filter(p => p.shipCount > 14)
      .sort((a, b) => a.position.distanceTo(target.position) - b.position.distanceTo(target.position))
      .slice(0, 4);
    if (stagers.length < 2) return false;

    const plan = [];
    let total = 0;
    for (const s of stagers) {
      const amount = Math.floor(s.shipCount * 0.6);
      if (amount < 6) continue;
      const tt = s.position.distanceTo(target.position) / g.fleetSpeed(s.hasCapital);
      plan.push({ source: s, amount, tt });
      total += amount;
      if (total >= needed && plan.length >= 2) break;
    }
    if (plan.length < 2 || total < needed) return false;

    // Arrive together: the farthest fleet leaves now, nearer ones wait.
    const maxTT = Math.max(...plan.map(p => p.tt));
    const arrival = this.clock + maxTT + 0.05;
    for (const p of plan) {
      this.scheduled.push({ source: p.source, target, amount: p.amount, at: arrival - p.tt });
    }
    return true;
  }

  // ---- reserve movement: feed ships from the rear to a threatened frontier ----
  _tryReserveMove(mine) {
    const g = this.game;
    if (mine.length < 2) return false;
    const enemies = g.planets.filter(p => p.owner !== this.owner && p.owner !== NEUTRAL);
    if (enemies.length === 0) return false;

    const threat = (p) => Math.min(...enemies.map(e => p.position.distanceTo(e.position)));
    const sorted = mine.slice().sort((a, b) => threat(a) - threat(b));
    const frontier = sorted[0];

    const enemyPressure = enemies
      .filter(e => e.position.distanceTo(frontier.position) < threat(frontier) * 1.6 + 30)
      .reduce((s, e) => s + e.shipCount, 0);
    if (frontier.shipCount > enemyPressure * 0.8) return false;

    const rear = sorted
      .filter(p => p !== frontier && p.shipCount > 24 && threat(p) > threat(frontier) * 1.3)
      .sort((a, b) => b.shipCount - a.shipCount)[0];
    if (!rear) return false;

    const send = Math.floor(rear.shipCount * 0.6);
    if (send < 10) return false;
    return !!g.launchFleet(rear, frontier, send); // same-owner arrival reinforces
  }
}
