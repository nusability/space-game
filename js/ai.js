import { NEUTRAL } from './constants.js?v=14';

// One controller per AI empire.
//   advanced     -> coordinated multi-world strikes + reserve movements
//   unrestricted -> no cadence and no move cap; acts as often as it likes and
//                   sends SURGICAL fleet sizes (just enough to take a world,
//                   anticipating the defenders it will grow during transit).
// Target selection favours expansion into safe/uncontested worlds, but as
// neutral space runs out an endgame "ramp" drops the contention penalty and
// raises the value of enemy worlds so empires commit to finishing each other.
const WINDOW = 10; // seconds

export class AIController {
  constructor(game, ownerId, params, advanced = false, unrestricted = false) {
    this.game = game;
    this.owner = ownerId;
    this.interval = params.interval;
    this.aggression = params.aggression;
    this.maxMoves = params.maxMoves;
    this.mistakeChance = unrestricted ? 0 : params.mistakeChance;
    this.advanced = advanced || unrestricted;
    this.unrestricted = unrestricted;
    this.surgical = unrestricted; // exact, growth-aware fleet sizing
    this.timer = Math.random() * this.interval;
    this.clock = 0;
    this.moveTimes = [];
    this.scheduled = [];          // staggered launches: { source, target, amount, at }
    this.recent = new Map();      // target id -> clock last committed (anti-spam)
    this.reserved = new Map();    // planet id -> ships pledged to scheduled launches
    this._ramp = 0;               // 0 = expansion phase, 1 = endgame aggression
  }

  get mine() { return this.game.planets.filter(p => p.owner === this.owner); }
  get _contestR() { return (this.game.galaxyRadius || 200) * 0.33; }

  // Ships at a world not already pledged to a pending scheduled launch.
  _avail(p) { return p.shipCount - (this.reserved.get(p.id) || 0); }
  _reserve(p, amt) { this.reserved.set(p.id, (this.reserved.get(p.id) || 0) + amt); }
  _release(p, amt) {
    const r = (this.reserved.get(p.id) || 0) - amt;
    if (r > 0.001) this.reserved.set(p.id, r); else this.reserved.delete(p.id);
  }

  update(dt) {
    this.clock += dt;
    if (this.scheduled.length) this._flushScheduled();

    if (this.unrestricted) {
      // No cadence, no budget: keep acting until no worthwhile move remains.
      let n = 0;
      while (n < 40 && this.act()) n++;
      return;
    }

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
      this._release(s.source, s.amount);
      if (s.source.owner !== this.owner) continue; // lost the staging world
      const amount = Math.min(Math.floor(s.amount), s.source.shipCount);
      if (amount >= 1) this.game.launchFleet(s.source, s.target, amount);
    }
    this.scheduled = remaining;
  }

  // ---- scoring ----
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
    const isEnemy = t.owner !== NEUTRAL && t.owner !== this.owner;
    const base = (t.owner === NEUTRAL ? 6 : 3) + (t.hasCapital ? 5 : 0);
    const enemyBonus = isEnemy ? this._ramp * 4 : 0;      // hunt enemies in the endgame
    const contention = this._nearbyEnemyStrength(t) * 0.06 * (1 - this._ramp);
    const rt = this.recent.get(t.id);
    const recentPen = (rt != null && this.clock - rt < 5) ? 5 : 0;
    return base + enemyBonus - t.shipCount * 0.05 - dist * 0.03 - contention - recentPen;
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
    if (cands.length > 1 && Math.random() < this.mistakeChance) {
      return cands[Math.floor(Math.random() * cands.length)];
    }
    return best;
  }

  _bestSourceFor(target, mine) {
    let best = null, bestVal = -Infinity;
    for (const p of mine) {
      if (this._avail(p) < 10) continue;
      const val = this._avail(p) - p.position.distanceTo(target.position) * 0.15;
      if (val > bestVal) { bestVal = val; best = p; }
    }
    return best;
  }

  // Ships needed to flip a world, accounting for growth during `tt` seconds.
  _requiredToTake(target, tt) {
    let def = target.shipCount;
    if (target.owner !== NEUTRAL && target.owner !== this.owner) {
      def += target.production * this.game.prodMulFor(target.owner) * tt;
    }
    return def + 2; // small margin
  }

  // ---- decision ----
  act() {
    const g = this.game;
    const mine = this.mine;
    if (mine.length === 0) return false;

    // Endgame ramp: 0 while >=25% of worlds are neutral, →1 as neutrals vanish.
    const neutrals = g.planets.reduce((n, p) => n + (p.owner === NEUTRAL ? 1 : 0), 0);
    this._ramp = 1 - Math.min(1, neutrals / (g.planets.length * 0.25));

    // Maybe build a capital ship on the richest world to enable warp.
    if (g.techLevelOf(this.owner) >= 3) {
      const noHub = mine.filter(p => !p.hasCapital);
      const richest = noHub.sort((a, b) => this._avail(b) - this._avail(a))[0];
      const hubs = mine.filter(p => p.hasCapital).length;
      if (richest && this._avail(richest) > g.CAPITAL_COST + 35 && hubs < Math.ceil(mine.length / 3)) {
        return g.buildCapitalAt(richest);
      }
    }

    const target = this._chooseTarget(mine);
    if (!target) return this.advanced ? this._tryReserveMove(mine) : false;

    const source = this._bestSourceFor(target, mine);
    if (!source) return this.advanced ? this._tryReserveMove(mine) : false;

    const tt = source.position.distanceTo(target.position) / g.fleetSpeed(source.hasCapital);
    const need = this._requiredToTake(target, tt);

    if (this.surgical) {
      // Send exactly enough from one world if it can; keep the rest in reserve.
      if (this._avail(source) - 1 >= need) {
        this.recent.set(target.id, this.clock);
        return !!g.launchFleet(source, target, Math.ceil(need));
      }
      if (this._tryCoordinatedAttackOn(target, mine)) {
        this.recent.set(target.id, this.clock);
        return true;
      }
      return this.advanced ? this._tryReserveMove(mine) : false;
    }

    // Fraction-based sizing for restricted empires.
    const defenders = target.shipCount;
    const sendFrac = Math.min(0.9, 0.4 + this.aggression * 0.3);
    const single = Math.floor(this._avail(source) * sendFrac);

    if (single > defenders + 4 && single >= 8) {
      this.recent.set(target.id, this.clock);
      return !!g.launchFleet(source, target, single);
    }
    if (this.advanced && this._tryCoordinatedAttackOn(target, mine)) {
      this.recent.set(target.id, this.clock);
      return true;
    }
    if (single >= 8 && (target.owner === NEUTRAL || single > defenders)) {
      this.recent.set(target.id, this.clock);
      return !!g.launchFleet(source, target, single);
    }
    if (this.advanced && Math.random() < 0.5) return this._tryReserveMove(mine);
    return false;
  }

  // ---- coordinated multi-world strike, timed to arrive together ----
  _tryCoordinatedAttackOn(target, mine) {
    if (mine.length < 2) return false;
    const g = this.game;
    const minShips = this.surgical ? 3 : 14;
    const stagers = mine
      .filter(p => this._avail(p) > minShips)
      .sort((a, b) => a.position.distanceTo(target.position) - b.position.distanceTo(target.position))
      .slice(0, 5);
    if (stagers.length < 2) return false;

    const tts = stagers.map(s => s.position.distanceTo(target.position) / g.fleetSpeed(s.hasCapital));
    const maxTT = Math.max(...tts);
    let remaining = this._requiredToTake(target, maxTT);

    const plan = [];
    for (let i = 0; i < stagers.length; i++) {
      const s = stagers[i];
      const avail = this.surgical ? this._avail(s) - 1 : Math.floor(this._avail(s) * 0.6);
      if (avail < 6) continue;
      const amount = this.surgical ? Math.min(avail, Math.ceil(remaining)) : avail;
      plan.push({ source: s, amount, tt: tts[i] });
      remaining -= amount;
      if (remaining <= 0 && plan.length >= 2) break;
    }
    if (plan.length < 2 || remaining > 0) return false;

    // Arrive together: the farthest fleet leaves now, nearer ones wait.
    const arrival = this.clock + maxTT + 0.05;
    for (const p of plan) {
      this.scheduled.push({ source: p.source, target, amount: p.amount, at: arrival - p.tt });
      this._reserve(p.source, p.amount);
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
      .filter(p => p !== frontier && this._avail(p) > 24 && threat(p) > threat(frontier) * 1.3)
      .sort((a, b) => this._avail(b) - this._avail(a))[0];
    if (!rear) return false;

    const send = Math.floor(this._avail(rear) * 0.6);
    if (send < 10) return false;
    return !!g.launchFleet(rear, frontier, send); // same-owner arrival reinforces
  }
}
