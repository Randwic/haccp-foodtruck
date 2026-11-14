// sync-push : réception des enregistrements d'un appareil et vérification de sa chaîne de hachage.
import { computeRecordHash } from '../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord, type RecordType, type RejectReason, type SyncPushResponse } from '../../../shared/types.ts'
import {
  isCanonicalIsoTime,
  isPlainObject,
  isUuid,
  referencedEquipmentId,
  referencedPhotoPaths,
  referencedProductId,
  referencedRecipeId,
  referencedSupplierId,
  validatePayload,
  validateRecordSemantics,
  validateRecordStructure,
} from '../../../shared/validation.ts'
import { authenticateDevice } from './auth.ts'
import { HttpError, jsonResponse, readJsonBody, withHttp, type HttpEnv, type Logger } from './http.ts'
import { isClockSuspect, type ChainHead, type DeviceRow, type NewRecordRow, type PushRepo, type QuarantineReason, type StoredRecord } from './repo.ts'

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

export interface ParsedPush {
  /** Enregistrements bruts (non typés). */
  records: unknown[]
  /** Horloge de l'appareil à l'envoi (ISO canonique), absente pour une ancienne app. */
  deviceNow: string | null
}

/** Contrôle de l'enveloppe { device_id, device_now?, records }. */
export function parsePushRequest(body: unknown, device: DeviceRow): ParsedPush {
  if (!isPlainObject(body)) throw new HttpError(400, 'invalid_request', 'objet JSON attendu')
  if (typeof body.device_id !== 'string') throw new HttpError(400, 'invalid_request', 'device_id manquant')
  if (body.device_id !== device.id) throw new HttpError(403, 'device_mismatch', 'device_id ne correspond pas au jeton')
  if (!Array.isArray(body.records)) throw new HttpError(400, 'invalid_request', 'records : tableau attendu')
  if (body.records.length > PUSH_LIMITS.maxRecords) {
    throw new HttpError(413, 'too_many_records', `${PUSH_LIMITS.maxRecords} enregistrements maximum par requête`)
  }
  let deviceNow: string | null = null
  if (body.device_now !== undefined && body.device_now !== null) {
    if (!isCanonicalIsoTime(body.device_now)) {
      throw new HttpError(400, 'invalid_request', 'device_now : format ISO UTC canonique attendu (new Date().toISOString())')
    }
    deviceNow = body.device_now
  }
  return { records: body.records, deviceNow }
}

/**
 * Horloge du LOT : |server_now − device_now| > settings.clock_suspect_minutes. Jugée une fois pour
 * tout le lot ; null si device_now est absent (ancienne app : le trigger applique l'ancienne règle,
 * enregistrement par enregistrement, sur device_time).
 */
export async function batchClockSuspect(deviceNow: string | null, serverNow: Date, repo: PushRepo): Promise<boolean | null> {
  if (deviceNow === null) return null
  const settings = await repo.getSettings()
  return isClockSuspect(serverNow, new Date(deviceNow), settings?.clock_suspect_minutes)
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
 *
 * Horloge : si l'app envoie `device_now`, le lot est jugé une fois (`batchClockSuspect`). Chaque
 * ligne porte `device_now` (le trigger calcule sur lui plutôt que sur device_time : une saisie hors
 * réseau envoyée plus tard avec une horloge juste n'est plus signalée) et, si le lot est suspect,
 * `clock_suspect: true` (tous les enregistrements du lot sont alors signalés). Sans device_now :
 * ancienne règle par enregistrement, dans le trigger.
 */
export async function processPush(
  device: DeviceRow,
  rawRecords: unknown[],
  repo: PushRepo,
  ctx: PushContext,
  opts: { deviceNow?: string | null } = {},
): Promise<SyncPushResponse> {
  const deviceNow = opts.deviceNow ?? null
  const accepted: Accepted[] = []
  const rejected: Rejected[] = []

  let head: ChainHead = (await repo.getChainHead(device.id)) ?? { device_seq: 0, hash: GENESIS_HASH }

  // Pré-chargement des id déjà connus (une requête au lieu d'une par enregistrement).
  const candidateIds = [...new Set(rawRecords.map(idOf).filter(isUuid))]
  const known = new Map<string, StoredRecord>()
  if (candidateIds.length > 0) for (const s of await repo.getRecordsByIds(candidateIds)) known.set(s.id, s)

  const caches: ContentCaches = { staff: new Map(), equipment: new Map(), suppliers: new Map(), products: new Map(), recipes: new Map() }
  const state: { blockedBy: { id: string; reason: RejectReason } | null } = { blockedBy: null }

  const batchSuspect = await batchClockSuspect(deviceNow, ctx.now(), repo)
  if (batchSuspect) {
    ctx.logger.log('warn', 'clock_suspect_batch', {
      device_id: device.id,
      skew_seconds: Math.round((ctx.now().getTime() - new Date(deviceNow as string).getTime()) / 1000),
      records: rawRecords.length,
    })
  }

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
    let verdict = await checkContent(r, device.id, repo, caches)
    let quarantine: QuarantineReason | null = verdict.ok ? null : verdict.quarantine

    // 6. Insertion (server_time et clock_suspect sont imposés par le trigger puis relus)
    const row: Omit<NewRecordRow, 'quarantine_reason'> = {
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
      ...(deviceNow !== null ? { device_now: deviceNow } : {}),
      ...(batchSuspect ? { clock_suspect: true as const } : {}),
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
        id: row.id,
        type: row.type,
        hash: row.hash,
        device_id: row.device_id,
        device_seq: row.device_seq,
        supersedes_id: row.supersedes_id,
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
  suppliers: Map<string, boolean>
  products: Map<string, boolean>
  recipes: Map<string, boolean>
}

/** Contrôles de contenu d'un enregistrement à la chaîne intègre. */
async function checkContent(r: HaccpRecord, deviceId: string, repo: PushRepo, caches: ContentCaches): Promise<ContentVerdict> {
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
  let correctedIds: string[] = []
  if (r.type === 'correction') {
    const res = await resolveOriginalType(r.supersedes_id as string, repo)
    if (!res.ok) return q(res.notFound ? 'supersedes_not_found' : 'invalid_payload', res.detail)
    supersededType = res.type as RecordType
    correctedIds = res.chain
  }

  // Payload
  const pv = validatePayload(r.type, r.payload, { supersededType })
  if (!pv.ok) return q(pv.reason === 'unknown_type' ? 'unknown_type' : 'invalid_payload', pv.detail)

  // Références du payload effectif
  const effectiveType = supersededType ?? r.type
  const effectivePayload = (r.type === 'correction' ? r.payload.replacement : r.payload) as Record<string, unknown>
  // Équipement référencé (temperature_check, thawing, hot_holding s'il est déclaré) : doit exister.
  // Pas de contrôle in_range / seuils ici (choix) : in_range est calculé par l'app avec le seuil en
  // vigueur au moment de la saisie, éventuellement hors réseau, alors que le seuil a pu changer depuis.
  const eq = referencedEquipmentId(effectiveType, effectivePayload)
  if (eq !== null) {
    if (!caches.equipment.has(eq)) caches.equipment.set(eq, await repo.equipmentExists(eq))
    if (!caches.equipment.get(eq)) return q('invalid_payload', 'equipment_id : équipement inconnu')
  }
  // Fournisseur référencé (réception) : doit exister (même désactivé depuis : saisie hors réseau).
  const sup = referencedSupplierId(effectiveType, effectivePayload)
  if (sup !== null) {
    if (!caches.suppliers.has(sup)) caches.suppliers.set(sup, await repo.supplierExists(sup))
    if (!caches.suppliers.get(sup)) return q('invalid_payload', 'supplier_id : fournisseur inconnu')
  }
  // Étiquette : produit / recette existants (même désactivés depuis : impression hors réseau).
  // Choix : AUCUN contrôle que `allergens` correspond à la fiche actuelle — la fiche a pu changer
  // depuis l'impression ; l'enregistrement atteste ce qui a été imprimé.
  const prod = referencedProductId(effectiveType, effectivePayload)
  if (prod !== null) {
    if (!caches.products.has(prod)) caches.products.set(prod, await repo.productExists(prod))
    if (!caches.products.get(prod)) return q('invalid_payload', 'product_id : produit inconnu')
  }
  const rec = referencedRecipeId(effectiveType, effectivePayload)
  if (rec !== null) {
    if (!caches.recipes.has(rec)) caches.recipes.set(rec, await repo.recipeExists(rec))
    if (!caches.recipes.get(rec)) return q('invalid_payload', 'recipe_id : recette inconnue')
  }
  // Photos : chemin `<device_id>/<uuid>.webp` de CET appareil (seul dossier où photo-upload le
  // laisse écrire). Une correction peut reprendre les photos de l'enregistrement qu'elle corrige,
  // même prises par un autre appareil. La présence du fichier n'est PAS exigée (envoi différé).
  const foreign = referencedPhotoPaths(effectiveType, effectivePayload).filter((p) => !p.startsWith(`${deviceId}/`))
  if (foreign.length > 0) {
    const inherited = new Set<string>()
    if (correctedIds.length > 0) {
      for (const prev of await repo.getPayloadsByIds(correctedIds)) {
        const isCorr = prev.type === 'correction'
        const inner = isCorr ? (prev.payload as Record<string, unknown>).replacement : prev.payload
        if (isPlainObject(inner)) for (const p of referencedPhotoPaths(supersededType as string, inner)) inherited.add(p)
      }
    }
    const bad = foreign.find((p) => !inherited.has(p))
    if (bad !== undefined) return q('invalid_payload', `photo_paths : ${bad} n’appartient pas à cet appareil`)
  }
  return { ok: true }
}

async function resolveOriginalType(
  supersedesId: string,
  repo: PushRepo,
): Promise<{ ok: true; type: string; chain: string[] } | { ok: false; notFound: boolean; detail: string }> {
  let current = supersedesId
  const chain: string[] = []
  for (let depth = 0; depth < PUSH_LIMITS.maxCorrectionDepth; depth++) {
    const [rec] = await repo.getRecordsByIds([current])
    if (!rec) {
      return depth === 0
        ? { ok: false, notFound: true, detail: 'supersedes_id : enregistrement corrigé introuvable' }
        : { ok: false, notFound: false, detail: 'chaîne de corrections incohérente' }
    }
    chain.push(rec.id)
    if (rec.type !== 'correction') return { ok: true, type: rec.type, chain }
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
    const { records, deviceNow } = parsePushRequest(body, device)
    const res = await processPush(device, records, deps.repo, ctx, { deviceNow })
    await deps.repo.touchDevice(device.id, ctx.now().toISOString())
    ctx.logger.log('info', 'sync_push', {
      device_id: device.id,
      received: records.length,
      device_now: deviceNow !== null,
      accepted: res.accepted.length,
      rejected: res.rejected.length,
      reject_reasons: [...new Set(res.rejected.map((r) => r.reason))],
      last_device_seq: res.last_device_seq,
    })
    return jsonResponse(200, res)
  })
}
