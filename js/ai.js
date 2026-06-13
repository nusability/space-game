import { NEUTRAL } from './constants.js';

// One controller per AI empire. Periodically launches fleets and builds
// capital ships. Difficulty tunes interval, aggression and risk tolerance,
// but every empire is hard-capped to MAX_MOVES real moves per WINDOW seconds.
const WINDOW = 10;     // seconds
const MAX_MOVES = 3;   // launches/builds allowed within the window

export class AIController {
  constructor(game, ownerId, params) {
    this.game = game;
    this.owner = ownerId;
    this.interval = params.aiInterval;
    this.aggression = params.aiAggression;
    this.timer = Math.random() * this.interval;
    this.clock = 0;        // local game-time accumulator
    this.moveTimes = [];   // timestamps of recent real moves
  }

  update(dt) {
    this.clock += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval * (0.7 + Math.random() * 0.6);

    // Rolling-window rate limit: drop moves older than WINDOW seconds.
    this.moveTimes = this.moveTimes.filter(t => this.clock - t < WINDOW);
    if (this.moveTimes.length >= MAX_MOVES) return; // budget spent

    // Only a move that actually happens counts against the budget.
    if (this.act()) this.moveTimes.push(this.clock);
  }

  // Returns true if a real action (build or launch) was taken.
  act() {
    const g = this.game;
    const mine = g.planets.filter(p => p.owner === this.owner);
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

    // Pick the strongest world as a launch base.
    mine.sort((a, b) => b.ships - a.ships);
    const source = mine[0];
    if (source.shipCount < 12) return false;

    // Score candidate targets: prefer weak, nearby, hostile/neutral worlds.
    let best = null, bestScore = -Infinity;
    for (const t of g.planets) {
      if (t === source) continue;
      if (t.owner === this.owner) continue;
      const dist = source.position.distanceTo(t.position);
      const defense = t.shipCount + 1;
      // Cheaper to take neutral & weak worlds that are close.
      let score = (source.shipCount * this.aggression) / defense - dist * 0.05;
      if (t.owner === NEUTRAL) score += 4;
      if (t.hasCapital) score += 6; // grabbing a warp hub is valuable
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return false;

    // Only commit if we can plausibly take it (or it's a cheap neutral).
    const defenders = best.shipCount;
    const sendFrac = Math.min(0.9, 0.45 + this.aggression * 0.3);
    const send = Math.floor(source.shipCount * sendFrac);
    if (send < 8) return false;
    if (send <= defenders && best.owner !== NEUTRAL && Math.random() > 0.3) return false;

    return !!g.launchFleet(source, best, send);
  }
}
