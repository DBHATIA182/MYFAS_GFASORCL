import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PROXY_TARGET = 'http://127.0.0.1:5002'

export default defineConfig({
  plugins: [
    react(),
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
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})