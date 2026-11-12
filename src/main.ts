import './style.css';
import { Game } from './game/game';
import { Hud } from './ui/hud';

try {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Element #game fehlt in index.html.');
  const game = new Game(canvas, new Hud(import.meta.env.DEV));
  game.start();
  // Zugriff aus der Browser-Konsole beim Entwickeln und Testen.
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game }).__game = game;
    // Der Messlauf gehört nicht ins fertige Spiel und wird deshalb nur hier nachgeladen.
    void import('./tools/messlauf').then(({ installMesslauf }) => installMesslauf(game));
  }
} catch (error) {
  const message = document.getElementById('error');
  if (message) {
    message.textContent = 'Das Spiel konnte nicht starten. Unterstützt dieser Browser WebGL?';
    message.hidden = false;
  }
  throw error;
}
