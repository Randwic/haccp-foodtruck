// Transport : seul point de contact entre le core et le serveur.
import { publicKeyHeaders } from './supabaseKey.ts'
import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from '../../../shared/types.ts'
import type { PushSubscribeRequest } from '../../../shared/payloads.ts'

export interface DeviceAuth {
  device_token: string
}

/**
 * Issue d'un envoi de photo (photo-upload) qui a reçu une réponse définitive du serveur.
 * Les erreurs passagères (réseau, délai, 5xx) et 401 sont levées en TransportError (réessai / arrêt).
 */
export type PhotoUploadOutcome =
  | { ok: true; status: 'created' | 'already_present' }
  | { ok: false; error: PhotoRefusal }
/** Refus définitifs : renvoyer le même fichier ne changerait rien. */
export type PhotoRefusal = 'photo_conflict' | 'invalid_photo' | 'invalid_path' | 'payload_too_large' | 'device_mismatch'
const PHOTO_REFUSALS: readonly PhotoRefusal[] = ['photo_conflict', 'invalid_photo', 'invalid_path', 'payload_too_large', 'device_mismatch']

export interface Transport {
  push(req: SyncPushRequest, auth: DeviceAuth): Promise<SyncPushResponse>
  pull(since: string | null, auth: DeviceAuth): Promise<SyncPullResponse>
  /**
   * PUT photo-upload (lot 3). Facultatif pour rester compatible avec d'anciens transports :
   * sans lui, les photos restent « en attente » sur l'appareil.
   */
  uploadPhoto?(path: string, bytes: Uint8Array, auth: DeviceAuth): Promise<PhotoUploadOutcome>
  /** Lot 6 (facultatif) : push-config, clé publique VAPID du serveur. */
  getPushConfig?(): Promise<{ enabled: boolean; vapid_public_key: string | null }>
  /** Lot 6 (facultatif) : push-subscribe, abonnement Web Push de l'appareil. */
  subscribePush?(subscription: PushSubscribeRequest, auth: DeviceAuth): Promise<void>
}

/**
 * - network : pas de réseau / connexion coupée (réessayer plus tard)
 * - timeout : pas de réponse dans le délai (réessayer plus tard)
 * - unauthorized : 401/403, jeton invalide ou appareil révoqué (arrêter la synchro)
 * - server : 5xx (réessayer plus tard)
 * - client : autre 4xx ou réponse illisible (réessayer plus tard, mais c'est un bug)
 */
export type TransportErrorKind = 'network' | 'timeout' | 'unauthorized' | 'server' | 'client'

export class TransportError extends Error {
  readonly kind: TransportErrorKind
  readonly status: number | null
  constructor(kind: TransportErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'TransportError'
    this.kind = kind
    this.status = status
  }
}

export function isTransportError(e: unknown): e is TransportError {
  return e instanceof TransportError
}

export interface HttpTransportOptions {
  /** URL du projet Supabase, ex. https://xxxx.supabase.co */
  baseUrl: string
  /** Clé publique « anon » (jamais la clé service_role). */
  anonKey: string
  /** Délai max d'une requête (défaut 20 s). */
  timeoutMs?: number
  /** Délai max d'un envoi de photo (défaut 60 s : réseau 4G faible). */
  photoTimeoutMs?: number
  /** Injection pour les tests. */
  fetchImpl?: typeof fetch
}

export function createHttpTransport(opts: HttpTransportOptions): Transport {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? 20_000
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))

  async function call<T>(path: string, init: RequestInit, auth: DeviceAuth): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}/functions/v1/${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...publicKeyHeaders(opts.anonKey),
          ...(auth.device_token ? { 'x-device-token': auth.device_token } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
    } catch (e) {
      clearTimeout(timer)
      if (controller.signal.aborted) throw new TransportError('timeout', `Délai dépassé (${timeoutMs} ms)`)
      throw new TransportError('network', `Réseau indisponible : ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      if (res.status === 401 || res.status === 403) {
        const detail = await res.text().catch(() => '')
        throw new TransportError('unauthorized', `Appareil non autorisé (${res.status}) ${detail}`.trim(), res.status)
      }
      if (res.status >= 500) throw new TransportError('server', `Erreur serveur (${res.status})`, res.status)
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new TransportError('client', `Requête refusée (${res.status}) ${detail}`.trim(), res.status)
      }
      try {
        return (await res.json()) as T
      } catch {
        if (controller.signal.aborted) throw new TransportError('timeout', `Délai dépassé (${timeoutMs} ms)`)
        throw new TransportError('client', 'Réponse illisible', res.status)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function uploadPhoto(path: string, bytes: Uint8Array, auth: DeviceAuth): Promise<PhotoUploadOutcome> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.photoTimeoutMs ?? 60_000)
    let res: Response
    try {
      res = await doFetch(`${base}/functions/v1/photo-upload?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        signal: controller.signal,
        headers: {
          ...publicKeyHeaders(opts.anonKey),
          'x-device-token': auth.device_token,
          'Content-Type': 'image/webp',
        },
        body: bytes as BodyInit,
      })
    } catch (e) {
      clearTimeout(timer)
      if (controller.signal.aborted) throw new TransportError('timeout', 'Envoi de photo : délai dépassé')
      throw new TransportError('network', `Réseau indisponible : ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      let body: { error?: string } | null = null
      try {
        body = (await res.json()) as { error?: string }
      } catch {
        body = null
      }
      if (res.status === 201 || res.status === 200) return { ok: true, status: res.status === 201 ? 'created' : 'already_present' }
      const code = typeof body?.error === 'string' ? body.error : ''
      // 403 device_mismatch : la photo appartient à un autre appareil (ré-enrôlement) — pas une révocation.
      if ((PHOTO_REFUSALS as readonly string[]).includes(code)) return { ok: false, error: code as PhotoRefusal }
      if (res.status === 401 || res.status === 403) throw new TransportError('unauthorized', `Appareil non autorisé (${res.status}) ${code}`.trim(), res.status)
      if (res.status === 409) return { ok: false, error: 'photo_conflict' }
      if (res.status === 413) return { ok: false, error: 'payload_too_large' }
      if (res.status === 415) return { ok: false, error: 'invalid_photo' }
      if (res.status >= 500) throw new TransportError('server', `Erreur serveur (${res.status})`, res.status)
      throw new TransportError('client', `Envoi de photo refusé (${res.status}) ${code}`.trim(), res.status)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    uploadPhoto,
    getPushConfig: () => call<{ enabled: boolean; vapid_public_key: string | null }>('push-config', { method: 'GET' }, { device_token: '' }),
    subscribePush: async (subscription, auth) => {
      await call<unknown>('push-subscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }) }, auth)
    },
    push: (req, auth) => call<SyncPushResponse>('sync-push', { method: 'POST', body: JSON.stringify(req) }, auth),
    pull: (since, auth) =>
      call<SyncPullResponse>(`sync-pull?since=${encodeURIComponent(since ?? '')}`, { method: 'GET' }, auth),
  }
}
