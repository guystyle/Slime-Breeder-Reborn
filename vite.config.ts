import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'src/client/index.html', gallery: 'src/client/gallery.html' } },
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { root: '.', include: ['src/**/*.test.ts'] },
});
