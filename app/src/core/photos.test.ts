import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHOTO_MAX_BYTES, PHOTO_PATH_RE } from '../../../shared/payloads.ts'
import { PHOTO_DRAFT_KEEP_MS, PHOTO_LOCAL_KEEP_MS } from './core.ts'
import { DEMO_DEVICE, DEMO_SUPPLIERS } from './mockTransport.ts'
import { createAdaptiveEncoder, fitWithin, isWebp, PHOTO_TARGET_BYTES, syntheticWebp, type DecodedImage, type EncoderBackend } from './photoEncoder.ts'
import { disposeAll, enrollAndUnlock, makeHarness } from './testUtils.ts'
import { createHttpTransport } from './transport.ts'

afterEach(async () => {
  await disposeAll()
})

const image = (size = 5000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

function reception(paths: string[], extra: Record<string, unknown> = {}) {
  return {
    supplier_id: DEMO_SUPPLIERS[0].id,
    vehicle_ok: true,
    packaging_ok: true,
    items: [{ product: 'Steak haché', lot: 'L123', storage: 'fridge', temperature_c: 3, accepted: true, photo_paths: paths }],
    ...extra,
  }
}

describe('photos : stockage local et file d’envoi', () => {
  it('une photo reste un brouillon local tant qu’aucune saisie ne la référence', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const photo = await core.addPhoto(image())
    expect(photo.path).toMatch(PHOTO_PATH_RE)
    expect(photo.path.startsWith(`${DEMO_DEVICE.device_id}/`)).toBe(true)
    expect((await core.getPhotoStatuses([photo.path]))[photo.path]).toEqual({ state: 'draft', error: null, local: true })
    const blob = await core.getPhoto(photo.path)
    expect(blob?.type).toBe('image/webp')
    expect(isWebp(new Uint8Array(await blob!.arrayBuffer()))).toBe(true)

    await core.syncNow()
    expect(server.calls.photo).toBe(0)
    expect((await core.getSyncStatus()).photos_pending).toBe(0)
    // Retirée du formulaire : supprimée (brouillon seulement).
    expect(await core.discardPhoto(photo.path)).toBe(true)
    expect(await core.getPhoto(photo.path)).toBeNull()
    expect((await core.getPhotoStatuses([photo.path]))[photo.path].state).toBe('absent')
  })

  it('référencée par une réception : envoyée à la synchro, gardée localement, plus supprimable', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    const a = await core.addPhoto(image(4000))
    const b = await core.addPhoto(image(6000))
    await core.addRecord('reception', reception([a.path], { photo_paths: [b.path] }))
    await core.whenSyncIdle()
    let st = await core.getSyncStatus()
    expect(st.photos_pending).toBe(2)
    expect(await core.discardPhoto(a.path)).toBe(false)

    server.setOffline(false)
    st = await core.syncNow()
    expect(st.photos_pending).toBe(0)
    expect(st.photos_failed).toBe(0)
    const stored = server.storedPhotos()
    expect([...stored.keys()].sort()).toEqual([a.path, b.path].sort())
    expect(stored.get(a.path)!.byteLength).toBe(a.size)
    const statuses = await core.getPhotoStatuses([a.path, b.path])
    expect(statuses[a.path]).toEqual({ state: 'uploaded', error: null, local: true })
    expect(await core.getPhoto(a.path)).not.toBeNull()
  })

  it('envoi idempotent : un objet identique déjà présent (réponse perdue) compte comme envoyé', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    const a = await core.addPhoto(image())
    await core.addRecord('waste', { product: 'Crème', reason: 'expired', photo_paths: [a.path] })
    await core.whenSyncIdle()
    const bytes = new Uint8Array(await (await core.getPhoto(a.path))!.arrayBuffer())
    server.putStoredPhoto(a.path, bytes) // le premier envoi était arrivé, la réponse s'est perdue
    server.setOffline(false)
    const st = await core.syncNow()
    expect(st.photos_pending).toBe(0)
    expect((await core.getPhotoStatuses([a.path]))[a.path].state).toBe('uploaded')
  })

  it('409 photo_conflict : erreur visible, jamais renvoyée en boucle', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    const a = await core.addPhoto(image(5000))
    await core.addRecord('reception', reception([a.path]))
    await core.whenSyncIdle()
    server.putStoredPhoto(a.path, syntheticWebp(999))
    server.setOffline(false)
    let st = await core.syncNow()
    expect(st.photos_failed).toBe(1)
    expect(st.photos_pending).toBe(0)
    expect((await core.getPhotoStatuses([a.path]))[a.path]).toMatchObject({ state: 'failed', error: 'photo_conflict', local: true })
    const calls = server.calls.photo
    st = await core.syncNow()
    expect(server.calls.photo).toBe(calls)
    expect(st.photos_failed).toBe(1)
    // L'objet du serveur n'est jamais écrasé.
    expect(server.storedPhotos().get(a.path)!.byteLength).toBe(1000)
  })

  it('erreur serveur passagère : la photo reste en attente, backoff, puis envoyée', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    const a = await core.addPhoto(image())
    await core.addRecord('reception', reception([a.path]))
    await core.whenSyncIdle()
    server.setOffline(false)
    server.failNextPhotoUploads(1)
    let st = await core.syncNow()
    expect(st.photos_pending).toBe(1)
    expect(st.last_error).toMatch(/503/)
    // Les saisies, elles, sont bien parties.
    expect(st.pending_count).toBe(0)
    const calls = server.calls.photo
    await core.triggerSync('periodic') // dans le délai de backoff : rien n'est tenté
    expect(server.calls.photo).toBe(calls)
    st = await core.syncNow()
    expect(st.photos_pending).toBe(0)
    expect(st.last_error).toBeNull()
  })

  it('une correction qui ajoute une photo la met en file d’envoi', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const orig = await core.addRecord('reception', reception([]))
    await core.whenSyncIdle()
    const p = await core.addPhoto(image())
    await core.addRecord('correction', { reason: 'Photo oubliée', replacement: reception([p.path]) }, { supersedes_id: orig.id })
    await core.syncNow()
    expect(server.storedPhotos().has(p.path)).toBe(true)
  })

  it('ménage : brouillon abandonné supprimé après 7 jours, copie envoyée libérée après 45 jours', async () => {
    const { core, clock } = makeHarness()
    await enrollAndUnlock(core)
    const draft = await core.addPhoto(image())
    const sent = await core.addPhoto(image())
    await core.addRecord('reception', reception([sent.path]))
    await core.syncNow()
    clock.advance(PHOTO_DRAFT_KEEP_MS + 60_000)
    await core.syncNow()
    let st = await core.getPhotoStatuses([draft.path, sent.path])
    expect(st[draft.path].state).toBe('absent')
    expect(st[sent.path]).toEqual({ state: 'uploaded', error: null, local: true })
    clock.advance(PHOTO_LOCAL_KEEP_MS)
    await core.syncNow()
    st = await core.getPhotoStatuses([sent.path])
    expect(st[sent.path]).toEqual({ state: 'uploaded', error: null, local: false })
    expect(await core.getPhoto(sent.path)).toBeNull()
  })

  it('photo trop lourde ou pas en WebP : refusée avant stockage', async () => {
    const h = makeHarness({
      photoEncoder: async () => ({ bytes: new Uint8Array(100), width: 1, height: 1, encoder: 'native', quality: 1 }),
    })
    await enrollAndUnlock(h.core)
    await expect(h.core.addPhoto(image())).rejects.toThrow(/WebP/)
    const big = makeHarness({
      photoEncoder: async () => ({ bytes: syntheticWebp(PHOTO_MAX_BYTES + 2), width: 1, height: 1, encoder: 'native', quality: 1 }),
    })
    await enrollAndUnlock(big.core)
    await expect(big.core.addPhoto(image())).rejects.toThrow(/volumineuse/)
  })
})

describe('fournisseurs (sync-pull)', () => {
  it('stockés localement ; un fournisseur désactivé reste connu mais inactif', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    expect((await core.listSuppliers()).map((s) => s.name)).toEqual(['Boucherie Martin', 'Metro Lyon Nord', 'Primeurs du Rhône'])
    server.upsertSupplier({ id: '6f1c2a4e-0000-4000-8000-000000000599', name: 'Fromagerie Alpine', phone: null, email: null, active: true })
    server.deactivate('suppliers', DEMO_SUPPLIERS[2].id)
    await core.syncNow()
    expect((await core.listSuppliers()).map((s) => s.name)).toEqual(['Boucherie Martin', 'Fromagerie Alpine', 'Primeurs du Rhône'])
    const all = await core.listSuppliers({ includeInactive: true })
    expect(all.find((s) => s.id === DEMO_SUPPLIERS[2].id)?.active).toBe(false)
  })
})

describe('compression : algorithme adaptatif et secours WebAssembly', () => {
  const decoded = (width: number, height: number): DecodedImage => ({ width, height, release: vi.fn() })

  function backend(opts: { native: 'webp' | 'png' | 'null'; sizeAt: (q: number, w: number) => number }) {
    const calls = { native: 0, wasm: 0, sizes: [] as number[][] }
    const b: EncoderBackend = {
      decode: async () => decoded(4032, 3024),
      async encodeNative(_img, w, h, q) {
        calls.native++
        calls.sizes.push([w, h])
        if (opts.native === 'null') return null
        if (opts.native === 'png') return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
        return new Blob([syntheticWebp(opts.sizeAt(q, w)) as BlobPart], { type: 'image/webp' })
      },
      async encodeWasm(_img, w, h, q) {
        calls.wasm++
        calls.sizes.push([w, h])
        return syntheticWebp(opts.sizeAt(q, w))
      },
    }
    return { b, calls }
  }

  it('redimensionne (côté long ≤ 1600 px) et encode nativement si le navigateur sait faire du WebP', async () => {
    const { b, calls } = backend({ native: 'webp', sizeAt: () => 150_000 })
    const out = await createAdaptiveEncoder(b)(image())
    expect(out).toMatchObject({ width: 1600, height: 1200, encoder: 'native', quality: 0.82 })
    expect(calls.wasm).toBe(0)
  })

  it('Safari (toBlob renvoie du PNG) : bascule sur l’encodeur WebAssembly, une fois pour toutes', async () => {
    const state = { nativeWebp: null as boolean | null }
    const { b, calls } = backend({ native: 'png', sizeAt: () => 120_000 })
    const encode = createAdaptiveEncoder(b, state)
    const out = await encode(image())
    expect(out.encoder).toBe('wasm')
    expect(isWebp(out.bytes)).toBe(true)
    expect(state.nativeWebp).toBe(false)
    await encode(image())
    expect(calls.native).toBe(1) // l'encodeur natif n'est plus essayé
    expect(calls.wasm).toBe(2)
  })

  it('baisse la qualité jusqu’à ~200 Ko, puis réduit l’image si la limite de 1 Mo est dépassée', async () => {
    const { b } = backend({ native: 'webp', sizeAt: (q) => Math.round(q * 400_000) })
    const out = await createAdaptiveEncoder(b)(image())
    expect(out.bytes.byteLength).toBeLessThanOrEqual(PHOTO_TARGET_BYTES * 1.25)
    expect(out.quality).toBeLessThan(0.82)

    const heavy = backend({ native: 'webp', sizeAt: (_q, w) => (w >= 1600 ? 2_000_000 : 600_000) })
    const reduced = await createAdaptiveEncoder(heavy.b)(image())
    expect(reduced.width).toBe(1200)
    expect(reduced.bytes.byteLength).toBeLessThanOrEqual(PHOTO_MAX_BYTES)
  })

  it('fitWithin ne grossit jamais une petite image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
})

describe('transport HTTP : photo-upload', () => {
  function transportWith(status: number, body: unknown) {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }))
    return { t: createHttpTransport({ baseUrl: 'https://x.supabase.co/', anonKey: 'anon', fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl }
  }
  const path = `${DEMO_DEVICE.device_id}/6f1c2a4e-0000-4000-8000-00000000aaaa.webp`

  it('PUT avec les en-têtes du contrat ; 201 et 200 = envoyée', async () => {
    const { t, fetchImpl } = transportWith(201, { ok: true, path, status: 'created', size: 100 })
    expect(await t.uploadPhoto!(path, syntheticWebp(100), { device_token: 'tok' })).toEqual({ ok: true, status: 'created' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://x.supabase.co/functions/v1/photo-upload?path=${encodeURIComponent(path)}`)
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer anon', 'x-device-token': 'tok', 'Content-Type': 'image/webp' })
    expect((await transportWith(200, { ok: true, status: 'already_present' }).t.uploadPhoto!(path, syntheticWebp(100), { device_token: 'tok' }))).toEqual({ ok: true, status: 'already_present' })
  })

  it('refus définitifs (409, 415, 403 device_mismatch) ; 401 et 5xx levés', async () => {
    const auth = { device_token: 'tok' }
    expect(await transportWith(409, { error: 'photo_conflict' }).t.uploadPhoto!(path, syntheticWebp(), auth)).toEqual({ ok: false, error: 'photo_conflict' })
    expect(await transportWith(415, { error: 'invalid_photo' }).t.uploadPhoto!(path, syntheticWebp(), auth)).toEqual({ ok: false, error: 'invalid_photo' })
    expect(await transportWith(403, { error: 'device_mismatch' }).t.uploadPhoto!(path, syntheticWebp(), auth)).toEqual({ ok: false, error: 'device_mismatch' })
    await expect(transportWith(401, { error: 'device_revoked' }).t.uploadPhoto!(path, syntheticWebp(), auth)).rejects.toMatchObject({ kind: 'unauthorized' })
    await expect(transportWith(503, { error: 'x' }).t.uploadPhoto!(path, syntheticWebp(), auth)).rejects.toMatchObject({ kind: 'server' })
  })
})
