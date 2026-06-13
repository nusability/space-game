import { NEUTRAL } from './constants.js?v=12';

// One controller per AI empire. Difficulty tunes cadence, aggression, mistake
// rate and the per-WINDOW move cap. When `advanced` is set the empire also
// uses coordinated multi-world strikes and rear-to-front reserve movements.
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
  }

  get mine() { return this.game.planets.filter(p => p.owner === this.owner); }

  update(dt) {
    this.clock += dt;

    // Fire any staggered launches that have come due (coordinated strikes).
    // These belong to an already-counted decision, so they bypass the budget.
    if (this.scheduled.length) this._flushScheduled();

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval * (0.7 + Math.random() * 0.6);

    // Rolling-window rate limit.
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

  // Returns true if a real decision (build / launch / plan) was taken.
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

    if (this.advanced) {
      // Prefer a coordinated strike when several worlds can combine on a target
      // that no single world could take alone; otherwise shore up the frontier.
      if (this._tryCoordinatedAttack(mine)) return true;
      if (Math.random() < 0.5 && this._tryReserveMove(mine)) return true;
    }

    return this._simpleAttack(mine);
  }

  // ---- baseline single-world attack ----
  _simpleAttack(mine) {
    const g = this.game;
    mine.sort((a, b) => b.ships - a.ships);
    const source = mine[0];
    if (source.shipCount < 12) return false;

    const cands = [];
    let best = null, bestScore = -Infinity;
    for (const t of g.planets) {
      if (t.owner === this.owner) continue;
      const dist = source.position.distanceTo(t.position);
      const score = (source.shipCount * this.aggression) / (t.shipCount + 1)
        - dist * 0.05 + (t.owner === NEUTRAL ? 4 : 0) + (t.hasCapital ? 6 : 0);
      cands.push(t);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return false;

    let target = best;
    if (cands.length > 1 && Math.random() < this.mistakeChance) {
      target = cands[Math.floor(Math.random() * cands.length)];
    }

    const defenders = target.shipCount;
    const sendFrac = Math.min(0.9, 0.4 + this.aggression * 0.3);
    const send = Math.floor(source.shipCount * sendFrac);
    if (send < 8) return false;
    if (send <= defenders && target.owner !== NEUTRAL && Math.random() > 0.3) return false;

    return !!g.launchFleet(source, target, send);
  }

  // ---- coordinated multi-world strike, timed to arrive together ----
  _tryCoordinatedAttack(mine) {
    const g = this.game;
    if (mine.length < 2) return false;

    // Choose the most valuable hostile/neutral target near our territory.
    let target = null, bestScore = -Infinity;
    for (const t of g.planets) {
      if (t.owner === this.owner) continue;
      const nearMine = Math.min(...mine.map(p => p.position.distanceTo(t.position)));
      const score = (t.hasCapital ? 9 : 0) + (t.owner === NEUTRAL ? 2 : 5)
        - t.shipCount * 0.04 - nearMine * 0.03;
      if (score > bestScore) { bestScore = score; target = t; }
    }
    if (!target) return false;

    const needed = target.shipCount * 1.35 + 6;

    // Stage from our nearest, strongest worlds (keep a home garrison).
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
    if (plan.length < 2 || total < needed) return false; // not a real combined op

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

    // Distance from each of my worlds to the nearest enemy world.
    const threat = (p) => Math.min(...enemies.map(e => p.position.distanceTo(e.position)));

    // Frontier = my world closest to the enemy; rear = a safe world with surplus.
    const sorted = mine.slice().sort((a, b) => threat(a) - threat(b));
    const frontier = sorted[0];
    // Only reinforce if the frontier looks under-gunned vs nearby enemy mass.
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
