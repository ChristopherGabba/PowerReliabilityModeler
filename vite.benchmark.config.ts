import { defineConfig } from 'vite'
export default defineConfig({
  root: 'tests/performance',
  publicDir: '../../public',
  build: {
    outDir: '../../dist-benchmark',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        benchmark: 'tests/performance/index.html',
        arrangement: 'tests/performance/arrangement.html',
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
})
