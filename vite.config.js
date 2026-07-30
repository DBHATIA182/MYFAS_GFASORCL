import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PROXY_TARGET = 'http://127.0.0.1:5002'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Mobile Safari / in-app browsers drop stylesheets that fail CORS when `crossorigin` is set. */
function stripStylesheetCrossorigin() {
  return {
    name: 'gfasorcl-strip-css-crossorigin',
    transformIndexHtml(html) {
      return html.replace(
        /<link([^>]*\brel=["']stylesheet["'][^>]*)>/gi,
        (full, attrs) => {
          if (!/\bcrossorigin\b/i.test(attrs)) return full
          const cleaned = attrs
            .replace(/\s*crossorigin(?:=["'][^"']*["'])?/gi, '')
            .replace(/\s{2,}/g, ' ')
          return `<link${cleaned}>`
        },
      )
    },
  }
}

/**
 * Vite SPA fallback returns index.html for missing /assets/* (200 text/html).
 * After a rebuild, phones with a stale CSS URL then get HTML-as-CSS → fully unstyled UI
 * while a cached JS bundle may still run. Real 404s make the problem obvious and avoid that trap.
 */
function rejectMissingAssets({ rootDir, isPreview }) {
  return {
    name: 'gfasorcl-reject-missing-assets',
    configureServer(server) {
      attachMissingAssetGuard(server, { rootDir, isPreview: false })
    },
    configurePreviewServer(server) {
      attachMissingAssetGuard(server, { rootDir, isPreview: true })
    },
  }
}

function attachMissingAssetGuard(server, { rootDir, isPreview }) {
  server.middlewares.use((req, res, next) => {
    const raw = req.url || ''
    const pathname = raw.split('?')[0] || ''
    if (!pathname.startsWith('/assets/')) {
      next()
      return
    }

    const rel = pathname.replace(/^\/+/, '')
    const filePath = isPreview
      ? path.join(rootDir, 'dist', rel)
      : path.join(rootDir, rel)

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      next()
      return
    }

    // Dev: Vite serves transformed modules from memory — only block clearly hashed build leftovers.
    if (!isPreview && !/\.[a-zA-Z0-9_-]{6,}\.(css|js|mjs|map|woff2?|ttf|png|jpe?g|svg|webp)$/i.test(pathname)) {
      next()
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(`Missing asset: ${pathname}`)
  })
}

const assetHeaders = {
  'Access-Control-Allow-Origin': '*',
}

export default defineConfig({
  plugins: [
    react(),
    stripStylesheetCrossorigin(),
    rejectMissingAssets({ rootDir: __dirname, isPreview: false }),
    {
      name: 'gfasorcl-api-proxy-log',
      configureServer() {
        console.log(
          `[GFASORCL] port 5173 (strictPort). /api → ${API_PROXY_TARGET} — run npm run server on 5002 or npm run dev:all`
        )
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    headers: assetHeaders,
    // Forward /api to Node (npm run server). Avoids 404 when the UI hits 5173 without a matching route.
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    headers: assetHeaders,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})