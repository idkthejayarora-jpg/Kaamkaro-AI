import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Raise the warning threshold — the chunk-size warning was noise; the real
    // fix is lazy routes (done in App.tsx), not squeezing individual chunks.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep react/router in a tiny vendor chunk (loads first, cached long-term)
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor';
          }
          // Recharts is 434 KB — keep it separate so pages without charts never pay for it
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'charts';
          }
          // face-api stays in its own chunk (already lazy-loaded per route)
          if (id.includes('node_modules/@vladmandic')) {
            return 'face-api';
          }
        },
      },
    },
  },
});
