import * as THREE from 'three';
import { makeDotTexture } from './textures.js?v=6';
import { ownerColor } from './constants.js?v=6';

const BASE_SPEED = 16; // world units / sec
const MAX_DOTS = 28;

export class Fleet {
  constructor(opts) {
    this.owner = opts.owner;
    this.count = opts.count;
    this.target = opts.target;     // Planet
    this.warp = opts.warp || false;
    this.dead = false;
    this.arrived = false;

    this.pos = opts.from.clone();
    this.dir = this.target.position.clone().sub(this.pos);
    this.totalDist = this.dir.length();
    this.dir.normalize();
    this.travelled = 0;
    this.speed = BASE_SPEED * (this.warp ? 1 : 1);
    this.warpMul = opts.warpMul || 1;

    this._buildDots();
  }

  _buildDots() {
    const n = Math.min(MAX_DOTS, Math.max(3, Math.ceil(Math.sqrt(this.count) * 1.6)));
    this.dotCount = n;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    this.offsets = [];
    const spread = 0.9 + Math.log2(this.count + 1) * 0.35;
    for (let i = 0; i < n; i++) {
      const o = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      );
      this.offsets.push({ base: o, phase: Math.random() * Math.PI * 2 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: this.warp ? 2.4 : 1.7,
      map: makeDotTexture(),
      color: ownerColor(this.owner),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      opacity: 0.95,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this._writeDots();
  }

  _writeDots() {
    const attr = this.points.geometry.attributes.position;
    const arr = attr.array;
    const t = performance.now() * 0.004;
    // Fraction of dots visible scales with remaining count.
    const frac = this.count / this._maxCountSeen();
    const visible = Math.max(1, Math.round(this.dotCount * Math.min(1, frac)));
    for (let i = 0; i < this.dotCount; i++) {
      const o = this.offsets[i];
      const wob = Math.sin(t + o.phase) * 0.25;
      arr[i*3]   = this.pos.x + o.base.x + wob;
      arr[i*3+1] = this.pos.y + o.base.y + Math.cos(t + o.phase) * 0.25;
      arr[i*3+2] = this.pos.z + o.base.z + wob;
    }
    this.points.geometry.setDrawRange(0, visible);
    attr.needsUpdate = true;
  }

  _maxCountSeen() {
    if (this._maxCount === undefined || this.count > this._maxCount) this._maxCount = this.count;
    return this._maxCount;
  }

  update(dt, gameSpeed) {
    const v = this.speed * this.warpMul * gameSpeed * dt;
    this.travelled += v;
    if (this.travelled >= this.totalDist) {
      this.pos.copy(this.target.position);
      this.arrived = true;
    } else {
      this.pos.copy(this.target.position).addScaledVector(this.dir, -(this.totalDist - this.travelled));
    }
    this._writeDots();
  }

  // Resolve interception with another fleet. Returns true if a clash happened.
  clashWith(other) {
    const lost = Math.min(this.count, other.count);
    this.count -= lost;
    other.count -= lost;
    if (this.count <= 0) this.dead = true;
    if (other.count <= 0) other.dead = true;
    return lost > 0;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
