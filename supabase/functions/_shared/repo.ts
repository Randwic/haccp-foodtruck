// Accès aux données, injecté dans la logique pure. Implémentations :
//  - _adapters/supabase_repo.ts (Deno, supabase-js, service_role) en production ;
//  - _shared/memory_repo.ts (en mémoire) pour les tests Vitest.
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
  // server_time et clock_suspect ne sont PAS envoyés : le trigger d'insertion les impose.
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

/** Même règle que le trigger : |server_time − device_time| > clock_suspect_minutes (5 par défaut). */
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
  /**
   * `device_chain_head(device_id)` : dernier maillon, ou ancre de purge (record_chain_anchors)
   * si tous les enregistrements ont été purgés — traitée comme une tête normale. null si jamais rien reçu.
   */
  getChainHead(deviceId: string): Promise<ChainHead | null>
  getRecordsByIds(ids: string[]): Promise<StoredRecord[]>
  getStaffStatus(staffId: string): Promise<{ id: string; active: boolean } | null>
  equipmentExists(equipmentId: string): Promise<boolean>
  insertRecord(row: NewRecordRow): Promise<InsertResult>
}

export interface PullRepo extends DeviceAuthRepo {
  getEstablishment(): Promise<Establishment | null>
  getSettings(): Promise<Settings | null>
  /** Lignes (actives ou non) avec updated_at ≥ since ; toutes si since = null. */
  listStaff(since: string | null): Promise<StaffMember[]>
  listEquipment(since: string | null): Promise<Equipment[]>
  listThresholds(since: string | null): Promise<Threshold[]>
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
