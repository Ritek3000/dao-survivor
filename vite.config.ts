import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade im Build, damit dieselben Dateien später auch in einer Desktop-Hülle laufen.
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
