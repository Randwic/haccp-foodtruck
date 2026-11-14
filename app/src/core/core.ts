// Implémentation de CoreApi : registre local append-only, chaîne de hachage, synchro, session PIN.
import Dexie from 'dexie'
import { canonicalJson, computeRecordHash } from '../../../shared/canonical.ts'
import {
  GENESIS_HASH,
  type Equipment,
  type Establishment,
  type HaccpRecord,
  type RecordCore,
  type RecordType,
  type Settings,
  type StaffMember,
  type SyncPullResponse,
  type Threshold,
} from '../../../shared/types.ts'
import type { CoreApi, DeviceInfo, SyncStatus, UnlockResult } from './api.ts'
import { CoreDb, type DeviceRow, type RecordSyncRow, type StoredRecord } from './db.ts'
import { RECORD_TYPES } from './recordTypes.ts'
import { PIN_LOCKOUT_MS, PIN_MAX_FAILURES, verifyPin } from './pin.ts'
import { isTransportError, type Transport } from './transport.ts'

// ---------- Constantes ----------
export const SYNC_BATCH_SIZE = 200
export const SYNC_INTERVAL_MS = 60_000
export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_MAX_MS = 5 * 60_000
/** Utilisé tant que les settings n'ont pas été reçus du serveur. */
export const DEFAULT_AUTO_LOCK_MINUTES = 5
const AUTO_LOCK_CHECK_MS = 15_000
const DEFAULT_DB_NAME = 'haccp-core'

/** Délai d'attente après `failures` échecs consécutifs : 5 s, 10 s, 20 s… plafonné à 5 min. */
export function computeBackoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1))
}

// ---------- Erreurs ----------
export type CoreErrorCode = 'session_locked' | 'not_enrolled' | 'invalid_input' | 'enroll_unauthorized'
export class CoreError extends Error {
  readonly code: CoreErrorCode
  constructor(code: CoreErrorCode, message: string) {
    super(message)
    this.name = 'CoreError'
    this.code = code
  }
}
class DeviceRevokedError extends Error {}

// ---------- Types publics ----------
export type SyncTrigger = 'record' | 'online' | 'visible' | 'periodic' | 'retry' | 'manual'

export type ChainCheck =
  | { ok: true; count: number }
  | { ok: false; count: number; broken_at_seq: number; reason: 'seq_gap' | 'broken_chain' | 'invalid_hash' }

export interface CoreOptions {
  transport: Transport
  dbName?: string
  now?: () => Date
  randomUUID?: () => string
  /** Écouteurs online/visibilitychange + synchro périodique + contrôle d'auto-lock (défaut true). */
  background?: boolean
  /** Période de la synchro automatique (défaut 60 s). */
  syncIntervalMs?: number
}

export interface Core extends CoreApi {
  /** À appeler par l'interface à chaque interaction (toucher, saisie) : repousse l'auto-lock. */
  notifyActivity(): void
  /** Revérifie localement la chaîne de hachage de cet appareil. */
  verifyChain(): Promise<ChainCheck>
  /** Demande une synchro (respecte le backoff sauf pour online/visible/manual). */
  triggerSync(reason: SyncTrigger): Promise<void>
  /** Résout quand aucune synchro n'est en cours. */
  whenSyncIdle(): Promise<void>
  /** Arrête minuteries et écouteurs, ferme la base. */
  dispose(): Promise<void>
}

// Registre des instances, pour la fonction module `notifyActivity()`.
const instances = new Set<Core>()
/** Signale une activité utilisateur à toutes les instances du core. */
export function notifyActivity(): void {
  for (const c of instances) c.notifyActivity()
}

// ---------- Utilitaires ----------
function isPlainJson(v: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((x) => isPlainJson(x, depth + 1))
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return false // Date, Map, classes… refusés
    return Object.values(v as object).every((x) => isPlainJson(x, depth + 1))
  }
  return false // undefined, fonction, bigint, symbol
}

function toWire(r: StoredRecord): HaccpRecord {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    author_id: r.author_id,
    device_id: r.device_id,
    device_seq: r.device_seq,
    device_time: r.device_time,
    prev_hash: r.prev_hash,
    supersedes_id: r.supersedes_id,
    hash: r.hash,
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------- Fabrique ----------
export function createCore(options: CoreOptions): Core {
  const transport = options.transport
  const now = options.now ?? (() => new Date())
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID())
  const background = options.background ?? true
  const db = new CoreDb(options.dbName ?? DEFAULT_DB_NAME)

  let disposed = false

  // --- Session ---
  let session: { staff: StaffMember; lastActivity: number } | null = null
  let autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES
  const sessionListeners = new Set<(s: StaffMember | null) => void>()
  const statusListeners = new Set<(s: SyncStatus) => void>()

  // Charge les settings déjà connus (auto-lock) dès l'ouverture.
  const ready: Promise<void> = db
    .getMeta('settings', null)
    .then((s) => {
      if (s) autoLockMinutes = s.auto_lock_minutes
    })
    .catch(() => undefined)

  function emitSession(): void {
    const s = session?.staff ?? null
    for (const cb of sessionListeners) {
      try {
        cb(s)
      } catch (e) {
        console.error('onSessionChange', e)
      }
    }
  }

  function setSession(next: typeof session): void {
    const changed = (session?.staff.id ?? null) !== (next?.staff.id ?? null)
    session = next
    if (changed) emitSession()
  }

  /** Verrouille si l'inactivité dépasse auto_lock_minutes. */
  function checkAutoLock(): void {
    if (!session) return
    if (now().getTime() - session.lastActivity >= autoLockMinutes * 60_000) setSession(null)
  }

  function currentStaff(): StaffMember | null {
    checkAutoLock()
    return session?.staff ?? null
  }

  function touch(): void {
    checkAutoLock()
    if (session) session.lastActivity = now().getTime()
  }

  // --- Statut de synchro ---
  async function computeStatus(): Promise<SyncStatus> {
    const pending = await db.record_sync.where('state').equals('pending').toArray()
    const rejected_count = await db.record_sync.where('state').equals('rejected').count()
    let oldest: string | null = null
    for (const p of pending) if (oldest === null || p.created_at < oldest) oldest = p.created_at
    return {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      pending_count: pending.length,
      oldest_pending_at: oldest,
      last_success_at: await db.getMeta('last_success_at', null),
      last_error: await db.getMeta('last_error', null),
      rejected_count,
    }
  }

  async function emitStatus(): Promise<void> {
    if (disposed || statusListeners.size === 0) return
    try {
      const s = await computeStatus()
      for (const cb of statusListeners) {
        try {
          cb(s)
        } catch (e) {
          console.error('onSyncStatusChange', e)
        }
      }
    } catch {
      // base fermée (dispose) : rien à notifier
    }
  }

  // --- Synchronisation ---
  let failures = 0
  let nextAttemptAt = 0
  let running: Promise<void> | null = null
  let rerun = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleRetry(): void {
    if (disposed || !background) return
    if (retryTimer) clearTimeout(retryTimer)
    const delay = Math.max(1_000, nextAttemptAt - now().getTime())
    retryTimer = setTimeout(() => {
      retryTimer = null
      void triggerSync('retry')
    }, delay)
  }

  async function applyPull(resp: SyncPullResponse): Promise<void> {
    await db.transaction('rw', [db.staff, db.equipment, db.thresholds, db.meta], async () => {
      if (resp.staff.length) await db.staff.bulkPut(resp.staff)
      if (resp.equipment.length) await db.equipment.bulkPut(resp.equipment)
      if (resp.thresholds.length) await db.thresholds.bulkPut(resp.thresholds)
      for (const d of resp.deleted) {
        // Staff / équipements : on garde la ligne (pour afficher l'auteur d'anciens relevés) mais inactive.
        if (d.table === 'staff') await db.staff.update(d.id, { active: false })
        else if (d.table === 'equipment') await db.equipment.update(d.id, { active: false })
        else if (d.table === 'thresholds') await db.thresholds.delete(d.id)
      }
      await db.setMeta('establishment', resp.establishment)
      await db.setMeta('settings', resp.settings)
      await db.setMeta('since', resp.server_now)
    })
    autoLockMinutes = resp.settings.auto_lock_minutes
    // L'équipier connecté a été désactivé côté gérant : on ferme sa session.
    if (session) {
      const fresh = await db.staff.get(session.staff.id)
      if (!fresh || !fresh.active) setSession(null)
      else session.staff = fresh
    }
  }

  async function pullOnce(device: DeviceRow): Promise<void> {
    const since = await db.getMeta('since', null)
    const resp = await transport.pull(since, { device_token: device.device_token })
    await applyPull(resp)
  }

  async function pushAll(device: DeviceRow): Promise<void> {
    for (;;) {
      const rows = await db.record_sync
        .where('[state+device_seq]')
        .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
        .filter((r) => r.device_id === device.device_id)
        .limit(SYNC_BATCH_SIZE)
        .toArray()
      if (rows.length === 0) return
      const stored = await db.records.bulkGet(rows.map((r) => r.id))
      const records = stored.filter((r): r is StoredRecord => !!r).map(toWire)
      const resp = await transport.push({ device_id: device.device_id, records }, { device_token: device.device_token })

      const batchIds = new Set(rows.map((r) => r.id))
      let progressed = 0
      let revoked = false
      await db.transaction('rw', db.record_sync, async () => {
        for (const a of resp.accepted ?? []) {
          if (!batchIds.has(a.id)) continue
          const row = await db.record_sync.get(a.id)
          if (!row || row.state !== 'pending') continue
          await db.record_sync.put({ ...row, state: 'accepted', server_time: a.server_time, clock_suspect: a.clock_suspect })
          progressed++
        }
        for (const r of resp.rejected ?? []) {
          if (!batchIds.has(r.id)) continue
          if (r.reason === 'device_revoked') {
            revoked = true // l'enregistrement reste « pending » : il n'est pas en cause
            continue
          }
          const row = await db.record_sync.get(r.id)
          if (!row || row.state !== 'pending') continue
          await db.record_sync.put({ ...row, state: 'rejected', reject_reason: r.reason, reject_detail: r.detail ?? null })
          progressed++
        }
      })
      void emitStatus()
      if (revoked) throw new DeviceRevokedError('device_revoked')
      if (progressed === 0) throw new Error('Réponse du serveur incomplète (aucun enregistrement traité)')
      if (rows.length < SYNC_BATCH_SIZE) return
    }
  }

  /** Une passe complète push puis pull. Renvoie true si réussie. */
  async function syncOnce(): Promise<boolean> {
    const device = await db.device.get('self')
    if (!device) return true
    if (await db.getMeta('revoked', false)) return false
    try {
      await pushAll(device)
      await pullOnce(device)
      failures = 0
      nextAttemptAt = 0
      await db.setMeta('last_success_at', now().toISOString())
      await db.setMeta('last_error', null)
      return true
    } catch (e) {
      if (disposed) return false
      const unauthorized = e instanceof DeviceRevokedError || (isTransportError(e) && e.kind === 'unauthorized')
      if (unauthorized) {
        // Arrêt de la synchro jusqu'à un nouvel enrôlement.
        await db.setMeta('revoked', true)
        await db.setMeta('last_error', `device_revoked : synchronisation arrêtée (${errorMessage(e)})`)
        return false
      }
      failures++
      nextAttemptAt = now().getTime() + computeBackoffMs(failures)
      await db.setMeta('last_error', errorMessage(e))
      scheduleRetry()
      return false
    } finally {
      void emitStatus()
    }
  }

  function runExclusive(): Promise<void> {
    if (running) {
      rerun = true // une saisie arrivée pendant la synchro sera envoyée juste après
      return running
    }
    running = (async () => {
      try {
        let ok: boolean
        do {
          rerun = false
          ok = await syncOnce()
        } while (rerun && ok && !disposed)
      } catch (e) {
        if (!disposed) console.error('sync', e)
      } finally {
        running = null
      }
    })()
    return running
  }

  function triggerSync(reason: SyncTrigger): Promise<void> {
    if (disposed) return Promise.resolve()
    const force = reason === 'online' || reason === 'visible' || reason === 'manual'
    if (force) {
      nextAttemptAt = 0
    } else if (now().getTime() < nextAttemptAt) {
      scheduleRetry()
      return running ?? Promise.resolve()
    }
    return runExclusive()
  }

  // --- Écouteurs et minuteries ---
  const onOnline = () => {
    void emitStatus()
    void triggerSync('online')
  }
  const onOffline = () => void emitStatus()
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      checkAutoLock()
      void triggerSync('visible')
    }
  }
  let periodic: ReturnType<typeof setInterval> | null = null
  let lockTimer: ReturnType<typeof setInterval> | null = null
  if (background) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    periodic = setInterval(() => void triggerSync('periodic'), options.syncIntervalMs ?? SYNC_INTERVAL_MS)
    lockTimer = setInterval(checkAutoLock, AUTO_LOCK_CHECK_MS)
  }

  // ---------- API ----------
  const core: Core = {
    async getDevice(): Promise<DeviceInfo | null> {
      const d = await db.device.get('self')
      return d ? { device_id: d.device_id, name: d.name, enrolled_at: d.enrolled_at } : null
    },

    async enrollDevice({ device_id, device_token, name }) {
      if (!device_id || !device_token || !name.trim()) throw new CoreError('invalid_input', 'Enrôlement : champs manquants')
      const previous = await db.device.get('self')
      const row: DeviceRow = { key: 'self', device_id, device_token, name: name.trim(), enrolled_at: now().toISOString() }
      await db.transaction('rw', [db.device, db.meta], async () => {
        await db.device.put(row)
        await db.setMeta('revoked', false)
        await db.setMeta('last_error', null)
      })
      failures = 0
      nextAttemptAt = 0
      try {
        await pullOnce(row)
        await db.setMeta('last_success_at', now().toISOString())
      } catch (e) {
        if (isTransportError(e) && e.kind === 'unauthorized') {
          // Jeton refusé : on revient à l'état précédent.
          if (previous) await db.device.put(previous)
          else await db.device.delete('self')
          void emitStatus()
          throw new CoreError('enroll_unauthorized', `Jeton d'appareil refusé : ${e.message}`)
        }
        // Pas de réseau : l'appareil reste enrôlé, les références viendront à la prochaine synchro.
        failures = 1
        nextAttemptAt = now().getTime() + computeBackoffMs(failures)
        await db.setMeta('last_error', errorMessage(e))
        scheduleRetry()
      }
      void emitStatus()
    },

    async listStaff() {
      const all = await db.staff.toArray()
      return all.filter((s) => s.active).sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'))
    },

    async unlock(staffId, pin): Promise<UnlockResult> {
      await ready
      const t = now().getTime()
      const attempts = await db.pin_attempts.get(staffId)
      if (attempts?.locked_until && Date.parse(attempts.locked_until) > t) {
        return { ok: false, reason: 'locked_out', retry_after_seconds: Math.ceil((Date.parse(attempts.locked_until) - t) / 1000) }
      }
      const staff = await db.staff.get(staffId)
      // Même coût de calcul si l'équipier est inconnu (pas d'oracle temporel).
      const ref = staff && staff.active ? staff : { pin_salt: 'AAAAAAAAAAAAAAAAAAAAAA==', pin_hash: '' }
      const ok = (await verifyPin(pin, ref)) && !!staff && staff.active
      if (ok && staff) {
        await db.pin_attempts.put({ staff_id: staffId, failures: 0, locked_until: null })
        setSession({ staff, lastActivity: now().getTime() })
        return { ok: true, staff }
      }
      // Lecture-modification-écriture atomique du compteur d'échecs.
      const result = await db.transaction('rw', db.pin_attempts, async (): Promise<UnlockResult> => {
        const tt = now().getTime()
        const cur = await db.pin_attempts.get(staffId)
        const expired = !cur?.locked_until || Date.parse(cur.locked_until) <= tt
        if (!expired && cur?.locked_until) {
          return { ok: false, reason: 'locked_out', retry_after_seconds: Math.ceil((Date.parse(cur.locked_until) - tt) / 1000) }
        }
        const fails = (cur?.failures ?? 0) + 1
        if (fails >= PIN_MAX_FAILURES) {
          await db.pin_attempts.put({ staff_id: staffId, failures: 0, locked_until: new Date(tt + PIN_LOCKOUT_MS).toISOString() })
          return { ok: false, reason: 'locked_out', retry_after_seconds: Math.ceil(PIN_LOCKOUT_MS / 1000) }
        }
        await db.pin_attempts.put({ staff_id: staffId, failures: fails, locked_until: null })
        return { ok: false, reason: 'wrong_pin' }
      })
      return result
    },

    lock() {
      setSession(null)
    },

    currentStaff,

    onSessionChange(cb) {
      sessionListeners.add(cb)
      return () => void sessionListeners.delete(cb)
    },

    async addRecord(type: RecordType, payload: Record<string, unknown>, opts?: { supersedes_id?: string }) {
      const staff = currentStaff()
      if (!staff) throw new CoreError('session_locked', 'Session verrouillée : saisissez votre PIN')
      const device = await db.device.get('self')
      if (!device) throw new CoreError('not_enrolled', "Appareil non enrôlé")
      if (!(RECORD_TYPES as readonly string[]).includes(type)) throw new CoreError('invalid_input', `Type inconnu : ${type}`)
      const supersedes_id = opts?.supersedes_id ?? null
      if (type === 'correction' && !supersedes_id) throw new CoreError('invalid_input', 'Une correction doit indiquer supersedes_id')
      if (type !== 'correction' && supersedes_id) throw new CoreError('invalid_input', 'supersedes_id réservé au type correction')
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !isPlainJson(payload)) {
        throw new CoreError('invalid_input', 'Payload non sérialisable en JSON canonique (Date, undefined, NaN… interdits)')
      }
      // Copie normalisée : ce qui est stocké est exactement ce qui est haché.
      const cleanPayload = JSON.parse(canonicalJson(payload)) as Record<string, unknown>
      touch()

      // Une seule transaction : lecture de la tête de chaîne, hachage, écriture. IndexedDB sérialise
      // les transactions rw sur les mêmes tables : deux appels concurrents ne peuvent pas lire la même tête.
      const record = await db.transaction('rw', [db.records, db.record_sync, db.chain], async () => {
        const head = (await db.chain.get(device.device_id)) ?? { device_id: device.device_id, last_seq: 0, last_hash: GENESIS_HASH }
        const recordCore: RecordCore = {
          id: randomUUID(),
          type,
          payload: cleanPayload,
          author_id: staff.id,
          device_id: device.device_id,
          device_seq: head.last_seq + 1,
          device_time: now().toISOString(),
          prev_hash: head.last_hash,
          supersedes_id,
        }
        // Dexie.waitFor garde la transaction ouverte pendant l'appel WebCrypto (asynchrone, hors IndexedDB).
        const hash = await Dexie.waitFor(computeRecordHash(recordCore))
        const stored: StoredRecord = { ...recordCore, hash }
        await db.records.add(stored)
        const syncRow: RecordSyncRow = {
          id: stored.id,
          device_id: stored.device_id,
          device_seq: stored.device_seq,
          state: 'pending',
          created_at: stored.device_time,
          server_time: null,
          clock_suspect: null,
          reject_reason: null,
          reject_detail: null,
        }
        await db.record_sync.add(syncRow)
        await db.chain.put({ device_id: device.device_id, last_seq: stored.device_seq, last_hash: hash })
        return stored
      })
      void emitStatus()
      void triggerSync('record') // non bloquant
      return toWire(record)
    },

    async listRecords(filter) {
      const coll = filter?.since
        ? db.records.where('device_time').aboveOrEqual(filter.since).reverse()
        : db.records.orderBy('device_time').reverse()
      const typed = filter?.type ? coll.filter((r) => r.type === filter.type) : coll
      const rows = await (filter?.limit ? typed.limit(filter.limit) : typed).toArray()
      const syncRows = await db.record_sync.bulkGet(rows.map((r) => r.id))
      return rows.map((r, i) => {
        const w = toWire(r)
        const st = syncRows[i]?.server_time
        return st ? { ...w, server_time: st } : w
      })
    },

    async getEstablishment(): Promise<Establishment | null> {
      return db.getMeta('establishment', null)
    },
    async listEquipment(): Promise<Equipment[]> {
      const all = await db.equipment.toArray()
      return all.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async listThresholds(): Promise<Threshold[]> {
      return db.thresholds.toArray()
    },
    async getSettings(): Promise<Settings | null> {
      return db.getMeta('settings', null)
    },

    async syncNow() {
      await triggerSync('manual')
      return computeStatus()
    },
    getSyncStatus: computeStatus,
    onSyncStatusChange(cb) {
      statusListeners.add(cb)
      return () => void statusListeners.delete(cb)
    },

    async requestPersistentStorage() {
      try {
        const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
        if (!storage || typeof storage.persist !== 'function') return false
        if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
        return await storage.persist()
      } catch {
        return false
      }
    },

    notifyActivity: touch,

    async verifyChain(): Promise<ChainCheck> {
      const device = await db.device.get('self')
      if (!device) return { ok: true, count: 0 }
      const rows = await db.records
        .where('[device_id+device_seq]')
        .between([device.device_id, Dexie.minKey], [device.device_id, Dexie.maxKey])
        .toArray()
      let prev = GENESIS_HASH
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        if (r.device_seq !== i + 1) return { ok: false, count: rows.length, broken_at_seq: i + 1, reason: 'seq_gap' }
        if (r.prev_hash !== prev) return { ok: false, count: rows.length, broken_at_seq: r.device_seq, reason: 'broken_chain' }
        if ((await computeRecordHash(r)) !== r.hash) return { ok: false, count: rows.length, broken_at_seq: r.device_seq, reason: 'invalid_hash' }
        prev = r.hash
      }
      return { ok: true, count: rows.length }
    },

    triggerSync,

    async whenSyncIdle() {
      while (running) await running
    },

    async dispose() {
      if (disposed) return
      disposed = true // plus aucune nouvelle synchro ne démarre
      instances.delete(core)
      if (periodic) clearInterval(periodic)
      if (lockTimer) clearInterval(lockTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      while (running) await running
      db.close()
    },
  }

  instances.add(core)
  return core
}
