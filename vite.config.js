import { defineConfig } from 'vite';

// The engine awaits the GPU at the top level, so the build targets browsers that have it.
export default defineConfig({
  base: './',
  build: { target: 'esnext', chunkSizeWarningLimit: 1500 },
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
