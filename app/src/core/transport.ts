// Transport : seul point de contact entre le core et le serveur.
import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from '../../../shared/types.ts'

export interface DeviceAuth {
  device_token: string
}

export interface Transport {
  push(req: SyncPushRequest, auth: DeviceAuth): Promise<SyncPushResponse>
  pull(since: string | null, auth: DeviceAuth): Promise<SyncPullResponse>
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
          apikey: opts.anonKey,
          Authorization: `Bearer ${opts.anonKey}`,
          'x-device-token': auth.device_token,
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

  return {
    push: (req, auth) => call<SyncPushResponse>('sync-push', { method: 'POST', body: JSON.stringify(req) }, auth),
    pull: (since, auth) =>
      call<SyncPullResponse>(`sync-pull?since=${encodeURIComponent(since ?? '')}`, { method: 'GET' }, auth),
  }
}
