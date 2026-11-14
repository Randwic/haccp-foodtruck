// Interface publique du « core » (hors-ligne, registre, synchro, PIN) utilisée par l'interface.
// FIGÉE : l'équipe UI code contre ces signatures, l'équipe core les implémente dans ./index.ts.
import type { HaccpRecord, RecordType, StaffMember, Equipment, Threshold, Settings, Establishment } from '../../../shared/types.ts'

export interface DeviceInfo {
  device_id: string
  name: string
  enrolled_at: string
}

export interface SyncStatus {
  online: boolean
  pending_count: number // saisies pas encore acceptées par le serveur
  oldest_pending_at: string | null
  last_success_at: string | null
  last_error: string | null
  rejected_count: number // saisies refusées par le serveur (à examiner)
}

export type UnlockResult =
  | { ok: true; staff: StaffMember }
  | { ok: false; reason: 'wrong_pin' | 'locked_out'; retry_after_seconds?: number }

export interface CoreApi {
  // Appareil
  getDevice(): Promise<DeviceInfo | null>
  /** Enregistre l'appareil avec le jeton reçu du gérant (device-enroll), puis fait un premier sync-pull. */
  enrollDevice(input: { device_id: string; device_token: string; name: string }): Promise<void>

  // Session équipier (PIN)
  listStaff(): Promise<StaffMember[]> // actifs uniquement
  unlock(staffId: string, pin: string): Promise<UnlockResult>
  lock(): void
  currentStaff(): StaffMember | null
  onSessionChange(cb: (staff: StaffMember | null) => void): () => void

  // Registre (append-only)
  /** Crée, chaîne, hache et stocke localement un enregistrement, puis déclenche une synchro. */
  addRecord(type: RecordType, payload: Record<string, unknown>, opts?: { supersedes_id?: string }): Promise<HaccpRecord>
  listRecords(filter?: { type?: RecordType; since?: string; limit?: number }): Promise<HaccpRecord[]>

  // Références (lecture, issues de sync-pull)
  getEstablishment(): Promise<Establishment | null>
  listEquipment(): Promise<Equipment[]>
  listThresholds(): Promise<Threshold[]>
  getSettings(): Promise<Settings | null>

  // Synchronisation
  syncNow(): Promise<SyncStatus>
  getSyncStatus(): Promise<SyncStatus>
  onSyncStatusChange(cb: (s: SyncStatus) => void): () => void

  // Stockage
  /** Demande navigator.storage.persist() ; renvoie true si accordé. */
  requestPersistentStorage(): Promise<boolean>
}
