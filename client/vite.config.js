import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/login': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/logout': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/authorize': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/callback': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
