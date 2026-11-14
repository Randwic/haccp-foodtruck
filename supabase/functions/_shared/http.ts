// Couche HTTP commune (pure : uniquement les API web standard Request/Response, disponibles
// dans Deno et Node 20+). CORS, réponses JSON, erreurs sans fuite d'information, journalisation.

export type LogLevel = 'info' | 'warn' | 'error'
export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void
}

/** Journal JSON sur une ligne (lisible dans les logs Supabase et filtrable). */
export function jsonLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = console.log): Logger {
  return {
    log(level, event, fields = {}) {
      sink(JSON.stringify({ level, event, time: new Date().toISOString(), ...base, ...fields }))
    },
  }
}

export const silentLogger: Logger = { log() {} }

/** Erreur « attendue » : son code et son détail sont renvoyés tels quels au client. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly detail?: string
  constructor(status: number, code: string, detail?: string) {
    super(code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** `ALLOWED_ORIGIN` : une origine, une liste séparée par des virgules, ou `*` (déconseillé en production). */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0)
}

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-device-token'

export function corsHeaders(req: Request, allowedOrigins: string[], methods: string[]): Record<string, string> {
  const origin = req.headers.get('origin')
  const h: Record<string, string> = { Vary: 'Origin' }
  let allow: string | null = null
  if (allowedOrigins.includes('*')) allow = '*'
  else if (origin && allowedOrigins.includes(origin)) allow = origin
  if (allow) {
    h['Access-Control-Allow-Origin'] = allow
    h['Access-Control-Allow-Headers'] = ALLOW_HEADERS
    h['Access-Control-Allow-Methods'] = [...methods, 'OPTIONS'].join(', ')
    h['Access-Control-Max-Age'] = '86400'
  }
  return h
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

/**
 * Lit un corps JSON en refusant au-delà de `maxBytes` (sans tout charger en mémoire si le
 * client ment sur Content-Length ou envoie en chunked).
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `corps limité à ${maxBytes} octets`)
  }
  if (!req.body) throw new HttpError(400, 'invalid_json', 'corps vide')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, 'payload_too_large', `corps limité à ${maxBytes} octets`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.byteLength
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new HttpError(400, 'invalid_json', 'encodage UTF-8 invalide')
  }
  if (text.trim() === '') throw new HttpError(400, 'invalid_json', 'corps vide')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON invalide')
  }
}

export interface HttpEnv {
  allowedOrigins: string[]
  logger: Logger
  now?: () => Date
  newRequestId?: () => string
}

export interface RequestContext {
  requestId: string
  logger: Logger
  now: () => Date
}

/**
 * Enveloppe un handler : pré-vol CORS, contrôle de méthode, en-têtes communs, conversion des
 * erreurs (HttpError → code + détail ; autre → 500 générique sans détail), journal d'accès.
 */
export function withHttp(
  fn: string,
  methods: string[],
  env: HttpEnv,
  handler: (req: Request, ctx: RequestContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const now = env.now ?? (() => new Date())
  const newId = env.newRequestId ?? (() => crypto.randomUUID())
  return async (req) => {
    const requestId = newId()
    const started = Date.now()
    const cors = corsHeaders(req, env.allowedOrigins, methods)
    const common = { ...cors, 'X-Request-Id': requestId }
    const logger: Logger = {
      log: (level, event, fields = {}) => env.logger.log(level, event, { fn, request_id: requestId, ...fields }),
    }
    let res: Response
    if (req.method === 'OPTIONS') {
      res = new Response(null, { status: 204, headers: common })
    } else if (!methods.includes(req.method)) {
      res = jsonResponse(405, { error: 'method_not_allowed' }, { ...common, Allow: [...methods, 'OPTIONS'].join(', ') })
    } else {
      try {
        const inner = await handler(req, { requestId, logger, now })
        const headers = new Headers(inner.headers)
        for (const [k, v] of Object.entries(common)) headers.set(k, v)
        res = new Response(inner.body, { status: inner.status, headers })
      } catch (e) {
        if (e instanceof HttpError) {
          const body: Record<string, unknown> = { error: e.code }
          if (e.detail) body.detail = e.detail
          res = jsonResponse(e.status, body, common)
          if (e.status >= 500) logger.log('error', 'http_error', { code: e.code })
        } else {
          logger.log('error', 'unhandled_error', {
            error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          })
          res = jsonResponse(500, { error: 'internal_error', request_id: requestId }, common)
        }
      }
    }
    logger.log(res.status >= 500 ? 'error' : 'info', 'request', {
      method: req.method,
      status: res.status,
      duration_ms: Date.now() - started,
    })
    return res
  }
}
