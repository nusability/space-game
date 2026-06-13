import { SceneManager } from './scene.js?v=12';
import { UI } from './ui.js?v=12';
import { Game } from './game.js?v=12';

function fatal(e) {
  const msg = (e && (e.stack || e.message)) || String(e);
  if (window.__fatal) window.__fatal(msg);
  console.error(e);
}

let scene, ui, game;
try {
  const canvas = document.getElementById('scene');
  scene = new SceneManager(canvas);
  ui = new UI();
  game = new Game(scene, ui);
  window.__booted = true; // tells the boot watchdog we're alive
} catch (e) {
  fatal(e);
}

let last = performance.now();
let stopped = false;
function loop(now) {
  if (stopped) return;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab switches

  try {
    if (game) {
      game.update(dt);
      scene.update(dt);
      if (game.started) ui.updateLabels(game.planets, scene);
      scene.render();
    }
  } catch (e) {
    stopped = true; // stop so we don't spam the same error every frame
    fatal(e);
    return;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Prevent iOS double-tap zoom / pull-to-refresh leaking through.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
