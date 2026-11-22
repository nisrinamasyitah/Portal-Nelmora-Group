import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Libraries in their own files: they rarely change, so browsers keep them cached between updates.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory|internmap|decimal\.js|eventemitter3|lodash|react-smooth|recharts-scale|tiny-invariant|clsx|immer|reselect|redux|@reduxjs|use-sync-external-store|es-toolkit)/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
