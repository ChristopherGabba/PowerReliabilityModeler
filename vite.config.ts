import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true },
})
