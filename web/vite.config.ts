import fs from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { rewriteDocsDirectoryRequest } from './src/lib/handbook-docs-routing.ts'

const favaProxy = {
  '/api/fava': {
    target: process.env.FAVA_URL ?? 'http://127.0.0.1:5000',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/fava/, ''),
  },
}

const handbookImagesRoot = path.resolve(import.meta.dirname, '../docs/images')

function handbookImageType(file: string): string {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
  if (file.endsWith('.webp')) return 'image/webp'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function handbookDocsIndex(): Plugin {
  return {
    name: 'handbook-docs-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewriteDocsDirectoryRequest(req.url)
        next()
      })
    },
  }
}

function handbookImages(): Plugin {
  return {
    name: 'handbook-images',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/images/')) {
          next()
          return
        }
        const rel = decodeURIComponent(url.slice('/images/'.length))
        const file = path.resolve(handbookImagesRoot, rel)
        const inside = !path.relative(handbookImagesRoot, file).startsWith('..')
        if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', handbookImageType(file))
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      const dir = options.dir ?? path.resolve(import.meta.dirname, 'dist')
      fs.cpSync(handbookImagesRoot, path.join(dir, 'images'), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [handbookDocsIndex(), react(), tailwindcss(), handbookImages()],
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
