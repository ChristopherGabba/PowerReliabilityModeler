import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), cloudflare()],
  // A production deployment must never inherit the development key in .env.local.
  define:
    process.env.CLOUDFLARE_ENV === 'production'
      ? {
          'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(
            'pk_live_Y2xlcmsucG93ZXJzeXN0ZW1zbW9kZWx0b2pzb24uY29tJA',
          ),
        }
      : {},
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true },
})
