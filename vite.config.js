import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL as NodeURL } from 'node:url'

const require = createRequire(import.meta.url)

// Load .env.local into process.env at startup
try {
  const lines = readFileSync('.env.local', 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)\s*$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']+|["']+$/g, '')
  }
} catch { /* no .env.local — env vars must come from the shell */ }

// Wraps Node's IncomingMessage/ServerResponse to match Vercel handler signature
function makeRes(nativeRes) {
  let code = 200
  return {
    setHeader: (k, v) => nativeRes.setHeader(k, v),
    status(c) { code = c; return this },
    end(data) { nativeRes.statusCode = code; nativeRes.end(data) },
    json(data) {
      nativeRes.statusCode = code
      nativeRes.setHeader('Content-Type', 'application/json')
      nativeRes.end(JSON.stringify(data))
    }
  }
}

const API_ROUTES = {
  '/api/brickeconomy-collection':   require('./api/brickeconomy-collection'),
  '/api/brickeconomy-set':          require('./api/brickeconomy-set'),
  '/api/brickset-set':              require('./api/brickset-set'),
  '/api/brickset-search':           require('./api/brickset-search'),
  '/api/brickset-themes':           require('./api/brickset-themes'),
  '/api/bricklink-auth':            require('./api/bricklink-auth'),
  '/api/bricklink-priceguide':      require('./api/bricklink-priceguide'),
  '/api/lego-last-chance':          require('./api/lego-last-chance'),
  '/api/brickfanatics-retiring':    require('./api/brickfanatics-retiring'),
}

export default defineConfig({
  server: { port: 5179, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1000, // exceljs is ~930 KB but lazy-loaded; suppress warning
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory-vendor")) {
            return "vendor-charts";
          }
        }
      }
    }
  },
  plugins: [
    react(),
    {
      name: 'local-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url.split('?')[0]
          const handler = API_ROUTES[pathname]
          if (!handler) return next()

          const query = Object.fromEntries(
            new NodeURL(req.url, 'http://localhost').searchParams
          )
          // Attach query onto the native IncomingMessage so POST handlers
          // can also stream the request body via req.on("data", ...)
          req.query = query
          handler(req, makeRes(res))
        })
      }
    }
  ],
})
