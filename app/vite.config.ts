/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Space Diner – HACCP',
        short_name: 'HACCP',
        lang: 'fr',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0A0E1F',
        theme_color: '#0A0E1F',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // .wasm : encodeur WebP de secours (Safari iOS), disponible hors-ligne.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'] },
    }),
  ],
  // L'encodeur WebAssembly charge son .wasm via import.meta.url : pas de pré-bundling.
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts', '../supabase/functions/**/*.test.ts'],
  },
})
