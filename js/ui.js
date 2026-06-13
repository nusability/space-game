import { OWNER_COLORS, OWNER_NAMES, NEUTRAL, PLAYER } from './constants.js?v=9';

const hex = (id) => '#' + (OWNER_COLORS[id] ?? 0xffffff).toString(16).padStart(6, '0');

// Owns all DOM overlay/HUD interaction. The game wires callbacks onto it.
export class UI {
  constructor() {
    this.labelLayer = document.createElement('div');
    this.labelLayer.id = 'labels';
    Object.assign(this.labelLayer.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10',
    });
    document.body.appendChild(this.labelLayer);
    this.labels = new Map();

    // Stat readouts
    this.statPlanets = document.querySelector('#stat-planets .val');
    this.statShips = document.querySelector('#stat-ships .val');
    this.statTech = document.querySelector('#stat-tech .val');
    this.messages = document.getElementById('messages');

    // Send panel
    this.sendPanel = document.getElementById('send-panel');
    this.sendSlider = document.getElementById('send-slider');
    this.sendCountEl = document.getElementById('send-count');
    this._sourceMax = 1;

    this.sendSlider.addEventListener('input', () => this._refreshSendCount());
    this.sendPanel.querySelectorAll('.send-quick button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sendSlider.value = btn.dataset.pct;
        this._refreshSendCount();
      });
    });
    document.getElementById('send-cancel').addEventListener('click', () => this.onCancel && this.onCancel());
    document.getElementById('send-go').addEventListener('click', () => {
      const amount = this._sendAmount();
      this.onSend && this.onSend(amount);
    });

    // Planet panel
    this.planetPanel = document.getElementById('planet-panel');
    this.ppName = this.planetPanel.querySelector('.pp-name');
    this.buildBtn = document.getElementById('build-capital');
    document.getElementById('capital-cost').textContent = '';
    this.buildBtn.addEventListener('click', () => this.onBuildCapital && this.onBuildCapital());
    document.getElementById('planet-close').addEventListener('click', () => this.onClosePlanet && this.onClosePlanet());

    // Overlays + setup form
    this.overlay = document.getElementById('overlay');
    this.endscreen = document.getElementById('endscreen');

    this._difficulty = 'normal';
    this.diffSeg = document.getElementById('diff-seg');
    this.diffSeg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        this.diffSeg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._difficulty = b.dataset.diff;
      });
    });

    this.planetsRange = document.getElementById('planets-range');
    this.planetsVal = document.getElementById('planets-val');
    this.aiRange = document.getElementById('ai-range');
    this.aiVal = document.getElementById('ai-val');
    this.spectateChk = document.getElementById('spectate-chk');

    this.planetsRange.addEventListener('input', () => {
      this.planetsVal.textContent = this.planetsRange.value;
    });
    this.aiRange.addEventListener('input', () => this._syncAi());
    this.spectateChk.addEventListener('change', () => this._syncAi());

    document.getElementById('launch').addEventListener('click', () => {
      this.onStart && this.onStart({
        difficulty: this._difficulty,
        planets: +this.planetsRange.value,
        ai: +this.aiRange.value,
        spectate: this.spectateChk.checked,
      });
    });

    document.getElementById('restart').addEventListener('click', () => {
      this.endscreen.classList.add('hidden');
      this.overlay.classList.remove('hidden');
    });

    // Pause button + menu
    this.pauseBtn = document.getElementById('pause-btn');
    this.pauseMenu = document.getElementById('pause-menu');
    this.pauseBtn.addEventListener('click', () => {
      this.pauseMenu.classList.remove('hidden');
      this.pauseBtn.classList.add('hidden');
      this.onPause && this.onPause();
    });
    document.getElementById('resume').addEventListener('click', () => {
      this.pauseMenu.classList.add('hidden');
      this.pauseBtn.classList.remove('hidden');
      this.onResume && this.onResume();
    });
    document.getElementById('pause-restart').addEventListener('click', () => {
      this.pauseMenu.classList.add('hidden');
      this.pauseBtn.classList.add('hidden');
      this.overlay.classList.remove('hidden'); // back to setup
      this.onRestart && this.onRestart();
    });
  }

  showPauseButton(show) {
    this.pauseBtn.classList.toggle('hidden', !show);
  }

  // Human mode allows 1-3 AI (4 owner slots); spectate allows 2-4.
  _syncAi() {
    const spectate = this.spectateChk.checked;
    const min = spectate ? 2 : 1, max = spectate ? 4 : 3;
    let v = +this.aiRange.value;
    v = Math.max(min, Math.min(max, v));
    this.aiRange.min = min; this.aiRange.max = max; this.aiRange.value = v;
    this.aiVal.textContent = v;
  }

  // ---- labels ----
  initLabels(planets) {
    this.clearLabels();
    for (const p of planets) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', transform: 'translate(-50%,-50%)',
        font: '700 13px system-ui, sans-serif', textShadow: '0 1px 3px rgba(0,0,0,0.9)',
        whiteSpace: 'nowrap', pointerEvents: 'none', transition: 'opacity 0.2s',
      });
      this.labelLayer.appendChild(el);
      this.labels.set(p.id, el);
    }
  }

  clearLabels() {
    this.labelLayer.innerHTML = '';
    this.labels.clear();
  }

  updateLabels(planets, scene) {
    for (const p of planets) {
      const el = this.labels.get(p.id);
      if (!el) continue;
      const s = scene.worldToScreen(p.position);
      const r = p.radius;
      // Offset label below the planet.
      const sBottom = scene.worldToScreen(p.position.clone().setY(p.position.y - r * 1.6));
      if (s.behind) { el.style.opacity = '0'; continue; }
      el.style.left = sBottom.x + 'px';
      el.style.top = sBottom.y + 'px';

      if (!p.discovered) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = p.visible ? '1' : '0.45';
      if (p.visible) {
        el.style.color = hex(p.owner);
        el.textContent = p.shipCount.toString();
      } else {
        el.style.color = hex(p.owner);
        el.textContent = '?';
      }
    }
  }

  updateStats(worlds, ships, tech) {
    this.statPlanets.textContent = worlds;
    this.statShips.textContent = ships;
    this.statTech.textContent = tech;
  }

  // ---- panels ----
  showPlanetPanel(planet, canBuild, cost) {
    this.sendPanel.classList.add('hidden');
    this.planetPanel.classList.remove('hidden');
    this.ppName.textContent = `${planet.name} · ${OWNER_NAMES[planet.owner]} · ${planet.shipCount} ships`;
    this.ppName.style.color = hex(planet.owner);
    if (planet.hasCapital) {
      this.buildBtn.textContent = 'Warp Hub Active';
      this.buildBtn.disabled = true;
    } else if (canBuild) {
      this.buildBtn.textContent = `Build Capital Ship (${cost})`;
      this.buildBtn.disabled = planet.shipCount < cost;
    } else {
      this.buildBtn.textContent = `Capital Ship — reach Tech 3`;
      this.buildBtn.disabled = true;
    }
  }

  showSendPanel(sourceShips) {
    this.planetPanel.classList.add('hidden');
    this.sendPanel.classList.remove('hidden');
    this._sourceMax = Math.max(1, sourceShips);
    this.sendSlider.value = 50;
    this._refreshSendCount();
  }

  hidePanels() {
    this.sendPanel.classList.add('hidden');
    this.planetPanel.classList.add('hidden');
  }

  _sendAmount() {
    return Math.max(1, Math.round(this._sourceMax * (this.sendSlider.value / 100)));
  }
  _refreshSendCount() {
    this.sendCountEl.textContent = this._sendAmount();
  }

  // ---- feedback ----
  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.messages.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }

  showEnd(win, text, title) {
    this.hidePanels();
    this.showPauseButton(false);
    document.getElementById('end-title').textContent = title || (win ? 'Victory' : 'Defeat');
    document.getElementById('end-text').textContent = text;
    this.endscreen.classList.remove('hidden');
  }

  hideOverlay() { this.overlay.classList.add('hidden'); }
}
