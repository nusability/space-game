import * as THREE from 'three';

// Owner ids: 0 = neutral, 1 = player, 2..n = AI empires.
export const NEUTRAL = 0;
export const PLAYER = 1;

export const OWNER_COLORS = {
  0: 0x9aa6b2, // neutral
  1: 0x39d0ff, // player (cyan)
  2: 0xff5a52, // red
  3: 0xffb13d, // orange
  4: 0xc46bff, // purple
};

export const OWNER_NAMES = {
  0: 'Neutral',
  1: 'You',
  2: 'Crimson',
  3: 'Amber',
  4: 'Violet',
};

export function ownerColor(id) {
  return new THREE.Color(OWNER_COLORS[id] ?? 0xffffff);
}

// Tech thresholds — number of worlds an empire controls.
export const CAPITAL_TECH_LEVEL = 3;   // tech level that unlocks capital ships
export const CAPITAL_COST = 50;        // ships consumed to build a capital ship
export const WARP_MULTIPLIER = 3.4;    // travel speed boost for fleets from a warp hub

// Tech level from world count.
export function techLevel(worldCount) {
  if (worldCount >= 8) return 4;
  if (worldCount >= 5) return 3;
  if (worldCount >= 3) return 2;
  return 1;
}

export const DIFFICULTY = {
  easy:   { ai: 1, aiAggression: 0.5, aiInterval: 3.2, prodMul: 1.0 },
  normal: { ai: 2, aiAggression: 0.8, aiInterval: 2.4, prodMul: 1.0 },
  hard:   { ai: 3, aiAggression: 1.1, aiInterval: 1.7, prodMul: 1.15 },
};
