// push-subscribe : abonnement Web Push d'un appareil enrôlé (en-tête x-device-token).
//   POST   corps PushSubscribeRequest { endpoint, keys: { p256dh, auth } } (PushSubscription.toJSON() accepté)
//   DELETE corps { endpoint } ou ?endpoint=…  → désabonnement (abonnements de CET appareil seulement)
// push-config (GET, public) : clé publique VAPID à passer à pushManager.subscribe().
import type { PushSubscribeRequest } from '../../../shared/payloads.ts'
import { isPlainObject } from '../../../shared/validation.ts'
import { authenticateDevice } from './auth.ts'
import { base64Url, fromBase64Url } from './crypto.ts'
import { HttpError, jsonResponse, readBodyBytes, readJsonBody, withHttp, type HttpEnv } from './http.ts'
import type { PushSubscribeRepo } from './repo.ts'

export const PUSH_SUBSCRIBE_LIMITS = { maxBodyBytes: 8192, maxEndpointLength: 2048 } as const

/**
 * Services push des navigateurs (suffixes de nom d'hôte). Le serveur n'envoie qu'à ces hôtes
 * (pas de requête vers une URL arbitraire fournie par un appareil) : Apple (Safari / PWA iOS),
 * Google (Chrome, Android), Mozilla (Firefox), Microsoft (Edge).
 */
export const PUSH_SERVICE_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'] as const

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port !== '' && u.port !== '443')) return false
  const host = u.hostname.toLowerCase()
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

export interface ParsedSubscription {
  endpoint: string
  p256dh: string // base64url sans remplissage (87 caractères)
  auth: string // base64url sans remplissage (22 caractères)
}

function checkEndpoint(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > PUSH_SUBSCRIBE_LIMITS.maxEndpointLength || /\s/.test(v)) {
    throw new HttpError(400, 'invalid_request', 'endpoint : URL https attendue')
  }
  if (!isAllowedPushEndpoint(v)) throw new HttpError(400, 'invalid_request', 'endpoint : service push non reconnu (https, Apple / Google / Mozilla / Microsoft)')
  return v
}

/** Valide un PushSubscribeRequest ; normalise les clés en base64url sans remplissage. */
export function parseSubscribeBody(body: unknown): ParsedSubscription {
  if (!isPlainObject(body)) throw new HttpError(400, 'invalid_request', 'objet JSON attendu')
  for (const k of Object.keys(body)) {
    if (k !== 'endpoint' && k !== 'keys' && k !== 'expirationTime') throw new HttpError(400, 'invalid_request', `champ inconnu : ${k.slice(0, 40)}`)
  }
  const endpoint = checkEndpoint(body.endpoint)
  if (!isPlainObject(body.keys)) throw new HttpError(400, 'invalid_request', 'keys : objet { p256dh, auth } attendu')
  const p = fromBase64Url(typeof body.keys.p256dh === 'string' ? body.keys.p256dh : '')
  if (!p || p.byteLength !== 65 || p[0] !== 0x04) throw new HttpError(400, 'invalid_request', 'keys.p256dh : clé P-256 non compressée (65 octets) en base64url attendue')
  const a = fromBase64Url(typeof body.keys.auth === 'string' ? body.keys.auth : '')
  if (!a || a.byteLength !== 16) throw new HttpError(400, 'invalid_request', 'keys.auth : 16 octets en base64url attendus')
  return { endpoint, p256dh: base64Url(p), auth: base64Url(a) }
}

export interface PushSubscribeDeps extends HttpEnv {
  repo: PushSubscribeRepo
}

export function createPushSubscribeHandler(deps: PushSubscribeDeps): (req: Request) => Promise<Response> {
  return withHttp('push-subscribe', ['POST', 'DELETE'], deps, async (req, ctx) => {
    const device = await authenticateDevice(req, deps.repo, ctx.logger)
    if (req.method === 'DELETE') {
      let endpoint = new URL(req.url).searchParams.get('endpoint')
      if (endpoint === null) {
        const bytes = await readBodyBytes(req, PUSH_SUBSCRIBE_LIMITS.maxBodyBytes)
        let body: unknown = null
        try {
          body = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : null
        } catch {
          throw new HttpError(400, 'invalid_json', 'JSON invalide')
        }
        endpoint = isPlainObject(body) && typeof body.endpoint === 'string' ? body.endpoint : null
      }
      if (endpoint === null || endpoint.length === 0 || endpoint.length > PUSH_SUBSCRIBE_LIMITS.maxEndpointLength) {
        throw new HttpError(400, 'invalid_request', 'endpoint : obligatoire')
      }
      const deleted = await deps.repo.removePushSubscription(device.id, endpoint)
      ctx.logger.log('info', 'push_unsubscribed', { device_id: device.id, deleted })
      return jsonResponse(200, { ok: true, deleted })
    }
    const sub = parseSubscribeBody((await readJsonBody(req, PUSH_SUBSCRIBE_LIMITS.maxBodyBytes)) as PushSubscribeRequest)
    const status = await deps.repo.upsertPushSubscription({ device_id: device.id, ...sub })
    await deps.repo.touchDevice(device.id, ctx.now().toISOString())
    ctx.logger.log('info', 'push_subscribed', { device_id: device.id, status, host: new URL(sub.endpoint).hostname })
    return jsonResponse(status === 'created' ? 201 : 200, { ok: true, status })
  })
}

export interface PushConfigDeps extends HttpEnv {
  vapidPublicKey: string | undefined
}

/** GET public : `{ enabled, vapid_public_key }` (null si VAPID n'est pas configuré). */
export function createPushConfigHandler(deps: PushConfigDeps): (req: Request) => Promise<Response> {
  return withHttp('push-config', ['GET'], deps, async () => {
    const k = deps.vapidPublicKey?.trim() ?? ''
    const raw = fromBase64Url(k)
    const ok = raw !== null && raw.byteLength === 65 && raw[0] === 0x04
    return jsonResponse(200, { enabled: ok, vapid_public_key: ok ? k : null })
  })
}
