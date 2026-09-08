import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A relative base makes the static build compatible with GitHub Pages
  // project sites as well as ordinary static hosting.
  base: '/Salk-AIRC-Take-Home-Maze-Analyzer',
});
