import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
const BASE = process.env.BASE_PATH || '/'
const normalizeBase = (base) => {
  if (!base) return ''
  if (base === '/') return ''
  return base.endsWith('/') ? base.slice(0, -1) : base
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizedBase = normalizeBase(BASE)
const basePattern = escapeRegex(normalizedBase)
const literalPattern = (segment, { anchored = false } = {}) => {
  const escapedSegment = escapeRegex(segment)
  return new RegExp(`${anchored ? '^' : ''}${basePattern}${escapedSegment}`)
}
const regexPattern = (segment, { anchored = false } = {}) =>
  new RegExp(`${anchored ? '^' : ''}${basePattern}${segment}`)
const routePrefixPattern = (segment) =>
  new RegExp(`^${basePattern}${escapeRegex(segment)}(?:/|$)`)

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      mode: 'development',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'Nekomimi',
        short_name: 'Nekomimi',
        description: 'Local DLsite audio library with offline support',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: BASE,
        icons: [
          { src: 'favicon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'favicon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${BASE.replace(/\/$/, '')}/index.html`,
        navigateFallbackDenylist: [
          routePrefixPattern('/api'),
          routePrefixPattern('/media'),
          routePrefixPattern('/files'),
          routePrefixPattern('/cover'),
          literalPattern('/favicon', { anchored: true }),
          literalPattern('/apple-touch-icon', { anchored: true }),
          literalPattern('/manifest.webmanifest', { anchored: true }),
          literalPattern('/sw.js', { anchored: true }),
          literalPattern('/workbox-', { anchored: true }),
          literalPattern('/registerSW.js', { anchored: true }),
        ],
        navigationPreload: false,
        runtimeCaching: [
          {
            urlPattern: literalPattern('/api/health', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: literalPattern('/api/docs', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: literalPattern('/api/openapi.json', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: literalPattern('/api/scan/stream', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: regexPattern('/api/scan/jobs/.+/stream', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: literalPattern('/api/auth/', { anchored: true }),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: literalPattern('/api/', { anchored: true }),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: literalPattern('/cover/', { anchored: true }),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cover-images',
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: regexPattern('/(media|files)/', { anchored: true }),
            handler: 'NetworkOnly',
          },
        ],
      },
      // Disable dev SW by default to prevent dev-dist generation and auto SW install
      // Enable via ENABLE_PWA_DEV=1 when you really want to test SW in dev.
      devOptions: {
        enabled: process.env.ENABLE_PWA_DEV === '1',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
      '/media': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
      '/cover': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
      '/files': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
    }
  },
})
