import * as THREE from 'three';
import { makePlanetTexture, makeCloudTexture, makeRingTexture, makeMarkerTexture } from './textures.js';
import { ownerColor, NEUTRAL } from './constants.js';

// Atmosphere fresnel glow shader (rim-lit halo around the planet).
function atmosphereMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(color) }, power: { value: 3.2 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float power;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float intensity = pow(1.0 - abs(dot(vNormal, vView)), power);
        gl_FragColor = vec4(glowColor, intensity);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

const ATMO_TINT = {
  ocean: 0x7fb4ff, ice: 0x9fd0ff, desert: 0xd9a86a,
  gas: 0xe8c79a, lava: 0xff6a30, barren: 0x6677aa,
};

let _id = 0;

export class Planet {
  constructor(opts) {
    this.id = _id++;
    this.name = opts.name;
    this.position = opts.position.clone();
    this.radius = opts.radius;
    this.type = opts.type;
    this.seed = opts.seed;

    this.owner = opts.owner ?? NEUTRAL;
    this.ships = opts.ships ?? 0;
    this.production = opts.production ?? (this.radius * 0.55); // ships/sec
    this.maxShips = Math.round(this.radius * 90);
    this.hasCapital = false;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._buildMesh();
  }

  _buildMesh() {
    const texSize = this.radius > 7 ? 256 : 192;
    const { map, emissiveMap } = makePlanetTexture(this.type, this.seed, texSize);

    const geo = new THREE.SphereGeometry(this.radius, 48, 48);
    const matOpts = {
      map,
      roughness: this.type === 'ocean' ? 0.55 : 0.95,
      metalness: 0.0,
    };
    if (emissiveMap) {
      matOpts.emissiveMap = emissiveMap;
      matOpts.emissive = new THREE.Color(0xffffff);
      matOpts.emissiveIntensity = 1.4;
    }
    this.surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(matOpts));
    // Random axial tilt + rotation for gentle realistic spin.
    this.spin = 0.05 + Math.random() * 0.12;
    this.surface.rotation.z = (Math.random() - 0.5) * 0.6;
    this.surface.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(this.surface);
    this.surface.userData.planet = this; // for raycasting

    // Clouds for habitable worlds.
    if (this.type === 'ocean') {
      const cloudTex = makeCloudTexture(this.seed);
      const cloudMat = new THREE.MeshStandardMaterial({
        map: cloudTex, transparent: true, depthWrite: false,
        opacity: 0.85, roughness: 1,
      });
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.015, 32, 32), cloudMat);
      this.clouds.rotation.copy(this.surface.rotation);
      this.group.add(this.clouds);
    }

    // Atmosphere glow.
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 1.14, 32, 32),
      atmosphereMaterial(ATMO_TINT[this.type] ?? 0x88aaff)
    );
    this.group.add(atmo);

    // Ownership ring (billboarded).
    const ringTex = makeRingTexture();
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTex, color: ownerColor(this.owner),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.9,
    }));
    this.ring.scale.setScalar(this.radius * 3.4);
    this.group.add(this.ring);

    // Selection ring (brighter, hidden by default).
    this.selRing = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTex, color: 0xffffff,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0,
    }));
    this.selRing.scale.setScalar(this.radius * 4.1);
    this.group.add(this.selRing);

    // Capital-ship marker (hidden until built).
    const markTex = makeMarkerTexture();
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markTex, color: ownerColor(this.owner),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0,
    }));
    this.marker.scale.setScalar(this.radius * 1.6);
    this.marker.position.set(0, this.radius * 1.5, 0);
    this.group.add(this.marker);
  }

  setOwner(id) {
    this.owner = id;
    this.ring.material.color.copy(ownerColor(id));
    this.marker.material.color.copy(ownerColor(id));
  }

  buildCapital() {
    this.hasCapital = true;
    this.marker.material.opacity = 0.95;
  }

  setSelected(on) {
    this.selRing.material.opacity = on ? 0.95 : 0;
  }

  update(dt, gameSpeed) {
    // Gentle spin.
    if (this.surface) this.surface.rotation.y += this.spin * dt;
    if (this.clouds) this.clouds.rotation.y += this.spin * dt * 1.25;

    // Production: owned worlds grow fleets; neutral garrisons stay static.
    if (this.owner !== NEUTRAL && this.ships < this.maxShips) {
      this.ships = Math.min(this.maxShips, this.ships + this.production * gameSpeed * dt);
    }

    // Marker bob.
    if (this.hasCapital) {
      this.marker.position.y = this.radius * (1.5 + Math.sin(performance.now() * 0.003) * 0.08);
    }
  }

  get shipCount() { return Math.floor(this.ships); }
}
