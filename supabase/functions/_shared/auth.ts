import { sha256Hex } from './crypto.ts'
import { HttpError, type Logger } from './http.ts'
import type { DeviceAuthRepo, DeviceRow } from './repo.ts'

export const DEVICE_TOKEN_HEADER = 'x-device-token'

/**
 * Authentifie un appareil par son jeton : seul le SHA-256 du jeton est stocké (`devices.token_hash`).
 * Réponses : 401 `unauthorized` (absent/inconnu, sans distinguer) ou 401 `device_revoked`.
 */
export async function authenticateDevice(req: Request, repo: DeviceAuthRepo, logger: Logger): Promise<DeviceRow> {
  const token = req.headers.get(DEVICE_TOKEN_HEADER)?.trim() ?? ''
  // Garde-fou de format avant tout accès base (jeton émis : 43 caractères base64url).
  if (token.length < 16 || token.length > 256 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new HttpError(401, 'unauthorized')
  }
  const device = await repo.findDeviceByTokenHash(await sha256Hex(token))
  if (!device) {
    logger.log('warn', 'device_auth_failed', { cause: 'unknown_token' })
    throw new HttpError(401, 'unauthorized')
  }
  if (device.revoked_at) {
    logger.log('warn', 'device_auth_failed', { cause: 'revoked', device_id: device.id })
    throw new HttpError(401, 'device_revoked')
  }
  return device
}

/** Extrait le JWT de `Authorization: Bearer <jwt>`. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim())
  return m ? m[1] : null
}
