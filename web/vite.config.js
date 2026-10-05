import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: /api/* is forwarded to the Express API on :8080.
// In production the site calls VITE_API_URL directly (see src/api.js).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
