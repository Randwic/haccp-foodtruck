// Dépôt en mémoire pour les tests : reproduit le comportement utile de la base (trigger
// d'insertion « filet de sécurité » avec messages `HACCP: …`, clé primaire records.id,
// unique(device_id, device_seq), server_time / clock_suspect imposés, ancres de purge).
import type { Supplier } from '../../../shared/payloads.ts'
import type { Equipment, Establishment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'
import type { PhotoStore } from './photo_upload.ts'
import type { PhotoRemover, PurgePhotosRepo } from './purge_photos.ts'
import { classifyDbError, isClockSuspect } from './repo.ts'
import type {
  BootstrapManagerResult,
  BootstrapManagerRow,
  BootstrapRepo,
  ChainHead,
  CreateAuthUserResult,
  DeviceRow,
  EnrollRepo,
  HealthRepo,
  InsertResult,
  NewRecordRow,
  PullRepo,
  PushRepo,
  StoredRecord,
} from './repo.ts'

export interface MemoryDevice extends DeviceRow {
  token_hash: string
  last_seen_at: string | null
  enrolled_by?: string
}

export class MemoryRepo implements PushRepo, PullRepo, EnrollRepo, HealthRepo, BootstrapRepo {
  devices: MemoryDevice[] = []
  staff: StaffMember[] = []
  equipment: Equipment[] = []
  thresholds: Threshold[] = []
  suppliers: Supplier[] = []
  establishment: Establishment | null = null
  settings: Settings | null = null
  records: (Omit<NewRecordRow, 'clock_suspect'> & { server_time: string; clock_suspect: boolean })[] = []
  /** record_chain_anchors : dernier maillon d'un appareil dont tous les enregistrements ont été purgés. */
  anchors: { device_id: string; device_seq: number; hash: string }[] = []
  /** Toutes les lignes envoyées à insertRecord (y compris refusées). */
  inserted: NewRecordRow[] = []
  managers = new Set<string>()
  jwts = new Map<string, string>() // jwt -> user id
  serverClock: () => Date = () => new Date()
  /** Appelé juste avant chaque insertion : permet de simuler un envoi concurrent. */
  beforeInsert: ((row: NewRecordRow) => void) | null = null
  /** Permet de simuler un refus métier de la base. */
  rejectInsert: ((row: NewRecordRow) => string | null) | null = null
  pingFails = false
  /** Supabase Auth (bootstrap) : utilisateurs créés via l'API admin. */
  authUsers = new Map<string, { email: string }>()
  /** Mots de passe reçus par createAuthUser (pour vérifier qu'ils ne fuient pas ailleurs). */
  receivedPasswords: string[] = []
  /** bootstrap_attempts : horodatage + raison des échecs. */
  bootstrapFailures: { at: Date; reason: string }[] = []
  /** Lien staff.user_id (la forme StaffMember du contrat ne le porte pas). */
  staffUserIds = new Map<string, string>()
  /** Force un refus de createUser. */
  createUserRefusal: CreateAuthUserResult & { ok: false } | null = null
  /** Simule une panne de l'étape SQL (exception) ou de la suppression d'utilisateur. */
  bootstrapThrows = false
  deleteUserThrows = false
  /** Appelé juste avant la transaction SQL : permet de simuler une inscription concurrente. */
  beforeBootstrap: ((row: BootstrapManagerRow) => void) | null = null
  calls: Record<string, number> = {}

  private count(name: string) {
    this.calls[name] = (this.calls[name] ?? 0) + 1
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    this.count('findDeviceByTokenHash')
    const d = this.devices.find((x) => x.token_hash === tokenHash)
    return d ? { id: d.id, name: d.name, revoked_at: d.revoked_at } : null
  }
  async touchDevice(deviceId: string, at: string): Promise<void> {
    this.count('touchDevice')
    const d = this.devices.find((x) => x.id === deviceId)
    if (d) d.last_seen_at = at
  }
  async getSettings(): Promise<Settings | null> {
    return this.settings ? { ...this.settings } : null
  }
  async getChainHead(deviceId: string): Promise<ChainHead | null> {
    this.count('getChainHead')
    // Comme device_chain_head() : dernier enregistrement, ou l'ancre de purge s'il n'en reste aucun.
    const candidates: ChainHead[] = [
      ...this.records.filter((r) => r.device_id === deviceId),
      ...this.anchors.filter((a) => a.device_id === deviceId),
    ].map((x) => ({ device_seq: x.device_seq, hash: x.hash }))
    candidates.sort((a, b) => b.device_seq - a.device_seq)
    return candidates[0] ?? null
  }
  async getRecordsByIds(ids: string[]): Promise<StoredRecord[]> {
    this.count('getRecordsByIds')
    return this.records
      .filter((r) => ids.includes(r.id))
      .map((r) => ({
        id: r.id,
        type: r.type,
        hash: r.hash,
        device_id: r.device_id,
        device_seq: r.device_seq,
        supersedes_id: r.supersedes_id,
        server_time: r.server_time,
        clock_suspect: r.clock_suspect,
        quarantine_reason: r.quarantine_reason,
      }))
  }
  async getStaffStatus(staffId: string) {
    this.count('getStaffStatus')
    const s = this.staff.find((x) => x.id === staffId)
    return s ? { id: s.id, active: s.active } : null
  }
  async equipmentExists(equipmentId: string): Promise<boolean> {
    return this.equipment.some((e) => e.id === equipmentId)
  }
  async supplierExists(supplierId: string): Promise<boolean> {
    this.count('supplierExists')
    return this.suppliers.some((s) => s.id === supplierId)
  }
  async getPayloadsByIds(ids: string[]) {
    this.count('getPayloadsByIds')
    return this.records.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, type: r.type, payload: structuredClone(r.payload) }))
  }
  /** Reproduit le trigger haccp_records_before_insert puis les contraintes d'unicité. */
  async insertRecord(row: NewRecordRow): Promise<InsertResult> {
    this.count('insertRecord')
    this.inserted.push(structuredClone(row))
    this.beforeInsert?.(row)
    const refusal = this.rejectInsert?.(row)
    if (refusal) return classifyDbError('23514', refusal)
    const raise = (code: string, msg: string) => classifyDbError(code, msg)

    const serverTime = this.serverClock()
    if (this.devices.find((d) => d.id === row.device_id)?.revoked_at) return raise('23514', `HACCP: device_revoked — appareil ${row.device_id} révoqué`)
    if (row.quarantine_reason === null) {
      if (!this.staff.some((s) => s.id === row.author_id)) return raise('23503', `HACCP: unknown_author — membre ${row.author_id} inconnu`)
      if (row.supersedes_id !== null && !this.records.some((r) => r.id === row.supersedes_id)) {
        return raise('23503', `HACCP: supersedes_not_found — enregistrement corrigé ${row.supersedes_id} introuvable`)
      }
    }
    if (row.device_seq > 1) {
      const prev =
        this.records.find((r) => r.device_id === row.device_id && r.device_seq === row.device_seq - 1) ??
        this.anchors.find((a) => a.device_id === row.device_id && a.device_seq === row.device_seq - 1)
      if (!prev) return raise('23514', `HACCP: seq_gap — maillon ${row.device_seq - 1} absent`)
      if (prev.hash !== row.prev_hash) return raise('23514', `HACCP: broken_chain — prev_hash ne correspond pas au maillon ${row.device_seq - 1}`)
    }
    if (this.records.some((r) => r.id === row.id || (r.device_id === row.device_id && r.device_seq === row.device_seq))) {
      return raise('23505', 'duplicate key value violates unique constraint')
    }
    const server_time = serverTime.toISOString()
    // Comme le trigger (appelé en service_role) : device_now remplace device_time, OU avec la valeur fournie.
    const clock_suspect =
      row.clock_suspect === true ||
      isClockSuspect(serverTime, new Date(row.device_now ?? row.device_time), this.settings?.clock_suspect_minutes)
    this.records.push({ ...structuredClone(row), server_time, clock_suspect })
    return { ok: true, server_time, clock_suspect }
  }

  async getEstablishment() {
    return this.establishment
  }
  private since<T extends { updated_at: string }>(rows: T[], since: string | null): T[] {
    return since ? rows.filter((r) => new Date(r.updated_at).getTime() >= new Date(since).getTime()) : [...rows]
  }
  async listStaff(since: string | null) {
    return this.since(this.staff, since)
  }
  async listEquipment(since: string | null) {
    return this.since(this.equipment, since)
  }
  async listThresholds(since: string | null) {
    return this.since(this.thresholds, since)
  }
  async listSuppliers(since: string | null) {
    return this.since(this.suppliers, since)
  }

  async getUserIdFromJwt(jwt: string) {
    return this.jwts.get(jwt) ?? null
  }
  async isManager(userId: string) {
    return this.managers.has(userId)
  }
  async insertDevice(row: { name: string; token_hash: string; enrolled_by: string }) {
    const id = crypto.randomUUID()
    this.devices.push({ id, name: row.name, token_hash: row.token_hash, revoked_at: null, last_seen_at: null, enrolled_by: row.enrolled_by })
    return { id }
  }

  // ---- bootstrap du gérant ----
  async countManagers() {
    return this.managers.size
  }
  async getEstablishmentName() {
    return this.establishment?.name ?? null
  }
  async countRecentBootstrapFailures(windowMinutes: number) {
    const since = this.serverClock().getTime() - windowMinutes * 60_000
    return this.bootstrapFailures.filter((f) => f.at.getTime() > since).length
  }
  async recordBootstrapFailure(reason: string) {
    this.bootstrapFailures.push({ at: this.serverClock(), reason: /^[a-z_]{1,40}$/.test(reason) ? reason : 'other' })
  }
  async createAuthUser(email: string, password: string): Promise<CreateAuthUserResult> {
    this.count('createAuthUser')
    this.receivedPasswords.push(password)
    if (this.createUserRefusal) return this.createUserRefusal
    if ([...this.authUsers.values()].some((u) => u.email === email)) return { ok: false, kind: 'email_exists' }
    const id = crypto.randomUUID()
    this.authUsers.set(id, { email })
    return { ok: true, user_id: id }
  }
  async deleteAuthUser(userId: string) {
    this.count('deleteAuthUser')
    if (this.deleteUserThrows) throw new Error('auth indisponible')
    this.authUsers.delete(userId)
  }
  /** Reproduit public.bootstrap_manager() : revérifie l'absence de gérant puis écrit tout d'un bloc. */
  async bootstrapManager(row: BootstrapManagerRow): Promise<BootstrapManagerResult> {
    this.count('bootstrapManager')
    this.beforeBootstrap?.(row)
    if (this.bootstrapThrows) throw new Error('DbError: bootstrap_manager : 57P01 terminating connection')
    if (this.managers.size > 0) return { ok: false, kind: 'already_bootstrapped' }
    if (!this.authUsers.has(row.user_id)) throw new Error('DbError: bootstrap_manager : 23503 foreign key')
    const id = crypto.randomUUID()
    this.managers.add(row.user_id)
    this.staff.push({
      id,
      display_name: row.display_name,
      role: 'manager',
      active: true,
      pin_salt: row.pin_salt,
      pin_hash: row.pin_hash,
      updated_at: this.serverClock().toISOString(),
    })
    this.staffUserIds.set(id, row.user_id)
    if (this.establishment) this.establishment = { ...this.establishment, name: row.establishment_name }
    else this.establishment = { id: crypto.randomUUID(), name: row.establishment_name, timezone: 'Europe/Paris' }
    return { ok: true, staff_id: id }
  }

  async ping() {
    if (this.pingFails) throw new Error('connexion refusée')
  }
}

/** Bucket `photos` en mémoire (photo-upload, purge-photos). */
export class MemoryPhotoStore implements PhotoStore, PhotoRemover {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  writes = 0
  /** Appelé juste avant l'écriture : permet de simuler un envoi concurrent. */
  beforeCreate: ((path: string) => void) | null = null
  /** Chemins dont la suppression échoue. */
  failRemove = new Set<string>()
  async stat(path: string) {
    const o = this.objects.get(path)
    return o ? { size: o.bytes.byteLength } : null
  }
  async create(path: string, bytes: Uint8Array, contentType: string): Promise<'created' | 'exists'> {
    this.beforeCreate?.(path)
    if (this.objects.has(path)) return 'exists'
    this.writes++
    this.objects.set(path, { bytes: bytes.slice(), contentType })
    return 'created'
  }
  async remove(paths: string[]): Promise<string[]> {
    const removed: string[] = []
    for (const p of paths) {
      if (this.failRemove.has(p) || !this.objects.delete(p)) continue
      removed.push(p)
    }
    return removed
  }
}

/** photos_to_purge() / record_photo_purge() en mémoire : `purgeable` liste les chemins expirés non référencés. */
export class MemoryPurgeRepo implements PurgePhotosRepo {
  private readonly store: MemoryPhotoStore
  purgeable: string[]
  constructor(store: MemoryPhotoStore, purgeable: string[] = []) {
    this.store = store
    this.purgeable = purgeable
  }
  logs: { deleted: number; failed: number }[] = []
  async listPurgeablePhotos(limit: number) {
    return this.purgeable.filter((p) => this.store.objects.has(p)).slice(0, limit)
  }
  async recordPhotoPurge(deleted: number, failed: number) {
    this.logs.push({ deleted, failed })
  }
}
