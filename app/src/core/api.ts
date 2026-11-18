// Interface publique du « core » (hors-ligne, registre, synchro, PIN) utilisée par l'interface.
// FIGÉE : l'équipe UI code contre ces signatures, l'équipe core les implémente dans ./index.ts.
import type { HaccpRecord, RecordType, StaffMember, Equipment, Threshold, Settings, Establishment } from '../../../shared/types.ts'
import type { Alert, Checklist, CleaningTask, Product, PushSubscribeRequest, Recipe, Supplier } from '../../../shared/payloads.ts'

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
  /**
   * Lot 3 (ajout facultatif, absent des anciens cores) : photos référencées par une saisie et pas
   * encore confirmées par le serveur. Les photos d'un formulaire non enregistré ne comptent pas.
   */
  photos_pending?: number
  /** Lot 3 (facultatif) : photos refusées définitivement (409 photo_conflict…) — à signaler, jamais renvoyées. */
  photos_failed?: number
}

/** Photo compressée et rangée sur l'appareil (`path` = `<device_id>/<uuid>.webp`, à mettre dans le payload). */
export interface PhotoInfo {
  path: string
  size: number
  width: number
  height: number
}

/**
 * État local d'une photo : draft (formulaire pas encore enregistré), pending (à envoyer), uploaded
 * (confirmée par le serveur), failed (refus définitif, `error` = code du serveur), absent (pas sur cet
 * appareil : prise ailleurs ou copie locale libérée — lisible par le gérant connecté).
 */
export interface PhotoStatus {
  state: 'draft' | 'pending' | 'uploaded' | 'failed' | 'absent'
  error: string | null
  /** Octets disponibles sur l'appareil (affichage hors-ligne possible). */
  local: boolean
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
  /** Fournisseurs reçus par sync-pull (lot 3), triés par nom ; actifs seulement sauf `includeInactive`. */
  listSuppliers(opts?: { includeInactive?: boolean }): Promise<Supplier[]>
  /**
   * Produits reçus par sync-pull (lot 4), triés par nom ; actifs seulement sauf `includeInactive`
   * (un produit désactivé reste lisible pour l'historique des étiquettes).
   */
  listProducts(opts?: { includeInactive?: boolean }): Promise<Product[]>
  /** Recettes / préparations maison reçues par sync-pull (lot 4), triées par nom ; même règle. */
  listRecipes(opts?: { includeInactive?: boolean }): Promise<Recipe[]>
  /**
   * Lot 5 (ajout rétro-compatible) : tâches du plan de nettoyage reçues par sync-pull (stockées depuis
   * le lot 4), triées par nom ; actives seulement sauf `includeInactive` (historique).
   */
  listCleaningTasks(opts?: { includeInactive?: boolean }): Promise<CleaningTask[]>
  /** Lot 5 : checklists (ouverture, fermeture, nuisibles…) reçues par sync-pull, triées par nom ; même règle. */
  listChecklists(opts?: { includeInactive?: boolean }): Promise<Checklist[]>

  // Alertes (lot 6) — ajouts facultatifs (absents d'anciens cores et du core factice des tests).
  /** Alertes calculées par le serveur et reçues par sync-pull, encore ouvertes (non résolues), les plus récentes d'abord. */
  listAlerts?(): Promise<Alert[]>
  /** Clé publique VAPID du serveur pour s'abonner aux notifications, ou null si le serveur ne les envoie pas. */
  getPushPublicKey?(): Promise<string | null>
  /** Enregistre l'abonnement Web Push de cet appareil sur le serveur (push-subscribe). */
  subscribePush?(subscription: PushSubscribeRequest): Promise<void>

  // Photos (lot 3) — stockées sur l'appareil puis envoyées par la synchro.
  /**
   * Compresse (≤ 1600 px, WebP ~200 Ko) et range la photo localement, à l'état « brouillon » :
   * elle ne part au serveur qu'une fois référencée par une saisie (`addRecord`). Renvoie son chemin.
   */
  addPhoto(image: Blob): Promise<PhotoInfo>
  /** Abandonne une photo encore à l'état brouillon (retirée du formulaire). false si déjà référencée. */
  discardPhoto(path: string): Promise<boolean>
  /** Octets WebP de la photo si présents sur l'appareil, sinon null. */
  getPhoto(path: string): Promise<Blob | null>
  getPhotoStatuses(paths: readonly string[]): Promise<Record<string, PhotoStatus>>

  // Synchronisation
  syncNow(): Promise<SyncStatus>
  getSyncStatus(): Promise<SyncStatus>
  onSyncStatusChange(cb: (s: SyncStatus) => void): () => void

  // Stockage
  /** Demande navigator.storage.persist() ; renvoie true si accordé. */
  requestPersistentStorage(): Promise<boolean>
}
