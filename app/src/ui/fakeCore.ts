// Implémentation EN MÉMOIRE de CoreApi, pour les tests et la démo de l'interface.
// Aucune persistance, aucun réseau, aucune cryptographie réelle : ne jamais l'utiliser en production.
import type { CoreApi, DeviceInfo, PhotoStatus, SyncStatus, UnlockResult } from '../core/api.ts'
import type { Alert, Checklist, CleaningTask, Product, Recipe, Supplier } from '../../../shared/payloads.ts'
import { referencedPhotoPaths } from '../../../shared/validation.ts'
import { createBrowserPhotoEncoder, isWebp, type PhotoEncoder } from '../core/photoEncoder.ts'
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
import { DEMO_CHECKLISTS, DEMO_CLEANING_TASKS, DEMO_EQUIPMENT, DEMO_PRODUCTS, DEMO_RECIPES, DEMO_SUPPLIERS, DEMO_THRESHOLDS } from '../core/mockTransport.ts'

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
  /** Fournisseurs (défaut : les 3 fournisseurs de démonstration ; désactivés compris). */
  suppliers?: Supplier[]
  /** Produits (défaut : les produits de démonstration du serveur ; désactivés compris). */
  products?: Product[]
  /** Recettes (défaut : la recette de démonstration du serveur ; désactivées comprises). */
  recipes?: Recipe[]
  /** Plan de nettoyage (défaut : les tâches de démonstration du serveur ; désactivées comprises). */
  cleaningTasks?: CleaningTask[]
  /** Checklists (défaut : ouverture, fermeture, nuisibles du serveur ; désactivées comprises). */
  checklists?: Checklist[]
  /** Lot 6 : alertes « reçues du serveur » (défaut : aucune). */
  alerts?: Alert[]
  /** Équipements (défaut : ceux du serveur simulé, dont 2 bacs de friteuse). */
  equipment?: Equipment[]
  /** Compression des photos (défaut : encodeur du navigateur ; les tests injectent un encodeur simulé). */
  photoEncoder?: PhotoEncoder
  /** Photos déjà présentes (démo) : chemin → image (ou fabrique, appelée à la première lecture) et état. */
  initialPhotos?: Record<string, { image: Blob | (() => Promise<Blob>); state?: FakePhotoState }>
}

export type FakePhotoState = 'draft' | 'pending' | 'uploaded' | 'failed'
interface FakePhoto {
  image: Blob | (() => Promise<Blob>)
  state: FakePhotoState
  error: string | null
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
    /** Ajoute / modifie un fournisseur (comme un sync-pull après une action du gérant). */
    upsertSupplier(s: Supplier): void
    /** Ajoute / modifie un produit ou une recette (comme un sync-pull). */
    upsertProduct(p: Product): void
    upsertRecipe(r: Recipe): void
    /** Ajoute / modifie une tâche de nettoyage ou une checklist (comme un sync-pull). */
    upsertCleaningTask(t: CleaningTask): void
    upsertChecklist(c: Checklist): void
    /** Refus définitif d'une photo par le serveur (ex. 409 photo_conflict). */
    failPhoto(path: string, error?: string): void
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
  const equipment: Equipment[] = (options.equipment ?? DEMO_EQUIPMENT).map((e) => ({ ...e }))
  const establishment: Establishment = { id: 'etab-demo', name: 'Food Truck (démo)', timezone: 'Europe/Paris' }
  const settings: Settings = {
    daily_check_times: ['08:00', '18:00'],
  missed_slot_carry_over: true,
  thaw_dlc_days: 3,
  oil_polar_max: 25,
  oil_polar_warn: 22,
  thermometer_tolerance_c: 1,
  thermometer_check_days: 30,
    sensor_silent_minutes: 60,
    alert_repeat_minutes: 15,
    retention_years: 3,
    auto_lock_minutes: 5,
    clock_suspect_minutes: 5,
    email_alerts: true,
    ...options.settings,
  }
  const thresholds: Threshold[] = DEMO_THRESHOLDS.map((t) => ({ ...t }))
  const suppliers: Supplier[] = (options.suppliers ?? DEMO_SUPPLIERS).map((x) => ({ ...x }))
  const products: Product[] = structuredClone(options.products ?? DEMO_PRODUCTS)
  const recipes: Recipe[] = structuredClone(options.recipes ?? DEMO_RECIPES)
  const cleaningTasks: CleaningTask[] = structuredClone(options.cleaningTasks ?? DEMO_CLEANING_TASKS)
  const checklists: Checklist[] = structuredClone(options.checklists ?? DEMO_CHECKLISTS)
  const alerts: Alert[] = structuredClone(options.alerts ?? [])
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr')
  const upsert = <T extends { id: string }>(list: T[], item: T) => {
    const i = list.findIndex((x) => x.id === item.id)
    if (i >= 0) list[i] = structuredClone(item)
    else list.push(structuredClone(item))
  }
  const photos = new Map<string, FakePhoto>(
    Object.entries(options.initialPhotos ?? {}).map(([path, p]) => [path, { image: p.image, state: p.state ?? 'uploaded', error: null }]),
  )
  let photoEncoder: PhotoEncoder | null = options.photoEncoder ?? null

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
  const photoCounts = () => {
    let photos_pending = 0
    let photos_failed = 0
    for (const p of photos.values()) {
      if (p.state === 'pending') photos_pending++
      else if (p.state === 'failed') photos_failed++
    }
    return { photos_pending, photos_failed }
  }
  const emitSync = () => {
    const snapshot = { ...status, ...photoCounts() }
    syncListeners.forEach((cb) => cb(snapshot))
  }
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    emitSync()
  }

  const flush = () => {
    const now = NOW()
    for (const r of records) if (!r.server_time) r.server_time = now
    for (const p of photos.values()) if (p.state === 'pending') p.state = 'uploaded'
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
      const replacement = rec.payload.replacement
      const paths =
        type === 'correction'
          ? typeof replacement === 'object' && replacement !== null && !Array.isArray(replacement)
            ? referencedPhotoPaths('reception', replacement as Record<string, unknown>) // photo_paths + items[].photo_paths : couvre aussi waste / cleaning_done
            : []
          : referencedPhotoPaths(type, rec.payload)
      for (const path of paths) {
        const p = photos.get(path)
        if (p?.state === 'draft') p.state = 'pending'
      }
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
    async listSuppliers(opts) {
      await wait()
      return suppliers
        .filter((x) => opts?.includeInactive || x.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map((x) => ({ ...x }))
    },
    async listProducts(opts) {
      await wait()
      return structuredClone(products.filter((x) => opts?.includeInactive || x.active).sort(byName))
    },
    async listRecipes(opts) {
      await wait()
      return structuredClone(recipes.filter((x) => opts?.includeInactive || x.active).sort(byName))
    },
    async listCleaningTasks(opts) {
      await wait()
      return structuredClone(cleaningTasks.filter((x) => opts?.includeInactive || x.active).sort(byName))
    },
    async listChecklists(opts) {
      await wait()
      return structuredClone(checklists.filter((x) => opts?.includeInactive || x.active).sort(byName))
    },
    async listAlerts() {
      await wait()
      return structuredClone(alerts.filter((a) => a.resolved_at === null).sort((a, b) => b.opened_at.localeCompare(a.opened_at)))
    },

    async addPhoto(image) {
      await wait()
      if (!device) throw new Error('Appareil non enrôlé.')
      photoEncoder ??= createBrowserPhotoEncoder()
      const enc = await photoEncoder(image)
      if (!isWebp(enc.bytes)) throw new Error('Photo : encodage WebP impossible.')
      const path = `${device.device_id}/${uuid()}.webp`
      photos.set(path, { image: new Blob([enc.bytes.slice().buffer], { type: 'image/webp' }), state: 'draft', error: null })
      return { path, size: enc.bytes.byteLength, width: enc.width, height: enc.height }
    },
    async discardPhoto(path) {
      const p = photos.get(path)
      if (!p || p.state !== 'draft') return false
      photos.delete(path)
      return true
    },
    async getPhoto(path) {
      const p = photos.get(path)
      if (!p) return null
      if (typeof p.image === 'function') p.image = await p.image()
      return p.image
    },
    async getPhotoStatuses(paths) {
      const out: Record<string, PhotoStatus> = {}
      for (const path of paths) {
        const p = photos.get(path)
        out[path] = p ? { state: p.state, error: p.error, local: true } : { state: 'absent', error: null, local: false }
      }
      return out
    },

    async syncNow() {
      await wait()
      if (status.online) flush()
      else setStatus({ last_error: 'Pas de réseau' })
      return { ...status, ...photoCounts() }
    },
    async getSyncStatus() {
      return { ...status, ...photoCounts() }
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
      upsertSupplier(sup) {
        const i = suppliers.findIndex((x) => x.id === sup.id)
        if (i >= 0) suppliers[i] = { ...sup }
        else suppliers.push({ ...sup })
        emitSync()
      },
      upsertProduct(p) {
        upsert(products, p)
        emitSync()
      },
      upsertRecipe(r) {
        upsert(recipes, r)
        emitSync()
      },
      upsertCleaningTask(t) {
        upsert(cleaningTasks, t)
        emitSync()
      },
      upsertChecklist(c) {
        upsert(checklists, c)
        emitSync()
      },
      failPhoto(path, error = 'photo_conflict') {
        const p = photos.get(path)
        if (p) {
          p.state = 'failed'
          p.error = error
        }
        emitSync()
      },
    },
  }
  return core
}
