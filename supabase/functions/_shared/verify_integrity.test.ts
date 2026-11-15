// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { computeRecordHash } from '../../../shared/canonical.ts'
import type { IntegrityReport } from '../../../shared/payloads.ts'
import { GENESIS_HASH } from '../../../shared/types.ts'
import { memoryLogger, NOW } from './test_helpers.ts'
import {
  canonicalDeviceTime,
  createVerifyIntegrityHandler,
  INTEGRITY_LIMITS,
  verifyRegistry,
  type ChainAnchor,
  type IntegrityRecordRow,
  type IntegrityRepo,
} from './verify_integrity.ts'

const MANAGER = '00000000-0000-4000-8000-00000000aaaa'
const EMPLOYEE = '00000000-0000-4000-8000-00000000bbbb'
const D1 = '00000000-0000-4000-8000-0000000000d1'
const D2 = '00000000-0000-4000-8000-0000000000d2'
const D3 = '00000000-0000-4000-8000-0000000000d3'
const STAFF = '00000000-0000-4000-8000-0000000000a1'

class MemoryIntegrityRepo implements IntegrityRepo {
  managers = new Set<string>([MANAGER])
  jwts = new Map<string, string>([
    ['jwt-manager', MANAGER],
    ['jwt-employee', EMPLOYEE],
  ])
  devices: { id: string; name: string }[] = []
  anchors: ChainAnchor[] = []
  records: IntegrityRecordRow[] = []
  audits: { userId: string; summary: Record<string, unknown> }[] = []
  pageCalls = 0
  failAudit = false

  async getUserIdFromJwt(jwt: string) {
    return this.jwts.get(jwt) ?? null
  }
  async isManager(userId: string) {
    return this.managers.has(userId)
  }
  async listDevicesForIntegrity() {
    return this.devices
  }
  async listChainAnchors() {
    return this.anchors
  }
  async listDeviceRecords(deviceId: string, afterSeq: number, limit: number) {
    this.pageCalls++
    return this.records
      .filter((r) => r.device_id === deviceId && r.device_seq > afterSeq)
      .sort((a, b) => a.device_seq - b.device_seq)
      .slice(0, limit)
      .map((r) => structuredClone(r))
  }
  async recordIntegrityCheck(userId: string, summary: Record<string, unknown>) {
    if (this.failAudit) throw new Error('db down')
    this.audits.push({ userId, summary })
  }
}

let seqId = 0
function uuid(): string {
  seqId++
  return `00000000-0000-4000-8000-${seqId.toString(16).padStart(12, '0')}`
}

/** Construit une chaîne valide de n maillons ; device_time relu au format PostgREST (+00:00). */
async function chain(deviceId: string, n: number, opts: { startSeq?: number; prevHash?: string } = {}): Promise<IntegrityRecordRow[]> {
  const out: IntegrityRecordRow[] = []
  let prev = opts.prevHash ?? GENESIS_HASH
  const start = opts.startSeq ?? 1
  for (let i = 0; i < n; i++) {
    const seq = start + i
    const deviceTime = new Date(Date.UTC(2026, 10, 1, 8, 0, 0, 0) + seq * 60_000 + 123).toISOString()
    const core = {
      id: uuid(),
      type: 'temperature_check' as const,
      payload: { equipment_id: '00000000-0000-4000-8000-0000000000e1', value_c: 3.5, in_range: true, nested: { b: 1, a: [1, 2] } },
      author_id: STAFF,
      device_id: deviceId,
      device_seq: seq,
      device_time: deviceTime,
      prev_hash: prev,
      supersedes_id: null,
    }
    const hash = await computeRecordHash(core)
    out.push({ ...core, device_time: deviceTime.replace('Z', '+00:00'), hash })
    prev = hash
  }
  return out
}

let repo: MemoryIntegrityRepo
beforeEach(() => {
  repo = new MemoryIntegrityRepo()
  repo.devices = [
    { id: D1, name: 'Tablette' },
    { id: D2, name: 'iPhone' },
  ]
})

describe('canonicalDeviceTime', () => {
  it('remet le timestamptz relu au format toISOString()', () => {
    expect(canonicalDeviceTime('2026-11-14T10:00:00.1+00:00')).toBe('2026-11-14T10:00:00.100Z')
    expect(canonicalDeviceTime('2026-11-14T11:00:00+01:00')).toBe('2026-11-14T10:00:00.000Z')
    expect(canonicalDeviceTime('n/a')).toBeNull()
  })
})

describe('verifyRegistry', () => {
  it('registre intact (plusieurs appareils) : ok, compteurs et bornes', async () => {
    repo.records = [...(await chain(D1, 5)), ...(await chain(D2, 3))]
    const { report } = await verifyRegistry(repo, NOW)
    expect(report).toMatchObject({ checked_at: NOW.toISOString(), total_records: 8, anchors_used: 0, ok: true })
    // Tri par nom : iPhone puis Tablette.
    expect(report.devices.map((d) => [d.device_name, d.records, d.first_seq, d.last_seq, d.ok])).toEqual([
      ['iPhone', 3, 1, 3, true],
      ['Tablette', 5, 1, 5, true],
    ])
    expect(report.devices.every((d) => d.problems.length === 0)).toBe(true)
  })

  it('appareil sans enregistrement : listé, 0, ok', async () => {
    repo.records = await chain(D1, 2)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((d) => d.device_id === D2)).toMatchObject({ records: 0, first_seq: 0, last_seq: 0, ok: true, problems: [] })
    expect(report.ok).toBe(true)
  })

  it('payload altéré en base (hash conservé) : hash_mismatch sur ce seul maillon', async () => {
    repo.records = await chain(D1, 4)
    ;(repo.records[1].payload as Record<string, unknown>).value_c = 2.5
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.ok).toBe(false)
    const d = report.devices.find((x) => x.device_id === D1)!
    expect(d.problems).toEqual([{ device_seq: 2, record_id: repo.records[1].id, problem: 'hash_mismatch' }])
    expect(report.devices.find((x) => x.device_id === D2)!.ok).toBe(true)
  })

  it('autres champs altérés (device_time, auteur) : hash_mismatch', async () => {
    repo.records = await chain(D1, 3)
    repo.records[0].device_time = '2026-11-01T08:01:00.124+00:00'
    repo.records[2].author_id = '00000000-0000-4000-8000-0000000000a9'
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems.map((p) => [p.device_seq, p.problem])).toEqual([
      [1, 'hash_mismatch'],
      [3, 'hash_mismatch'],
    ])
  })

  it('maillon réécrit avec un hash recalculé : le suivant casse la chaîne (broken_chain)', async () => {
    repo.records = await chain(D1, 4)
    const r = repo.records[1]
    ;(r.payload as Record<string, unknown>).value_c = 9.9
    r.hash = await computeRecordHash({ ...r, device_time: canonicalDeviceTime(r.device_time)! } as never)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([
      { device_seq: 3, record_id: repo.records[2].id, problem: 'broken_chain' },
    ])
  })

  it('genèse différente de GENESIS_HASH : broken_chain sur le premier', async () => {
    repo.records = await chain(D1, 2, { prevHash: 'f'.repeat(64) })
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([
      { device_seq: 1, record_id: repo.records[0].id, problem: 'broken_chain' },
    ])
  })

  it('maillon supprimé (trou) : seq_gap sur le suivant', async () => {
    const all = await chain(D1, 5)
    repo.records = all.filter((r) => r.device_seq !== 3)
    const { report } = await verifyRegistry(repo, NOW)
    const d = report.devices.find((x) => x.device_id === D1)!
    expect(d).toMatchObject({ records: 4, first_seq: 1, last_seq: 5, ok: false })
    expect(d.problems).toEqual([{ device_seq: 4, record_id: all[3].id, problem: 'seq_gap' }])
  })

  it('début de chaîne supprimé sans ancre : seq_gap sur le premier présent', async () => {
    const all = await chain(D1, 4)
    repo.records = all.slice(2)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([{ device_seq: 3, record_id: all[2].id, problem: 'seq_gap' }])
  })

  it('purge de conservation avec ancre : la chaîne reprend à l\'ancre, anchors_used', async () => {
    const all = await chain(D1, 6)
    repo.anchors = [{ device_id: D1, device_seq: 3, hash: all[2].hash }]
    repo.records = all.slice(3)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.ok).toBe(true)
    expect(report.anchors_used).toBe(1)
    expect(report.devices.find((x) => x.device_id === D1)).toMatchObject({ records: 3, first_seq: 4, last_seq: 6, ok: true })
  })

  it('purge : original expiré conservé sous l\'ancre (cité par une correction) → pas d\'anomalie, hash vérifié', async () => {
    const all = await chain(D1, 8)
    repo.anchors = [{ device_id: D1, device_seq: 5, hash: all[4].hash }]
    // 2 conservé (isolé), 3 conservé (lié à 2), 4 et 5 purgés, 6..8 conservés.
    repo.records = [all[1], all[2], ...all.slice(5)]
    let { report } = await verifyRegistry(repo, NOW)
    expect(report.ok).toBe(true)
    expect(report.devices.find((x) => x.device_id === D1)).toMatchObject({ records: 5, first_seq: 2, last_seq: 8 })
    // Un original conservé altéré reste détecté.
    ;(repo.records[0].payload as Record<string, unknown>).value_c = 0
    ;({ report } = await verifyRegistry(repo, NOW))
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([{ device_seq: 2, record_id: all[1].id, problem: 'hash_mismatch' }])
  })

  it('purge : ancre qui ne correspond pas au maillon suivant → broken_chain', async () => {
    const all = await chain(D1, 4)
    repo.anchors = [{ device_id: D1, device_seq: 2, hash: 'a'.repeat(64) }]
    repo.records = all.slice(2)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([{ device_seq: 3, record_id: all[2].id, problem: 'broken_chain' }])
  })

  it('purge : trou après l\'ancre → seq_gap', async () => {
    const all = await chain(D1, 6)
    repo.anchors = [{ device_id: D1, device_seq: 2, hash: all[1].hash }]
    repo.records = all.slice(3) // 3 manquant
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.devices.find((x) => x.device_id === D1)!.problems).toEqual([{ device_seq: 4, record_id: all[3].id, problem: 'seq_gap' }])
  })

  it('purge : tout purgé (ancre seule) → ok, 0 enregistrement', async () => {
    const all = await chain(D1, 3)
    repo.anchors = [{ device_id: D1, device_seq: 3, hash: all[2].hash }]
    const { report } = await verifyRegistry(repo, NOW)
    expect(report).toMatchObject({ ok: true, total_records: 0, anchors_used: 1 })
  })

  it('plusieurs appareils : une anomalie sur l\'un ne touche pas l\'autre ; enregistrement d\'un autre appareil → hash_mismatch', async () => {
    repo.devices.push({ id: D3, name: 'Caisse' })
    const c1 = await chain(D1, 3)
    const c2 = await chain(D2, 3)
    const c3 = await chain(D3, 2)
    c2[2].prev_hash = c2[0].hash // lien falsifié (hash non recalculé)
    repo.records = [...c1, ...c2, ...c3]
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.ok).toBe(false)
    expect(report.total_records).toBe(8)
    const byId = new Map(report.devices.map((d) => [d.device_id, d]))
    expect(byId.get(D1)!.ok).toBe(true)
    expect(byId.get(D3)!.ok).toBe(true)
    expect(byId.get(D2)!.problems.map((p) => p.problem).sort()).toEqual(['broken_chain', 'hash_mismatch'])
  })

  it('quarantaine (type hors contrat) : haché tel quel, chaîne continue', async () => {
    const c = await chain(D1, 1)
    const core = {
      id: uuid(),
      type: 'mystere' as never,
      payload: { x: 1 },
      author_id: '00000000-0000-4000-8000-0000000000ff',
      device_id: D1,
      device_seq: 2,
      device_time: '2026-11-02T00:00:00.000Z',
      prev_hash: c[0].hash,
      supersedes_id: null,
    }
    repo.records = [...c, { ...core, hash: await computeRecordHash(core) }]
    expect((await verifyRegistry(repo, NOW)).report.ok).toBe(true)
  })

  it('pagination : relit tout par pages de pageSize, sans trou artificiel', async () => {
    const n = INTEGRITY_LIMITS.pageSize * 2 + 5
    repo.records = await chain(D1, n)
    const { report } = await verifyRegistry(repo, NOW)
    expect(report.ok).toBe(true)
    expect(report.devices.find((x) => x.device_id === D1)).toMatchObject({ records: n, first_seq: 1, last_seq: n })
    // D1 : 3 pages ; D2 : 1 page vide.
    expect(repo.pageCalls).toBe(4)
  }, 30_000)

  it('liste d\'anomalies bornée par appareil', async () => {
    const all = await chain(D1, INTEGRITY_LIMITS.maxProblemsPerDevice + 10)
    for (const r of all) r.hash = 'b'.repeat(64)
    repo.records = all
    const run = await verifyRegistry(repo, NOW)
    const d = run.report.devices.find((x) => x.device_id === D1)!
    expect(d.problems).toHaveLength(INTEGRITY_LIMITS.maxProblemsPerDevice)
    expect(run.problemCounts.get(D1)).toBeGreaterThan(INTEGRITY_LIMITS.maxProblemsPerDevice)
  }, 30_000)
})

describe('verify-integrity (HTTP)', () => {
  function req(jwt: string | null = 'jwt-manager', method = 'POST'): Request {
    const headers: Record<string, string> = {}
    if (jwt) headers.authorization = `Bearer ${jwt}`
    return new Request('https://fn.example/verify-integrity', { method, headers })
  }

  it('gérant : 200 IntegrityReport + résumé VERIFY_INTEGRITY journalisé', async () => {
    repo.records = [...(await chain(D1, 3)), ...(await chain(D2, 2))]
    repo.records[0].hash = 'c'.repeat(64)
    const logger = memoryLogger()
    const handler = createVerifyIntegrityHandler({ repo, logger, allowedOrigins: [], now: () => NOW })
    const res = await handler(req())
    expect(res.status).toBe(200)
    const body = (await res.json()) as IntegrityReport
    expect(body.ok).toBe(false)
    expect(body.total_records).toBe(5)
    expect(repo.audits).toHaveLength(1)
    expect(repo.audits[0].userId).toBe(MANAGER)
    expect(repo.audits[0].summary).toMatchObject({ ok: false, total_records: 5, devices: 2, problems: 2, anchors_used: 0 })
    // Le résumé ne contient aucun payload.
    expect(JSON.stringify(repo.audits[0].summary)).not.toContain('equipment_id')
    expect(logger.lines.some((l) => l.event === 'verify_integrity' && l.level === 'warn')).toBe(true)
  })

  it('GET accepté aussi', async () => {
    const handler = createVerifyIntegrityHandler({ repo, logger: memoryLogger(), allowedOrigins: [] })
    expect((await handler(req('jwt-manager', 'GET'))).status).toBe(200)
  })

  it('sans JWT / JWT inconnu : 401 ; non-gérant : 403 ; rien n\'est lu ni journalisé', async () => {
    const handler = createVerifyIntegrityHandler({ repo, logger: memoryLogger(), allowedOrigins: [] })
    expect((await handler(req(null))).status).toBe(401)
    expect((await handler(req('jwt-inconnu'))).status).toBe(401)
    const res = await handler(req('jwt-employee'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
    expect(repo.pageCalls).toBe(0)
    expect(repo.audits).toHaveLength(0)
  })

  it('échec du journal : le rapport est quand même rendu, erreur journalisée', async () => {
    repo.failAudit = true
    const logger = memoryLogger()
    const handler = createVerifyIntegrityHandler({ repo, logger, allowedOrigins: [] })
    const res = await handler(req())
    expect(res.status).toBe(200)
    expect(logger.lines.some((l) => l.event === 'verify_integrity_audit_failed' && l.level === 'error')).toBe(true)
  })

  it('méthode non autorisée : 405', async () => {
    const handler = createVerifyIntegrityHandler({ repo, logger: memoryLogger(), allowedOrigins: [] })
    expect((await handler(req('jwt-manager', 'DELETE'))).status).toBe(405)
  })
})
