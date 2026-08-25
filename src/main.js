import { Game } from './game.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { SHIPS } from './ships.js';

const canvas = document.getElementById('view');
const hud = new HUD();
const input = new Input(canvas);
const audio = new Audio();
const game = new Game(canvas, hud, input, audio);

window.game = game;   // handy for debugging from the console

let paused = false;
let currentDef = SHIPS[0];

function startBattle(def) {
  currentDef = def ?? currentDef;
  audio.init();
  hud.hideGameOver();
  hud.showPause(false);
  hud.showMenu(false);
  paused = false;
  game.overShown = false;
  input.enabled = true;
  game.start(currentDef);
  canvas.requestPointerLock();
}

function toMenu() {
  input.enabled = false;
  paused = false;
  hud.hideGameOver();
  hud.showPause(false);
  hud.showMenu(true);
  document.exitPointerLock?.();
  game.showPreview(currentDef);
}

hud.buildMenu(
  SHIPS,
  (def) => {
    currentDef = def;
    game.showPreview(def);
  },
  (def) => startBattle(def)
);
hud.selectShip(SHIPS[0]);
game.showPreview(SHIPS[0]);
hud.showMenu(true);

document.getElementById('resumeBtn').onclick = () => {
  paused = false;
  hud.showPause(false);
  canvas.requestPointerLock();
};
document.getElementById('quitBtn').onclick = toMenu;
document.getElementById('menuBtn').onclick = toMenu;
document.getElementById('againBtn').onclick = () => startBattle(currentDef);

document.addEventListener('pointerlockchange', () => {
  if (game.mode === 'battle' && !input.locked && !paused) {
    paused = true;
    hud.showPause(true);
  }
});

addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (game.mode !== 'battle') return;
  if (paused) {
    paused = false;
    hud.showPause(false);
    canvas.requestPointerLock();
  } else {
    paused = true;
    hud.showPause(true);
    document.exitPointerLock?.();
  }
});

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!paused) {
    game.update(dt);
    if (game.mode === 'battle' || game.mode === 'over') hud.update(game, dt);
  }
  game.render();
  input.endFrame();
}
requestAnimationFrame(frame);
