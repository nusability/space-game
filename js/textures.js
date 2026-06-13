import * as THREE from 'three';
import { createNoise3D, fbm } from './noise.js';

// Planet archetypes with colour ramps (height -> rgb). Heights in [0,1].
export const PLANET_TYPES = ['ocean', 'desert', 'ice', 'lava', 'gas', 'barren'];

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Ramp lookup: stops = [{h, c:[r,g,b]}...] sorted by h.
function ramp(stops, h) {
  if (h <= stops[0].h) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i].h) {
      const t = (h - stops[i-1].h) / (stops[i].h - stops[i-1].h);
      return mix(stops[i-1].c, stops[i].c, t);
    }
  }
  return stops[stops.length - 1].c;
}

const RAMPS = {
  ocean: [
    { h: 0.00, c: [12, 30, 70] },
    { h: 0.45, c: [20, 70, 130] },
    { h: 0.50, c: [30, 110, 170] },
    { h: 0.52, c: [210, 195, 140] }, // beach
    { h: 0.60, c: [70, 130, 60] },
    { h: 0.78, c: [90, 110, 55] },
    { h: 0.88, c: [110, 95, 70] },
    { h: 1.00, c: [240, 245, 250] }, // snow peaks
  ],
  desert: [
    { h: 0.00, c: [120, 70, 40] },
    { h: 0.40, c: [170, 110, 60] },
    { h: 0.60, c: [210, 160, 95] },
    { h: 0.80, c: [230, 195, 140] },
    { h: 1.00, c: [245, 225, 190] },
  ],
  ice: [
    { h: 0.00, c: [120, 150, 190] },
    { h: 0.45, c: [170, 200, 230] },
    { h: 0.70, c: [220, 235, 250] },
    { h: 1.00, c: [255, 255, 255] },
  ],
  lava: [
    { h: 0.00, c: [20, 12, 12] },
    { h: 0.50, c: [50, 25, 20] },
    { h: 0.72, c: [90, 40, 25] },
    { h: 0.85, c: [200, 70, 20] },
    { h: 0.93, c: [255, 150, 30] },
    { h: 1.00, c: [255, 240, 160] },
  ],
  gas: [
    { h: 0.00, c: [140, 90, 55] },
    { h: 0.35, c: [200, 150, 95] },
    { h: 0.55, c: [235, 205, 150] },
    { h: 0.75, c: [210, 165, 110] },
    { h: 1.00, c: [250, 235, 205] },
  ],
  barren: [
    { h: 0.00, c: [55, 55, 62] },
    { h: 0.45, c: [95, 95, 105] },
    { h: 0.75, c: [140, 140, 150] },
    { h: 1.00, c: [185, 185, 195] },
  ],
};

const texCache = new Map();

// Generate an equirectangular diffuse texture (and emissive for lava) by
// sampling 3D fbm on the unit sphere — seamless across the wrap.
export function makePlanetTexture(type, seed, size = 256) {
  const key = `${type}:${seed}:${size}`;
  if (texCache.has(key)) return texCache.get(key);

  const w = size * 2, h = size;
  const noise = createNoise3D(seed);
  const noise2 = createNoise3D(seed * 7 + 13);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const stops = RAMPS[type];
  const isGas = type === 'gas';
  const isLava = type === 'lava';

  let emCanvas = null, emData = null;
  if (isLava) {
    emCanvas = document.createElement('canvas');
    emCanvas.width = w; emCanvas.height = h;
  }
  const emImg = isLava ? ctx.createImageData(w, h) : null;
  emData = emImg ? emImg.data : null;

  for (let y = 0; y < h; y++) {
    const lat = (y / (h - 1)) * Math.PI - Math.PI / 2; // -pi/2..pi/2
    const cy = Math.cos(lat), sy = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = cy * Math.cos(lon);
      const py = sy;
      const pz = cy * Math.sin(lon);

      let val;
      if (isGas) {
        // Latitude bands warped by turbulence -> Jupiter-like belts.
        const warp = fbm(noise2, px * 1.6, py * 1.6, pz * 1.6, 4) * 0.35;
        const bands = Math.sin((py + warp) * 9.0);
        const detail = fbm(noise, px * 3, py * 3, pz * 3, 4) * 0.25;
        val = (bands * 0.5 + 0.5) * 0.8 + (detail * 0.5 + 0.5) * 0.2;
      } else {
        val = fbm(noise, px * 2.0, py * 2.0, pz * 2.0, 5) * 0.5 + 0.5;
        // Polar ice caps for ocean/desert
        if (type === 'ocean' || type === 'desert') {
          const polar = Math.max(0, Math.abs(sy) - 0.72) / 0.28;
          val = Math.min(1, val + polar * polar * 0.9);
        }
      }
      val = Math.max(0, Math.min(1, val));

      let c = ramp(stops, val);

      // Cheap relief shading: brighten high terrain, darken valleys.
      const shade = 0.82 + val * 0.30;
      const idx = (y * w + x) * 4;
      data[idx]     = Math.min(255, c[0] * shade);
      data[idx + 1] = Math.min(255, c[1] * shade);
      data[idx + 2] = Math.min(255, c[2] * shade);
      data[idx + 3] = 255;

      if (isLava && emData) {
        // Glowing cracks where height is high.
        const glow = Math.max(0, val - 0.8) / 0.2;
        emData[idx]     = 255 * glow;
        emData[idx + 1] = 120 * glow;
        emData[idx + 2] = 20 * glow;
        emData[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  let emissiveMap = null;
  if (isLava && emData) {
    emCanvas.getContext('2d').putImageData(emImg, 0, 0);
    emissiveMap = new THREE.CanvasTexture(emCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
  }

  const result = { map, emissiveMap };
  texCache.set(key, result);
  return result;
}

// Cloud layer (white blobs on transparent) for habitable worlds.
export function makeCloudTexture(seed, size = 256) {
  const key = `clouds:${seed}:${size}`;
  if (texCache.has(key)) return texCache.get(key);
  const w = size * 2, h = size;
  const noise = createNoise3D(seed * 31 + 5);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    const lat = (y / (h - 1)) * Math.PI - Math.PI / 2;
    const cy = Math.cos(lat), sy = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = cy * Math.cos(lon), py = sy, pz = cy * Math.sin(lon);
      let v = fbm(noise, px * 2.4, py * 2.4, pz * 2.4, 5) * 0.5 + 0.5;
      v = Math.max(0, (v - 0.52) / 0.48);
      v = Math.pow(v, 1.4);
      const idx = (y * w + x) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = 255;
      data[idx + 3] = Math.min(255, v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

// Soft round sprite used for ship dots and glows.
export function makeDotTexture() {
  if (texCache.has('dot')) return texCache.get('dot');
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  texCache.set('dot', tex);
  return tex;
}

// Soft annulus (ownership ring) sprite, white so it can be tinted.
export function makeRingTexture() {
  if (texCache.has('ring')) return texCache.get('ring');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.translate(s/2, s/2);
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    const r = s * 0.30 + t * s * 0.16;
    const a = Math.sin(t * Math.PI);
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.06})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.40, 0, Math.PI * 2); ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  texCache.set('ring', tex);
  return tex;
}

// Four-point star / capital-ship marker sprite (white, tintable).
export function makeMarkerTexture() {
  if (texCache.has('marker')) return texCache.get('marker');
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.translate(s/2, s/2);
  const g = ctx.createRadialGradient(0,0,0,0,0,s/2);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.5,'rgba(255,255,255,0.4)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -s/2); ctx.lineTo(s*0.08, 0); ctx.lineTo(0, s/2); ctx.lineTo(-s*0.08, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  texCache.set('marker', tex);
  return tex;
}

// Distant starfield as a big inward-facing sphere texture.
export function makeStarfieldTexture(seed = 99) {
  if (texCache.has('stars')) return texCache.get('stars');
  const w = 2048, h = 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // Faint nebula wash
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#05060f');
  grad.addColorStop(0.5, '#080a1a');
  grad.addColorStop(1, '#04050c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const noise = createNoise3D(seed);
  // Nebula clouds
  for (let i = 0; i < 3; i++) {
    const hue = [220, 280, 200][i];
    ctx.globalAlpha = 0.04;
    for (let n = 0; n < 60; n++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = 80 + Math.random() * 220;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, `hsla(${hue}, 60%, 50%, 0.5)`);
      g2.addColorStop(1, 'transparent');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Stars
  const count = 1400;
  let s = seed;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = rnd() * 1.4 + 0.2;
    const b = 0.5 + rnd() * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${b})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (rnd() > 0.93) {
      ctx.fillStyle = `rgba(170,200,255,${b * 0.6})`;
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set('stars', tex);
  return tex;
}
