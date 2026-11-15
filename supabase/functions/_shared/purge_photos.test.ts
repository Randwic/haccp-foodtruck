// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DOCUMENT_BUCKET, PHOTO_BUCKET } from '../../../shared/payloads.ts'
import { MemoryPhotoStore, MemoryPurgeRepo } from './memory_repo.ts'
import { createPurgePhotosHandler, PURGE_LIMITS, PURGE_SECRET_HEADER } from './purge_photos.ts'
import { DEVICE_ID, NOW, memoryLogger } from './test_helpers.ts'

const SECRET = 's'.repeat(40)
const path = (n: number) => `${DEVICE_ID}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`

let store: MemoryPhotoStore
let repo: MemoryPurgeRepo
let handler: (req: Request) => Promise<Response>

function fill(n: number): string[] {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    store.objects.set(path(i), { bytes: new Uint8Array(1), contentType: 'image/webp' })
    out.push(path(i))
  }
  return out
}

beforeEach(() => {
  store = new MemoryPhotoStore()
  repo = new MemoryPurgeRepo(store)
  handler = createPurgePhotosHandler({ repo, store, secret: SECRET, logger: memoryLogger(), allowedOrigins: [], now: () => NOW })
})

const req = (secret: string | null = SECRET, method = 'POST') =>
  new Request('https://fn.example/purge-photos', { method, headers: secret === null ? {} : { [PURGE_SECRET_HEADER]: secret } })

describe('purge-photos', () => {
  it('supprime les photos désignées par photos_to_purge() et journalise', async () => {
    repo.purgeable = fill(3).slice(0, 2)
    const res = await handler(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 2, failed: 0, more: false })
    expect([...store.objects.keys()]).toEqual([path(3)])
    expect(repo.logs).toEqual([{ deleted: 2, failed: 0 }])
  })
  it('traite plusieurs lots, puis s’arrête à la limite (more = true)', async () => {
    repo.purgeable = fill(PURGE_LIMITS.batch * 2 + 5)
    expect(await (await handler(req())).json()).toMatchObject({ deleted: PURGE_LIMITS.batch * 2 + 5, more: false })
    repo.purgeable = fill(PURGE_LIMITS.batch * PURGE_LIMITS.maxBatches + 1)
    expect(await (await handler(req())).json()).toMatchObject({ deleted: PURGE_LIMITS.batch * PURGE_LIMITS.maxBatches, more: true })
  })
  it('échec partiel : compte les échecs et s’arrête sans reboucler', async () => {
    repo.purgeable = fill(3)
    store.failRemove.add(path(2))
    expect(await (await handler(req())).json()).toEqual({ ok: true, deleted: 2, failed: 1, more: true })
    expect(repo.logs).toEqual([{ deleted: 2, failed: 1 }])
  })
  it('rien à purger : 200, résumé journalisé quand même', async () => {
    expect(await (await handler(req())).json()).toEqual({ ok: true, deleted: 0, failed: 0, more: false })
    expect(repo.logs).toHaveLength(1)
  })
  it('401 sans secret ou avec un mauvais secret, 503 si non configuré, 405 hors POST', async () => {
    repo.purgeable = fill(1)
    expect((await handler(req(null))).status).toBe(401)
    expect((await handler(req('x'.repeat(40)))).status).toBe(401)
    expect(store.objects.size).toBe(1)
    const unconfigured = createPurgePhotosHandler({ repo, store, secret: 'court', logger: memoryLogger(), allowedOrigins: [] })
    expect((await unconfigured(req('court'))).status).toBe(503)
    expect((await handler(req(SECRET, 'GET'))).status).toBe(405)
    expect(repo.logs).toEqual([])
  })
})

describe('purge-photos et bucket documents (lot 7)', () => {
  it("le seul bucket utilisé par la purge (PHOTO_BUCKET) n'est jamais celui des documents", () => {
    // _adapters/supabase_storage.ts n'ouvre que storage.from(PHOTO_BUCKET) ; photos_to_purge() filtre
    // bucket_id = 'photos' (vérifié aussi en SQL : 99_lot7_documents.sql).
    expect(PHOTO_BUCKET).toBe('photos')
    expect(DOCUMENT_BUCKET).toBe('documents')
    expect(PHOTO_BUCKET).not.toBe(DOCUMENT_BUCKET)
  })
})
