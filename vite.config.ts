import { defineConfig } from 'vite';
import pkg from './package.json';

// Die Versionsnummer des Spiels steht nur in package.json (siehe „Versionsnummer“ in CLAUDE.md). Hier wird sie beim
// Bauen in den Startbildschirm geschrieben: `%APP_VERSION%` in index.html wird durch sie ersetzt. `order: 'pre'`, damit
// Vites eigener Ersatz für `%NAME%` (Umgebungsvariablen) den Platzhalter nicht vorher als unbekannt meldet.
export default defineConfig({
  // Relative Pfade im Build, damit dieselben Dateien später auch in einer Desktop-Hülle laufen.
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
  // Die Fassung steht auch im Code zur Verfügung (die Statistik hält sie je Nacht fest), ohne dass dort eine zweite Zahl steht.
  define: { __GAME_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    {
      name: 'dao-version',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('%APP_VERSION%', pkg.version),
      },
    },
  ],
});
