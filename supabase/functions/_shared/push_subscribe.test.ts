// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { base64Url } from './crypto.ts'
import type { MemoryRepo } from './memory_repo.ts'
import { createPushConfigHandler, createPushSubscribeHandler, isAllowedPushEndpoint, parseSubscribeBody } from './push_subscribe.ts'
import { DEVICE_ID, memoryLogger, NOW, OTHER_DEVICE_ID, OTHER_TOKEN, seededRepo, TOKEN } from './test_helpers.ts'

const ENDPOINT = 'https://web.push.apple.com/QGuNbe-abc123'
const p256dhBytes = new Uint8Array(65).fill(7)
p256dhBytes[0] = 4
const P256DH = base64Url(p256dhBytes)
const AUTH = base64Url(new Uint8Array(16).fill(9))

let repo: MemoryRepo
let handler: (req: Request) => Promise<Response>

beforeEach(async () => {
  repo = await seededRepo()
  handler = createPushSubscribeHandler({ repo, logger: memoryLogger(), allowedOrigins: ['https://app.example'], now: () => NOW })
})

const req = (method: string, body: unknown, token: string | null = TOKEN, query = '') =>
  new Request(`https://fn.example/push-subscribe${query}`, {
    method,
    headers: { ...(token ? { 'x-device-token': token } : {}), 'content-type': 'application/json', origin: 'https://app.example' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('push-subscribe', () => {
  it('jeton appareil exigé (401)', async () => {
    expect((await handler(req('POST', { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }, null))).status).toBe(401)
    expect(repo.pushSubscriptions).toHaveLength(0)
  })
  it('POST : 201 created, puis 200 updated (clés remplacées, échecs remis à zéro)', async () => {
    const r1 = await handler(req('POST', { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }))
    expect(r1.status).toBe(201)
    expect(await r1.json()).toEqual({ ok: true, status: 'created' })
    expect(r1.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example')
    expect(repo.pushSubscriptions).toMatchObject([{ device_id: DEVICE_ID, endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, failures: 0 }])
    repo.pushSubscriptions[0].failures = 7
    const p2 = new Uint8Array(p256dhBytes)
    p2[1] = 1
    const r2 = await handler(req('POST', { endpoint: ENDPOINT, keys: { p256dh: base64Url(p2), auth: AUTH } }, OTHER_TOKEN))
    expect(r2.status).toBe(200)
    expect(repo.pushSubscriptions).toMatchObject([{ device_id: OTHER_DEVICE_ID, p256dh: base64Url(p2), failures: 0 }])
  })
  it('clés en base64 standard avec remplissage : normalisées en base64url', () => {
    const std = btoa(String.fromCharCode(...p256dhBytes))
    const a = btoa(String.fromCharCode(...new Uint8Array(16).fill(9)))
    expect(parseSubscribeBody({ endpoint: ENDPOINT, keys: { p256dh: std, auth: a } })).toEqual({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH })
  })
  it('refuse endpoint non https, service inconnu, clés mal formées, champ inconnu', async () => {
    const bad = [
      { endpoint: 'http://web.push.apple.com/x', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: 'https://evil.example/push', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: 'https://web.push.apple.com.evil.example/x', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: 'https://user@web.push.apple.com/x', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: ENDPOINT, keys: { p256dh: AUTH, auth: AUTH } },
      { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: P256DH } },
      { endpoint: ENDPOINT, keys: { p256dh: P256DH } },
      { endpoint: ENDPOINT },
      { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, device_id: DEVICE_ID },
    ]
    for (const b of bad) {
      const res = await handler(req('POST', b))
      expect(res.status, JSON.stringify(b)).toBe(400)
    }
    expect(repo.pushSubscriptions).toHaveLength(0)
  })
  it('services push reconnus', () => {
    for (const u of [ENDPOINT, 'https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://wns2-par02p.notify.windows.com/w/?token=a', 'https://api.push.apple.com/x']) {
      expect(isAllowedPushEndpoint(u), u).toBe(true)
    }
    expect(isAllowedPushEndpoint('https://web.push.apple.com:8443/x')).toBe(false)
  })
  it('DELETE : désabonne seulement l’abonnement de CET appareil', async () => {
    await handler(req('POST', { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }))
    const other = await handler(req('DELETE', { endpoint: ENDPOINT }, OTHER_TOKEN))
    expect(await other.json()).toEqual({ ok: true, deleted: false })
    expect(repo.pushSubscriptions).toHaveLength(1)
    const mine = await handler(req('DELETE', undefined, TOKEN, `?endpoint=${encodeURIComponent(ENDPOINT)}`))
    expect(mine.status).toBe(200)
    expect(await mine.json()).toEqual({ ok: true, deleted: true })
    expect(repo.pushSubscriptions).toHaveLength(0)
    expect((await handler(req('DELETE', {}))).status).toBe(400)
  })
})

describe('push-config', () => {
  it('expose la clé publique VAPID (GET public) ; null si absente ou mal formée', async () => {
    const pub = base64Url(p256dhBytes)
    const h = (k: string | undefined) => createPushConfigHandler({ vapidPublicKey: k, logger: memoryLogger(), allowedOrigins: [], now: () => NOW })
    const res = await h(pub)(new Request('https://fn.example/push-config'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true, vapid_public_key: pub })
    expect(await (await h(undefined)(new Request('https://fn.example/push-config'))).json()).toEqual({ enabled: false, vapid_public_key: null })
    expect(await (await h('abc')(new Request('https://fn.example/push-config'))).json()).toEqual({ enabled: false, vapid_public_key: null })
    expect((await h(pub)(new Request('https://fn.example/push-config', { method: 'POST' }))).status).toBe(405)
  })
})
