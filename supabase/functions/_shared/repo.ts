// Accès aux données, injecté dans la logique pure. Implémentations :
//  - _adapters/supabase_repo.ts (Deno, supabase-js, service_role) en production ;
//  - _shared/memory_repo.ts (en mémoire) pour les tests Vitest.
import type { Equipment, Establishment, RecordType, Settings, StaffMember, Threshold } from '../../../shared/types.ts'

export interface DeviceRow {
  id: string
  name: string
  revoked_at: string | null
}

/** Enregistrement tel que relu en base (sous-ensemble utile à la synchro). */
export interface StoredRecord {
  id: string
  type: RecordType
  hash: string
  device_id: string
  device_seq: number
  supersedes_id: string | null
  server_time: string // ISO
  clock_suspect: boolean
}

/** Ligne insérée dans `records` (server_time posé par la base : default now()). */
export interface NewRecordRow {
  id: string
  type: RecordType
  payload: Record<string, unknown>
  author_id: string
  device_id: string
  device_seq: number
  device_time: string
  prev_hash: string
  hash: string
  supersedes_id: string | null
  clock_suspect: boolean
}

export type InsertResult =
  | { ok: true; server_time: string }
  /** 23505 : id ou (device_id, device_seq) déjà pris, typiquement par un envoi concurrent. */
  | { ok: false; kind: 'unique_violation' }
  /** Refus « métier » de la base (contrainte CHECK, trigger RAISE…) : définitif, pas de nouvel essai. */
  | { ok: false; kind: 'rejected'; detail: string }

export interface ChainHead {
  device_seq: number
  hash: string
}

export interface DeviceAuthRepo {
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>
  touchDevice(deviceId: string, at: string): Promise<void>
}

export interface PushRepo extends DeviceAuthRepo {
  getSettings(): Promise<Settings | null>
  /** `device_chain_head(device_id)` ; null si aucun enregistrement. */
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
