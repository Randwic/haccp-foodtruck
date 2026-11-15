// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { base64Url, concatBytes, fromBase64Url } from './crypto.ts'
import { classifyPushStatus, createWebPushSender, encryptWebPushPayload, parseVapidKeys, vapidAuthorization, type PushHttpClient, type VapidKeys } from './webpush.ts'

const enc = new TextEncoder()
const b = (s: string) => fromBase64Url(s) as Uint8Array<ArrayBuffer>

// RFC 8291, annexe A (exemple complet de chiffrement).
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

function jwkFromRaw(pub: string, d?: string): JsonWebKey {
  const p = b(pub)
  return { kty: 'EC', crv: 'P-256', x: base64Url(p.slice(1, 33)), y: base64Url(p.slice(33, 65)), ...(d ? { d } : {}), ext: true }
}

async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(data)))
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  return (await hmac(await hmac(salt, ikm), concatBytes(info, new Uint8Array([1])))).slice(0, len)
}

/** Déchiffrement côté navigateur (RFC 8291), écrit indépendamment pour vérifier le chiffrement. */
async function decrypt(body: Uint8Array, uaPrivateJwk: JsonWebKey, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ct = body.slice(21 + idlen)
  expect(rs).toBe(4096)
  const priv = await crypto.subtle.importKey('jwk', uaPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = await crypto.subtle.importKey('raw', new Uint8Array(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256))
  const ikm = await hkdf(auth, secret, concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct))
  expect(plain[plain.length - 1]).toBe(2) // délimiteur du dernier enregistrement
  return new TextDecoder().decode(plain.slice(0, -1))
}

async function newVapid(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: base64Url(raw), privateKey: jwk.d as string, subject: 'mailto:alertes@example.org' }
}

async function newBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), raw, p256dh: base64Url(raw), authBytes: auth, auth: base64Url(auth) }
}

describe('Web Push — chiffrement RFC 8291 (aes128gcm)', () => {
  it('reproduit exactement le vecteur de l’annexe A de la RFC 8291', async () => {
    const body = await encryptWebPushPayload(enc.encode(RFC.plaintext), RFC.uaPublic, RFC.auth, {
      salt: b(RFC.salt),
      ephemeral: { publicKey: b(RFC.asPublic), privateJwk: jwkFromRaw(RFC.asPublic, RFC.asPrivate) },
    })
    expect(base64Url(body)).toBe(RFC.body)
    expect(await decrypt(body, jwkFromRaw(RFC.uaPublic, RFC.uaPrivate), b(RFC.uaPublic), b(RFC.auth))).toBe(RFC.plaintext)
  })
  it('clé éphémère et sel aléatoires : déchiffrable par le navigateur, jamais deux fois le même corps', async () => {
    const br = await newBrowser()
    const msg = JSON.stringify({ title: 'Température hors seuil', body: 'Frigo 1 : 7,4 °C', url: '/' })
    const a = await encryptWebPushPayload(enc.encode(msg), br.p256dh, br.auth)
    const c = await encryptWebPushPayload(enc.encode(msg), br.p256dh, br.auth)
    expect(base64Url(a)).not.toBe(base64Url(c))
    expect(await decrypt(a, br.privateJwk, br.raw, br.authBytes)).toBe(msg)
    expect(a.byteLength).toBe(16 + 4 + 1 + 65 + enc.encode(msg).byteLength + 1 + 16)
  })
  it('refuse des clés d’abonnement mal formées et un message trop long', async () => {
    const br = await newBrowser()
    await expect(encryptWebPushPayload(enc.encode('x'), 'abc', br.auth)).rejects.toThrow(/p256dh/)
    await expect(encryptWebPushPayload(enc.encode('x'), br.p256dh, 'abc')).rejects.toThrow(/auth/)
    await expect(encryptWebPushPayload(new Uint8Array(5000), br.p256dh, br.auth)).rejects.toThrow(/trop long/)
  })
})

describe('Web Push — VAPID (RFC 8292)', () => {
  it('JWT ES256 signé, aud = origine du point d’envoi, exp ≤ 24 h, clé publique jointe', async () => {
    const keys = await newVapid()
    const now = new Date('2026-11-14T10:00:00.000Z')
    const h = await vapidAuthorization('https://web.push.apple.com/QGuN…/abc?x=1', keys, now)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!
    expect(m).not.toBeNull()
    expect(m[4]).toBe(keys.publicKey)
    expect(JSON.parse(new TextDecoder().decode(b(m[1])))).toEqual({ typ: 'JWT', alg: 'ES256' })
    const claims = JSON.parse(new TextDecoder().decode(b(m[2])))
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: 'mailto:alertes@example.org' })
    const pub = await crypto.subtle.importKey('raw', b(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b(m[3]), enc.encode(`${m[1]}.${m[2]}`))
    expect(ok).toBe(true)
  })
  it('format des secrets vérifié', async () => {
    const keys = await newVapid()
    expect(() => parseVapidKeys(keys)).not.toThrow()
    expect(() => parseVapidKeys({ ...keys, publicKey: keys.privateKey })).toThrow(/VAPID_PUBLIC_KEY/)
    expect(() => parseVapidKeys({ ...keys, privateKey: keys.publicKey })).toThrow(/VAPID_PRIVATE_KEY/)
    expect(() => parseVapidKeys({ ...keys, subject: 'alertes@example.org' })).toThrow(/VAPID_SUBJECT/)
  })
})

describe('Web Push — envoi (client HTTP simulé)', () => {
  it('POST chiffré vers l’endpoint avec les en-têtes RFC 8030 / 8291 / 8292', async () => {
    const keys = await newVapid()
    const br = await newBrowser()
    const calls: { url: string; headers: Record<string, string>; body: Uint8Array }[] = []
    const client: PushHttpClient = { post: async (url, headers, body) => (calls.push({ url, headers, body }), { status: 201 }) }
    const sender = createWebPushSender(keys, client, () => new Date('2026-11-14T10:00:00.000Z'))
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
    const msg = { title: 'Capteur muet', body: 'Frigo 1 : aucune mesure', url: '/', tag: 'a1', alert_id: '00000000-0000-4000-8000-0000000000aa' }
    const r = await sender.send({ endpoint, p256dh: br.p256dh, auth: br.auth }, msg)
    expect(r).toEqual({ status: 201, outcome: 'ok' })
    expect(calls).toHaveLength(1)
    const { url, headers, body } = calls[0]
    expect(url).toBe(endpoint)
    expect(headers['Content-Encoding']).toBe('aes128gcm')
    expect(headers.TTL).toBe('3600')
    expect(headers.Urgency).toBe('high')
    expect(headers.Topic).toBe('000000000000400080000000000000aa') // uuid sans tirets (≤ 32 caractères base64url)
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/)
    expect(JSON.parse(await decrypt(body, br.privateJwk, br.raw, br.authBytes))).toEqual(msg)
  })
  it('404 / 410 : abonnement expiré ; autres erreurs : échec', () => {
    expect(classifyPushStatus(201)).toBe('ok')
    expect(classifyPushStatus(404)).toBe('gone')
    expect(classifyPushStatus(410)).toBe('gone')
    expect(classifyPushStatus(403)).toBe('failed')
    expect(classifyPushStatus(429)).toBe('failed')
    expect(classifyPushStatus(500)).toBe('failed')
  })
  it('refuse des clés VAPID mal formées dès la création', () => {
    expect(() => createWebPushSender({ publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.c' })).toThrow(/VAPID/)
  })
})

describe('scripts/generate-vapid.mjs', () => {
  it('produit une paire au format attendu, utilisable pour signer', async () => {
    // Modules Node chargés dynamiquement : la vérification de type de _shared se fait sans @types/node.
    const cp = (await import('node:' + 'child_process')) as { execFileSync: (cmd: string, args: string[], o: { encoding: 'utf8' }) => string }
    const node = (globalThis as unknown as { process: { execPath: string } }).process.execPath
    const script = decodeURIComponent(new URL('../../../scripts/generate-vapid.mjs', import.meta.url).pathname)
    const out = cp.execFileSync(node, [script, 'mailto:alertes@example.org'], { encoding: 'utf8' })
    const get = (k: string) => new RegExp(`^${k}=(.+)$`, 'm').exec(out)?.[1] ?? ''
    const keys: VapidKeys = { publicKey: get('VAPID_PUBLIC_KEY'), privateKey: get('VAPID_PRIVATE_KEY'), subject: get('VAPID_SUBJECT') }
    expect(() => parseVapidKeys(keys)).not.toThrow()
    const h = await vapidAuthorization('https://web.push.apple.com/x', keys, new Date())
    const [, t] = /^vapid t=([^,]+), k=/.exec(h)!
    const [hd, cl, sig] = t.split('.')
    const pub = await crypto.subtle.importKey('raw', b(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b(sig), enc.encode(`${hd}.${cl}`))).toBe(true)
  })
})
