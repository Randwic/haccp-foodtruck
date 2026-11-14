// Régénère les icônes PWA à partir du composant BrandLogo (app/src/ui/brand.tsx).
// Usage (depuis app/) : node scripts/generate-icons.mjs
// Prérequis : Playwright + Chromium disponibles (require('playwright')).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const pub = join(appDir, 'public')
const require = createRequire(import.meta.url)
let playwright
try {
  playwright = require('playwright')
} catch {
  playwright = createRequire('/opt/node-tools/')('playwright')
}

const NAVY = '#0A0E1F'
const fontPath = require.resolve('@fontsource/bowlby-one/files/bowlby-one-latin-400-normal.woff2', { paths: [appDir] })
const fontB64 = readFileSync(fontPath).toString('base64')

// Rendu du composant React en SVG statique (via le chargeur SSR de Vite, sans plugin PWA).
const server = await createServer({ root: appDir, configFile: false, logLevel: 'error', server: { middlewareMode: true }, ssr: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } })
const { BrandLogo } = await server.ssrLoadModule('/src/ui/brand.tsx')
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
await server.close()
const logo = (size) => renderToStaticMarkup(createElement(BrandLogo, { size, title: null }))

// favicon.svg : autonome, police intégrée.
const faviconSvg = logo(64)
  .replace(/>/, `><style>@font-face{font-family:'Bowlby One';src:url(data:font/woff2;base64,${fontB64}) format('woff2');}</style>`)
writeFileSync(join(pub, 'favicon.svg'), faviconSvg)

const browser = await playwright.chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
/** PNG carré : logo de diamètre `ratio`×taille, centré sur fond bleu nuit. */
async function png(file, size, ratio) {
  const d = Math.round(size * ratio)
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:'Bowlby One';src:url(data:font/woff2;base64,${fontB64}) format('woff2');}
    html,body{margin:0;width:${size}px;height:${size}px;background:${NAVY};display:flex;align-items:center;justify-content:center;overflow:hidden}
  </style></head><body>${logo(d)}</body></html>`)
  await page.evaluate(async () => {
    await document.fonts.load("44px 'Bowlby One'")
    await document.fonts.ready
  })
  await page.screenshot({ path: join(pub, file), omitBackground: false })
  console.log('écrit :', file)
}
await png('pwa-192x192.png', 192, 0.9)
await png('pwa-512x512.png', 512, 0.9)
await png('apple-touch-icon.png', 180, 0.84)
// Zone sûre des icônes « maskable » : cercle de 80 % au centre.
await png('maskable-icon-512x512.png', 512, 0.72)
await browser.close()
