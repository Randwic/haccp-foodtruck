// verify-integrity (lot 7) : preuve d'intégrité du registre pour un contrôle sanitaire.
// GET|POST /functions/v1/verify-integrity   Authorization: Bearer <JWT du gérant>
//
// Relit TOUT `records`, appareil par appareil, dans l'ordre de `device_seq` (pages bornées), et :
//  1. recalcule chaque hash (`computeRecordHash`, device_time remis au format canonique
//     `toISOString()` comme dans sync-push) → `hash_mismatch` ;
//  2. vérifie le chaînage : `prev_hash` = hash STOCKÉ du maillon `device_seq - 1`, `GENESIS_HASH`
//     pour le premier, ou l'ancre de purge (`record_chain_anchors`) après une purge de
//     conservation → `broken_chain` ;
//  3. vérifie l'absence de trou dans la numérotation → `seq_gap`.
// Après une purge, des originaux expirés sont conservés parce qu'une correction encore conservée
// les cite : ils sont isolés sous l'ancre, leur hash est vérifié, leur lien vers un maillon purgé
// ne peut pas l'être (ce n'est pas une anomalie).
// Limite : la suppression des derniers maillons d'une chaîne n'est pas détectable ici (aucun
// maillon suivant ne les cite) ; elle est empêchée par les triggers de la base.
import { computeRecordHash } from '../../../shared/canonical.ts'
import type { IntegrityReport } from '../../../shared/payloads.ts'
import { GENESIS_HASH } from '../../../shared/types.ts'
import { bearerToken } from './auth.ts'
import { HttpError, jsonResponse, withHttp, type HttpEnv } from './http.ts'

export const INTEGRITY_LIMITS = {
  /** Enregistrements par page (≤ max_rows de PostgREST). */
  pageSize: 1000,
  /** Anomalies détaillées par appareil (au-delà : comptées dans ok = false, non listées). */
  maxProblemsPerDevice: 1000,
} as const

export type IntegrityProblem = IntegrityReport['devices'][number]['problems'][number]
export type IntegrityDevice = IntegrityReport['devices'][number]

/** Colonnes de `records` nécessaires au recalcul du hash (valeurs telles que relues en base). */
export interface IntegrityRecordRow {
  id: string
  type: string
  payload: unknown
  author_id: string
  device_id: string
  device_seq: number
  /** timestamptz relu (ex. `2026-11-14T10:00:00.123+00:00`) : remis au format canonique. */
  device_time: string
  prev_hash: string
  hash: string
  supersedes_id: string | null
}

export interface ChainAnchor {
  device_id: string
  device_seq: number
  hash: string
}

export interface IntegrityRepo {
  getUserIdFromJwt(jwt: string): Promise<string | null>
  isManager(userId: string): Promise<boolean>
  /** Tous les appareils (révoqués compris). */
  listDevicesForIntegrity(): Promise<{ id: string; name: string }[]>
  listChainAnchors(): Promise<ChainAnchor[]>
  /** Enregistrements de l'appareil avec device_seq > afterSeq, triés par device_seq croissant, `limit` au plus. */
  listDeviceRecords(deviceId: string, afterSeq: number, limit: number): Promise<IntegrityRecordRow[]>
  /** `record_integrity_check(user, résumé)` : action VERIFY_INTEGRITY dans audit_log. */
  recordIntegrityCheck(userId: string, summary: Record<string, unknown>): Promise<void>
}

/** device_time canonique (celui qui a été haché par l'app), null si illisible. */
export function canonicalDeviceTime(v: string): string | null {
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export async function recordHashMatches(r: IntegrityRecordRow): Promise<boolean> {
  const device_time = canonicalDeviceTime(r.device_time)
  if (device_time === null) return false
  try {
    const hash = await computeRecordHash({
      id: r.id,
      type: r.type as never, // quarantaine `unknown_type` : type hors contrat, haché tel quel
      payload: r.payload as never,
      author_id: r.author_id,
      device_id: r.device_id,
      device_seq: r.device_seq,
      device_time,
      prev_hash: r.prev_hash,
      supersedes_id: r.supersedes_id,
    })
    return hash === r.hash
  } catch {
    return false // payload non sérialisable (ne devrait pas arriver avec du jsonb)
  }
}

/**
 * Vérification en flux de la chaîne d'UN appareil : les enregistrements arrivent triés par
 * device_seq ; seul le maillon précédent est gardé en mémoire.
 */
export class DeviceChainVerifier {
  private prev: { seq: number; hash: string } | null = null
  private count = 0
  private firstSeq = 0
  private lastSeq = 0
  private problemCount = 0
  private readonly problems: IntegrityProblem[] = []

  readonly deviceId: string
  readonly deviceName: string
  private readonly anchor: ChainAnchor | null

  constructor(deviceId: string, deviceName: string, anchor: ChainAnchor | null) {
    this.deviceId = deviceId
    this.deviceName = deviceName
    this.anchor = anchor
  }

  private flag(r: IntegrityRecordRow, problem: IntegrityProblem['problem']): void {
    this.problemCount++
    if (this.problems.length < INTEGRITY_LIMITS.maxProblemsPerDevice) {
      this.problems.push({ device_seq: r.device_seq, record_id: r.id, problem })
    }
  }

  async add(r: IntegrityRecordRow): Promise<void> {
    const seq = r.device_seq
    if (this.count === 0) this.firstSeq = seq
    this.count++
    this.lastSeq = seq

    if (r.device_id !== this.deviceId || !(await recordHashMatches(r))) this.flag(r, 'hash_mismatch')

    const anchor = this.anchor
    if (this.prev && seq <= this.prev.seq) {
      // Doublon / désordre (impossible avec la contrainte d'unicité) : chaîne incohérente.
      this.flag(r, 'broken_chain')
    } else if (anchor && seq === anchor.device_seq) {
      // Le maillon ancré a été purgé : s'il réapparaît, ce doit être exactement lui.
      if (r.hash !== anchor.hash) this.flag(r, 'broken_chain')
    } else if (seq === 1) {
      if (r.prev_hash !== GENESIS_HASH) this.flag(r, 'broken_chain')
    } else if (this.prev && this.prev.seq === seq - 1) {
      if (r.prev_hash !== this.prev.hash) this.flag(r, 'broken_chain')
    } else if (anchor && anchor.device_seq === seq - 1) {
      if (r.prev_hash !== anchor.hash) this.flag(r, 'broken_chain')
    } else if (anchor && seq < anchor.device_seq) {
      // Original expiré conservé (cité par une correction) : son prédécesseur a été purgé.
    } else {
      this.flag(r, 'seq_gap')
    }
    this.prev = { seq, hash: r.hash }
  }

  result(): IntegrityDevice {
    return {
      device_id: this.deviceId,
      device_name: this.deviceName,
      records: this.count,
      first_seq: this.firstSeq,
      last_seq: this.lastSeq,
      ok: this.problemCount === 0,
      problems: this.problems,
    }
  }

  /** Nombre total d'anomalies (y compris au-delà de la liste détaillée). */
  get totalProblems(): number {
    return this.problemCount
  }
}

export interface IntegrityRun {
  report: IntegrityReport
  /** Anomalies par appareil, non tronquées. */
  problemCounts: Map<string, number>
}

/** Relit tout le registre via le repo (pagination par device_seq) et construit le rapport. */
export async function verifyRegistry(repo: IntegrityRepo, now: Date): Promise<IntegrityRun> {
  const [devices, anchors] = await Promise.all([repo.listDevicesForIntegrity(), repo.listChainAnchors()])
  const anchorByDevice = new Map(anchors.map((a) => [a.device_id, a]))
  const sorted = [...devices].sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id))
  const out: IntegrityDevice[] = []
  const problemCounts = new Map<string, number>()
  let total = 0
  let anchorsUsed = 0

  for (const d of sorted) {
    const anchor = anchorByDevice.get(d.id) ?? null
    if (anchor) anchorsUsed++
    const v = new DeviceChainVerifier(d.id, d.name, anchor)
    let after = 0
    for (;;) {
      const page = await repo.listDeviceRecords(d.id, after, INTEGRITY_LIMITS.pageSize)
      for (const r of page) await v.add(r)
      if (page.length < INTEGRITY_LIMITS.pageSize) break
      const last = page[page.length - 1].device_seq
      if (!(last > after)) throw new Error('verify-integrity : pagination sans progression')
      after = last
    }
    const res = v.result()
    total += res.records
    problemCounts.set(d.id, v.totalProblems)
    out.push(res)
  }

  return {
    report: {
      checked_at: now.toISOString(),
      total_records: total,
      devices: out,
      anchors_used: anchorsUsed,
      ok: out.every((d) => d.ok),
    },
    problemCounts,
  }
}

/** Résumé journalisé dans audit_log (sans payload, sans liste détaillée au-delà de 20 anomalies). */
export function integritySummary(run: IntegrityRun): Record<string, unknown> {
  const { report } = run
  const problems = [...run.problemCounts.values()].reduce((a, b) => a + b, 0)
  return {
    ok: report.ok,
    checked_at: report.checked_at,
    total_records: report.total_records,
    devices: report.devices.length,
    anchors_used: report.anchors_used,
    problems,
    by_device: report.devices.map((d) => ({
      device_id: d.device_id,
      records: d.records,
      first_seq: d.first_seq,
      last_seq: d.last_seq,
      problems: run.problemCounts.get(d.device_id) ?? 0,
    })),
    first_problems: report.devices.flatMap((d) => d.problems.map((p) => ({ device_id: d.device_id, ...p }))).slice(0, 20),
  }
}

export interface VerifyIntegrityDeps extends HttpEnv {
  repo: IntegrityRepo
}

export function createVerifyIntegrityHandler(deps: VerifyIntegrityDeps): (req: Request) => Promise<Response> {
  return withHttp('verify-integrity', ['GET', 'POST'], deps, async (req, ctx) => {
    const jwt = bearerToken(req)
    if (!jwt) throw new HttpError(401, 'unauthorized')
    const userId = await deps.repo.getUserIdFromJwt(jwt)
    if (!userId) throw new HttpError(401, 'unauthorized')
    if (!(await deps.repo.isManager(userId))) {
      ctx.logger.log('warn', 'verify_integrity_forbidden', { user_id: userId })
      throw new HttpError(403, 'forbidden', 'réservé au gérant')
    }

    const run = await verifyRegistry(deps.repo, ctx.now())
    const summary = integritySummary(run)
    try {
      await deps.repo.recordIntegrityCheck(userId, summary)
    } catch (e) {
      // Le rapport reste rendu (il est la preuve demandée) ; l'échec du journal est tracé.
      ctx.logger.log('error', 'verify_integrity_audit_failed', { error: e instanceof Error ? e.message : String(e) })
    }
    ctx.logger.log(run.report.ok ? 'info' : 'warn', 'verify_integrity', {
      user_id: userId,
      ok: run.report.ok,
      total_records: run.report.total_records,
      devices: run.report.devices.length,
      problems: summary.problems,
      anchors_used: run.report.anchors_used,
    })
    return jsonResponse(200, run.report)
  })
}
