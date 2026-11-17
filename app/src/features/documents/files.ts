// Fichiers des documents : réduction des photos avant dépôt, partage / ouverture d'un fichier.

/** Côté long maximal d'une photo de document (lisible à l'écran et à l'impression). */
export const DOCUMENT_IMAGE_MAX_SIDE = 2400

/**
 * Photo d'un document (attestation, contrat…) : réduite à 2400 px et réencodée en JPEG (qualité 0,85) si cela
 * la rend plus légère. PDF, petites images et navigateurs sans canvas : fichier d'origine.
 */
export async function prepareDocumentFile(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 600_000) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, DOCUMENT_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob && blob.type === 'image/jpeg' && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/**
 * Image (JPEG / PNG / WebP) → JPEG pour l'intégrer à un PDF (pdf-lib ne lit pas le WebP), réduite à `maxSide`.
 * null si le navigateur ne sait pas la décoder.
 */
export async function toJpegBytes(blob: Blob, maxSide = 1000): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return out ? new Uint8Array(await out.arrayBuffer()) : null
  } catch {
    return null
  }
}

export type FileOutcome = 'shared' | 'cancelled' | 'opened' | 'downloaded'

function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true
  } catch {
    return false
  }
}

/**
 * Feuille de partage (iPad : Imprimer, Enregistrer dans Fichiers, Mail…) sinon ouverture dans un onglet, sinon
 * téléchargement. À appeler directement dans le gestionnaire du toucher (le fichier doit être déjà prêt).
 */
export async function shareFile(data: Blob | Uint8Array, filename: string, type: string, title: string): Promise<FileOutcome> {
  const file = new File([data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data], filename, { type })
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(file)
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
  const w = window.open(url, '_blank')
  if (w) return 'opened'
  return downloadFile(file, filename)
}

/** Téléchargement direct (ordinateur ; sur iPad : « Télécharger » puis Fichiers). */
export function downloadFile(data: Blob, filename: string): FileOutcome {
  const url = URL.createObjectURL(data)
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  return 'downloaded'
}
