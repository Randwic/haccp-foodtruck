// sync-push : réception des enregistrements d'un appareil et vérification de sa chaîne de hachage.
import { computeRecordHash } from '../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord, type RecordType, type RejectReason, type SyncPushResponse } from '../../../shared/types.ts'
import { isPlainObject, isUuid, validatePayload, validateRecordSemantics, validateRecordStructure } from '../../../shared/validation.ts'
import { authenticateDevice } from './auth.ts'
import { HttpError, jsonResponse, readJsonBody, withHttp, type HttpEnv, type Logger } from './http.ts'
import type { ChainHead, DeviceRow, PushRepo, QuarantineReason, StoredRecord } from './repo.ts'

export const PUSH_LIMITS = {
  maxRecords: 500,
  maxBodyBytes: 1024 * 1024,
  /** Profondeur max de remontée correction → correction → … → original. */
  maxCorrectionDepth: 20,
} as const

type Accepted = SyncPushResponse['accepted'][number]
type Rejected = SyncPushResponse['rejected'][number]

export interface PushContext {
  now: () => Date
  logger: Logger
}

/** Raison renvoyée au client pour un enregistrement en quarantaine (marqué `quarantined: true`). */
export function quarantineToRejectReason(q: QuarantineReason): RejectReason {
  return q
}

/** Préfixe du `detail` d'un rejet par quarantaine : l'enregistrement EST stocké, la chaîne a avancé. */
export function quarantineDetail(q: QuarantineReason, detail: string): string {
  return `quarantaine[${q}] (enregistré, chaîne avancée) : ${detail}`
}

/** Contrôle de l'enveloppe { device_id, records } ; renvoie les enregistrements bruts (non typés). */
export function parsePushRequest(body: unknown, device: DeviceRow): unknown[] {
  if (!isPlainObject(body)) throw new HttpError(400, 'invalid_request', 'objet JSON attendu')
  if (typeof body.device_id !== 'string') throw new HttpError(400, 'invalid_request', 'device_id manquant')
  if (body.device_id !== device.id) throw new HttpError(403, 'device_mismatch', 'device_id ne correspond pas au jeton')
  if (!Array.isArray(body.records)) throw new HttpError(400, 'invalid_request', 'records : tableau attendu')
  if (body.records.length > PUSH_LIMITS.maxRecords) {
    throw new HttpError(413, 'too_many_records', `${PUSH_LIMITS.maxRecords} enregistrements maximum par requête`)
  }
  return body.records
}

function idOf(r: unknown): string {
  return isPlainObject(r) && typeof r.id === 'string' ? r.id.slice(0, 64) : ''
}

type ContentVerdict = { ok: true } | { ok: false; quarantine: QuarantineReason; detail: string }

/**
 * Traite les enregistrements dans l'ordre reçu. Deux familles de refus :
 *
 * A. Intégrité (rien n'est stocké, la chaîne n'avance pas, la suite du lot est refusée en
 *    `broken_chain`) — structure non stockable, appartenance à l'appareil, `invalid_hash`,
 *    `id_conflict`, `seq_gap`, `broken_chain`, refus définitif de la base.
 * B. Contenu, sur une chaîne intègre : l'enregistrement est INSÉRÉ avec `quarantine_reason`
 *    (`unknown_type`, `unknown_author` — inconnu ou désactivé —, `supersedes_not_found`,
 *    `invalid_payload`), la chaîne avance, et la réponse le place dans `rejected` (raison du
 *    contrat, détail préfixé `quarantaine[...]`). Ainsi un équipier désactivé pendant une tournée
 *    hors réseau ne bloque pas pour toujours la chaîne de la tablette.
 *
 * Ordre : 1 structure → 2 hash → 3 idempotence (même id : même hash = rejeu, réponse identique à
 * la première ; sinon `id_conflict`) → 4 chaîne → 5 contenu → 6 insertion. L'idempotence passe
 * avant le contenu : un rejeu reste accepté même si l'équipier a été désactivé depuis.
 *
 * La base revérifie à l'insertion (trigger, messages `HACCP: …`) ; jamais de 500 pour ces cas :
 *  - violation d'unicité (envoi concurrent) → relecture, réponse identique au rejeu ou refus ;
 *  - `seq_gap` / `broken_chain` / `device_revoked` → refus d'intégrité (tête relue) ;
 *  - `unknown_author` / `supersedes_not_found` → nouvelle insertion en quarantaine.
 * `server_time` et `clock_suspect` sont imposés par le trigger et relus après insertion.
 */
export async function processPush(device: DeviceRow, rawRecords: unknown[], repo: PushRepo, ctx: PushContext): Promise<SyncPushResponse> {
  const accepted: Accepted[] = []
  const rejected: Rejected[] = []

  let head: ChainHead = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }

  // Pré-chargement des id déjà connus (une requête au lieu d'une par enregistrement).
  const candidateIds = [...new Set(rawRecords.map(idOf).filter(isUuid))]
  const known = new Map<string, StoredRecord>()
  if (candidateIds.length > 0) for (const s of await repo.getRecordsByIds(candidateIds)) known.set(s.id, s)

  const caches: ContentCaches = { staff: new Map(), equipment: new Map() }
  const state: { blockedBy: { id: string; reason: RejectReason } | null } = { blockedBy: null }

  /** Refus d'intégrité : rien n'est stocké et la suite du lot est bloquée. */
  const reject = (id: string, reason: RejectReason, detail?: string) => {
    rejected.push(detail ? { id, reason, detail } : { id, reason })
    state.blockedBy ??= { id, reason }
  }
  /** Réponse pour un enregistrement stocké (nouveau ou rejeu). */
  const respondStored = (s: StoredRecord, detailIfQuarantine: string) => {
    if (s.quarantine_reason) {
      rejected.push({ id: s.id, reason: quarantineToRejectReason(s.quarantine_reason), detail: quarantineDetail(s.quarantine_reason, detailIfQuarantine), quarantined: true })
    } else {
      accepted.push({ id: s.id, server_time: s.server_time, clock_suspect: s.clock_suspect })
    }
  }

  for (const raw of rawRecords) {
    const id = idOf(raw)
    const b = state.blockedBy
    if (b) {
      rejected.push({ id, reason: 'broken_chain', detail: `bloqué par le refus de ${b.id || '(sans id)'} (${b.reason})` })
      continue
    }

    // 1. Structure (stockable, hachable) et appartenance à l'appareil
    const structure = validateRecordStructure(raw)
    if (!structure.ok) {
      reject(id, structure.reason, structure.detail)
      continue
    }
    const r = raw as unknown as HaccpRecord
    if (r.device_id !== device.id) {
      reject(id, 'invalid_record', 'device_id de l’enregistrement différent de l’appareil authentifié')
      continue
    }

    // 2. Hash
    let computed: string
    try {
      computed = await computeRecordHash(r)
    } catch {
      reject(id, 'invalid_record', 'contenu non hachable')
      continue
    }
    if (computed !== r.hash) {
      reject(id, 'invalid_hash', 'le hash ne correspond pas au contenu')
      continue
    }

    // 3. Idempotence
    const prior = known.get(r.id)
    if (prior) {
      if (prior.hash === r.hash) respondStored(prior, 'déjà reçu')
      else reject(id, 'id_conflict', 'id déjà utilisé par un autre enregistrement')
      continue
    }

    // 4. Chaîne
    if (r.device_seq !== head.device_seq + 1) {
      reject(id, 'seq_gap', `device_seq attendu : ${head.device_seq + 1}, reçu : ${r.device_seq}`)
      continue
    }
    if (r.prev_hash !== head.hash) {
      reject(id, 'broken_chain', 'prev_hash différent du hash de l’enregistrement précédent')
      continue
    }

    // 5. Contenu → quarantaine éventuelle
    let verdict = await checkContent(r, repo, caches)
    let quarantine: QuarantineReason | null = verdict.ok ? null : verdict.quarantine

    // 6. Insertion (server_time et clock_suspect sont imposés par le trigger puis relus)
    const row = {
      id: r.id,
      type: r.type,
      payload: r.payload,
      author_id: r.author_id,
      device_id: r.device_id,
      device_seq: r.device_seq,
      device_time: r.device_time,
      prev_hash: r.prev_hash,
      hash: r.hash,
      supersedes_id: r.supersedes_id,
    }
    let ins = await repo.insertRecord({ ...row, quarantine_reason: quarantine })
    if (!ins.ok && ins.kind === 'content' && quarantine === null) {
      // La base a vu un auteur / une cible disparus entre nos contrôles et l'insertion : quarantaine.
      ctx.logger.log('warn', 'db_content_check', { record_id: r.id, quarantine_reason: ins.quarantine })
      verdict = { ok: false, quarantine: ins.quarantine, detail: ins.quarantine === 'unknown_author' ? 'auteur inconnu' : 'supersedes_id : enregistrement corrigé introuvable' }
      quarantine = ins.quarantine
      ins = await repo.insertRecord({ ...row, quarantine_reason: quarantine })
    }
    if (ins.ok) {
      const stored: StoredRecord = {
        ...row,
        server_time: ins.server_time,
        clock_suspect: ins.clock_suspect,
        quarantine_reason: quarantine,
      }
      known.set(r.id, stored)
      head = { device_seq: r.device_seq, hash: r.hash }
      respondStored(stored, verdict.ok ? '' : verdict.detail)
      if (quarantine) ctx.logger.log('warn', 'record_quarantined', { record_id: r.id, device_id: device.id, quarantine_reason: quarantine })
      if (ins.clock_suspect) ctx.logger.log('warn', 'clock_suspect', { record_id: r.id, device_id: device.id })
      continue
    }
    if (ins.kind === 'integrity') {
      // Filet de sécurité de la base : la chaîne a bougé (ou l'appareil a été révoqué) entre-temps.
      ctx.logger.log('warn', 'db_integrity_check', { record_id: r.id, reason: ins.reason })
      head = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }
      reject(id, ins.reason, ins.reason === 'device_revoked' ? 'appareil révoqué' : 'refusé par la vérification de chaîne de la base')
      continue
    }
    if (ins.kind === 'rejected' || ins.kind === 'content') {
      ctx.logger.log('warn', 'db_rejected_record', { record_id: r.id, detail: ins.detail })
      reject(id, 'invalid_record', 'refusé par la base de données')
      continue
    }

    // Violation d'unicité : un envoi concurrent est passé avant nous. On relit pour répondre juste.
    ctx.logger.log('info', 'concurrent_insert', { record_id: r.id, device_id: device.id })
    const [again] = await repo.getRecordsByIds([r.id])
    head = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }
    if (again) {
      known.set(again.id, again)
      if (again.hash === r.hash) respondStored(again, verdict.ok ? 'déjà reçu' : verdict.detail)
      else reject(id, 'id_conflict', 'id déjà utilisé par un autre enregistrement')
    } else {
      reject(id, 'broken_chain', `device_seq ${r.device_seq} déjà occupé par un autre enregistrement (envoi concurrent)`)
    }
  }

  return { accepted, rejected, last_device_seq: head.device_seq }
}

interface ContentCaches {
  staff: Map<string, boolean | null> // null = inconnu, false = désactivé
  equipment: Map<string, boolean>
}

/** Contrôles de contenu d'un enregistrement à la chaîne intègre. */
async function checkContent(r: HaccpRecord, repo: PushRepo, caches: ContentCaches): Promise<ContentVerdict> {
  const q = (quarantine: QuarantineReason, detail: string): ContentVerdict => ({ ok: false, quarantine, detail })

  // Type du contrat et cohérence de supersedes_id
  const sem = validateRecordSemantics(r)
  if (!sem.ok) return q(sem.reason === 'unknown_type' ? 'unknown_type' : 'invalid_payload', sem.detail)

  // Auteur existant ET actif
  if (!caches.staff.has(r.author_id)) {
    const s = await repo.getStaffStatus(r.author_id)
    caches.staff.set(r.author_id, s ? s.active : null)
  }
  const active = caches.staff.get(r.author_id)
  if (active !== true) return q('unknown_author', active === false ? 'auteur désactivé' : 'auteur inconnu')

  // Correction : cible existante, type d'origine
  let supersededType: RecordType | undefined
  if (r.type === 'correction') {
    const res = await resolveOriginalType(r.supersedes_id as string, repo)
    if (!res.ok) return q(res.notFound ? 'supersedes_not_found' : 'invalid_payload', res.detail)
    supersededType = res.type as RecordType
  }

  // Payload
  const pv = validatePayload(r.type, r.payload, { supersededType })
  if (!pv.ok) return q(pv.reason === 'unknown_type' ? 'unknown_type' : 'invalid_payload', pv.detail)

  // Références du payload effectif
  const effectiveType = supersededType ?? r.type
  const effectivePayload = (r.type === 'correction' ? r.payload.replacement : r.payload) as Record<string, unknown>
  if (effectiveType === 'temperature_check') {
    const eq = effectivePayload.equipment_id as string
    if (!caches.equipment.has(eq)) caches.equipment.set(eq, await repo.equipmentExists(eq))
    if (!caches.equipment.get(eq)) return q('invalid_payload', 'equipment_id : équipement inconnu')
  }
  return { ok: true }
}

async function resolveOriginalType(
  supersedesId: string,
  repo: PushRepo,
): Promise<{ ok: true; type: string } | { ok: false; notFound: boolean; detail: string }> {
  let current = supersedesId
  for (let depth = 0; depth < PUSH_LIMITS.maxCorrectionDepth; depth++) {
    const [rec] = await repo.getRecordsByIds([current])
    if (!rec) {
      return depth === 0
        ? { ok: false, notFound: true, detail: 'supersedes_id : enregistrement corrigé introuvable' }
        : { ok: false, notFound: false, detail: 'chaîne de corrections incohérente' }
    }
    if (rec.type !== 'correction') return { ok: true, type: rec.type }
    if (!rec.supersedes_id) return { ok: false, notFound: false, detail: 'chaîne de corrections incohérente' }
    current = rec.supersedes_id
  }
  return { ok: false, notFound: false, detail: 'trop de corrections successives' }
}

export interface SyncPushDeps extends HttpEnv {
  repo: PushRepo
}

export function createSyncPushHandler(deps: SyncPushDeps): (req: Request) => Promise<Response> {
  return withHttp('sync-push', ['POST'], deps, async (req, ctx) => {
    const device = await authenticateDevice(req, deps.repo, ctx.logger)
    const body = await readJsonBody(req, PUSH_LIMITS.maxBodyBytes)
    const records = parsePushRequest(body, device)
    const res = await processPush(device, records, deps.repo, ctx)
    await deps.repo.touchDevice(device.id, ctx.now().toISOString())
    ctx.logger.log('info', 'sync_push', {
      device_id: device.id,
      received: records.length,
      accepted: res.accepted.length,
      rejected: res.rejected.length,
      reject_reasons: [...new Set(res.rejected.map((r) => r.reason))],
      last_device_seq: res.last_device_seq,
    })
    return jsonResponse(200, res)
  })
}
