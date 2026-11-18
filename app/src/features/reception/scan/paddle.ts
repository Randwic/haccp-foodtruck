// Lecture du texte d'une photo par réseau de neurones (modèles PaddleOCR PP-OCRv4, exécutés dans le
// navigateur par ONNX Runtime). Entièrement sur l'appareil : rien n'est envoyé, aucun abonnement.
// Deux étapes :
//  1. détection : le modèle repère les zones de texte (même imprimées en points, en relief, de travers) ;
//  2. lecture : chaque zone est redressée puis lue caractère par caractère.
// Fichiers (≈ 30 Mo, servis par l'app sous /ocr/, mis en cache à la première utilisation) : voir vite.config.ts.
import type { InferenceSession, Tensor } from 'onnxruntime-web'

/** Côté le plus long donné à la détection (multiple de 32). Plus grand = petits textes mieux vus, plus lent. */
const DET_MAX_SIDE = 1280
/** Probabilité au-delà de laquelle un pixel est du texte, et score moyen minimal d'une zone. */
const DET_THRESH = 0.3
const BOX_THRESH = 0.5
/** Agrandissement des zones détectées (le modèle les voit un peu plus petites que le texte). */
const UNCLIP_RATIO = 1.6
/** Hauteur des lignes données à la lecture. */
const REC_HEIGHT = 48
const REC_MAX_WIDTH = 1600
/** Confiance moyenne minimale d'une ligne lue. */
const MIN_CONFIDENCE = 0.5

interface Engine {
  ort: typeof import('onnxruntime-web')
  det: InferenceSession
  rec: InferenceSession
  /** Caractères du modèle de lecture : 0 = « vide », puis le dictionnaire, puis l'espace. */
  chars: string[]
}

let enginePromise: Promise<Engine> | null = null

function base(): string {
  return new URL('/ocr/', location.origin).href
}

/** Charge (une seule fois) le moteur et les modèles. */
export function paddleEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.wasmPaths = base() + 'ort/'
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
      const opts: InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
      const [det, rec, keys] = await Promise.all([
        ort.InferenceSession.create(base() + 'paddle/det.onnx', opts),
        ort.InferenceSession.create(base() + 'paddle/rec.onnx', opts),
        fetch(base() + 'paddle/keys.txt').then((r) => {
          if (!r.ok) throw new Error(`keys.txt : ${r.status}`)
          return r.text()
        }),
      ])
      const dict = keys.replace(/\r/g, '').replace(/\n$/, '').split('\n')
      return { ort: ort as unknown as typeof import('onnxruntime-web'), det, rec, chars: ['', ...dict, ' '] }
    })().catch((e) => {
      enginePromise = null // nouvel essai à la prochaine photo (ex. connexion revenue)
      throw e
    })
  }
  return enginePromise
}

/** Zone de texte : rectangle tourné (centre, axe de la ligne, longueur, épaisseur), en pixels de la photo. */
export interface TextBox {
  cx: number
  cy: number
  /** Angle de la ligne de texte (radians). */
  angle: number
  length: number
  thickness: number
  score: number
}

/**
 * Zones de texte d'une carte de probabilités (sortie du modèle de détection) : composantes connexes,
 * puis pour chacune un rectangle orienté (axes principaux), agrandi. Fonction pure (testée).
 */
export function boxesFromProbMap(prob: Float32Array, w: number, h: number, scale = 1): TextBox[] {
  // Carte binaire légèrement épaissie : les morceaux d'une même ligne (points d'encre) se rejoignent.
  const on = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (prob[y * w + x] > DET_THRESH)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy >= 0 && yy < h && xx >= 0 && xx < w) on[yy * w + xx] = 1
          }
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const out: TextBox[] = []
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue
    // Parcours de la composante : moments pour l'orientation, score moyen.
    let n = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0
    let sp = 0
    const pts: number[] = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      const y = (i - x) / w
      n++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sxy += x * y
      sp += prob[i]
      pts.push(i)
      const visit = (j: number) => {
        if (on[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
      if (x > 0) visit(i - 1)
      if (x < w - 1) visit(i + 1)
      if (y > 0) visit(i - w)
      if (y < h - 1) visit(i + w)
    }
    if (n < 12 || sp / n < BOX_THRESH) continue
    const mx = sx / n
    const my = sy / n
    const cxx = sxx / n - mx * mx
    const cyy = syy / n - my * my
    const cxy = sxy / n - mx * my
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    let umin = Infinity
    let umax = -Infinity
    let vmin = Infinity
    let vmax = -Infinity
    for (const i of pts) {
      const x = (i % w) - mx
      const y = Math.floor(i / w) - my
      const u = x * ux + y * uy
      const v = -x * uy + y * ux
      if (u < umin) umin = u
      if (u > umax) umax = u
      if (v < vmin) vmin = v
      if (v > vmax) vmax = v
    }
    let length = umax - umin + 1
    let thickness = vmax - vmin + 1
    if (thickness < 3 || length < 3) continue
    const d = (length * thickness * UNCLIP_RATIO) / (2 * (length + thickness))
    length += 2 * d
    thickness += 2 * d
    // Centre du rectangle (pas le barycentre) dans le repère de la photo.
    const cu = (umin + umax) / 2
    const cv = (vmin + vmax) / 2
    out.push({
      cx: (mx + cu * ux - cv * uy) * scale,
      cy: (my + cu * uy + cv * ux) * scale,
      angle,
      length: length * scale,
      thickness: thickness * scale,
      score: sp / n,
    })
  }
  return out
}

/** Décodage CTC : caractère le plus probable à chaque pas, sans répétitions ni « vides ». */
export function ctcDecode(data: Float32Array, steps: number, classes: number, chars: string[]): { text: string; confidence: number } {
  let text = ''
  let sum = 0
  let count = 0
  let prev = -1
  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestP = -Infinity
    const off = t * classes
    for (let c = 0; c < classes; c++) {
      const p = data[off + c]
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      text += chars[best] ?? ''
      sum += bestP
      count++
    }
    prev = best
  }
  return { text, confidence: count ? sum / count : 0 }
}

/** Pixels d'un canvas en tenseur [1, 3, h, w] (ordre BGR comme à l'entraînement), normalisés. */
function toTensor(ort: Engine['ort'], ctx: CanvasRenderingContext2D, w: number, h: number, mean: number[], std: number[]): Tensor {
  const px = ctx.getImageData(0, 0, w, h).data
  const plane = w * h
  const out = new Float32Array(3 * plane)
  for (let i = 0, j = 0; i < plane; i++, j += 4) {
    out[i] = (px[j + 2] / 255 - mean[0]) / std[0]
    out[plane + i] = (px[j + 1] / 255 - mean[1]) / std[1]
    out[2 * plane + i] = (px[j] / 255 - mean[2]) / std[2]
  }
  return new ort.Tensor('float32', out, [1, 3, h, w])
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })!]
}

async function detect(e: Engine, src: HTMLCanvasElement): Promise<TextBox[]> {
  const k = Math.min(1, DET_MAX_SIDE / Math.max(src.width, src.height))
  const w = Math.max(32, Math.round((src.width * k) / 32) * 32)
  const h = Math.max(32, Math.round((src.height * k) / 32) * 32)
  const [, ctx] = canvas2d(w, h)
  ctx.drawImage(src, 0, 0, w, h)
  const input = toTensor(e.ort, ctx, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
  const res = await e.det.run({ [e.det.inputNames[0]]: input })
  const out = res[e.det.outputNames[0]]
  const [oh, ow] = [out.dims[2], out.dims[3]]
  // Les zones sont exprimées dans les pixels de la photo d'origine (lecture à pleine résolution).
  const boxes = boxesFromProbMap(out.data as Float32Array, ow, oh, 1)
  const fx = src.width / ow
  const fy = src.height / oh
  return boxes.map((b) => {
    // Échelle non uniforme possible (arrondi à 32) : on corrige centre et dimensions.
    const ux = Math.cos(b.angle)
    const uy = Math.sin(b.angle)
    return {
      ...b,
      cx: b.cx * fx,
      cy: b.cy * fy,
      angle: Math.atan2(uy * fy, ux * fx),
      length: b.length * Math.hypot(ux * fx, uy * fy),
      thickness: b.thickness * Math.hypot(uy * fx, ux * fy),
    }
  })
}

async function recognize(e: Engine, src: HTMLCanvasElement, b: TextBox, flip: boolean): Promise<{ text: string; confidence: number }> {
  const k = REC_HEIGHT / b.thickness
  const w = Math.min(REC_MAX_WIDTH, Math.max(16, Math.round(b.length * k)))
  const [, ctx] = canvas2d(w, REC_HEIGHT)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, REC_HEIGHT)
  ctx.translate(w / 2, REC_HEIGHT / 2)
  ctx.scale(Math.min(k, w / b.length), k)
  ctx.rotate(-b.angle + (flip ? Math.PI : 0))
  ctx.translate(-b.cx, -b.cy)
  ctx.drawImage(src, 0, 0)
  const input = toTensor(e.ort, ctx, w, REC_HEIGHT, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
  const res = await e.rec.run({ [e.rec.inputNames[0]]: input })
  const out = res[e.rec.outputNames[0]]
  return ctcDecode(out.data as Float32Array, out.dims[1], out.dims[2], e.chars)
}

/** Une ligne lue, avec sa position (pour remettre les lignes dans l'ordre de lecture). */
interface Line {
  text: string
  confidence: number
  box: TextBox
  flipped: boolean
}

async function readLines(e: Engine, src: HTMLCanvasElement): Promise<Line[]> {
  const boxes = (await detect(e, src)).filter((b) => b.length >= 8 && b.thickness >= 6)
  // Les plus grandes zones d'abord (les plus utiles), au plus 60.
  boxes.sort((a, b) => b.length * b.thickness - a.length * a.thickness)
  const lines: Line[] = []
  for (const box of boxes.slice(0, 60)) {
    let best = await recognize(e, src, box, false)
    let flipped = false
    if (best.confidence < 0.85) {
      const other = await recognize(e, src, box, true)
      if (other.confidence > best.confidence) {
        best = other
        flipped = true
      }
    }
    if (best.text.trim() && best.confidence >= MIN_CONFIDENCE) lines.push({ ...best, box, flipped })
  }
  return lines
}

function turned(src: HTMLCanvasElement, quarter: 1 | 3): HTMLCanvasElement {
  const [c, ctx] = canvas2d(src.height, src.width)
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((quarter * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

/**
 * Texte d'une photo, ligne par ligne dans l'ordre de lecture. `quarter` : photo tournée d'un quart
 * de tour (1) ou de trois (3) avant lecture, pour une étiquette photographiée de côté.
 */
export async function paddleReadText(src: HTMLCanvasElement, quarter: 0 | 1 | 3 = 0): Promise<string> {
  const e = await paddleEngine()
  return orderLines(await readLines(e, quarter ? turned(src, quarter) : src))
}

/** Ordre de lecture : de haut en bas dans le sens du texte majoritaire (photo éventuellement tournée). */
function orderLines(lines: Line[]): string {
  if (!lines.length) return ''
  // Direction de lecture dominante (pondérée par la longueur des lignes).
  let dx = 0
  let dy = 0
  for (const l of lines) {
    const a = l.box.angle + (l.flipped ? Math.PI : 0)
    dx += Math.cos(a) * l.box.length
    dy += Math.sin(a) * l.box.length
  }
  const n = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / n, dy / n]
  // « Vers le bas » du texte = direction de lecture tournée de +90°.
  const down = (l: Line) => -l.box.cx * uy + l.box.cy * ux
  const along = (l: Line) => l.box.cx * ux + l.box.cy * uy
  const sorted = [...lines].sort((a, b) => down(a) - down(b))
  // Regroupe les morceaux d'une même ligne (à moins d'une demi-hauteur), de gauche à droite.
  const rows: Line[][] = []
  for (const l of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(down(l) - down(row[0])) < Math.min(l.box.thickness, row[0].box.thickness) / 2) row.push(l)
    else rows.push([l])
  }
  return rows.map((r) => r.sort((a, b) => along(a) - along(b)).map((l) => l.text).join(' ')).join('\n')
}
