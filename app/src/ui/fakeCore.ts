// Implémentation EN MÉMOIRE de CoreApi, pour les tests et la démo de l'interface.
// Aucune persistance, aucun réseau, aucune cryptographie réelle : ne jamais l'utiliser en production.
import type { CoreApi, DeviceInfo, SyncStatus, UnlockResult } from '../core/api.ts'
import {
  GENESIS_HASH,
  type Equipment,
  type Establishment,
  type HaccpRecord,
  type RecordType,
  type Settings,
  type StaffMember,
  type Threshold,
} from '../../../shared/types.ts'
import { DEMO_EQUIPMENT, DEMO_THRESHOLDS } from '../core/mockTransport.ts'

export const FAKE_STAFF_PINS: Record<string, string> = {
  'staff-gerant': '123456',
  'staff-equipier': '654321',
}

export const FAKE_MAX_ATTEMPTS = 5
export const FAKE_LOCKOUT_SECONDS = 300

export interface FakeCoreOptions {
  /** Appareil déjà enrôlé au démarrage (défaut : false). */
  enrolled?: boolean
  /** Équipier déjà déverrouillé au démarrage (id). */
  unlockedStaffId?: string
  /** État initial de synchro (fusionné avec l'état « tout est synchronisé »). */
  sync?: Partial<SyncStatus>
  /** Les saisies sont « acceptées par le serveur » automatiquement après ce délai si en ligne (défaut 1200 ms ; null = jamais). */
  autoSyncDelayMs?: number | null
  /** Délai simulé des appels (défaut 0). */
  latencyMs?: number
  settings?: Partial<Settings>
  /** Simule un enrôlement hors-ligne : listStaff() renvoie [] jusqu'à la prochaine synchro réussie. */
  noStaffUntilSync?: boolean
  /** Enregistrements déjà présents (démo, tests) : chaînés dans l'ordre donné, `device_time` imposé. */
  initialRecords?: FakeRecordSeed[]
}

export interface FakeRecordSeed {
  /** id imposé (sinon uuid aléatoire). */
  id?: string
  type: RecordType
  payload: Record<string, unknown>
  author_id: string
  device_time: string
  supersedes_id?: string | null
  /** Déjà accepté par le serveur (défaut true). */
  synced?: boolean
}

export interface FakeCore extends CoreApi {
  /** Contrôles de simulation (tests/démo uniquement). */
  simulate: {
    setSyncStatus(patch: Partial<SyncStatus>): void
    setOnline(online: boolean): void
    /** Marque toutes les saisies en attente comme acceptées. */
    flush(): void
  }
}

const NOW = () => new Date().toISOString()
const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
const fakeHash = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createFakeCore(options: FakeCoreOptions = {}): FakeCore {
  const t0 = '2026-01-01T00:00:00.000Z'
  const staff: StaffMember[] = [
    { id: 'staff-gerant', display_name: 'Gérant', role: 'manager', active: true, pin_salt: 'fake', pin_hash: 'fake', updated_at: t0 },
    { id: 'staff-equipier', display_name: 'Équipier', role: 'staff', active: true, pin_salt: 'fake', pin_hash: 'fake', updated_at: t0 },
  ]
  // Mêmes équipements et seuils que le serveur simulé (identifiants uuid, comme en production).
  const equipment: Equipment[] = DEMO_EQUIPMENT.map((e) => ({ ...e }))
  const establishment: Establishment = { id: 'etab-demo', name: 'Food Truck (démo)', timezone: 'Europe/Paris' }
  const settings: Settings = {
    daily_check_times: ['08:00', '18:00'],
  missed_slot_carry_over: true,
  thaw_dlc_days: 3,
    retention_years: 3,
    auto_lock_minutes: 5,
    clock_suspect_minutes: 5,
    email_alerts: true,
    ...options.settings,
  }
  const thresholds: Threshold[] = DEMO_THRESHOLDS.map((t) => ({ ...t }))

  let device: DeviceInfo | null = options.enrolled
    ? { device_id: '00000000-0000-4000-8000-000000000001', name: 'iPad cuisine', enrolled_at: t0 }
    : null
  let current: StaffMember | null = staff.find((s) => s.id === options.unlockedStaffId) ?? null
  const attempts = new Map<string, { failures: number; lockedUntil: number }>()
  const records: HaccpRecord[] = []
  for (const seed of options.initialRecords ?? []) {
    const last = records[records.length - 1]
    records.push({
      id: seed.id ?? uuid(),
      type: seed.type,
      payload: { ...seed.payload },
      author_id: seed.author_id,
      device_id: '00000000-0000-4000-8000-000000000001',
      device_seq: records.length + 1,
      device_time: seed.device_time,
      prev_hash: last ? last.hash : GENESIS_HASH,
      supersedes_id: seed.supersedes_id ?? null,
      hash: fakeHash(),
      ...(seed.synced === false ? {} : { server_time: seed.device_time }),
    })
  }
  const sessionListeners = new Set<(s: StaffMember | null) => void>()
  const syncListeners = new Set<(s: SyncStatus) => void>()
  const autoSyncDelay = options.autoSyncDelayMs === undefined ? 1200 : options.autoSyncDelayMs
  const latency = options.latencyMs ?? 0
  let staffSynced = !options.noStaffUntilSync

  let status: SyncStatus = {
    online: true,
    pending_count: 0,
    oldest_pending_at: null,
    last_success_at: NOW(),
    last_error: null,
    rejected_count: 0,
    ...options.sync,
  }

  const wait = () => (latency > 0 ? new Promise<void>((r) => setTimeout(r, latency)) : Promise.resolve())
  const emitSession = () => sessionListeners.forEach((cb) => cb(current))
  const emitSync = () => {
    const snapshot = { ...status }
    syncListeners.forEach((cb) => cb(snapshot))
  }
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    emitSync()
  }

  const flush = () => {
    const now = NOW()
    for (const r of records) if (!r.server_time) r.server_time = now
    staffSynced = true
    setStatus({ pending_count: 0, oldest_pending_at: null, last_success_at: now, last_error: null })
  }

  const scheduleSync = () => {
    if (autoSyncDelay === null) return
    setTimeout(() => {
      if (status.online) flush()
    }, autoSyncDelay)
  }

  const core: FakeCore = {
    async getDevice() {
      await wait()
      return device ? { ...device } : null
    },

    async enrollDevice({ device_id, device_token, name }) {
      await wait()
      if (!name.trim()) throw new Error('Le nom de l’appareil est obligatoire.')
      if (!UUID_RE.test(device_id.trim())) throw new Error('Identifiant d’appareil invalide.')
      if (device_token.trim().length < 8 || device_token.trim() === 'invalide') {
        throw new Error('Jeton d’appareil refusé par le serveur. Demandez un nouveau jeton au gérant.')
      }
      if (!status.online) throw new Error('Pas de réseau : l’enrôlement nécessite une connexion Internet.')
      device = { device_id: device_id.trim(), name: name.trim(), enrolled_at: NOW() }
    },

    async listStaff() {
      await wait()
      if (!staffSynced) return []
      return staff.filter((s) => s.active).map((s) => ({ ...s }))
    },

    async unlock(staffId, pin): Promise<UnlockResult> {
      await wait()
      const member = staff.find((s) => s.id === staffId && s.active)
      const a = attempts.get(staffId) ?? { failures: 0, lockedUntil: 0 }
      const now = Date.now()
      if (a.lockedUntil > now) {
        return { ok: false, reason: 'locked_out', retry_after_seconds: Math.ceil((a.lockedUntil - now) / 1000) }
      }
      if (member && FAKE_STAFF_PINS[staffId] === pin) {
        attempts.delete(staffId)
        current = member
        emitSession()
        return { ok: true, staff: { ...member } }
      }
      a.failures += 1
      if (a.failures >= FAKE_MAX_ATTEMPTS) {
        a.failures = 0
        a.lockedUntil = now + FAKE_LOCKOUT_SECONDS * 1000
        attempts.set(staffId, a)
        return { ok: false, reason: 'locked_out', retry_after_seconds: FAKE_LOCKOUT_SECONDS }
      }
      attempts.set(staffId, a)
      return { ok: false, reason: 'wrong_pin' }
    },

    lock() {
      if (current === null) return
      current = null
      emitSession()
    },

    currentStaff() {
      return current ? { ...current } : null
    },

    onSessionChange(cb) {
      sessionListeners.add(cb)
      return () => sessionListeners.delete(cb)
    },

    async addRecord(type: RecordType, payload, opts) {
      await wait()
      if (!current) throw new Error('Aucun équipier connecté.')
      if (!device) throw new Error('Appareil non enrôlé.')
      const last = records[records.length - 1]
      const rec: HaccpRecord = {
        id: uuid(),
        type,
        payload: { ...payload },
        author_id: current.id,
        device_id: device.device_id,
        device_seq: records.length + 1,
        device_time: NOW(),
        prev_hash: last ? last.hash : GENESIS_HASH,
        supersedes_id: opts?.supersedes_id ?? null,
        hash: fakeHash(),
      }
      records.push(rec)
      setStatus({
        pending_count: status.pending_count + 1,
        oldest_pending_at: status.oldest_pending_at ?? rec.device_time,
      })
      scheduleSync()
      return { ...rec }
    },

    async listRecords(filter) {
      await wait()
      let list = [...records].reverse()
      if (filter?.type) list = list.filter((r) => r.type === filter.type)
      if (filter?.since) list = list.filter((r) => r.device_time >= filter.since!)
      if (filter?.limit) list = list.slice(0, filter.limit)
      return list.map((r) => ({ ...r }))
    },

    async getEstablishment() {
      await wait()
      return device ? { ...establishment } : null
    },
    async listEquipment() {
      await wait()
      return equipment.filter((e) => e.active).map((e) => ({ ...e }))
    },
    async listThresholds() {
      await wait()
      return thresholds.map((t) => ({ ...t }))
    },
    async getSettings() {
      await wait()
      return { ...settings }
    },

    async syncNow() {
      await wait()
      if (status.online) flush()
      else setStatus({ last_error: 'Pas de réseau' })
      return { ...status }
    },
    async getSyncStatus() {
      return { ...status }
    },
    onSyncStatusChange(cb) {
      syncListeners.add(cb)
      return () => syncListeners.delete(cb)
    },

    async requestPersistentStorage() {
      try {
        return (await navigator.storage?.persist?.()) ?? false
      } catch {
        return false
      }
    },

    simulate: {
      setSyncStatus: setStatus,
      setOnline(online) {
        setStatus({ online })
        if (online && status.pending_count > 0) scheduleSync()
      },
      flush,
    },
  }
  return core
}
