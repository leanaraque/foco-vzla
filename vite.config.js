import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Presupuesto de peso estricto (Spec §6.1): chunks separados, mapa diferido.
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'FOCO — Coordinación de ayuda',
        short_name: 'FOCO',
        description: 'Coordinación de ayuda ciudadana. No es un servicio de emergencia.',
        lang: 'es',
        theme_color: '#0b3d5c',
        background_color: '#0b3d5c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Tiles de OpenStreetMap: cache para no re-descargar en 2G/3G (Spec §6.3)
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.host.includes('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2019',
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/app-check', 'firebase/auth', 'firebase/firestore'],
          leaflet: ['leaflet', 'leaflet.markercluster']
        }
      }
    }
  }
});
