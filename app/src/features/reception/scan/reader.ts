// Lecture automatique d'une photo d'étiquette, dans le navigateur, sans envoyer l'image nulle part :
//  - code-barres (EAN, GS1-128, DataMatrix, QR) avec ZXing ;
//  - texte (lot, DLC / DDM) avec Tesseract (reconnaissance de caractères, français).
// Les fichiers de Tesseract (≈ 5 Mo) sont servis par l'app sous /ocr/ (copiés au build, voir
// vite.config.ts) et gardés en cache après la première lecture : la lecture marche ensuite hors-ligne.
// Modules chargés à la demande (import dynamique) : rien n'alourdit le démarrage de l'app.
import type { LabelReading } from '../extensions.ts'
import { readingFromBarcode } from './gtin.ts'
import { parseLabelText } from './parseLabel.ts'
import { binarize, darken, flatten, shrink, toGray, toRgba, type Gray } from './prepare.ts'
import { ReadingVote } from './vote.ts'

/** Côté le plus long de l'image analysée (au-delà, l'OCR est lent sans gain réel). */
const MAX_SIDE = 2000
/** Délai maximal d'une lecture : au-delà on abandonne (la saisie reste manuelle). */
const READ_TIMEOUT_MS = 45_000

type TesseractWorker = import('tesseract.js').Worker
let workerPromise: Promise<TesseractWorker> | null = null

function ocrBase(): string {
  return new URL('/ocr/', location.origin).href
}

/** Crée (une seule fois) le moteur OCR. Appelé aussi en avance pour préparer le cache hors-ligne. */
export function ocrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker, OEM }) =>
        createWorker('fra', OEM.LSTM_ONLY, {
          workerPath: ocrBase() + 'worker.min.js',
          corePath: ocrBase(),
          langPath: ocrBase() + 'lang',
          workerBlobURL: false,
        }),
      )
      .catch((e) => {
        workerPromise = null // nouvel essai à la prochaine photo (ex. connexion revenue)
        throw e
      })
  }
  return workerPromise
}

/**
 * Prépare la lecture d'étiquette en arrière-plan (téléchargement et mise en cache des fichiers OCR),
 * seulement en ligne et quand le navigateur est inactif. Sans effet si c'est déjà fait.
 */
export function warmUpLabelReader(): void {
  if (workerPromise || typeof navigator === 'undefined' || !navigator.onLine) return
  const go = () => {
    void import('./paddle.ts').then((m) => m.paddleEngine()).catch(() => {})
    void ocrWorker().catch(() => {})
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 5000 })
  else setTimeout(go, 2000)
}

/** Image redimensionnée sur un canvas (orientation de l'appareil photo respectée). */
async function toCanvas(photo: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(photo, { imageOrientation: 'from-image' })
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas
}

/** Formats lus : produits de détail, étiquettes logistiques GS1 (lot + date), QR. */
export async function barcodeHints() {
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
  const hints = new Map<import('@zxing/library').DecodeHintType, unknown>()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.ITF,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.QR_CODE,
  ])
  hints.set(DecodeHintType.TRY_HARDER, true)
  return hints
}

/** Texte brut du code-barres d'une image, ou null. */
export async function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  try {
    return new BrowserMultiFormatReader(await barcodeHints()).decodeFromCanvas(canvas).getText()
  } catch {
    return null // aucun code-barres trouvé
  }
}

export async function decodeBarcodeFromImage(photo: Blob): Promise<LabelReading | null> {
  const text = await decodeBarcodeFromCanvas(await toCanvas(photo))
  return text ? readingFromBarcode(text) : null
}

function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

/** Une version de la photo à lire, avec le mode de découpage du texte de Tesseract. */
interface Pass {
  name: string
  /** 3 = page structurée (étiquette imprimée), 11 = texte épars (tampons, mots isolés). */
  psm: '3' | '11'
  make: () => HTMLCanvasElement
}

function grayCanvas(g: Gray): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = g.w
  c.height = g.h
  c.getContext('2d')!.putImageData(new ImageData(toRgba(g), g.w, g.h), 0, 0)
  return c
}

function rotated(src: HTMLCanvasElement, quarterTurns: 1 | 3): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.height
  c.height = src.width
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((quarterTurns * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

/**
 * Les versions de la photo, de la plus utile à la moins utile. Une vraie photo n'est pas un scan :
 * éclairage inégal, reflets, fond coloré, lot et DLC souvent imprimés en points (jet d'encre).
 */
function passesFor(canvas: HTMLCanvasElement): { main: Pass[]; turned: Pass[] } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  let flat: Gray | null = null
  const flatOnce = () => {
    if (!flat) {
      const g = toGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
      flat = flatten(g, Math.round(Math.max(g.w, g.h) / 50)) // éclairage remis à plat
    }
    return flat
  }
  const bin = () => grayCanvas(binarize(flatOnce(), 20))
  let binCache: HTMLCanvasElement | null = null
  const binOnce = () => (binCache ??= bin())
  const main: Pass[] = [
    { name: 'noir et blanc', psm: '3', make: binOnce },
    { name: 'photo', psm: '3', make: () => canvas },
    { name: 'noir et blanc, texte épars', psm: '11', make: binOnce },
    // Impression en points : on épaissit l'encre pour que les points se touchent.
    { name: 'points épaissis', psm: '11', make: () => grayCanvas(binarize(darken(flatOnce(), 2), 20)) },
    { name: 'points réduits', psm: '11', make: () => grayCanvas(binarize(shrink(flatOnce(), 2), 12)) },
    { name: 'points légers', psm: '11', make: () => grayCanvas(binarize(darken(flatOnce(), 1), 20)) },
  ]
  // Étiquette photographiée de côté (ou produit tenu couché).
  const turned: Pass[] = ([1, 3] as const).flatMap((q) => [
    { name: `tournée ${q * 90}°`, psm: '3' as const, make: () => rotated(binOnce(), q) },
    { name: `tournée ${q * 90}°, points`, psm: '11' as const, make: () => rotated(grayCanvas(binarize(darken(flatOnce(), 2), 20)), q) },
  ])
  return { main, turned }
}

/** Lecture impossible (moteur de lecture non chargé : première utilisation hors connexion, par ex.). */
export class LabelReaderUnavailable extends Error {}

/**
 * Lit une photo d'étiquette. Le code-barres (s'il est lisible) donne le GTIN, et pour un code GS1
 * le lot et la date, plus fiables que le texte. Le texte complète ce qui manque : il est lu sur
 * plusieurs versions de la photo et la valeur lue le plus souvent l'emporte (voir vote.ts).
 */
export async function readLabelPhoto(photo: Blob, onPass?: (name: string, text: string) => void): Promise<LabelReading | null> {
  const deadline = Date.now() + READ_TIMEOUT_MS
  const canvas = await toCanvas(photo)
  const barcode = decodeBarcodeFromCanvas(canvas).then((t) => (t ? readingFromBarcode(t) : null))
  const text = (async () => {
    const vote = new ReadingVote()
    const today = localToday()
    // 1. Moteur moderne (réseau de neurones) : lit les impressions en points, en relief, de travers.
    let modern = false
    try {
      const { paddleReadText } = await import('./paddle.ts')
      // Photo droite d'abord ; sans date trouvée, photo tournée (étiquette prise de côté, texte vertical).
      let found: LabelReading | null = null
      for (const q of [0, 1, 3] as const) {
        const t = await paddleReadText(canvas, q)
        onPass?.(`moteur moderne ${q * 90}°`, t)
        const r = parseLabelText(t, { today })
        if (r?.dlc || r?.ddm) return found?.lot && !r.lot ? { ...r, lot: found.lot } : r
        found ??= r
      }
      modern = true
      // Bien plus fiable que le secours : s'il a trouvé quelque chose, on s'arrête là.
      if (found) return found
    } catch {
      // moteur non chargé (première utilisation hors connexion…) : on passe au moteur de secours
    }
    // 2. Secours (Tesseract) : complète ce qui manque, ou lit seul si le moteur moderne est indisponible.
    let worker: TesseractWorker
    try {
      worker = await ocrWorker()
    } catch {
      if (modern) return null
      throw new LabelReaderUnavailable()
    }
    const { main, turned } = passesFor(canvas)
    const run = async (passes: Pass[]) => {
      for (const p of passes) {
        if (Date.now() > deadline || vote.confirmed()) return
        await worker.setParameters({ tessedit_pageseg_mode: p.psm as never })
        const res = await worker.recognize(p.make())
        onPass?.(p.name, res.data.text)
        vote.add(parseLabelText(res.data.text, { today }))
      }
    }
    await run(main)
    if (!vote.hasDate()) await run(turned)
    return vote.result()
  })()
  const b = await barcode
  let t: LabelReading | null
  try {
    t = await withTimeout(text, READ_TIMEOUT_MS + 5000)
  } catch (e) {
    if (e instanceof LabelReaderUnavailable && !b) throw e
    t = null
  }
  const r: LabelReading = { ...(t ?? {}), ...(b ?? {}) }
  if (b?.dlc || b?.ddm) {
    // La date du code GS1 remplace celle du texte (pas de DLC et DDM à la fois).
    if (b.dlc) delete r.ddm
    else delete r.dlc
  }
  return Object.keys(r).length ? r : null
}
