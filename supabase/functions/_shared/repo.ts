// Accès aux données, injecté dans la logique pure. Implémentations :
//  - _adapters/supabase_repo.ts (Deno, supabase-js, service_role) en production ;
//  - _shared/memory_repo.ts (en mémoire) pour les tests Vitest.
import type { Supplier } from '../../../shared/payloads.ts'
import type { Equipment, Establishment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'

export interface DeviceRow {
  id: string
  name: string
  revoked_at: string | null
}

/**
 * Valeurs de `records.quarantine_reason` : enregistrement à la chaîne intègre mais au contenu
 * refusé. Il est stocké (la chaîne de l'appareil avance) mais exclu des données « valides ».
 */
export type QuarantineReason = 'unknown_author' | 'unknown_type' | 'invalid_payload' | 'supersedes_not_found'

/** Enregistrement tel que relu en base (sous-ensemble utile à la synchro). */
export interface StoredRecord {
  id: string
  /** Texte libre : un enregistrement en quarantaine `unknown_type` peut porter un type hors contrat. */
  type: string
  hash: string
  device_id: string
  device_seq: number
  supersedes_id: string | null
  server_time: string // ISO
  clock_suspect: boolean
  quarantine_reason: QuarantineReason | null
}

/** Ligne insérée dans `records` (server_time posé par la base : default now()). */
export interface NewRecordRow {
  id: string
  type: string
  payload: Record<string, unknown>
  author_id: string
  device_id: string
  device_seq: number
  device_time: string
  prev_hash: string
  hash: string
  supersedes_id: string | null
  quarantine_reason: QuarantineReason | null
  /**
   * `SyncPushRequest.device_now` (horloge de l'appareil à l'envoi), absent pour une ancienne app.
   * Le trigger calcule alors clock_suspect sur |server_time − device_now| au lieu de device_time
   * (pris en compte pour service_role seulement).
   */
  device_now?: string
  /**
   * Envoyé uniquement à `true`, quand le lot entier est jugé « horloge suspecte ». Le trigger fait
   * un OU avec son propre calcul : une valeur fournie ne peut jamais effacer un signalement.
   * server_time n'est jamais envoyé (imposé par le trigger).
   */
  clock_suspect?: true
}

export type InsertResult =
  /** Valeurs relues après insertion (posées par le trigger). */
  | { ok: true; server_time: string; clock_suspect: boolean }
  /** 23505 : id ou (device_id, device_seq) déjà pris, typiquement par un envoi concurrent. */
  | { ok: false; kind: 'unique_violation' }
  /**
   * Filet de sécurité de la base (`HACCP: seq_gap|broken_chain|device_revoked …`) : la chaîne
   * ou l'appareil ont changé entre nos contrôles et l'insertion. Refus d'intégrité.
   */
  | { ok: false; kind: 'integrity'; reason: 'seq_gap' | 'broken_chain' | 'device_revoked'; detail: string }
  /**
   * `HACCP: unknown_author|supersedes_not_found` : contrôle de contenu de la base (hors quarantaine).
   * La logique réessaie alors l'insertion en quarantaine avec cette raison.
   */
  | { ok: false; kind: 'content'; quarantine: 'unknown_author' | 'supersedes_not_found'; detail: string }
  /** Autre refus « métier » de la base (contrainte CHECK…) : définitif, pas de nouvel essai. */
  | { ok: false; kind: 'rejected'; detail: string }

/**
 * Traduit le message d'une exception levée par les triggers (`HACCP: <code> — …`).
 * Pur, partagé entre l'adaptateur Supabase et les tests.
 */
export function classifyDbError(code: string, message: string): InsertResult & { ok: false } {
  if (code === '23505') return { ok: false, kind: 'unique_violation' }
  const m = /^HACCP:\s*([a-z_]+)/.exec(message)
  const tag = m?.[1]
  if (tag === 'seq_gap' || tag === 'broken_chain' || tag === 'device_revoked') return { ok: false, kind: 'integrity', reason: tag, detail: message }
  if (tag === 'unknown_author' || tag === 'supersedes_not_found') return { ok: false, kind: 'content', quarantine: tag, detail: message }
  return { ok: false, kind: 'rejected', detail: `${code} ${message}`.trim() }
}

/**
 * Même règle que le trigger : |server_time − horloge appareil| > clock_suspect_minutes (5 par défaut).
 * Horloge appareil = device_now (moment de l'envoi) si fourni, sinon device_time (ancienne règle).
 */
export function isClockSuspect(serverTime: Date, deviceTime: Date, clockSuspectMinutes: number | null | undefined): boolean {
  return Math.abs(serverTime.getTime() - deviceTime.getTime()) > (clockSuspectMinutes ?? 5) * 60_000
}

export interface ChainHead {
  device_seq: number
  hash: string
}

export interface DeviceAuthRepo {
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>
  touchDevice(deviceId: string, at: string): Promise<void>
}

export interface PushRepo extends DeviceAuthRepo {
  /** Paramètres (clock_suspect_minutes pour juger l'horloge du lot). */
  getSettings(): Promise<Settings | null>
  /**
   * `device_chain_head(device_id)` : dernier maillon, ou ancre de purge (record_chain_anchors)
   * si tous les enregistrements ont été purgés — traitée comme une tête normale. null si jamais rien reçu.
   */
  getChainHead(deviceId: string): Promise<ChainHead | null>
  getRecordsByIds(ids: string[]): Promise<StoredRecord[]>
  getStaffStatus(staffId: string): Promise<{ id: string; active: boolean } | null>
  equipmentExists(equipmentId: string): Promise<boolean>
  /** Fournisseur existant (actif ou non) : `reception.supplier_id`. */
  supplierExists(supplierId: string): Promise<boolean>
  /**
   * Type et payload d'enregistrements (corrections : photos reprises de l'enregistrement corrigé).
   * Ordre quelconque, id inconnus ignorés.
   */
  getPayloadsByIds(ids: string[]): Promise<{ id: string; type: string; payload: unknown }[]>
  insertRecord(row: NewRecordRow): Promise<InsertResult>
}

export interface PullRepo extends DeviceAuthRepo {
  getEstablishment(): Promise<Establishment | null>
  getSettings(): Promise<Settings | null>
  /** Lignes (actives ou non) avec updated_at ≥ since ; toutes si since = null. */
  listStaff(since: string | null): Promise<StaffMember[]>
  listEquipment(since: string | null): Promise<Equipment[]>
  listThresholds(since: string | null): Promise<Threshold[]>
  listSuppliers(since: string | null): Promise<Supplier[]>
}

export interface EnrollRepo {
  /** Vérifie le JWT auprès de Supabase Auth ; renvoie l'id utilisateur ou null. */
  getUserIdFromJwt(jwt: string): Promise<string | null>
  isManager(userId: string): Promise<boolean>
  insertDevice(row: { name: string; token_hash: string; enrolled_by: string }): Promise<{ id: string }>
}

export interface HealthRepo {
  ping(): Promise<void>
}

/** Résultat de la création d'un utilisateur via l'API admin Supabase Auth. */
export type CreateAuthUserResult =
  | { ok: true; user_id: string }
  /** Refus « métier » d'Auth : e-mail déjà pris, mot de passe jugé trop faible, autre refus de validation. */
  | { ok: false; kind: 'email_exists' | 'weak_password' | 'rejected' }

/** Résultat de `bootstrap_manager()` (transaction SQL sérialisée par verrou). */
export type BootstrapManagerResult =
  | { ok: true; staff_id: string }
  /** `HACCP: already_bootstrapped` : un gérant existe déjà (y compris inscrit en concurrence). */
  | { ok: false; kind: 'already_bootstrapped' }

export interface BootstrapManagerRow {
  user_id: string
  display_name: string
  pin_salt: string
  pin_hash: string
  establishment_name: string
}

export interface BootstrapRepo {
  countManagers(): Promise<number>
  /** Nom de l'établissement, null s'il n'existe pas. */
  getEstablishmentName(): Promise<string | null>
  /** `bootstrap_failure_count(minutes)` : échecs enregistrés dans la fenêtre. */
  countRecentBootstrapFailures(windowMinutes: number): Promise<number>
  /** `bootstrap_record_failure(reason)` : raison courte `[a-z_]`, jamais de donnée personnelle. */
  recordBootstrapFailure(reason: string): Promise<void>
  /** `auth.admin.createUser({ email, password, email_confirm: true })`. */
  createAuthUser(email: string, password: string): Promise<CreateAuthUserResult>
  /** `auth.admin.deleteUser(id)` : nettoyage après échec de l'étape SQL. */
  deleteAuthUser(userId: string): Promise<void>
  /** `bootstrap_manager(…)` ; toute autre erreur SQL est levée. */
  bootstrapManager(row: BootstrapManagerRow): Promise<BootstrapManagerResult>
}
