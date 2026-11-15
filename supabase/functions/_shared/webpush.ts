// Web Push sans dépendance (WebCrypto seulement : Deno, Node 20+, navigateurs).
//  - Chiffrement du message : RFC 8291 (« aes128gcm », RFC 8188), un seul enregistrement.
//  - Authentification du serveur d'application : VAPID, RFC 8292 (JWT ES256).
// Format des clés (celui de la bibliothèque `web-push` et de `scripts/generate-vapid.mjs`) :
//  - VAPID_PUBLIC_KEY  : point P-256 non compressé (65 octets, 0x04‖X‖Y) en base64url ;
//  - VAPID_PRIVATE_KEY : scalaire privé d (32 octets) en base64url.
import { base64Url, concatBytes, fromBase64Url } from './crypto.ts'

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** `mailto:…` ou URL https (RFC 8292 § 2.1). */
  subject: string
}

export interface PushTarget {
  endpoint: string
  p256dh: string // clé publique ECDH du navigateur (65 octets base64url)
  auth: string // secret d'authentification (16 octets base64url)
}

const enc = new TextEncoder()

function bytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u.buffer instanceof ArrayBuffer && u.byteOffset === 0 && u.byteLength === u.buffer.byteLength
    ? (u as Uint8Array<ArrayBuffer>)
    : new Uint8Array(u)
}

/** Vérifie et décode la paire VAPID ; lève une erreur explicite si le format est mauvais. */
export function parseVapidKeys(keys: VapidKeys): { pub: Uint8Array<ArrayBuffer>; d: Uint8Array<ArrayBuffer> } {
  const pub = fromBase64Url(keys.publicKey ?? '')
  const d = fromBase64Url(keys.privateKey ?? '')
  if (!pub || pub.byteLength !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY : point P-256 non compressé (65 octets) en base64url attendu')
  if (!d || d.byteLength !== 32) throw new Error('VAPID_PRIVATE_KEY : clé privée P-256 (32 octets) en base64url attendue')
  if (!/^(mailto:|https:\/\/)/.test(keys.subject ?? '')) throw new Error('VAPID_SUBJECT : « mailto:… » ou « https://… » attendu')
  return { pub, d }
}

async function importVapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const { pub, d } = parseVapidKeys(keys)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: base64Url(pub.slice(1, 33)),
    y: base64Url(pub.slice(33, 65)),
    d: base64Url(d),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** En-tête `Authorization: vapid t=<JWT>, k=<clé publique>` pour l'origine du point d'envoi. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date, ttlSeconds = 12 * 3600): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = base64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64Url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now.getTime() / 1000) + ttlSeconds, sub: keys.subject })))
  const key = await importVapidSigningKey(keys)
  // WebCrypto produit directement la signature JOSE (r‖s, 64 octets).
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${base64Url(sig)}, k=${keys.publicKey}`
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes(data)))
}

/** HKDF-SHA-256 (RFC 5869), longueur ≤ 32. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(salt, ikm)
  const t = await hmac(prk, concatBytes(info, new Uint8Array([1])))
  return t.slice(0, length)
}

export interface EncryptOptions {
  /** Tests uniquement (vecteurs RFC 8291) : sel et clé éphémère imposés. */
  salt?: Uint8Array
  ephemeral?: { publicKey: Uint8Array; privateJwk: JsonWebKey }
  /** Taille d'enregistrement annoncée (défaut 4096). */
  recordSize?: number
}

/**
 * Chiffre `plaintext` pour un abonnement (RFC 8291) : renvoie le corps « aes128gcm » complet
 * (en-tête sel‖rs‖idlen‖clé éphémère, puis l'unique enregistrement chiffré).
 */
export async function encryptWebPushPayload(plaintext: Uint8Array, p256dh: string, authSecret: string, opts: EncryptOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(p256dh)
  const auth = fromBase64Url(authSecret)
  if (!uaPublic || uaPublic.byteLength !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh invalide')
  if (!auth || auth.byteLength !== 16) throw new Error('auth invalide')
  const rs = opts.recordSize ?? 4096
  if (plaintext.byteLength + 1 + 16 > rs) throw new Error('message trop long pour un enregistrement')

  let asPrivate: CryptoKey
  let asPublic: Uint8Array<ArrayBuffer>
  if (opts.ephemeral) {
    asPrivate = await crypto.subtle.importKey('jwk', opts.ephemeral.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    asPublic = bytes(opts.ephemeral.publicKey)
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPrivate = pair.privateKey
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256))

  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32)
  const salt = opts.salt ? bytes(opts.salt) : crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  // Dernier (et unique) enregistrement : délimiteur 0x02, sans remplissage.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, concatBytes(plaintext, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.byteLength)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs)
  header[20] = asPublic.byteLength
  header.set(asPublic, 21)
  return concatBytes(header, record)
}

/** Client HTTP injecté (fetch en production, simulé dans les tests). */
export interface PushHttpClient {
  post(url: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer>): Promise<{ status: number }>
}

export const fetchPushClient: PushHttpClient = {
  async post(url, headers, body) {
    const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    await res.body?.cancel().catch(() => {})
    return { status: res.status }
  },
}

/** Contenu de la notification lu par le service worker de l'app (JSON). */
export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
  alert_id?: string
  kind?: string
}

export type PushOutcome = 'ok' | 'gone' | 'failed'

export interface WebPushSender {
  send(target: PushTarget, message: PushMessage): Promise<{ status: number; outcome: PushOutcome }>
}

/** 2xx : remis ; 404/410 : abonnement expiré (à supprimer) ; autre : échec temporaire ou de configuration. */
export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 404 || status === 410) return 'gone'
  return 'failed'
}

export function createWebPushSender(keys: VapidKeys, client: PushHttpClient = fetchPushClient, now: () => Date = () => new Date()): WebPushSender {
  parseVapidKeys(keys) // erreur immédiate si les secrets sont mal formés
  return {
    async send(target, message) {
      const body = await encryptWebPushPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth)
      const headers: Record<string, string> = {
        Authorization: await vapidAuthorization(target.endpoint, keys, now()),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'high',
      }
      // Topic : un rappel remplace la notification encore en attente pour la même alerte.
      const topic = (message.alert_id ?? '').replace(/-/g, '')
      if (/^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic
      const { status } = await client.post(target.endpoint, headers, body)
      return { status, outcome: classifyPushStatus(status) }
    },
  }
}
