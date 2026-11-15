// Base locale IndexedDB (Dexie).
//
// Principe : la table `records` est en ÉCRITURE UNIQUE. Le code du core n'y fait que des `add`
// (jamais `put`, `update` ni `delete`). L'état de synchronisation, lui, évolue : il est rangé à part
// dans `record_sync`, de sorte que le contenu haché d'un enregistrement n'est jamais réécrit.
import Dexie, { type Table } from 'dexie'
import type {
  Equipment,
  Establishment,
  HaccpRecord,
  RejectReason,
  Settings,
  StaffMember,
  Threshold,
} from '../../../shared/types.ts'
import type { Checklist, CleaningTask, Product, Recipe, Supplier } from '../../../shared/payloads.ts'

/** Appareil enrôlé (une seule ligne, clé 'self'). Le jeton ne sort jamais du core. */
export interface DeviceRow {
  key: 'self'
  device_id: string
  device_token: string
  name: string
  enrolled_at: string
}

/** Enregistrement tel que stocké localement : exactement les champs hachés + le hash. */
export type StoredRecord = Omit<HaccpRecord, 'server_time'>

export type SyncState = 'pending' | 'accepted' | 'rejected'

export interface RecordSyncRow {
  id: string
  device_id: string
  device_seq: number
  state: SyncState
  /** Date de création locale (= device_time), pour `oldest_pending_at`. */
  created_at: string
  server_time: string | null
  clock_suspect: boolean | null
  reject_reason: RejectReason | null
  reject_detail: string | null
}

/** Tête de chaîne d'un appareil : dernier device_seq et dernier hash. */
export interface ChainHead {
  device_id: string
  last_seq: number
  last_hash: string
}

/** Tentatives de PIN d'un équipier (persistées pour survivre au rechargement). */
export interface PinAttemptsRow {
  staff_id: string
  failures: number
  locked_until: string | null
}

/**
 * État local d'une photo (lot 3) :
 * - draft    : prise mais référencée par aucune saisie (formulaire en cours) — jamais envoyée ;
 * - pending  : référencée par une saisie du registre, à envoyer (photo-upload) ;
 * - uploaded : confirmée par le serveur (201 créée / 200 déjà présente) ;
 * - failed   : refus définitif du serveur (409 photo_conflict, 415 invalid_photo…) — visible, jamais renvoyée en boucle.
 */
export type PhotoState = 'draft' | 'pending' | 'uploaded' | 'failed'

/** Photo stockée sur l'appareil : chemin `<device_id>/<uuid>.webp` + octets WebP. */
export interface PhotoRow {
  path: string
  device_id: string
  state: PhotoState
  /** Octets WebP ; null seulement pour une photo envoyée dont la copie locale a été libérée. */
  bytes: ArrayBuffer | null
  size: number
  width: number
  height: number
  created_at: string
  uploaded_at: string | null
  /** Code d'erreur du serveur (photo_conflict, invalid_photo…) quand state = failed. */
  error: string | null
}

/** Métadonnées diverses (clé/valeur). */
export interface MetaMap {
  since: string | null
  last_success_at: string | null
  last_error: string | null
  /** Synchro arrêtée suite à un 401 / device_revoked (jusqu'à un nouvel enrôlement). */
  revoked: boolean
  establishment: Establishment | null
  settings: Settings | null
}
export type MetaKey = keyof MetaMap
export interface MetaRow<K extends MetaKey = MetaKey> {
  key: K
  value: MetaMap[K]
}

export class CoreDb extends Dexie {
  device!: Table<DeviceRow, string>
  records!: Table<StoredRecord, string>
  record_sync!: Table<RecordSyncRow, string>
  chain!: Table<ChainHead, string>
  staff!: Table<StaffMember, string>
  equipment!: Table<Equipment, string>
  thresholds!: Table<Threshold, string>
  pin_attempts!: Table<PinAttemptsRow, string>
  meta!: Table<MetaRow, string>
  // Version 2 (lot 3) : photos et fournisseurs.
  photos!: Table<PhotoRow, string>
  suppliers!: Table<Supplier, string>
  // Version 3 (lot 4) : produits et recettes ; tâches de nettoyage et checklists (stockées pour le lot 5).
  products!: Table<Product, string>
  recipes!: Table<Recipe, string>
  cleaning_tasks!: Table<CleaningTask, string>
  checklists!: Table<Checklist, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      device: '&key',
      // Unicité (device_id, device_seq) : filet de sécurité contre tout doublon de numéro.
      records: '&id, &[device_id+device_seq], type, device_time',
      record_sync: '&id, [state+device_seq], state',
      chain: '&device_id',
      staff: '&id',
      equipment: '&id',
      thresholds: '&id',
      pin_attempts: '&staff_id',
      meta: '&key',
    })
    // Lot 3 : ajout de tables uniquement (aucune donnée existante modifiée, pas de fonction d'upgrade).
    this.version(2).stores({
      photos: '&path, state, created_at',
      suppliers: '&id',
    })
    // Lot 4 : ajout de tables. Les références déjà présentes côté serveur (données initiales des
    // produits) peuvent être plus anciennes que le dernier `since` de l'appareil : on remet `since` à
    // zéro pour que le prochain sync-pull soit complet (idempotent : bulkPut). Aucun enregistrement touché.
    this.version(3)
      .stores({
        products: '&id',
        recipes: '&id',
        cleaning_tasks: '&id',
        checklists: '&id',
      })
      .upgrade(async (tx) => {
        await tx.table('meta').put({ key: 'since', value: null })
      })
    // Garde-fou : toute tentative de réécriture ou de suppression d'un enregistrement échoue,
    // même si un futur code l'essayait par erreur (put sur un id existant, update, delete).
    this.records.hook('updating', () => {
      throw new Error('Registre en ajout seul : modification interdite')
    })
    this.records.hook('deleting', () => {
      throw new Error('Registre en ajout seul : suppression interdite')
    })
  }

  async getMeta<K extends MetaKey>(key: K, fallback: MetaMap[K]): Promise<MetaMap[K]> {
    const row = (await this.meta.get(key)) as MetaRow<K> | undefined
    return row ? row.value : fallback
  }

  async setMeta<K extends MetaKey>(key: K, value: MetaMap[K]): Promise<void> {
    await this.meta.put({ key, value } as MetaRow)
  }
}
