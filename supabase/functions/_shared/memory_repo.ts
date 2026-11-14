// Dépôt en mémoire pour les tests : reproduit les contraintes utiles de la base
// (clé primaire records.id, unique(device_id, device_seq), server_time posé par le serveur).
import type { Equipment, Establishment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'
import type {
  ChainHead,
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

export class MemoryRepo implements PushRepo, PullRepo, EnrollRepo, HealthRepo {
  devices: MemoryDevice[] = []
  staff: StaffMember[] = []
  equipment: Equipment[] = []
  thresholds: Threshold[] = []
  establishment: Establishment | null = null
  settings: Settings | null = null
  records: (NewRecordRow & { server_time: string })[] = []
  managers = new Set<string>()
  jwts = new Map<string, string>() // jwt -> user id
  serverClock: () => Date = () => new Date()
  /** Appelé juste avant chaque insertion : permet de simuler un envoi concurrent. */
  beforeInsert: ((row: NewRecordRow) => void) | null = null
  /** Permet de simuler un refus métier de la base. */
  rejectInsert: ((row: NewRecordRow) => string | null) | null = null
  pingFails = false
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
    const mine = this.records.filter((r) => r.device_id === deviceId).sort((a, b) => b.device_seq - a.device_seq)
    return mine[0] ? { device_seq: mine[0].device_seq, hash: mine[0].hash } : null
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
  async insertRecord(row: NewRecordRow): Promise<InsertResult> {
    this.count('insertRecord')
    this.beforeInsert?.(row)
    const refusal = this.rejectInsert?.(row)
    if (refusal) return { ok: false, kind: 'rejected', detail: refusal }
    if (this.records.some((r) => r.id === row.id || (r.device_id === row.device_id && r.device_seq === row.device_seq))) {
      return { ok: false, kind: 'unique_violation' }
    }
    const server_time = this.serverClock().toISOString()
    this.records.push({ ...structuredClone(row), server_time })
    return { ok: true, server_time }
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

  async ping() {
    if (this.pingFails) throw new Error('connexion refusée')
  }
}
