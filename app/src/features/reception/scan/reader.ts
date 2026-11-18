// Lecture automatique d'une photo d'étiquette, dans le navigateur, sans envoyer l'image nulle part :
//  - code-barres (EAN, GS1-128, DataMatrix, QR) avec ZXing ;
//  - texte (lot, DLC / DDM) avec Tesseract (reconnaissance de caractères, français).
// Les fichiers de Tesseract (≈ 5 Mo) sont servis par l'app sous /ocr/ (copiés au build, voir
// vite.config.ts) et gardés en cache après la première lecture : la lecture marche ensuite hors-ligne.
// Modules chargés à la demande (import dynamique) : rien n'alourdit le démarrage de l'app.
import type { LabelReading } from '../extensions.ts'
import { readingFromBarcode } from './gtin.ts'
import { parseLabelText } from './parseLabel.ts'

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
  const go = () => void ocrWorker().catch(() => {})
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

/**
 * Lit une photo d'étiquette. Le code-barres (s'il est lisible) donne le GTIN, et pour un code GS1
 * le lot et la date, plus fiables que le texte. Le texte complète ce qui manque.
 */
export async function readLabelPhoto(photo: Blob): Promise<LabelReading | null> {
  const canvas = await toCanvas(photo)
  const barcode = decodeBarcodeFromCanvas(canvas).then((t) => (t ? readingFromBarcode(t) : null))
  const text = ocrWorker()
    .then((w) => w.recognize(canvas))
    .then((res) => parseLabelText(res.data.text, { today: localToday() }))
    .catch(() => null)
  const [b, t] = await Promise.all([barcode, withTimeout(text, READ_TIMEOUT_MS)])
  const r: LabelReading = { ...(t ?? {}), ...(b ?? {}) }
  if (b?.dlc || b?.ddm) {
    // La date du code GS1 remplace celle du texte (pas de DLC et DDM à la fois).
    if (b.dlc) delete r.ddm
    else delete r.dlc
  }
  return Object.keys(r).length ? r : null
}
