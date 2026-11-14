// sync-push : réception des enregistrements d'un appareil et vérification de sa chaîne de hachage.
import { computeRecordHash } from '../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord, type RecordType, type RejectReason, type SyncPushResponse } from '../../../shared/types.ts'
import { isPlainObject, isUuid, validatePayload, validateRecordShape } from '../../../shared/validation.ts'
import { authenticateDevice } from './auth.ts'
import { HttpError, jsonResponse, readJsonBody, withHttp, type HttpEnv, type Logger } from './http.ts'
import type { ChainHead, DeviceRow, PushRepo, StoredRecord } from './repo.ts'

export const PUSH_LIMITS = {
  maxRecords: 500,
  maxBodyBytes: 1024 * 1024,
  /** Profondeur max de remontée correction → correction → … → original. */
  maxCorrectionDepth: 20,
  /** Repli si la ligne settings est absente (valeur de docs/ARCHITECTURE.md). */
  defaultClockSuspectMinutes: 5,
} as const

type Accepted = SyncPushResponse['accepted'][number]
type Rejected = SyncPushResponse['rejected'][number]

export interface PushContext {
  now: () => Date
  logger: Logger
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

/**
 * Traite les enregistrements dans l'ordre reçu. Ordre des contrôles pour chacun :
 *  1. forme (validateRecordShape) et appartenance à l'appareil authentifié ;
 *  2. recalcul du hash (computeRecordHash) ;
 *  3. idempotence : id déjà connu → même hash = accepté (rejeu), sinon `id_conflict` ;
 *  4. chaîne : device_seq = tête+1 (`seq_gap`) et prev_hash = hash de tête (`broken_chain`) ;
 *  5. auteur existant et actif (`unknown_author`) ;
 *  6. correction : supersedes_id existe, remplacement valide pour le type d'origine ;
 *  7. payload (+ références : équipement existant) ;
 *  8. insertion (une violation d'unicité concurrente est relue, jamais remontée en 500).
 * Dès qu'un enregistrement est refusé, les suivants du lot le sont aussi (`broken_chain`) :
 * la chaîne de l'appareil ne peut plus avancer tant que le refus n'est pas traité.
 * L'idempotence passe avant l'auteur : un rejeu reste accepté même si l'équipier a été désactivé depuis.
 */
export async function processPush(device: DeviceRow, rawRecords: unknown[], repo: PushRepo, ctx: PushContext): Promise<SyncPushResponse> {
  const accepted: Accepted[] = []
  const rejected: Rejected[] = []

  const settings = await repo.getSettings()
  const clockSuspectMs = (settings?.clock_suspect_minutes ?? PUSH_LIMITS.defaultClockSuspectMinutes) * 60_000
  if (!settings) ctx.logger.log('warn', 'settings_missing', { fallback_clock_suspect_minutes: PUSH_LIMITS.defaultClockSuspectMinutes })

  let head: ChainHead = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }

  // Pré-chargement des id déjà connus (une requête au lieu d'une par enregistrement).
  const candidateIds = [...new Set(rawRecords.map(idOf).filter(isUuid))]
  const known = new Map<string, StoredRecord>()
  if (candidateIds.length > 0) for (const s of await repo.getRecordsByIds(candidateIds)) known.set(s.id, s)

  const staffCache = new Map<string, boolean | null>()
  const equipmentCache = new Map<string, boolean>()
  const state: { blockedBy: { id: string; reason: RejectReason } | null } = { blockedBy: null }

  const reject = (id: string, reason: RejectReason, detail?: string) => {
    rejected.push(detail ? { id, reason, detail } : { id, reason })
    state.blockedBy ??= { id, reason }
  }

  for (const raw of rawRecords) {
    const id = idOf(raw)
    const b = state.blockedBy
    if (b) {
      rejected.push({ id, reason: 'broken_chain', detail: `bloqué par le refus de ${b.id || '(sans id)'} (${b.reason})` })
      continue
    }

    // 1. Forme
    const shape = validateRecordShape(raw)
    if (!shape.ok) {
      reject(id, shape.reason, shape.detail)
      continue
    }
    const r = raw as unknown as HaccpRecord
    if (r.device_id !== device.id) {
      reject(id, 'invalid_payload', 'device_id de l’enregistrement différent de l’appareil authentifié')
      continue
    }

    // 2. Hash
    let computed: string
    try {
      computed = await computeRecordHash(r)
    } catch {
      reject(id, 'invalid_payload', 'contenu non hachable')
      continue
    }
    if (computed !== r.hash) {
      reject(id, 'invalid_hash', 'le hash ne correspond pas au contenu')
      continue
    }

    // 3. Idempotence
    const prior = known.get(r.id)
    if (prior) {
      if (prior.hash === r.hash) {
        accepted.push({ id: r.id, server_time: prior.server_time, clock_suspect: prior.clock_suspect })
      } else {
        reject(id, 'id_conflict', 'id déjà utilisé par un autre enregistrement')
      }
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

    // 5. Auteur
    if (!staffCache.has(r.author_id)) {
      const s = await repo.getStaffStatus(r.author_id)
      staffCache.set(r.author_id, s ? s.active : null)
    }
    const active = staffCache.get(r.author_id)
    if (active !== true) {
      reject(id, 'unknown_author', active === false ? 'auteur désactivé' : 'auteur inconnu')
      continue
    }

    // 6. Correction : cible existante, type d'origine
    let supersededType: RecordType | undefined
    if (r.type === 'correction') {
      const res = await resolveOriginalType(r.supersedes_id as string, repo)
      if (!res.ok) {
        reject(id, 'invalid_payload', res.detail)
        continue
      }
      supersededType = res.type
    }

    // 7. Payload et références
    const pv = validatePayload(r.type, r.payload, { supersededType })
    if (!pv.ok) {
      reject(id, pv.reason, pv.detail)
      continue
    }
    const effectiveType = supersededType ?? r.type
    const effectivePayload = (r.type === 'correction' ? r.payload.replacement : r.payload) as Record<string, unknown>
    if (effectiveType === 'temperature_check') {
      const eq = effectivePayload.equipment_id as string
      if (!equipmentCache.has(eq)) equipmentCache.set(eq, await repo.equipmentExists(eq))
      if (!equipmentCache.get(eq)) {
        reject(id, 'invalid_payload', 'equipment_id : équipement inconnu')
        continue
      }
    }

    // 8. Insertion
    const nowMs = ctx.now().getTime()
    const clockSuspect = Math.abs(nowMs - new Date(r.device_time).getTime()) > clockSuspectMs
    const ins = await repo.insertRecord({
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
      clock_suspect: clockSuspect,
    })
    if (ins.ok) {
      accepted.push({ id: r.id, server_time: ins.server_time, clock_suspect: clockSuspect })
      known.set(r.id, {
        id: r.id,
        type: r.type,
        hash: r.hash,
        device_id: r.device_id,
        device_seq: r.device_seq,
        supersedes_id: r.supersedes_id,
        server_time: ins.server_time,
        clock_suspect: clockSuspect,
      })
      head = { device_seq: r.device_seq, hash: r.hash }
      if (clockSuspect) ctx.logger.log('warn', 'clock_suspect', { record_id: r.id, device_id: device.id })
      continue
    }
    if (ins.kind === 'rejected') {
      ctx.logger.log('warn', 'db_rejected_record', { record_id: r.id, detail: ins.detail })
      reject(id, 'invalid_payload', 'refusé par la base de données')
      continue
    }

    // Violation d'unicité : un envoi concurrent est passé avant nous. On relit pour répondre juste.
    ctx.logger.log('info', 'concurrent_insert', { record_id: r.id, device_id: device.id })
    const [again] = await repo.getRecordsByIds([r.id])
    head = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }
    if (again) {
      known.set(again.id, again)
      if (again.hash === r.hash) {
        accepted.push({ id: r.id, server_time: again.server_time, clock_suspect: again.clock_suspect })
      } else {
        reject(id, 'id_conflict', 'id déjà utilisé par un autre enregistrement')
      }
    } else {
      reject(id, 'broken_chain', `device_seq ${r.device_seq} déjà occupé par un autre enregistrement (envoi concurrent)`)
    }
  }

  return { accepted, rejected, last_device_seq: head.device_seq }
}

async function resolveOriginalType(
  supersedesId: string,
  repo: PushRepo,
): Promise<{ ok: true; type: RecordType } | { ok: false; detail: string }> {
  let current = supersedesId
  for (let depth = 0; depth < PUSH_LIMITS.maxCorrectionDepth; depth++) {
    const [rec] = await repo.getRecordsByIds([current])
    if (!rec) {
      return { ok: false, detail: depth === 0 ? 'supersedes_id : enregistrement corrigé introuvable' : 'chaîne de corrections incohérente' }
    }
    if (rec.type !== 'correction') return { ok: true, type: rec.type }
    if (!rec.supersedes_id) return { ok: false, detail: 'chaîne de corrections incohérente' }
    current = rec.supersedes_id
  }
  return { ok: false, detail: 'trop de corrections successives' }
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
