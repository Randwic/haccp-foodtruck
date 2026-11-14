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
