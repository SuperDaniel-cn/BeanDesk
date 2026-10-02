import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const favaProxy = {
  '/api/fava': {
    target: process.env.FAVA_URL ?? 'http://127.0.0.1:5000',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/fava/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // Transparent reverse proxy to local Fava core (default: 5000)
    proxy: favaProxy,
  },
  preview: {
    port: 5188,
    proxy: favaProxy,
  },
})
