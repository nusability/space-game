import * as THREE from 'three';
import { makeStarfieldTexture } from './textures.js?v=8';

// Manages renderer, scene, camera rig, lighting, starfield and touch controls.
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 4000);

    // Spherical orbit state around a target point.
    this.target = new THREE.Vector3(0, 0, 0);
    this.azimuth = 0.6;
    this.polar = 1.15;            // from +Y axis
    this.radius = 160;
    this.minRadius = 30;
    this.maxRadius = 420;

    this._setupLights();
    this._setupStarfield();
    this._setupControls();

    this.raycaster = new THREE.Raycaster();
    this._updateCamera();

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLights() {
    // A distant star as key light gives planets a realistic terminator.
    this.sun = new THREE.DirectionalLight(0xfff4e8, 2.8);
    this.sun.position.set(-1, 0.35, 0.6).multiplyScalar(500);
    this.scene.add(this.sun);

    // Faint fill so the dark side isn't pure black.
    this.scene.add(new THREE.AmbientLight(0x223044, 0.55));
    // Cool rim from the opposite side.
    const rim = new THREE.DirectionalLight(0x4060a0, 0.5);
    rim.position.set(1, -0.2, -0.5).multiplyScalar(500);
    this.scene.add(rim);

    // Visible star sprite far away in the sun direction.
    const starMat = new THREE.SpriteMaterial({
      color: 0xfff0d0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const star = new THREE.Sprite(starMat);
    star.position.copy(this.sun.position).setLength(1800);
    star.scale.setScalar(420);
    this.scene.add(star);
  }

  _setupStarfield() {
    const tex = makeStarfieldTexture(99);
    const geo = new THREE.SphereGeometry(2500, 32, 24);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false });
    this.starfield = new THREE.Mesh(geo, mat);
    this.scene.add(this.starfield);
  }

  _setupControls() {
    const el = this.canvas;
    this.pointers = new Map();
    this._dragging = false;
    this._moved = 0;
    this._downTime = 0;
    this._lastPinch = 0;
    this._lastMid = null;
    this.panLimit = Infinity; // max distance the focus target may roam
    this.onTap = null; // callback(clientX, clientY)

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._dragging = true;
      this._moved = 0;
      this._downTime = performance.now();
      if (this.pointers.size === 2) {
        this._lastPinch = this._pinchDist();
        this._lastMid = this._pinchMid();
      }
    });

    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this._moved += Math.abs(dx) + Math.abs(dy);

      if (this.pointers.size >= 2) {
        // Two fingers: pinch to zoom, drag to pan.
        const d = this._pinchDist();
        const mid = this._pinchMid();
        if (this._lastPinch > 0) {
          const factor = this._lastPinch / d;
          this.radius = THREE.MathUtils.clamp(this.radius * factor, this.minRadius, this.maxRadius);
        }
        if (this._lastMid) {
          this._pan(mid.x - this._lastMid.x, mid.y - this._lastMid.y);
        }
        this._lastPinch = d;
        this._lastMid = mid;
        this._updateCamera();
      } else if (this.pointers.size === 1) {
        // Orbit.
        this.azimuth -= dx * 0.005;
        this.polar = THREE.MathUtils.clamp(this.polar - dy * 0.005, 0.25, Math.PI - 0.25);
        this._updateCamera();
      }
    });

    const end = (e) => {
      const wasTap = this.pointers.size === 1 && this._moved < 10 &&
        (performance.now() - this._downTime) < 350;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
      if (this.pointers.size === 0) this._dragging = false;
      if (wasTap && this.onTap) this.onTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
    });

    // Desktop wheel zoom.
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.radius = THREE.MathUtils.clamp(this.radius * (1 + Math.sign(e.deltaY) * 0.1), this.minRadius, this.maxRadius);
      this._updateCamera();
    }, { passive: false });
  }

  _pinchDist() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _pinchMid() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  // Pan the focus target in the camera plane by a screen-pixel delta.
  _pan(dxPx, dyPx) {
    const scale = this.radius * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dxPx * scale);
    this.target.addScaledVector(up, dyPx * scale);
    if (isFinite(this.panLimit) && this.target.length() > this.panLimit) {
      this.target.setLength(this.panLimit);
    }
    this._focusTarget = null; // don't fight an in-progress focus animation
  }

  // Approximate on-screen radius (px) of a sphere at world `pos` of radius `r`.
  projectedRadius(pos, r) {
    const c = pos.clone().project(this.camera);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const e = pos.clone().addScaledVector(right, r).project(this.camera);
    const dx = (e.x - c.x) * 0.5 * window.innerWidth;
    const dy = (e.y - c.y) * 0.5 * window.innerHeight;
    return Math.hypot(dx, dy);
  }

  _updateCamera() {
    const sinP = Math.sin(this.polar);
    const x = this.radius * sinP * Math.sin(this.azimuth);
    const y = this.radius * Math.cos(this.polar);
    const z = this.radius * sinP * Math.cos(this.azimuth);
    this.camera.position.set(
      this.target.x + x, this.target.y + y, this.target.z + z
    );
    this.camera.lookAt(this.target);
  }

  // Smoothly move focus toward a world.
  focusOn(pos, radius) {
    this._focusTarget = pos.clone();
    this._focusRadius = radius || null; // null = keep current zoom
  }

  setBounds(maxR) {
    this.maxRadius = maxR;
    this.radius = Math.min(this.radius, maxR);
  }

  // Returns the first intersected object from a list, given screen coords.
  pick(clientX, clientY, objects) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(objects, false);
    return hits.length ? hits[0] : null;
  }

  worldToScreen(pos) {
    const v = pos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      behind: v.z > 1,
    };
  }

  update(dt) {
    if (this._focusTarget) {
      this.target.lerp(this._focusTarget, Math.min(1, dt * 3));
      if (this._focusRadius) {
        this.radius += (this._focusRadius - this.radius) * Math.min(1, dt * 3);
      }
      if (this.target.distanceTo(this._focusTarget) < 0.5) {
        this._focusTarget = null; this._focusRadius = null;
      }
      this._updateCamera();
    }
    if (this.starfield) this.starfield.rotation.y += dt * 0.004;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}
