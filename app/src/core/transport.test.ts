import { describe, expect, it } from 'vitest'
import { createHttpTransport, TransportError } from './transport.ts'

const auth = { device_token: 'tok-123' }

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return handler(String(input), init ?? {})
  }) as typeof fetch
  return { f, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createHttpTransport', () => {
  it('appelle sync-push et sync-pull avec les bons en-têtes', async () => {
    const { f, calls } = fakeFetch(async (url) =>
      url.includes('sync-push') ? json({ accepted: [], rejected: [], last_device_seq: 0 }) : json({ server_now: 'x' }),
    )
    const t = createHttpTransport({ baseUrl: 'https://p.supabase.co/', anonKey: 'anon', fetchImpl: f })
    await t.push({ device_id: 'd', records: [] }, auth)
    await t.pull('2026-11-14T10:00:00.000Z', auth)
    await t.pull(null, auth)
    expect(calls[0].url).toBe('https://p.supabase.co/functions/v1/sync-push')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ device_id: 'd', records: [] })
    expect(calls[0].init.headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer anon', 'x-device-token': 'tok-123' })
    expect(calls[1].url).toBe('https://p.supabase.co/functions/v1/sync-pull?since=2026-11-14T10%3A00%3A00.000Z')
    expect(calls[1].init.method).toBe('GET')
    expect(calls[2].url).toBe('https://p.supabase.co/functions/v1/sync-pull?since=')
  })

  it('distingue réseau, 401, 5xx, 4xx et délai dépassé', async () => {
    const kindOf = async (handler: (url: string, init: RequestInit) => Promise<Response>, timeoutMs = 1000) => {
      const { f } = fakeFetch(handler)
      const t = createHttpTransport({ baseUrl: 'https://p', anonKey: 'a', fetchImpl: f, timeoutMs })
      try {
        await t.pull(null, auth)
        return 'ok'
      } catch (e) {
        expect(e).toBeInstanceOf(TransportError)
        return (e as TransportError).kind
      }
    }
    expect(await kindOf(async () => json({}))).toBe('ok')
    expect(await kindOf(async () => Promise.reject(new TypeError('Failed to fetch')))).toBe('network')
    expect(await kindOf(async () => json({ error: 'device_revoked' }, 401))).toBe('unauthorized')
    expect(await kindOf(async () => json({}, 403))).toBe('unauthorized')
    expect(await kindOf(async () => json({}, 503))).toBe('server')
    expect(await kindOf(async () => json({}, 400))).toBe('client')
    expect(await kindOf(async () => new Response('pas du json', { status: 200 }))).toBe('client')
    expect(
      await kindOf(
        (_url, init) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
        20,
      ),
    ).toBe('timeout')
  })
})
