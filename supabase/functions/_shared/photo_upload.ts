// photo-upload : envoi d'une photo (WebP) par un appareil, dans le bucket privé `photos`.
// PUT /functions/v1/photo-upload?path=<device_id>/<uuid>.webp   corps = octets WebP
// Idempotent : un renvoi du même fichier répond 200 sans réécrire ; jamais d'écrasement.
import { PHOTO_MAX_BYTES, PHOTO_PATH_RE } from '../../../shared/payloads.ts'
import { isUuid } from '../../../shared/validation.ts'
import { authenticateDevice } from './auth.ts'
import { HttpError, jsonResponse, readBodyBytes, withHttp, type HttpEnv } from './http.ts'
import type { DeviceAuthRepo } from './repo.ts'

/** Accès au bucket `photos` (clé service_role côté adaptateur). */
export interface PhotoStore {
  /** Taille de l'objet en octets, ou null s'il n'existe pas. */
  stat(path: string): Promise<{ size: number } | null>
  /**
   * Crée l'objet SANS jamais écraser. 'exists' si un objet occupe déjà ce chemin
   * (typiquement un envoi concurrent) ; toute autre erreur est levée.
   */
  create(path: string, bytes: Uint8Array, contentType: string): Promise<'created' | 'exists'>
}

/** Réponse 200/201 de photo-upload. */
export interface PhotoUploadResponse {
  ok: true
  path: string
  /** created : objet écrit (201) ; already_present : même objet déjà reçu (200, rien réécrit). */
  status: 'created' | 'already_present'
  size: number
}

/** Plus petit WebP possible : en-tête RIFF (12 octets) + en-tête du premier bloc (8 octets). */
const WEBP_MIN_BYTES = 20

/**
 * Chemin `<device_id>/<uuid>.webp` : format PHOTO_PATH_RE, deux uuid en minuscules, et le dossier
 * doit être celui de l'appareil authentifié (un appareil n'écrit que dans son propre dossier).
 */
export function parsePhotoPath(raw: string | null, deviceId: string): string {
  const path = raw ?? ''
  if (!PHOTO_PATH_RE.test(path)) throw new HttpError(400, 'invalid_path', 'path : <device_id>/<uuid>.webp attendu')
  const [dir, file] = path.split('/')
  if (!isUuid(dir) || !isUuid(file.slice(0, -'.webp'.length))) {
    throw new HttpError(400, 'invalid_path', 'path : uuid en minuscules attendus')
  }
  if (dir !== deviceId) throw new HttpError(403, 'device_mismatch', 'path : dossier d’un autre appareil')
  return path
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/**
 * Signature WebP : `RIFF` <taille LE> `WEBP` puis un bloc `VP8 `, `VP8L` ou `VP8X`. La taille RIFF
 * doit correspondre à la longueur reçue (fichier tronqué refusé). Ne décode pas l'image.
 */
export function checkWebp(bytes: Uint8Array): string | null {
  if (bytes.byteLength < WEBP_MIN_BYTES) return 'fichier trop court pour une image WebP'
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return 'signature RIFF/WEBP absente'
  const riffSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (riffSize + 8 !== bytes.byteLength) return 'taille RIFF incohérente (fichier tronqué ?)'
  const chunk = ascii(bytes, 12, 16)
  if (chunk !== 'VP8 ' && chunk !== 'VP8L' && chunk !== 'VP8X') return 'bloc WebP inconnu'
  return null
}

export interface PhotoUploadDeps extends HttpEnv {
  repo: DeviceAuthRepo
  store: PhotoStore
}

export function createPhotoUploadHandler(deps: PhotoUploadDeps): (req: Request) => Promise<Response> {
  return withHttp('photo-upload', ['PUT'], deps, async (req, ctx) => {
    const device = await authenticateDevice(req, deps.repo, ctx.logger)
    const path = parsePhotoPath(new URL(req.url).searchParams.get('path'), device.id)
    const bytes = await readBodyBytes(req, PHOTO_MAX_BYTES)
    if (bytes.byteLength === 0) throw new HttpError(400, 'invalid_photo', 'corps vide')
    const bad = checkWebp(bytes)
    if (bad) throw new HttpError(415, 'invalid_photo', `image WebP attendue : ${bad}`)

    const respond = (status: PhotoUploadResponse['status']) => {
      ctx.logger.log('info', 'photo_upload', { device_id: device.id, path, size: bytes.byteLength, status })
      const body: PhotoUploadResponse = { ok: true, path, status, size: bytes.byteLength }
      return jsonResponse(status === 'created' ? 201 : 200, body)
    }
    /** Objet déjà présent : même taille = même envoi (rejeu) ; sinon conflit, jamais d'écrasement. */
    const existing = async (size: number) => {
      if (size === bytes.byteLength) return respond('already_present')
      ctx.logger.log('warn', 'photo_conflict', { device_id: device.id, path, stored_size: size < 0 ? null : size, received: bytes.byteLength })
      throw new HttpError(409, 'photo_conflict', 'un autre contenu existe déjà à ce chemin')
    }

    const before = await deps.store.stat(path)
    let res: Response
    if (before) {
      res = await existing(before.size)
    } else if ((await deps.store.create(path, bytes, 'image/webp')) === 'created') {
      res = respond('created')
    } else {
      // Envoi concurrent passé entre stat et create : on juge sur l'objet effectivement stocké.
      const after = await deps.store.stat(path)
      res = await existing(after ? after.size : -1)
    }
    await deps.repo.touchDevice(device.id, ctx.now().toISOString())
    return res
  })
}
