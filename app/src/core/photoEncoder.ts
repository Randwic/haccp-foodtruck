// Compression des photos (lot 3) : redimensionnement (côté long ≤ 1600 px) puis encodage WebP
// visant ~200 Ko, jamais plus de PHOTO_MAX_BYTES (contrôlé aussi par le serveur : signature RIFF/WEBP).
//
// Safari iOS ne sait pas toujours encoder en WebP : `canvas.toBlob(cb, 'image/webp')` y renvoie
// silencieusement du PNG. On le détecte (type du blob + signature) et on bascule alors, une fois pour
// toutes, sur l'encodeur WebAssembly libre `@jsquash/webp` (Apache-2.0, libwebp), chargé à la demande
// (fichier .wasm précaché par le service worker : fonctionne hors-ligne).
import { PHOTO_MAX_BYTES } from '../../../shared/payloads.ts'

/** Côté long maximal après redimensionnement. */
export const PHOTO_MAX_DIMENSION = 1600
/** Taille visée (une étiquette reste lisible) ; on accepte jusqu'à 25 % de plus avant de baisser la qualité. */
export const PHOTO_TARGET_BYTES = 200_000
/** Qualités essayées dans l'ordre (0..1). */
export const PHOTO_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42] as const
/** Réduction appliquée si même la qualité la plus basse dépasse PHOTO_MAX_BYTES. */
const DOWNSCALE = 0.75
const MAX_DOWNSCALES = 4

export interface EncodedPhoto {
  bytes: Uint8Array
  width: number
  height: number
  /** native : canvas du navigateur ; wasm : encodeur WebAssembly de secours. */
  encoder: 'native' | 'wasm'
  quality: number
}

/** Transforme une image (fichier de l'appareil photo, JPEG/HEIC/PNG…) en WebP compressé. */
export type PhotoEncoder = (image: Blob) => Promise<EncodedPhoto>

/**
 * Signature WebP, comme le serveur (photo-upload) : `RIFF` <taille LE> `WEBP` puis un bloc
 * `VP8 `, `VP8L` ou `VP8X`, la taille RIFF correspondant à la longueur du fichier.
 */
export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 20) return false
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return false
  const riffSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (riffSize + 8 !== bytes.byteLength) return false
  const chunk = ascii(12, 16)
  return chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X'
}

/** Dimensions ramenées dans un carré de `max` px (proportions gardées, jamais agrandies). */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_DIMENSION): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  const k = max / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Image décodée, redessinable à une taille donnée. */
export interface DecodedImage {
  width: number
  height: number
  release(): void
}

/** Primitives dépendantes du navigateur (injectées dans les tests). */
export interface EncoderBackend<D extends DecodedImage = DecodedImage> {
  decode(image: Blob): Promise<D>
  /** Encodage par le navigateur ; peut renvoyer un autre format (Safari : PNG) ou null. */
  encodeNative(image: D, width: number, height: number, quality: number): Promise<Blob | null>
  /** Encodage WebAssembly (secours). */
  encodeWasm(image: D, width: number, height: number, quality: number): Promise<Uint8Array>
}

/**
 * Algorithme adaptatif, indépendant du navigateur : qualité décroissante jusqu'à ~200 Ko, puis
 * réduction des dimensions si nécessaire. Le premier refus de l'encodeur natif (pas du WebP)
 * bascule définitivement sur l'encodeur WebAssembly (`state.nativeWebp`).
 */
export function createAdaptiveEncoder<D extends DecodedImage>(
  backend: EncoderBackend<D>,
  state: { nativeWebp: boolean | null } = { nativeWebp: null },
): PhotoEncoder {
  return async (image) => {
    const decoded = await backend.decode(image)
    try {
      let { width, height } = fitWithin(decoded.width, decoded.height)
      for (let attempt = 0; attempt <= MAX_DOWNSCALES; attempt++) {
        let last: EncodedPhoto | null = null
        for (const quality of PHOTO_QUALITIES) {
          last = await encodeOnce(decoded, width, height, quality)
          if (last.bytes.byteLength <= PHOTO_TARGET_BYTES * 1.25) return last
        }
        if (last && last.bytes.byteLength <= PHOTO_MAX_BYTES) return last
        width = Math.max(1, Math.round(width * DOWNSCALE))
        height = Math.max(1, Math.round(height * DOWNSCALE))
      }
      throw new Error('Photo trop volumineuse, même très compressée')
    } finally {
      decoded.release()
    }
  }

  async function encodeOnce(decoded: D, width: number, height: number, quality: number): Promise<EncodedPhoto> {
    if (state.nativeWebp !== false) {
      const blob = await backend.encodeNative(decoded, width, height, quality).catch(() => null)
      if (blob && blob.type === 'image/webp') {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (isWebp(bytes)) {
          state.nativeWebp = true
          return { bytes, width, height, encoder: 'native', quality }
        }
      }
      state.nativeWebp = false // Safari : PNG renvoyé à la place du WebP → WebAssembly désormais
    }
    const bytes = await backend.encodeWasm(decoded, width, height, quality)
    if (!isWebp(bytes)) throw new Error('Encodage WebP impossible sur cet appareil')
    return { bytes, width, height, encoder: 'wasm', quality }
  }
}

// ---------- Implémentation navigateur ----------

interface BrowserImage extends DecodedImage {
  source: CanvasImageSource
}

async function decodeInBrowser(image: Blob): Promise<BrowserImage> {
  // createImageBitmap applique l'orientation EXIF (photo prise en portrait sur iPhone).
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(image, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch {
      /* format non pris en charge par createImageBitmap (HEIC sur certains navigateurs) : <img> */
    }
  }
  const url = URL.createObjectURL(image)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('Image illisible : reprenez la photo')
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
}

/** Encodeur des navigateurs (canvas, avec secours WebAssembly). Un seul canevas réutilisé par photo. */
export function createBrowserPhotoEncoder(): PhotoEncoder {
  let canvas: HTMLCanvasElement | null = null
  let drawn: { source: CanvasImageSource; width: number; height: number } | null = null

  const draw = (img: BrowserImage, width: number, height: number): CanvasRenderingContext2D => {
    canvas ??= document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas indisponible')
    if (!drawn || drawn.source !== img.source || drawn.width !== width || drawn.height !== height) {
      canvas.width = width
      canvas.height = height
      ctx.fillStyle = '#ffffff' // fond blanc : une image transparente ne devient pas noire
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img.source, 0, 0, width, height)
      drawn = { source: img.source, width, height }
    }
    return ctx
  }

  const backend: EncoderBackend<BrowserImage> = {
    decode: decodeInBrowser,
    async encodeNative(img, width, height, quality) {
      draw(img, width, height)
      const c = canvas!
      return new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/webp', quality))
    },
    async encodeWasm(img, width, height, quality) {
      const ctx = draw(img, width, height)
      const data = ctx.getImageData(0, 0, width, height)
      const { default: encode } = await import('@jsquash/webp/encode')
      return new Uint8Array(await encode(data, { quality: Math.round(quality * 100) }))
    },
  }
  const encode = createAdaptiveEncoder(backend)
  return async (image) => {
    try {
      return await encode(image)
    } finally {
      // Libère la mémoire du canevas (iOS limite fortement la mémoire des canevas).
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      drawn = null
    }
  }
}

/** Fichier WebP minimal et valide (signature + taille RIFF) de `size` octets : tests et démo. */
export function syntheticWebp(size = 2048, fill = 7): Uint8Array {
  const n = Math.max(20, size + (size % 2))
  const b = new Uint8Array(n).fill(fill)
  b.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  new DataView(b.buffer).setUint32(4, n - 8, true)
  b.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  b.set([0x56, 0x50, 0x38, 0x4c], 12) // VP8L
  new DataView(b.buffer).setUint32(16, n - 20, true)
  return b
}
