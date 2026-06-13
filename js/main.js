import { SceneManager } from './scene.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const canvas = document.getElementById('scene');
const scene = new SceneManager(canvas);
const ui = new UI();
const game = new Game(scene, ui);

let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab switches

  game.update(dt);
  scene.update(dt);
  if (game.started) ui.updateLabels(game.planets, scene);
  scene.render();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Prevent iOS double-tap zoom / pull-to-refresh leaking through.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
