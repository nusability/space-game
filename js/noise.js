// 3D simplex noise — adapted from Stefan Gustavson's public-domain implementation.
// Seedable permutation table so planets are deterministic per-seed.

const grad3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];

function buildPerm(seed) {
  // Simple xorshift PRNG seeded shuffle of 0..255
  let s = (seed | 0) || 1;
  const rand = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

export function createNoise3D(seed = 1) {
  const { perm, permMod12 } = buildPerm(seed);
  const F3 = 1 / 3, G3 = 1 / 6;

  return function noise(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else               { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0)       { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0)  { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else               { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;

    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 < 0) n0 = 0; else { const gi0 = permMod12[ii+perm[jj+perm[kk]]]; t0 *= t0; n0 = t0*t0*dot(grad3[gi0], x0,y0,z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 < 0) n1 = 0; else { const gi1 = permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]]; t1 *= t1; n1 = t1*t1*dot(grad3[gi1], x1,y1,z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 < 0) n2 = 0; else { const gi2 = permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]]; t2 *= t2; n2 = t2*t2*dot(grad3[gi2], x2,y2,z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 < 0) n3 = 0; else { const gi3 = permMod12[ii+1+perm[jj+1+perm[kk+1]]]; t3 *= t3; n3 = t3*t3*dot(grad3[gi3], x3,y3,z3); }

    return 32 * (n0 + n1 + n2 + n3); // ~[-1,1]
  };
}

function dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

// Fractal Brownian motion built on a noise function.
export function fbm(noise, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // ~[-1,1]
}
