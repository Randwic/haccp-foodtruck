// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { GENESIS_HASH, type SyncPushResponse } from '../../../shared/types.ts'
import type { MemoryRepo } from './memory_repo.ts'
import { classifyDbError, isClockSuspect } from './repo.ts'
import { createSyncPushHandler, PUSH_LIMITS } from './sync_push.ts'
import {
  ChainBuilder,
  DEVICE_ID,
  FRIDGE_ID,
  INACTIVE_STAFF_ID,
  NOW,
  OTHER_DEVICE_ID,
  OTHER_TOKEN,
  TOKEN,
  memoryLogger,
  newId,
  SUPPLIER_ID,
  rehash,
  seededRepo,
} from './test_helpers.ts'

let repo: MemoryRepo
let logger: ReturnType<typeof memoryLogger>
let handler: (req: Request) => Promise<Response>
let clock: Date

beforeEach(async () => {
  repo = await seededRepo()
  logger = memoryLogger()
  clock = NOW
  handler = createSyncPushHandler({ repo, logger, allowedOrigins: ['https://haccp.example'], now: () => clock })
})

function pushReq(body: unknown, opts: { token?: string | null; raw?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers }
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token !== null) headers['x-device-token'] = token
  return new Request('https://fn.example/sync-push', { method: 'POST', headers, body: opts.raw ?? JSON.stringify(body) })
}

async function push(records: unknown[], deviceId = DEVICE_ID, token = TOKEN): Promise<SyncPushResponse> {
  const res = await handler(pushReq({ device_id: deviceId, records }, { token }))
  expect(res.status).toBe(200)
  return (await res.json()) as SyncPushResponse
}

/** Envoi par une app récente : device_now = horloge de l'appareil au moment de l'envoi. */
async function pushAt(records: unknown[], deviceNow: string | null): Promise<SyncPushResponse> {
  const res = await handler(pushReq({ device_id: DEVICE_ID, device_now: deviceNow, records }))
  expect(res.status).toBe(200)
  return (await res.json()) as SyncPushResponse
}

const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString()

describe('sync-push — authentification', () => {
  it('refuse sans jeton, avec un jeton inconnu ou mal formé (401 unauthorized)', async () => {
    for (const token of [null, 'inconnu-mais-assez-long-0123456789', 'court', 'x'.repeat(300), 'avec espace dedans 123456']) {
      const res = await handler(pushReq({ device_id: DEVICE_ID, records: [] }, { token }))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
    expect(repo.records).toHaveLength(0)
  })
  it('refuse un appareil révoqué (401 device_revoked) sans rien insérer', async () => {
    repo.devices[0].revoked_at = '2026-11-13T00:00:00.000Z'
    const recs = await new ChainBuilder().many(1)
    const res = await handler(pushReq({ device_id: DEVICE_ID, records: recs }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'device_revoked' })
    expect(repo.records).toHaveLength(0)
    expect(repo.devices[0].last_seen_at).toBeNull()
  })
  it('refuse un device_id de corps différent de celui du jeton (403)', async () => {
    const res = await handler(pushReq({ device_id: OTHER_DEVICE_ID, records: [] }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('device_mismatch')
  })
  it('refuse un enregistrement portant le device_id d’un autre appareil', async () => {
    const [r] = await new ChainBuilder(OTHER_DEVICE_ID).many(1)
    const out = await push([r])
    expect(out.rejected).toEqual([{ id: r.id, reason: 'invalid_record', detail: expect.stringMatching(/appareil/) }])
  })
})

describe('sync-push — requête', () => {
  it('405 sur GET, 204 sur pré-vol CORS avec origine autorisée', async () => {
    expect((await handler(new Request('https://fn.example/sync-push'))).status).toBe(405)
    const pre = await handler(new Request('https://fn.example/sync-push', { method: 'OPTIONS', headers: { origin: 'https://haccp.example' } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://haccp.example')
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-device-token')
  })
  it('400 sur JSON invalide ou enveloppe incorrecte', async () => {
    expect((await handler(pushReq(null, { raw: '{pas du json' }))).status).toBe(400)
    expect((await handler(pushReq(null, { raw: '' }))).status).toBe(400)
    expect((await handler(pushReq([1, 2]))).status).toBe(400)
    expect((await handler(pushReq({ records: [] }))).status).toBe(400)
    const r = await handler(pushReq({ device_id: DEVICE_ID, records: 'x' }))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'invalid_request', detail: 'records : tableau attendu' })
  })
  it(`413 au-delà de ${PUSH_LIMITS.maxRecords} enregistrements`, async () => {
    const records = Array.from({ length: PUSH_LIMITS.maxRecords + 1 }, () => ({}))
    const res = await handler(pushReq({ device_id: DEVICE_ID, records }))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('too_many_records')
  })
  it('accepte exactement 500 enregistrements', async () => {
    const recs = await new ChainBuilder().many(PUSH_LIMITS.maxRecords)
    const out = await push(recs)
    expect(out.accepted).toHaveLength(500)
    expect(out.last_device_seq).toBe(500)
  })
  it('413 au-delà de 1 Mo (Content-Length déclaré ou corps réel)', async () => {
    const big = JSON.stringify({ device_id: DEVICE_ID, records: [], pad: 'x'.repeat(PUSH_LIMITS.maxBodyBytes) })
    const res = await handler(pushReq(null, { raw: big }))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
    // Corps en flux sans Content-Length (chunked)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const chunk = new TextEncoder().encode('x'.repeat(256 * 1024))
        for (let i = 0; i < 5; i++) c.enqueue(chunk)
        c.close()
      },
    })
    const req = new Request('https://fn.example/sync-push', {
      method: 'POST',
      headers: { 'x-device-token': TOKEN },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await handler(req)).status).toBe(413)
  })
  it('lot vide : renvoie la tête de chaîne et met à jour last_seen_at', async () => {
    const out = await push([])
    expect(out).toEqual({ accepted: [], rejected: [], last_device_seq: 0 })
    expect(repo.devices[0].last_seen_at).toBe(NOW.toISOString())
  })
})

describe('sync-push — chaîne', () => {
  it('accepte une chaîne valide depuis la genèse et stocke les champs à l’identique', async () => {
    const recs = await new ChainBuilder().many(3)
    expect(recs[0].prev_hash).toBe(GENESIS_HASH)
    const out = await push(recs)
    expect(out.rejected).toEqual([])
    expect(out.accepted).toEqual(recs.map((r) => ({ id: r.id, server_time: NOW.toISOString(), clock_suspect: false })))
    expect(out.last_device_seq).toBe(3)
    expect(repo.records.map((r) => [r.device_seq, r.hash, r.prev_hash])).toEqual(recs.map((r) => [r.device_seq, r.hash, r.prev_hash]))
  })
  it('poursuit une chaîne existante sur plusieurs envois', async () => {
    const chain = new ChainBuilder()
    await push(await chain.many(2))
    const out = await push(await chain.many(2))
    expect(out.accepted).toHaveLength(2)
    expect(out.last_device_seq).toBe(4)
  })
  it('les chaînes de deux appareils sont indépendantes', async () => {
    await push(await new ChainBuilder().many(2))
    const out = await push(await new ChainBuilder(OTHER_DEVICE_ID).many(1), OTHER_DEVICE_ID, OTHER_TOKEN)
    expect(out.accepted).toHaveLength(1)
    expect(out.last_device_seq).toBe(1)
  })
  it('hash falsifié : payload modifié sans recalcul → invalid_hash', async () => {
    const [r] = await new ChainBuilder().many(1)
    const out = await push([{ ...r, payload: { note: 'falsifié' } }])
    expect(out.rejected).toEqual([{ id: r.id, reason: 'invalid_hash', detail: expect.any(String) }])
    expect(repo.records).toHaveLength(0)
  })
  it('hash bien formé mais arbitraire → invalid_hash', async () => {
    const [r] = await new ChainBuilder().many(1)
    expect((await push([{ ...r, hash: 'f'.repeat(64) }])).rejected[0].reason).toBe('invalid_hash')
  })
  it('trou de séquence → seq_gap, et la suite du lot est bloquée', async () => {
    const chain = new ChainBuilder()
    const [r1, r2, r3] = await chain.many(3)
    const out = await push([r1, r3, r2])
    expect(out.accepted.map((a) => a.id)).toEqual([r1.id])
    expect(out.rejected).toEqual([
      { id: r3.id, reason: 'seq_gap', detail: 'device_seq attendu : 2, reçu : 3' },
      { id: r2.id, reason: 'broken_chain', detail: expect.stringContaining(r3.id) },
    ])
    expect(out.last_device_seq).toBe(1)
  })
  it('premier enregistrement qui ne commence pas à 1 → seq_gap', async () => {
    const recs = await new ChainBuilder(DEVICE_ID, { device_seq: 4, hash: GENESIS_HASH }).many(1)
    expect((await push(recs)).rejected[0].reason).toBe('seq_gap')
  })
  it('prev_hash faux (hash recalculé pour masquer) → broken_chain', async () => {
    const chain = new ChainBuilder()
    const [r1, r2] = await chain.many(2)
    const forged = await rehash({ ...r2, prev_hash: 'e'.repeat(64) })
    const out = await push([r1, forged])
    expect(out.accepted).toHaveLength(1)
    expect(out.rejected).toEqual([{ id: r2.id, reason: 'broken_chain', detail: expect.stringMatching(/prev_hash/) }])
  })
  it('premier enregistrement dont prev_hash n’est pas GENESIS_HASH → broken_chain', async () => {
    const recs = await new ChainBuilder(DEVICE_ID, { device_seq: 0, hash: 'a'.repeat(64) }).many(1)
    expect((await push(recs)).rejected[0].reason).toBe('broken_chain')
  })
  it('lot partiellement rejeté (intégrité) : les acceptés restent, les suivants sont rejetés, un renvoi corrigé passe', async () => {
    const chain = new ChainBuilder()
    const [r1, r2, r3, r4, r5] = await chain.many(5)
    const tampered = { ...r3, payload: { note: 'modifié après hachage' } }
    const out = await push([r1, r2, tampered, r4, r5])
    expect(out.accepted.map((a) => a.id)).toEqual([r1.id, r2.id])
    expect(out.rejected.map((x) => [x.id, x.reason])).toEqual([
      [r3.id, 'invalid_hash'],
      [r4.id, 'broken_chain'],
      [r5.id, 'broken_chain'],
    ])
    expect(repo.records).toHaveLength(2)
    expect(out.last_device_seq).toBe(2)
    // L'app reconstruit la suite de sa chaîne à partir de la tête serveur.
    const fixed = new ChainBuilder(DEVICE_ID, { device_seq: 2, hash: r2.hash })
    const again = await push([r1, r2, ...(await fixed.many(3))])
    expect(again.rejected).toEqual([])
    expect(again.last_device_seq).toBe(5)
  })
  it('forme invalide (device_time non canonique) → invalid_payload, rien d’inséré', async () => {
    const [r] = await new ChainBuilder().many(1)
    const out = await push([{ ...r, device_time: '2026-11-14T10:00:00Z' }])
    expect(out.rejected[0]).toMatchObject({ id: r.id, reason: 'invalid_record' })
    expect(repo.records).toHaveLength(0)
  })
  it('élément non objet dans le lot → rejet avec id vide', async () => {
    const out = await push([42])
    expect(out.rejected).toEqual([{ id: '', reason: 'invalid_record', detail: expect.any(String) }])
  })
  it('type non stockable (pas un identifiant) → invalid_payload sans stockage', async () => {
    const [r] = await new ChainBuilder().many(1)
    const out = await push([{ ...r, type: 'Pizza Margherita!' }])
    expect(out.rejected[0]).toMatchObject({ reason: 'invalid_record', detail: expect.stringMatching(/^type/) })
    expect(repo.records).toHaveLength(0)
  })
})

describe('sync-push — quarantaine (chaîne intègre, contenu refusé)', () => {
  const Q = (reason: string) => expect.stringMatching(new RegExp(`^quarantaine\\[${reason}\\]`))

  it('auteur désactivé pendant une tournée : saisie en quarantaine, la saisie suivante est acceptée', async () => {
    const chain = new ChainBuilder()
    const byFormer = await chain.next({ author_id: INACTIVE_STAFF_ID })
    const next = await chain.next()
    const out = await push([byFormer, next])
    expect(out.rejected).toEqual([{ id: byFormer.id, reason: 'unknown_author', detail: Q('unknown_author'), quarantined: true }])
    expect(out.accepted.map((a) => a.id)).toEqual([next.id])
    expect(out.last_device_seq).toBe(2)
    expect(repo.records.map((r) => [r.id, r.quarantine_reason])).toEqual([
      [byFormer.id, 'unknown_author'],
      [next.id, null],
    ])
    // Les envois suivants chaînent normalement sur la saisie en quarantaine.
    expect((await push(await chain.many(1))).accepted).toHaveLength(1)
  })
  it('rejeu d’une saisie en quarantaine : même réponse, pas de doublon, chaîne inchangée', async () => {
    const chain = new ChainBuilder()
    const recs = [await chain.next({ author_id: newId() }), await chain.next()]
    const first = await push(recs)
    const second = await push(recs)
    expect(second.rejected.map((r) => [r.id, r.reason])).toEqual([[recs[0].id, 'unknown_author']])
    expect(second.accepted).toEqual(first.accepted)
    expect(second.last_device_seq).toBe(2)
    expect(repo.records).toHaveLength(2)
  })
  it('type hors contrat → quarantaine unknown_type (stocké tel quel)', async () => {
    const chain = new ChainBuilder()
    const pizza = await chain.next({ type: 'pizza' as never })
    const oil = await chain.next({ type: 'oil_check', payload: {} })
    const out = await push([pizza, oil])
    expect(out.rejected.map((r) => [r.reason, r.detail])).toEqual([
      ['unknown_type', Q('unknown_type')],
      ['unknown_type', Q('unknown_type')],
    ])
    expect(repo.records.map((r) => [r.type, r.quarantine_reason])).toEqual([
      ['pizza', 'unknown_type'],
      ['oil_check', 'unknown_type'],
    ])
    expect(out.last_device_seq).toBe(2)
  })
  it('payload invalide → quarantaine invalid_payload, la suite du lot passe', async () => {
    const chain = new ChainBuilder()
    const [r1] = await chain.many(1)
    const bad = await chain.next({ payload: { note: 'x'.repeat(501) } })
    const [r3] = await chain.many(1)
    const out = await push([r1, bad, r3])
    expect(out.accepted.map((a) => a.id)).toEqual([r1.id, r3.id])
    expect(out.rejected).toEqual([{ id: bad.id, reason: 'invalid_payload', detail: Q('invalid_payload'), quarantined: true }])
    expect(repo.records.find((r) => r.id === bad.id)?.quarantine_reason).toBe('invalid_payload')
  })
  it('correction vers un id inexistant → quarantaine supersedes_not_found (raison client : invalid_payload)', async () => {
    const corr = await new ChainBuilder().next({ type: 'correction', supersedes_id: newId(), payload: { reason: 'r', replacement: { note: 'x' } } })
    const out = await push([corr])
    expect(out.rejected).toEqual([{ id: corr.id, reason: 'supersedes_not_found', detail: Q('supersedes_not_found'), quarantined: true }])
    expect(repo.records[0].quarantine_reason).toBe('supersedes_not_found')
    expect(out.last_device_seq).toBe(1)
  })
  it('supersedes_id sur un type autre que correction → quarantaine invalid_payload', async () => {
    const r = await new ChainBuilder().next({ supersedes_id: newId() })
    expect((await push([r])).rejected[0]).toMatchObject({ reason: 'invalid_payload', detail: Q('invalid_payload') })
    expect(repo.records[0].quarantine_reason).toBe('invalid_payload')
  })
  it('l’horloge suspecte est aussi calculée pour une saisie en quarantaine', async () => {
    const r = await new ChainBuilder().next({ author_id: newId(), device_time: new Date(NOW.getTime() - 3600_000).toISOString() })
    await push([r])
    expect(repo.records[0]).toMatchObject({ quarantine_reason: 'unknown_author', clock_suspect: true })
  })
  it('une saisie en quarantaine refusée par la base → refus d’intégrité, rien de stocké, suite bloquée', async () => {
    repo.rejectInsert = (row) => (row.type === 'pizza' ? 'violates check constraint "records_type_check"' : null)
    const chain = new ChainBuilder()
    const pizza = await chain.next({ type: 'pizza' as never })
    const [after] = await chain.many(1)
    const out = await push([pizza, after])
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual([
      [pizza.id, 'invalid_record'],
      [after.id, 'broken_chain'],
    ])
    expect(repo.records).toHaveLength(0)
    expect(out.last_device_seq).toBe(0)
  })
  it('les refus d’intégrité ne sont jamais mis en quarantaine', async () => {
    const chain = new ChainBuilder()
    const [r1, r2] = await chain.many(2)
    for (const bad of [{ ...r1, hash: 'f'.repeat(64) }, r2, await rehash({ ...r1, prev_hash: 'e'.repeat(64) })]) {
      await push([bad])
    }
    expect(repo.records).toHaveLength(0)
  })
})

describe('sync-push — idempotence et conflits', () => {
  it('rejeu idempotent : même id + même hash → accepté avec le server_time d’origine, sans doublon', async () => {
    const recs = await new ChainBuilder().many(2)
    const first = await push(recs)
    clock = new Date(NOW.getTime() + 3600_000)
    repo.serverClock = () => clock
    const second = await push(recs)
    expect(second.accepted).toEqual(first.accepted)
    expect(second.rejected).toEqual([])
    expect(repo.records).toHaveLength(2)
  })
  it('rejeu partiel suivi de nouveaux enregistrements', async () => {
    const chain = new ChainBuilder()
    const old = await chain.many(2)
    await push(old)
    const fresh = await chain.many(2)
    const out = await push([...old, ...fresh])
    expect(out.accepted).toHaveLength(4)
    expect(out.last_device_seq).toBe(4)
    expect(repo.records).toHaveLength(4)
  })
  it('rejeu accepté même si l’auteur a été désactivé depuis', async () => {
    const recs = await new ChainBuilder().many(1)
    await push(recs)
    repo.staff[0].active = false
    expect((await push(recs)).accepted).toHaveLength(1)
  })
  it('même id avec un contenu différent → id_conflict', async () => {
    const [r1] = await new ChainBuilder().many(1)
    await push([r1])
    // Même id, autre contenu, hash recalculé (donc cohérent) : conflit et non rejeu.
    const clash = await rehash({ ...r1, payload: { note: 'autre' } })
    const out = await push([clash])
    expect(out.rejected).toEqual([{ id: r1.id, reason: 'id_conflict', detail: expect.any(String) }])
    expect(repo.records).toHaveLength(1)
  })
  it('id déjà utilisé par un autre appareil → id_conflict', async () => {
    const [mine] = await new ChainBuilder().many(1)
    await push([mine])
    const theirs = await new ChainBuilder(OTHER_DEVICE_ID).next({ id: mine.id })
    const out = await push([theirs], OTHER_DEVICE_ID, OTHER_TOKEN)
    expect(out.rejected[0].reason).toBe('id_conflict')
  })
  it('doublon dans un même lot → accepté une seule fois en base', async () => {
    const [r1] = await new ChainBuilder().many(1)
    const out = await push([r1, r1])
    expect(out.accepted).toHaveLength(2)
    expect(repo.records).toHaveLength(1)
  })
})

describe('sync-push — concurrence (violation d’unicité)', () => {
  it('le même lot inséré en parallèle par une autre requête → accepté (pas de 500)', async () => {
    const recs = await new ChainBuilder().many(2)
    // Juste avant notre insertion, « l'autre requête » insère exactement les mêmes lignes.
    repo.beforeInsert = (row) => {
      const r = recs.find((x) => x.id === row.id)!
      if (!repo.records.some((x) => x.id === r.id)) repo.records.push({ ...row, clock_suspect: false, server_time: '2026-11-14T09:59:59.000Z' })
    }
    const out = await push(recs)
    expect(out.rejected).toEqual([])
    expect(out.accepted.map((a) => a.server_time)).toEqual(['2026-11-14T09:59:59.000Z', '2026-11-14T09:59:59.000Z'])
    expect(out.last_device_seq).toBe(2)
    expect(repo.records).toHaveLength(2)
  })
  it('device_seq pris par un autre enregistrement en parallèle → broken_chain propre, suite bloquée', async () => {
    const chain = new ChainBuilder()
    const [r1, r2] = await chain.many(2)
    const rival = await new ChainBuilder().next({ payload: { note: 'rival' } })
    let once = false
    repo.beforeInsert = () => {
      if (once) return
      once = true
      repo.records.push({ ...rival, quarantine_reason: null, clock_suspect: false, server_time: NOW.toISOString() })
    }
    const out = await push([r1, r2])
    expect(out.accepted).toEqual([])
    expect(out.rejected.map((x) => x.reason)).toEqual(['broken_chain', 'broken_chain'])
    expect(out.rejected[0].detail).toMatch(/concurrent/)
    expect(out.last_device_seq).toBe(1)
    expect(logger.lines.some((l) => l.event === 'concurrent_insert')).toBe(true)
  })
  it('même id pris en parallèle avec un autre contenu → id_conflict', async () => {
    const [r1] = await new ChainBuilder().many(1)
    repo.beforeInsert = (row) => {
      if (!repo.records.length) repo.records.push({ ...row, device_seq: 99, hash: 'b'.repeat(64), clock_suspect: false, server_time: NOW.toISOString() })
    }
    const out = await push([r1])
    expect(out.rejected[0].reason).toBe('id_conflict')
  })
  it('refus métier de la base → invalid_payload sans détail interne, pas de 500', async () => {
    repo.rejectInsert = () => 'new row violates check constraint "records_secret_check"'
    const recs = await new ChainBuilder().many(2)
    const out = await push(recs)
    expect(out.rejected[0]).toEqual({ id: recs[0].id, reason: 'invalid_record', detail: 'refusé par la base de données' })
    expect(out.rejected[1].reason).toBe('broken_chain')
  })
  it('ne transmet jamais server_time ; ni clock_suspect ni device_now sans device_now (ancienne app)', async () => {
    await push(await new ChainBuilder().many(1))
    expect(repo.inserted[0]).not.toHaveProperty('server_time')
    expect(repo.inserted[0]).not.toHaveProperty('clock_suspect')
    expect(repo.inserted[0]).not.toHaveProperty('device_now')
  })
})

describe('sync-push — filet de sécurité de la base (exceptions HACCP: …)', () => {
  it('HACCP: seq_gap (tête lue périmée) → refus seq_gap, rien de stocké, pas de 500', async () => {
    const stale = { device_seq: 5, hash: 'c'.repeat(64) }
    repo.getChainHead = async () => (repo.records.length ? null : stale)
    const recs = await new ChainBuilder(DEVICE_ID, stale).many(2)
    const out = await push(recs)
    expect(out.rejected.map((r) => r.reason)).toEqual(['seq_gap', 'broken_chain'])
    expect(repo.records).toHaveLength(0)
  })
  it('HACCP: broken_chain → refus broken_chain', async () => {
    const [r1] = await new ChainBuilder().many(1)
    await push([r1])
    const wrongHead = { device_seq: 1, hash: 'd'.repeat(64) }
    const realHead = repo.getChainHead.bind(repo)
    repo.getChainHead = async (id) => (repo.calls.insertRecord === 1 ? wrongHead : realHead(id))
    const next = await new ChainBuilder(DEVICE_ID, wrongHead).next()
    const out = await push([next])
    expect(out.rejected[0]).toMatchObject({ id: next.id, reason: 'broken_chain' })
    expect(out.last_device_seq).toBe(1)
  })
  it('HACCP: device_revoked (révoqué pendant la requête) → refus device_revoked', async () => {
    const recs = await new ChainBuilder().many(2)
    repo.beforeInsert = () => {
      repo.devices[0].revoked_at = NOW.toISOString()
    }
    const out = await push(recs)
    expect(out.rejected.map((r) => r.reason)).toEqual(['device_revoked', 'broken_chain'])
    expect(repo.records).toHaveLength(0)
  })
  it('HACCP: unknown_author (auteur supprimé entre contrôle et insertion) → réinsertion en quarantaine', async () => {
    const recs = await new ChainBuilder().many(2)
    repo.getStaffStatus = async (id) => ({ id, active: true })
    repo.staff = []
    const out = await push(recs)
    expect(out.rejected.map((r) => [r.reason, r.detail])).toEqual([
      ['unknown_author', expect.stringMatching(/^quarantaine\[unknown_author\]/)],
      ['unknown_author', expect.stringMatching(/^quarantaine\[unknown_author\]/)],
    ])
    expect(repo.records.map((r) => r.quarantine_reason)).toEqual(['unknown_author', 'unknown_author'])
    expect(out.last_device_seq).toBe(2)
  })
  it('HACCP: supersedes_not_found côté base → quarantaine supersedes_not_found', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next()
    await push([orig])
    const corr = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'r', replacement: { note: 'v2' } } })
    repo.beforeInsert = () => {
      repo.records = repo.records.filter((r) => r.id !== orig.id) // « disparu » (purge) entre-temps
      repo.anchors = [{ device_id: DEVICE_ID, device_seq: 1, hash: orig.hash }]
    }
    const out = await push([corr])
    expect(out.rejected[0]).toMatchObject({ reason: 'supersedes_not_found', detail: expect.stringMatching(/^quarantaine\[supersedes_not_found\]/) })
    expect(repo.records[0].quarantine_reason).toBe('supersedes_not_found')
  })
  it('classifyDbError reconnaît les messages HACCP et l’unicité', () => {
    expect(classifyDbError('23514', 'HACCP: seq_gap — maillon 3 absent')).toMatchObject({ kind: 'integrity', reason: 'seq_gap' })
    expect(classifyDbError('23514', 'HACCP: broken_chain — x')).toMatchObject({ kind: 'integrity', reason: 'broken_chain' })
    expect(classifyDbError('23514', 'HACCP: device_revoked — x')).toMatchObject({ kind: 'integrity', reason: 'device_revoked' })
    expect(classifyDbError('23503', 'HACCP: unknown_author — x')).toMatchObject({ kind: 'content', quarantine: 'unknown_author' })
    expect(classifyDbError('23503', 'HACCP: supersedes_not_found — x')).toMatchObject({ kind: 'content', quarantine: 'supersedes_not_found' })
    expect(classifyDbError('23505', 'duplicate key')).toEqual({ ok: false, kind: 'unique_violation' })
    expect(classifyDbError('23514', 'violates check constraint "records_genesis"')).toMatchObject({ kind: 'rejected' })
  })
})

describe('sync-push — ancre de purge', () => {
  it('après purge totale, la chaîne continue depuis l’ancre (device_chain_head)', async () => {
    const anchor = { device_seq: 42, hash: 'a'.repeat(64) }
    repo.anchors.push({ device_id: DEVICE_ID, ...anchor })
    const out = await push(await new ChainBuilder(DEVICE_ID, anchor).many(2))
    expect(out.rejected).toEqual([])
    expect(out.last_device_seq).toBe(44)
    expect((await push(await new ChainBuilder().many(1))).rejected[0].reason).toBe('seq_gap')
  })
})

describe('sync-push — erreurs', () => {
  it('erreur inattendue → 500 générique, sans fuite du message interne', async () => {
    repo.getChainHead = async () => {
      throw new Error('password=hunter2 connection failed')
    }
    const res = await handler(pushReq({ device_id: DEVICE_ID, records: [] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain('hunter2')
    expect(body.request_id).toBe(res.headers.get('x-request-id'))
  })
})

describe('sync-push — auteur', () => {
  it('auteur inconnu → unknown_author', async () => {
    const r = await new ChainBuilder().next({ author_id: newId() })
    const out = await push([r])
    expect(out.rejected).toEqual([{ id: r.id, reason: 'unknown_author', detail: expect.stringMatching(/^quarantaine\[unknown_author\].*auteur inconnu$/), quarantined: true }])
    expect(repo.records[0].quarantine_reason).toBe('unknown_author')
  })
  it('auteur désactivé → unknown_author (quarantaine aussi)', async () => {
    const r = await new ChainBuilder().next({ author_id: INACTIVE_STAFF_ID })
    expect((await push([r])).rejected[0]).toMatchObject({ reason: 'unknown_author', detail: expect.stringMatching(/auteur désactivé$/) })
    expect(repo.records[0].quarantine_reason).toBe('unknown_author')
  })
  it('met en cache la recherche d’auteur sur un lot', async () => {
    await push(await new ChainBuilder().many(10))
    expect(repo.calls.getStaffStatus).toBe(1)
  })
})

describe('sync-push — payloads', () => {
  const temp = (over: Record<string, unknown> = {}) => ({ equipment_id: FRIDGE_ID, value_c: 3.2, source: 'manual', in_range: true, ...over })

  it('relevé de température valide → accepté', async () => {
    const r = await new ChainBuilder().next({ type: 'temperature_check', payload: temp() })
    expect((await push([r])).accepted).toHaveLength(1)
  })
  it('payload invalide → invalid_payload avec détail', async () => {
    const r = await new ChainBuilder().next({ type: 'temperature_check', payload: temp({ value_c: 3.25 }) })
    expect((await push([r])).rejected[0]).toMatchObject({ reason: 'invalid_payload', detail: expect.stringMatching(/décimale/) })
  })
  it('équipement inconnu → invalid_payload', async () => {
    const r = await new ChainBuilder().next({ type: 'temperature_check', payload: temp({ equipment_id: newId() }) })
    expect((await push([r])).rejected[0]).toMatchObject({ reason: 'invalid_payload', detail: expect.stringMatching(/équipement/) })
  })
  it('écart + action corrective liée dans le même lot', async () => {
    const chain = new ChainBuilder()
    const tId = newId()
    const caId = newId()
    const t = await chain.next({ id: tId, type: 'temperature_check', payload: temp({ value_c: 7, in_range: false, corrective_action_id: caId }) })
    const ca = await chain.next({ id: caId, type: 'corrective_action', payload: { related_record_id: tId, action: 'move_product', comment: 'déplacé frigo 2' } })
    const out = await push([t, ca])
    expect(out.rejected).toEqual([])
  })
})

describe('sync-push — corrections', () => {
  it('correction d’un enregistrement existant avec remplacement valide → acceptée', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next({ type: 'temperature_check', payload: { equipment_id: FRIDGE_ID, value_c: 30, source: 'manual', in_range: false } })
    const corr = await chain.next({
      type: 'correction',
      supersedes_id: orig.id,
      payload: { reason: 'virgule oubliée', replacement: { equipment_id: FRIDGE_ID, value_c: 3, source: 'manual', in_range: true } },
    })
    const out = await push([orig, corr])
    expect(out.rejected).toEqual([])
    expect(repo.records[1].supersedes_id).toBe(orig.id)
  })
  it('correction vers un id inexistant → invalid_payload', async () => {
    const corr = await new ChainBuilder().next({ type: 'correction', supersedes_id: newId(), payload: { reason: 'r', replacement: { note: 'x' } } })
    expect((await push([corr])).rejected[0]).toMatchObject({ reason: 'supersedes_not_found', detail: expect.stringMatching(/introuvable/) })
  })
  it('remplacement invalide pour le type corrigé → invalid_payload', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next()
    const corr = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'r', replacement: { note: 5 } } })
    const out = await push([orig, corr])
    expect(out.rejected[0]).toMatchObject({ id: corr.id, reason: 'invalid_payload', detail: expect.stringMatching(/system_test/) })
  })
  it('correction d’une correction : le remplacement est validé contre le type d’origine', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next()
    const c1 = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'r1', replacement: { note: 'v2' } } })
    const c2 = await chain.next({ type: 'correction', supersedes_id: c1.id, payload: { reason: 'r2', replacement: { note: 'v3' } } })
    const c3bad = await chain.next({ type: 'correction', supersedes_id: c2.id, payload: { reason: 'r3', replacement: { reason: 'x', replacement: {} } } })
    const out = await push([orig, c1, c2, c3bad])
    expect(out.accepted).toHaveLength(3)
    expect(out.rejected[0]).toMatchObject({ id: c3bad.id, reason: 'invalid_payload' })
  })
  it('correction d’un relevé : équipement du remplacement vérifié', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next({ type: 'temperature_check', payload: { equipment_id: FRIDGE_ID, value_c: 3, source: 'manual', in_range: true } })
    const corr = await chain.next({
      type: 'correction',
      supersedes_id: orig.id,
      payload: { reason: 'r', replacement: { equipment_id: newId(), value_c: 3, source: 'manual', in_range: true } },
    })
    expect((await push([orig, corr])).rejected[0]).toMatchObject({ reason: 'invalid_payload', detail: expect.stringMatching(/équipement/) })
  })
  it('correction sans supersedes_id → invalid_payload (forme)', async () => {
    const corr = await new ChainBuilder().next({ type: 'correction', payload: { reason: 'r', replacement: {} } })
    expect((await push([corr])).rejected[0].reason).toBe('invalid_payload')
  })
})

describe('sync-push — lot 2 (températures)', () => {
  const batch = '00000000-0000-4000-8000-00000000ba7c'
  it('accepte cooling, reheating, thawing, hot_holding, cooking_check valides', async () => {
    const chain = new ChainBuilder()
    const recs = [
      await chain.next({ type: 'cooling', payload: { batch_id: batch, step: 'start', product: 'Chili', value_c: 70, source: 'probe' } }),
      await chain.next({ type: 'cooling', payload: { batch_id: batch, step: 'end', product: 'Chili', value_c: 9, source: 'probe', in_range: true, duration_min: 110 } }),
      await chain.next({ type: 'reheating', payload: { batch_id: batch, step: 'end', product: 'Chili', value_c: 66, source: 'probe', in_range: true, duration_min: 40 } }),
      await chain.next({ type: 'thawing', payload: { batch_id: batch, step: 'end', product: 'Steaks', equipment_id: FRIDGE_ID, dlc: '2026-11-17' } }),
      await chain.next({ type: 'hot_holding', payload: { product: 'Frites', value_c: 65, source: 'probe', in_range: true } }),
      await chain.next({ type: 'hot_holding', payload: { product: 'Frites', value_c: 64, source: 'probe', in_range: true, equipment_id: FRIDGE_ID } }),
      await chain.next({ type: 'cooking_check', payload: { product: 'Steak haché', value_c: 72, source: 'probe', in_range: true } }),
    ]
    const out = await push(recs)
    expect(out.rejected).toEqual([])
    expect(out.accepted).toHaveLength(7)
  })
  it('n’évalue pas in_range contre les seuils (choix : seuils changeants hors réseau)', async () => {
    repo.thresholds.push({ id: newId(), equipment_id: null, check_type: 'cooking_check', min_c: 70, max_c: null, tolerance_minutes: 0, updated_at: NOW.toISOString() })
    const r = await new ChainBuilder().next({ type: 'cooking_check', payload: { product: 'Steak', value_c: 50, source: 'manual', in_range: true } })
    expect((await push([r])).rejected).toEqual([])
  })
  it('équipement inconnu (thawing, hot_holding) → quarantaine invalid_payload, la chaîne avance', async () => {
    const chain = new ChainBuilder()
    const thaw = await chain.next({ type: 'thawing', payload: { batch_id: batch, step: 'start', product: 'Pain', equipment_id: newId() } })
    const hot = await chain.next({ type: 'hot_holding', payload: { product: 'Frites', value_c: 65, source: 'probe', in_range: true, equipment_id: newId() } })
    const ok = await chain.next()
    const out = await push([thaw, hot, ok])
    expect(out.rejected.map((r) => [r.id, r.reason, r.quarantined])).toEqual([
      [thaw.id, 'invalid_payload', true],
      [hot.id, 'invalid_payload', true],
    ])
    expect(out.rejected[0].detail).toMatch(/équipement inconnu/)
    expect(out.accepted.map((a) => a.id)).toEqual([ok.id])
    expect(out.last_device_seq).toBe(3)
  })
  it('payload invalide (cooling end sans duration_min, DLC impossible) → quarantaine invalid_payload', async () => {
    const chain = new ChainBuilder()
    const cool = await chain.next({ type: 'cooling', payload: { batch_id: batch, step: 'end', product: 'Chili', value_c: 9, source: 'probe', in_range: true } })
    const thaw = await chain.next({ type: 'thawing', payload: { batch_id: batch, step: 'end', product: 'Pain', equipment_id: FRIDGE_ID, dlc: '2026-02-30' } })
    const out = await push([cool, thaw])
    expect(out.rejected.map((r) => r.reason)).toEqual(['invalid_payload', 'invalid_payload'])
    expect(out.rejected[0].detail).toMatch(/duration_min/)
    expect(out.rejected[1].detail).toMatch(/dlc/)
  })
  it('correction d’une décongélation : remplacement validé et équipement vérifié', async () => {
    const chain = new ChainBuilder()
    const thaw = { batch_id: batch, step: 'end', product: 'Pain', equipment_id: FRIDGE_ID, dlc: '2026-11-17' }
    const { dlc: _dlc, ...noDlc } = thaw
    const orig = await chain.next({ type: 'thawing', payload: thaw })
    const good = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'DLC', replacement: { ...thaw, dlc: '2026-11-16' } } })
    const badEq = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'r', replacement: { ...thaw, equipment_id: newId() } } })
    const badDlc = await chain.next({ type: 'correction', supersedes_id: good.id, payload: { reason: 'r', replacement: noDlc } })
    const out = await push([orig, good, badEq, badDlc])
    expect(out.accepted.map((a) => a.id)).toEqual([orig.id, good.id])
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual([
      [badEq.id, 'invalid_payload'],
      [badDlc.id, 'invalid_payload'],
    ])
    expect(out.rejected[0].detail).toMatch(/équipement inconnu/)
    expect(out.rejected[1].detail).toMatch(/thawing.*dlc.*obligatoire/)
  })
})

describe('sync-push — horloge', () => {
  it('écart > clock_suspect_minutes → accepté mais signalé', async () => {
    const chain = new ChainBuilder()
    const late = await chain.next({ device_time: new Date(NOW.getTime() - 6 * 60_000).toISOString() })
    const ahead = await chain.next({ device_time: new Date(NOW.getTime() + 6 * 60_000).toISOString() })
    const fine = await chain.next({ device_time: new Date(NOW.getTime() - 5 * 60_000).toISOString() })
    const out = await push([late, ahead, fine])
    expect(out.accepted.map((a) => a.clock_suspect)).toEqual([true, true, false])
    expect(repo.records.map((r) => r.clock_suspect)).toEqual([true, true, false])
    expect(logger.lines.filter((l) => l.event === 'clock_suspect')).toHaveLength(2)
  })
  it('ancienne app (sans device_now) : saisie hors-ligne envoyée 48 h plus tard → signalée (ancienne règle)', async () => {
    const r = await new ChainBuilder().next({ device_time: new Date(NOW.getTime() - 48 * 3600_000).toISOString() })
    expect((await push([r])).accepted[0].clock_suspect).toBe(true)
  })
  it('respecte le paramètre settings.clock_suspect_minutes', async () => {
    repo.settings!.clock_suspect_minutes = 60
    const r = await new ChainBuilder().next({ device_time: new Date(NOW.getTime() - 30 * 60_000).toISOString() })
    expect((await push([r])).accepted[0].clock_suspect).toBe(false)
  })
  it('la réponse reprend la valeur relue en base (trigger), pas un calcul local', async () => {
    const r = await new ChainBuilder().next()
    const real = repo.insertRecord.bind(repo)
    repo.insertRecord = async (row) => {
      const res = await real(row)
      return res.ok ? { ...res, clock_suspect: true } : res
    }
    expect((await push([r])).accepted[0].clock_suspect).toBe(true)
  })
  it('device_now juste : saisies hors réseau envoyées 48 h plus tard → NON signalées', async () => {
    const chain = new ChainBuilder()
    const old = await chain.next({ device_time: minutes(-48 * 60) })
    const older = await chain.next({ device_time: minutes(-30 * 60) })
    const out = await pushAt([old, older], minutes(1))
    expect(out.accepted.map((a) => a.clock_suspect)).toEqual([false, false])
    expect(repo.records.map((r) => r.clock_suspect)).toEqual([false, false])
    expect(repo.inserted.map((r) => r.device_now)).toEqual([minutes(1), minutes(1)])
    expect(repo.inserted[0]).not.toHaveProperty('clock_suspect')
    expect(logger.lines.some((l) => l.event.startsWith('clock_suspect'))).toBe(false)
  })
  it('device_now décalé > clock_suspect_minutes → TOUT le lot signalé (même device_time = heure serveur)', async () => {
    const chain = new ChainBuilder()
    const recs = [await chain.next({ device_time: minutes(-60) }), await chain.next({ device_time: NOW.toISOString() })]
    const out = await pushAt(recs, minutes(-6))
    expect(out.accepted.map((a) => a.clock_suspect)).toEqual([true, true])
    expect(repo.inserted.map((r) => r.clock_suspect)).toEqual([true, true])
    const batch = logger.lines.find((l) => l.event === 'clock_suspect_batch')!
    expect(batch.fields).toMatchObject({ device_id: DEVICE_ID, skew_seconds: 360, records: 2 })
    // en avance aussi
    const ahead = await chain.next()
    expect((await pushAt([ahead], minutes(6))).accepted[0].clock_suspect).toBe(true)
  })
  it('device_now : écart ≤ seuil toléré, settings.clock_suspect_minutes respecté', async () => {
    const chain = new ChainBuilder()
    expect((await pushAt([await chain.next({ device_time: minutes(-500) })], minutes(-5))).accepted[0].clock_suspect).toBe(false)
    repo.settings!.clock_suspect_minutes = 60
    expect((await pushAt([await chain.next()], minutes(-59))).accepted[0].clock_suspect).toBe(false)
    expect((await pushAt([await chain.next()], minutes(61))).accepted[0].clock_suspect).toBe(true)
  })
  it('device_now : null = absent (ancienne règle) ; mal formé → 400 sans rien insérer', async () => {
    const r = await new ChainBuilder().next({ device_time: minutes(-60) })
    for (const bad of ['2026-11-14T10:00:00Z', '2026-11-14 10:00:00.000Z', 'hier', 12, true]) {
      const res = await handler(pushReq({ device_id: DEVICE_ID, device_now: bad, records: [r] }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'invalid_request', detail: expect.stringMatching(/device_now/) })
    }
    expect(repo.inserted).toHaveLength(0)
    expect((await pushAt([r], null)).accepted[0].clock_suspect).toBe(true)
  })
  it('device_now : rejeu idempotent → même réponse qu’au premier envoi', async () => {
    const r = await new ChainBuilder().next({ device_time: minutes(-120) })
    const first = await pushAt([r], NOW.toISOString())
    const again = await pushAt([r], minutes(-30))
    expect(again).toEqual(first)
  })
  it('isClockSuspect : même règle que le trigger (5 min par défaut sans settings)', () => {
    const later = new Date(NOW.getTime() + 5 * 60_000 + 1)
    expect(isClockSuspect(later, NOW, null)).toBe(true)
    expect(isClockSuspect(new Date(NOW.getTime() + 5 * 60_000), NOW, undefined)).toBe(false)
    expect(isClockSuspect(later, NOW, 10)).toBe(false)
  })
})

describe('sync-push — journalisation', () => {
  it('journalise un résumé sans jeton ni contenu', async () => {
    await push(await new ChainBuilder().many(2))
    const summary = logger.lines.find((l) => l.event === 'sync_push')!
    expect(summary.fields).toMatchObject({ fn: 'sync-push', device_id: DEVICE_ID, received: 2, accepted: 2, rejected: 0 })
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN)
  })
})

describe('sync-push — lot 3 (réception, pertes)', () => {
  const photo = (dev: string, n: number) => `${dev}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`
  const reception = (over: Record<string, unknown> = {}) => ({
    supplier_id: SUPPLIER_ID,
    vehicle_ok: true,
    packaging_ok: true,
    items: [{ product: 'Steak haché', lot: 'L1', dlc: '2026-11-20', temperature_c: 2.5, storage: 'fridge', accepted: true, photo_paths: [photo(DEVICE_ID, 1)] }],
    photo_paths: [photo(DEVICE_ID, 2)],
    ...over,
  })
  it('accepte une réception et une perte valides (photos pas encore envoyées : non exigé)', async () => {
    const chain = new ChainBuilder()
    const rec = await chain.next({ type: 'reception', payload: reception() })
    const waste = await chain.next({ type: 'waste', payload: { product: 'Crème', reason: 'other', comment: 'pot gonflé', related_record_id: rec.id, photo_paths: [photo(DEVICE_ID, 3)] } })
    const out = await push([rec, waste])
    expect(out.rejected).toEqual([])
    expect(out.accepted.map((a) => a.id)).toEqual([rec.id, waste.id])
  })
  it('fournisseur désactivé mais existant : accepté (saisie hors réseau)', async () => {
    repo.suppliers[0].active = false
    const r = await new ChainBuilder().next({ type: 'reception', payload: reception() })
    expect((await push([r])).rejected).toEqual([])
  })
  it('fournisseur inconnu → quarantaine invalid_payload, la chaîne avance', async () => {
    const chain = new ChainBuilder()
    const bad = await chain.next({ type: 'reception', payload: reception({ supplier_id: newId() }) })
    const ok = await chain.next()
    const out = await push([bad, ok])
    expect(out.rejected).toEqual([{ id: bad.id, reason: 'invalid_payload', detail: expect.stringMatching(/fournisseur inconnu/), quarantined: true }])
    expect(out.accepted.map((a) => a.id)).toEqual([ok.id])
    expect(out.last_device_seq).toBe(2)
    expect(repo.records[0].quarantine_reason).toBe('invalid_payload')
  })
  it('photo d’un autre appareil → quarantaine invalid_payload (réception, ligne, perte)', async () => {
    const chain = new ChainBuilder()
    const top = await chain.next({ type: 'reception', payload: reception({ photo_paths: [photo(OTHER_DEVICE_ID, 9)] }) })
    const line = await chain.next({
      type: 'reception',
      payload: reception({ items: [{ product: 'Pain', storage: 'ambient', accepted: true, photo_paths: [photo(DEVICE_ID, 1), photo(OTHER_DEVICE_ID, 8)] }] }),
    })
    const waste = await chain.next({ type: 'waste', payload: { product: 'Pain', reason: 'damaged', photo_paths: [photo(OTHER_DEVICE_ID, 7)] } })
    const out = await push([top, line, waste])
    expect(out.rejected.map((r) => [r.reason, r.quarantined])).toEqual([
      ['invalid_payload', true],
      ['invalid_payload', true],
      ['invalid_payload', true],
    ])
    expect(out.rejected[1].detail).toMatch(new RegExp(`${OTHER_DEVICE_ID}/.*n’appartient pas à cet appareil`))
    expect(out.last_device_seq).toBe(3)
  })
  it('payload invalide (réception sans ligne, refus sans motif, perte « other » sans commentaire) → quarantaine', async () => {
    const chain = new ChainBuilder()
    const empty = await chain.next({ type: 'reception', payload: reception({ items: [] }) })
    const refused = await chain.next({ type: 'reception', payload: reception({ items: [{ product: 'Glace', storage: 'freezer', accepted: false }] }) })
    const waste = await chain.next({ type: 'waste', payload: { product: 'Pain', reason: 'other' } })
    const out = await push([empty, refused, waste])
    expect(out.rejected.map((r) => r.reason)).toEqual(['invalid_payload', 'invalid_payload', 'invalid_payload'])
    expect(out.rejected[1].detail).toMatch(/refusal_reason/)
    expect(out.rejected[2].detail).toMatch(/comment/)
  })
  it('correction d’une réception : remplacement validé, fournisseur vérifié', async () => {
    const chain = new ChainBuilder()
    const orig = await chain.next({ type: 'reception', payload: reception() })
    const good = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'lot', replacement: reception({ comment: 'lot corrigé' }) } })
    const badSup = await chain.next({ type: 'correction', supersedes_id: good.id, payload: { reason: 'r', replacement: reception({ supplier_id: newId() }) } })
    const badItems = await chain.next({ type: 'correction', supersedes_id: orig.id, payload: { reason: 'r', replacement: reception({ items: [] }) } })
    const out = await push([orig, good, badSup, badItems])
    expect(out.accepted.map((a) => a.id)).toEqual([orig.id, good.id])
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual([
      [badSup.id, 'invalid_payload'],
      [badItems.id, 'invalid_payload'],
    ])
    expect(out.rejected[0].detail).toMatch(/fournisseur inconnu/)
    expect(out.rejected[1].detail).toMatch(/reception.*items/)
  })
  it('correction depuis un autre appareil : reprend les photos de l’enregistrement corrigé, n’en ajoute pas d’étrangères', async () => {
    const orig = await new ChainBuilder().next({ type: 'reception', payload: reception() })
    expect((await push([orig])).accepted).toHaveLength(1)
    const other = new ChainBuilder(OTHER_DEVICE_ID)
    // Reprend une photo de DEVICE_ID (héritée) et en ajoute une de l'appareil qui corrige.
    const keep = await other.next({
      type: 'correction',
      supersedes_id: orig.id,
      payload: { reason: 'DLC', replacement: reception({ photo_paths: [photo(DEVICE_ID, 2), photo(OTHER_DEVICE_ID, 5)] }) },
    })
    // Correction de correction : héritage à travers toute la chaîne de corrections.
    const keep2 = await other.next({ type: 'correction', supersedes_id: keep.id, payload: { reason: 'r', replacement: reception() } })
    const foreign = await other.next({
      type: 'correction',
      supersedes_id: orig.id,
      payload: { reason: 'r', replacement: reception({ photo_paths: [photo(DEVICE_ID, 99)] }) },
    })
    const out = await push([keep, keep2, foreign], OTHER_DEVICE_ID, OTHER_TOKEN)
    expect(out.accepted.map((a) => a.id)).toEqual([keep.id, keep2.id])
    expect(out.rejected).toEqual([{ id: foreign.id, reason: 'invalid_payload', detail: expect.stringMatching(/n’appartient pas/), quarantined: true }])
  })
  it('met en cache le contrôle du fournisseur dans un lot', async () => {
    const chain = new ChainBuilder()
    const recs = [await chain.next({ type: 'reception', payload: reception() }), await chain.next({ type: 'reception', payload: reception() })]
    expect((await push(recs)).accepted).toHaveLength(2)
    expect(repo.calls.supplierExists).toBe(1)
  })
})
