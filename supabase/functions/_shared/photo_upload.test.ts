// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES } from '../../../shared/payloads.ts'
import { MemoryPhotoStore, type MemoryRepo } from './memory_repo.ts'
import { checkWebp, createPhotoUploadHandler, parsePhotoPath } from './photo_upload.ts'
import { DEVICE_ID, NOW, OTHER_DEVICE_ID, TOKEN, memoryLogger, seededRepo } from './test_helpers.ts'

const FILE = '00000000-0000-4000-8000-00000000f001'
const PATH = `${DEVICE_ID}/${FILE}.webp`

/** WebP minimal bien formé : RIFF <taille> WEBP + bloc VP8L de `payload` octets. */
function webp(payload = 10, chunk = 'VP8L'): Uint8Array<ArrayBuffer> {
  const total = 20 + payload
  const b = new Uint8Array(total)
  b.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(b.buffer).setUint32(4, total - 8, true)
  b.set(new TextEncoder().encode('WEBP' + chunk), 8)
  new DataView(b.buffer).setUint32(16, payload, true)
  for (let i = 20; i < total; i++) b[i] = i % 251
  return b
}

let repo: MemoryRepo
let store: MemoryPhotoStore
let logger: ReturnType<typeof memoryLogger>
let handler: (req: Request) => Promise<Response>

beforeEach(async () => {
  repo = await seededRepo()
  store = new MemoryPhotoStore()
  logger = memoryLogger()
  handler = createPhotoUploadHandler({ repo, store, logger, allowedOrigins: ['https://haccp.example'], now: () => NOW })
})

function put(body: BodyInit | null, opts: { path?: string | null; token?: string | null; method?: string; headers?: Record<string, string> } = {}): Request {
  const url = new URL('https://fn.example/photo-upload')
  const path = opts.path === undefined ? PATH : opts.path
  if (path !== null) url.searchParams.set('path', path)
  const headers: Record<string, string> = { 'content-type': 'image/webp', ...opts.headers }
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token !== null) headers['x-device-token'] = token
  return new Request(url, { method: opts.method ?? 'PUT', headers, body })
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: string }).error
}

describe('photo-upload — signature WebP', () => {
  it('accepte VP8, VP8L, VP8X', () => {
    for (const c of ['VP8 ', 'VP8L', 'VP8X']) expect(checkWebp(webp(10, c))).toBeNull()
  })
  it('refuse trop court, mauvaise signature, taille RIFF incohérente, bloc inconnu', () => {
    expect(checkWebp(webp().slice(0, 19))).toMatch(/court/)
    const png = webp()
    png.set([0x89, 0x50, 0x4e, 0x47], 0)
    expect(checkWebp(png)).toMatch(/signature/)
    const notWebp = webp()
    notWebp.set(new TextEncoder().encode('WAVE'), 8)
    expect(checkWebp(notWebp)).toMatch(/signature/)
    expect(checkWebp(webp().slice(0, 25))).toMatch(/tronqué/)
    expect(checkWebp(webp(10, 'ABCD'))).toMatch(/bloc/)
  })
})

describe('photo-upload — chemin', () => {
  it('impose <device_id>/<uuid>.webp avec le dossier de l’appareil', () => {
    expect(parsePhotoPath(PATH, DEVICE_ID)).toBe(PATH)
    for (const bad of [null, '', `${DEVICE_ID}/${FILE}.jpg`, `${DEVICE_ID}/../${FILE}.webp`, `/${DEVICE_ID}/${FILE}.webp`, `${DEVICE_ID.toUpperCase()}/${FILE}.webp`, `${'-'.repeat(36)}/${FILE}.webp`]) {
      expect(() => parsePhotoPath(bad, DEVICE_ID)).toThrow(expect.objectContaining({ status: 400, code: 'invalid_path' }))
    }
    expect(() => parsePhotoPath(`${OTHER_DEVICE_ID}/${FILE}.webp`, DEVICE_ID)).toThrow(expect.objectContaining({ status: 403, code: 'device_mismatch' }))
  })
})

describe('photo-upload — envoi', () => {
  it('201 created : écrit l’objet en image/webp', async () => {
    const res = await handler(put(webp()))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, path: PATH, status: 'created', size: 30 })
    expect(store.objects.get(PATH)?.contentType).toBe('image/webp')
    expect(store.objects.get(PATH)?.bytes).toEqual(webp())
    expect(repo.devices[0].last_seen_at).toBe(NOW.toISOString())
  })
  it('idempotent : renvoi identique → 200 already_present sans réécriture', async () => {
    expect((await handler(put(webp()))).status).toBe(201)
    const res = await handler(put(webp()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, path: PATH, status: 'already_present', size: 30 })
    expect(store.writes).toBe(1)
  })
  it('contenu différent au même chemin → 409 photo_conflict, jamais d’écrasement', async () => {
    await handler(put(webp()))
    const res = await handler(put(webp(50)))
    expect(res.status).toBe(409)
    expect(await errorOf(res)).toBe('photo_conflict')
    expect(store.objects.get(PATH)?.bytes.byteLength).toBe(30)
    expect(store.writes).toBe(1)
  })
  it('envoi concurrent entre stat et create : jugé sur l’objet stocké (200 ou 409)', async () => {
    store.beforeCreate = (p) => store.objects.set(p, { bytes: webp(), contentType: 'image/webp' })
    expect((await handler(put(webp()))).status).toBe(200)
    store.objects.clear()
    store.beforeCreate = (p) => store.objects.set(p, { bytes: webp(99), contentType: 'image/webp' })
    expect((await handler(put(webp()))).status).toBe(409)
    expect(store.writes).toBe(0)
  })
  it('authentifie l’appareil : 401 sans jeton, 401 device_revoked', async () => {
    expect((await handler(put(webp(), { token: null }))).status).toBe(401)
    repo.devices[0].revoked_at = NOW.toISOString()
    const res = await handler(put(webp()))
    expect(res.status).toBe(401)
    expect(await errorOf(res)).toBe('device_revoked')
    expect(store.objects.size).toBe(0)
  })
  it('403 si le dossier est celui d’un autre appareil, 400 si chemin invalide ou absent', async () => {
    const other = await handler(put(webp(), { path: `${OTHER_DEVICE_ID}/${FILE}.webp` }))
    expect(other.status).toBe(403)
    expect(await errorOf(other)).toBe('device_mismatch')
    expect((await handler(put(webp(), { path: null }))).status).toBe(400)
    expect((await handler(put(webp(), { path: `${DEVICE_ID}/photo.webp` }))).status).toBe(400)
    expect(store.objects.size).toBe(0)
  })
  it('415 invalid_photo si ce n’est pas un WebP, 400 si corps vide', async () => {
    const jpeg = new Uint8Array(100).fill(0xff)
    const res = await handler(put(jpeg))
    expect(res.status).toBe(415)
    expect(await errorOf(res)).toBe('invalid_photo')
    expect((await handler(put(null))).status).toBe(400)
    expect(store.objects.size).toBe(0)
  })
  it(`413 au-delà de ${PHOTO_MAX_BYTES} octets (Content-Length ou flux)`, async () => {
    const big = webp(PHOTO_MAX_BYTES)
    expect((await handler(put(big))).status).toBe(413)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big.slice(0, 600_000))
        c.enqueue(big.slice(600_000))
        c.close()
      },
    })
    const req = new Request(`https://fn.example/photo-upload?path=${encodeURIComponent(PATH)}`, {
      method: 'PUT',
      headers: { 'x-device-token': TOKEN },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await handler(req)).status).toBe(413)
    expect(store.objects.size).toBe(0)
  })
  it('accepte exactement PHOTO_MAX_BYTES', async () => {
    expect((await handler(put(webp(PHOTO_MAX_BYTES - 20)))).status).toBe(201)
  })
  it('CORS : pré-vol OPTIONS et en-têtes sur la réponse ; 405 hors PUT', async () => {
    const pre = await handler(put(null, { method: 'OPTIONS', headers: { origin: 'https://haccp.example' } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-methods')).toBe('PUT, OPTIONS')
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/x-device-token/)
    const res = await handler(put(webp(), { headers: { origin: 'https://haccp.example' } }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://haccp.example')
    expect((await handler(put(webp(), { method: 'POST' }))).status).toBe(405)
  })
  it('erreur de stockage → 500 générique, sans détail interne', async () => {
    store.create = async () => {
      throw new Error('storage: secret interne')
    }
    const res = await handler(put(webp()))
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toMatch(/secret/)
  })
  it('journalise sans contenu ni jeton', async () => {
    await handler(put(webp()))
    const line = logger.lines.find((l) => l.event === 'photo_upload')
    expect(line?.fields).toMatchObject({ device_id: DEVICE_ID, path: PATH, size: 30, status: 'created' })
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN)
  })
})
