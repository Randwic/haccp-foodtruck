/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

// Lecture d'étiquette (Tesseract) : moteur, script du worker et langue française servis par l'app sous
// /ocr/ (aucun appel à un CDN extérieur). Copiés depuis node_modules au build, servis tels quels en dev.
// Trop lourds pour le pré-cache (≈ 4 Mo le moteur) : mis en cache à la première utilisation (runtimeCaching).
const require = createRequire(import.meta.url)
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'tesseract.js/dist/worker.min.js',
  'ocr/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/lang/fra.traineddata.gz': '@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz',
  // Moteur principal (PaddleOCR, réseau de neurones) : détection des zones de texte puis lecture.
  // Lit les impressions en points et le texte de travers, là où Tesseract échoue.
  'ocr/ort/ort-wasm-simd-threaded.mjs': 'onnxruntime-web/ort-wasm-simd-threaded.mjs',
  'ocr/ort/ort-wasm-simd-threaded.wasm': 'onnxruntime-web/ort-wasm-simd-threaded.wasm',
  'ocr/paddle/det.onnx': '@gutenye/ocr-models#assets/ch_PP-OCRv4_det_infer.onnx',
  'ocr/paddle/rec.onnx': '@gutenye/ocr-models#assets/ch_PP-OCRv4_rec_infer.onnx',
  'ocr/paddle/keys.txt': '@gutenye/ocr-models#assets/ppocr_keys_v1.txt',
}
/** Chemin d'un fichier de node_modules ; « @gutenye/ocr-models#… » : fichier du paquet des modèles (qui n'exporte que ./node). */
function ocrFile(mod: string): string {
  const [pkg, file] = mod.split('#')
  return file ? join(dirname(require.resolve(pkg + '/node')), file) : require.resolve(mod)
}
function ocrAssets(): Plugin {
  return {
    name: 'haccp-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = req.url?.split('?')[0].replace(/^\//, '')
        const mod = key ? OCR_FILES[key] : undefined
        if (!mod) return next()
        res.setHeader('Content-Type', /\.m?js$/.test(key!) ? 'text/javascript' : key!.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(readFileSync(ocrFile(mod)))
      })
    },
    generateBundle() {
      for (const [fileName, mod] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(ocrFile(mod)) })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ocrAssets(),
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
      // .wasm : encodeur WebP de secours (Safari iOS) ; .ttf : polices des étiquettes (impression hors-ligne).
      // ocr/ : lecture d'étiquette, mise en cache à la première utilisation (puis disponible hors-ligne).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,wasm,ttf}'],
        // ort-wasm* : copie du moteur émise par le bundler, inutilisée (chargé depuis /ocr/ort/).
        globIgnores: ['ocr/**', 'assets/ort-wasm*'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'haccp-ocr', expiration: { maxEntries: 20 } },
          },
        ],
      },
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
