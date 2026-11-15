// Implémentation EN MÉMOIRE de ManagerApi (développement sans Supabase, démo, tests).
// Si un MockTransport (serveur simulé du core) est fourni, chaque écriture y est répercutée :
// après core.syncNow(), la base locale de l'appareil voit les changements, comme en vrai.
import {
  DEMO_DEVICE,
  DEMO_EQUIPMENT,
  DEMO_ESTABLISHMENT,
  DEMO_SETTINGS,
  DEMO_STAFF,
  DEMO_SUPPLIERS,
  DEMO_PRODUCTS,
  DEMO_RECIPES,
  DEMO_CLEANING_TASKS,
  DEMO_CHECKLISTS,
  DEMO_THRESHOLDS,
  type MockTransport,
  type Transport,
} from '../core/index.ts'
import type { DeviceEnrollResponse, Equipment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'
import type { Checklist, CleaningTask, Product, Recipe, Supplier } from '../../../shared/payloads.ts'
import { normalizeProduct, normalizeRecipe } from '../core/catalog.ts'
import { wouldCreateCycle } from '../features/labels/allergens.ts'
import { ManagerError, MESSAGES, type ManagedStaff, type ManagerApi, type ManagerErrorCode, type ManagerSettings } from './api.ts'
import { normalizeChecklistInput, normalizeCleaningTaskInput, normalizeProductInput, normalizeRecipeInput, normalizeSupplierInput, oilSettingsError } from './helpers.ts'

/** Compte de démonstration (mode `seeded`). */
export const MOCK_MANAGER_ACCOUNT = { email: 'gerant@demo.fr', password: 'demo-demo-demo' } as const

export interface MockManagerOptions {
  /** Serveur simulé du core à alimenter (sinon : données gardées ici seulement). */
  transport?: MockTransport
  /** Compte gérant + équipe/équipements de démonstration déjà présents (défaut false : premier lancement). */
  seeded?: boolean
  latencyMs?: number
  /** Persiste l'état dans localStorage sous cette clé (mode développement dans le navigateur). */
  storageKey?: string
  /** 'demo' : l'enrôlement renvoie l'appareil de démonstration (jeton connu du serveur simulé même après rechargement). */
  enrollAs?: 'demo' | 'new'
  /** Connexion réseau (défaut : navigator.onLine). */
  isOnline?: () => boolean
  /** Session gérant déjà ouverte (mode `seeded` uniquement ; démo de l'interface). */
  signedIn?: boolean
  /** Catalogue initial (défaut : produits / recette de démonstration du serveur). */
  catalog?: { products: Product[]; recipes: Recipe[] }
  /**
   * Démo `?demo=` : répercute les écritures de références sur le core factice (fakeCore.simulate), pour que
   * les produits / recettes créés dans Gestion apparaissent aussitôt dans Étiquettes, Cuisson…
   */
  referenceSink?: ReferenceSink
}

/** Ce que le core factice expose pour recevoir les références (même forme que FakeCore.simulate). */
export interface ReferenceSink {
  upsertSupplier(s: Supplier): void
  upsertProduct(p: Product): void
  upsertRecipe(r: Recipe): void
  upsertCleaningTask(t: CleaningTask): void
  upsertChecklist(c: Checklist): void
}

interface MockState {
  bootstrapped: boolean
  account: { email: string; password: string } | null
  session: string | null
  establishment_name: string
  auto_lock_minutes: number
  daily_check_times: string[]
  missed_slot_carry_over: boolean
  thaw_dlc_days: number
  oil_polar_max: number
  oil_polar_warn: number
  staff: StaffMember[]
  equipment: Equipment[]
  thresholds: Threshold[]
  suppliers: Supplier[]
  products: Product[]
  recipes: Recipe[]
  cleaning_tasks: CleaningTask[]
  checklists: Checklist[]
}

export interface MockManagerApi extends ManagerApi {
  simulate: {
    setOffline(offline: boolean): void
    /** La prochaine opération échoue avec ce code. */
    failNext(code: ManagerErrorCode, message?: string): void
    /** Fait expirer la session gérant. */
    expireSession(): void
    /** État courant (copie). */
    state(): MockState
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const nowIso = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

function initialState(seeded: boolean): MockState {
  if (!seeded) {
    return { bootstrapped: false, account: null, session: null, establishment_name: '', auto_lock_minutes: 5, daily_check_times: [...DEMO_SETTINGS.daily_check_times], missed_slot_carry_over: DEMO_SETTINGS.missed_slot_carry_over, thaw_dlc_days: DEMO_SETTINGS.thaw_dlc_days, oil_polar_max: DEMO_SETTINGS.oil_polar_max, oil_polar_warn: DEMO_SETTINGS.oil_polar_warn, staff: [], equipment: [], thresholds: [], suppliers: [], products: clone(DEMO_PRODUCTS), recipes: clone(DEMO_RECIPES), cleaning_tasks: clone(DEMO_CLEANING_TASKS), checklists: clone(DEMO_CHECKLISTS) }
  }
  return {
    bootstrapped: true,
    account: { ...MOCK_MANAGER_ACCOUNT },
    session: null,
    establishment_name: DEMO_ESTABLISHMENT.name,
    auto_lock_minutes: DEMO_SETTINGS.auto_lock_minutes,
    daily_check_times: [...DEMO_SETTINGS.daily_check_times],
    missed_slot_carry_over: DEMO_SETTINGS.missed_slot_carry_over,
    thaw_dlc_days: DEMO_SETTINGS.thaw_dlc_days,
    oil_polar_max: DEMO_SETTINGS.oil_polar_max,
    oil_polar_warn: DEMO_SETTINGS.oil_polar_warn,
    staff: clone(DEMO_STAFF),
    equipment: clone(DEMO_EQUIPMENT),
    thresholds: clone(DEMO_THRESHOLDS),
    suppliers: clone(DEMO_SUPPLIERS),
    products: clone(DEMO_PRODUCTS),
    recipes: clone(DEMO_RECIPES),
    cleaning_tasks: clone(DEMO_CLEANING_TASKS),
    checklists: clone(DEMO_CHECKLISTS),
  }
}

/** Fait apparaître le nom d'établissement du gérant dans les sync-pull du serveur simulé. */
export function withEstablishmentName(transport: Transport, name: () => string): Transport {
  return {
    push: (req, auth) => transport.push(req, auth),
    async pull(since, auth) {
      const res = await transport.pull(since, auth)
      const n = name()
      return n ? { ...res, establishment: { ...res.establishment, name: n } } : res
    },
  }
}

/** Même règle que la base : 1 à 6 heures « HH:MM » distinctes (renvoyées triées). */
function checkCheckTimes(times: unknown): string[] {
  if (!Array.isArray(times) || times.length < 1 || times.length > 6 || !times.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    throw new ManagerError('validation', 'Indiquez de 1 à 6 heures de relevé au format HH:MM.', 400)
  }
  if (new Set(times).size !== times.length) throw new ManagerError('validation', 'Chaque heure de relevé ne doit apparaître qu’une fois.', 400)
  return [...(times as string[])].sort()
}

export function createMockManagerApi(opts: MockManagerOptions = {}): MockManagerApi {
  const latency = opts.latencyMs ?? 0
  const t = opts.transport
  let offline = false
  let pendingFailure: ManagerError | null = null
  let failedLogins = 0

  let state: MockState = initialState(opts.seeded ?? false)
  if (opts.catalog) {
    state.products = clone(opts.catalog.products)
    state.recipes = clone(opts.catalog.recipes)
  }
  const sink = opts.referenceSink
  if (opts.signedIn && state.account) state.session = state.account.email
  if (opts.storageKey) {
    try {
      const raw = localStorage.getItem(opts.storageKey)
      if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<MockState>) }
      state.suppliers ??= [] // état enregistré avant le lot 3
      state.products ??= clone(DEMO_PRODUCTS) // état enregistré avant le lot 4
      state.recipes ??= clone(DEMO_RECIPES)
      state.cleaning_tasks ??= clone(DEMO_CLEANING_TASKS) // état enregistré avant le lot 5
      state.checklists ??= clone(DEMO_CHECKLISTS)
      state.products = state.products.map(normalizeProduct) // état enregistré avant le lot 4 bis
      state.recipes = state.recipes.map(normalizeRecipe)
    } catch {
      /* état illisible : on repart de zéro */
    }
  }
  const save = () => {
    if (!opts.storageKey) return
    try {
      localStorage.setItem(opts.storageKey, JSON.stringify(state))
    } catch {
      /* quota : sans importance en démo */
    }
  }

  // ---- répercussion vers le serveur simulé du core ----
  const pushSettings = () =>
    t?.setSettings({
      ...DEMO_SETTINGS,
      auto_lock_minutes: state.auto_lock_minutes,
      daily_check_times: [...state.daily_check_times],
      missed_slot_carry_over: state.missed_slot_carry_over ?? DEMO_SETTINGS.missed_slot_carry_over,
      thaw_dlc_days: state.thaw_dlc_days ?? DEMO_SETTINGS.thaw_dlc_days,
      oil_polar_max: state.oil_polar_max ?? DEMO_SETTINGS.oil_polar_max,
      oil_polar_warn: state.oil_polar_warn ?? DEMO_SETTINGS.oil_polar_warn,
    } satisfies Settings)
  const pushStaff = (s: StaffMember) => {
    if (!t) return
    const { updated_at: _u, ...rest } = s
    void _u
    t.upsertStaff({ ...rest, active: true })
    if (!s.active) t.deactivate('staff', s.id)
  }
  const pushEquipment = (e: Equipment) => {
    if (!t) return
    const { updated_at: _u, ...rest } = e
    void _u
    t.upsertEquipment({ ...rest, active: true })
    if (!e.active) t.deactivate('equipment', e.id)
  }
  const pushThreshold = (th: Threshold) => {
    if (!t) return
    const { updated_at: _u, ...rest } = th
    void _u
    t.upsertThreshold(rest)
  }
  const pushSupplier = (s: Supplier) => {
    sink?.upsertSupplier(clone(s))
    if (!t) return
    const { updated_at: _u, ...rest } = s
    void _u
    t.upsertSupplier({ ...rest, active: true })
    if (!s.active) t.deactivate('suppliers', s.id)
  }
  const pushProduct = (p: Product) => {
    sink?.upsertProduct(clone(p))
    if (!t) return
    const { updated_at: _u, ...rest } = p
    void _u
    t.upsertProduct({ ...rest, active: true })
    if (!p.active) t.deactivate('products', p.id)
  }
  const pushRecipe = (r: Recipe) => {
    sink?.upsertRecipe(clone(r))
    if (!t) return
    const { updated_at: _u, ...rest } = r
    void _u
    t.upsertRecipe({ ...rest, active: true })
    if (!r.active) t.deactivate('recipes', r.id)
  }
  const pushCleaningTask = (x: CleaningTask) => {
    sink?.upsertCleaningTask(clone(x))
    if (!t) return
    const { updated_at: _u, ...rest } = x
    void _u
    t.upsertCleaningTask({ ...rest, active: true })
    if (!x.active) t.deactivate('cleaning_tasks', x.id)
  }
  const pushChecklist = (x: Checklist) => {
    sink?.upsertChecklist(clone(x))
    if (!t) return
    const { updated_at: _u, ...rest } = x
    void _u
    t.upsertChecklist({ ...rest, active: true })
    if (!x.active) t.deactivate('checklists', x.id)
  }
  if (t) {
    state.cleaning_tasks.forEach(pushCleaningTask)
    state.checklists.forEach(pushChecklist)
    state.products.forEach(pushProduct)
    state.recipes.forEach(pushRecipe)
    state.suppliers.forEach(pushSupplier)
    state.staff.forEach(pushStaff)
    state.equipment.forEach(pushEquipment)
    state.thresholds.forEach(pushThreshold)
    pushSettings()
  }

  /** Mêmes règles que la base : préparations existantes, de type 'preparation', sans boucle. */
  const checkSubRecipes = (selfId: string, ids: string[]) => {
    for (const x of ids) {
      const sub = state.recipes.find((r) => r.id === x)
      if (!sub || sub.kind !== 'preparation') throw new ManagerError('validation', 'Préparation inconnue.', 400)
      if (wouldCreateCycle(selfId, x, state.recipes)) throw new ManagerError('validation', 'Une préparation ne peut pas se contenir elle-même.', 400)
    }
  }

  const online = () => !offline && (opts.isOnline ? opts.isOnline() : typeof navigator === 'undefined' || navigator.onLine !== false)

  async function gate(needSession = false) {
    if (latency > 0) await new Promise((r) => setTimeout(r, latency))
    if (!online()) throw new ManagerError('network', MESSAGES.network)
    if (pendingFailure) {
      const f = pendingFailure
      pendingFailure = null
      throw f
    }
    if (needSession && !state.session) throw new ManagerError('unauthorized', MESSAGES.unauthorized, 401)
  }

  const toManaged = (s: StaffMember): ManagedStaff => ({ id: s.id, display_name: s.display_name, role: s.role, active: s.active, updated_at: s.updated_at })
  const requireName = (name: string, what: string, max = 100) => {
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n) throw new ManagerError('validation', `${what} est obligatoire.`, 400)
    if (n.length > max) throw new ManagerError('validation', `${what} est trop long (${max} caractères au plus).`, 400)
    return n
  }
  const settingsView = (): ManagerSettings => ({
    establishment_name: state.establishment_name,
    auto_lock_minutes: state.auto_lock_minutes,
    daily_check_times: [...state.daily_check_times],
    // États enregistrés avant l'ajout de ces réglages : valeurs par défaut.
    missed_slot_carry_over: state.missed_slot_carry_over ?? DEMO_SETTINGS.missed_slot_carry_over,
    thaw_dlc_days: state.thaw_dlc_days ?? DEMO_SETTINGS.thaw_dlc_days,
    oil_polar_max: state.oil_polar_max ?? DEMO_SETTINGS.oil_polar_max,
    oil_polar_warn: state.oil_polar_warn ?? DEMO_SETTINGS.oil_polar_warn,
  })

  const api: MockManagerApi = {
    mode: 'mock',

    async getBootstrapStatus() {
      await gate()
      return { needs_bootstrap: !state.bootstrapped, establishment_name: state.establishment_name }
    },

    async bootstrap(input) {
      await gate()
      if (state.bootstrapped) throw new ManagerError('already_bootstrapped', MESSAGES.already_bootstrapped, 409)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new ManagerError('validation', 'Adresse email invalide.', 400)
      if (input.password.length < 12) throw new ManagerError('validation', 'Le mot de passe doit comporter au moins 12 caractères.', 400)
      if (new TextEncoder().encode(input.password).length > 72) throw new ManagerError('validation', 'Le mot de passe est trop long (72 octets au maximum).', 422)
      if (!input.pin_salt || !input.pin_hash) throw new ManagerError('validation', 'Code PIN invalide.', 400)
      const display_name = requireName(input.display_name, 'Votre nom')
      const establishment_name = requireName(input.establishment_name, 'Le nom de l’établissement', 200)
      const staff: StaffMember = { id: uuid(), display_name, role: 'manager', active: true, pin_salt: input.pin_salt, pin_hash: input.pin_hash, updated_at: nowIso() }
      state = { ...state, bootstrapped: true, account: { email: input.email.trim().toLowerCase(), password: input.password }, establishment_name, staff: [...state.staff, staff] }
      pushStaff(staff)
      pushSettings()
      save()
      return { staff_id: staff.id }
    },

    async signIn(email, password) {
      await gate()
      if (failedLogins >= 5) throw new ManagerError('rate_limited', MESSAGES.rate_limited, 429)
      const a = state.account
      if (!a || a.email !== email.trim().toLowerCase() || a.password !== password) {
        failedLogins++
        throw new ManagerError('invalid_credentials', MESSAGES.invalid_credentials, 400)
      }
      failedLogins = 0
      state.session = a.email
      save()
    },

    async signOut() {
      state.session = null
      save()
    },

    async sessionEmail() {
      return state.session
    },

    async enrollDevice(name): Promise<DeviceEnrollResponse> {
      await gate(true)
      requireName(name, 'Le nom de l’appareil', 60)
      if (opts.enrollAs === 'demo') return { ...DEMO_DEVICE }
      if (t) return t.enrollDevice(name.trim())
      return { device_id: uuid(), device_token: `mock-${uuid()}` }
    },

    async listEquipment() {
      await gate(true)
      return clone(state.equipment).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addEquipment({ name, kind }) {
      await gate(true)
      const e: Equipment = { id: uuid(), name: requireName(name, 'Le nom'), kind, active: true, updated_at: nowIso() }
      state.equipment.push(e)
      pushEquipment(e)
      save()
      return clone(e)
    },
    async updateEquipment(id, patch) {
      await gate(true)
      const e = state.equipment.find((x) => x.id === id)
      if (!e) throw new ManagerError('validation', 'Équipement introuvable.', 404)
      if (patch.name !== undefined) e.name = requireName(patch.name, 'Le nom')
      if (patch.active !== undefined) e.active = patch.active
      e.updated_at = nowIso()
      pushEquipment(e)
      save()
      return clone(e)
    },

    async listThresholds() {
      await gate(true)
      return clone(state.thresholds)
    },
    async saveThreshold(input) {
      await gate(true)
      if (input.min_c === null && input.max_c === null) throw new ManagerError('validation', 'Indiquez au moins une limite (min ou max).', 400)
      if (input.min_c !== null && input.max_c !== null && input.min_c > input.max_c) throw new ManagerError('validation', 'Le minimum doit être inférieur au maximum.', 400)
      let th = state.thresholds.find((x) => x.equipment_id === input.equipment_id && x.check_type === input.check_type)
      if (th) Object.assign(th, input, { updated_at: nowIso() })
      else {
        th = { id: uuid(), ...input, updated_at: nowIso() }
        state.thresholds.push(th)
      }
      pushThreshold(th)
      save()
      return clone(th)
    },

    async listStaff() {
      await gate(true)
      return state.staff.map(toManaged).sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'))
    },
    async addStaff(input) {
      await gate(true)
      const s: StaffMember = { id: uuid(), display_name: requireName(input.display_name, 'Le nom'), role: input.role, active: true, pin_salt: input.pin_salt, pin_hash: input.pin_hash, updated_at: nowIso() }
      state.staff.push(s)
      pushStaff(s)
      save()
      return toManaged(s)
    },
    async updateStaff(id, patch) {
      await gate(true)
      const s = state.staff.find((x) => x.id === id)
      if (!s) throw new ManagerError('validation', 'Membre de l’équipe introuvable.', 404)
      if (patch.display_name !== undefined) s.display_name = requireName(patch.display_name, 'Le nom')
      if (patch.active !== undefined) s.active = patch.active
      if (patch.pin_salt !== undefined && patch.pin_hash !== undefined) {
        s.pin_salt = patch.pin_salt
        s.pin_hash = patch.pin_hash
      }
      s.updated_at = nowIso()
      pushStaff(s)
      save()
      return toManaged(s)
    },

    async getSettings() {
      await gate(true)
      return settingsView()
    },
    async saveSettings(patch) {
      await gate(true)
      if (patch.establishment_name !== undefined) state.establishment_name = requireName(patch.establishment_name, 'Le nom de l’établissement', 200)
      if (patch.auto_lock_minutes !== undefined) {
        const m = patch.auto_lock_minutes
        if (!Number.isInteger(m) || m < 1 || m > 30) throw new ManagerError('validation', 'Le délai doit être compris entre 1 et 30 minutes.', 400)
        state.auto_lock_minutes = m
      }
      if (patch.daily_check_times !== undefined) state.daily_check_times = checkCheckTimes(patch.daily_check_times)
      if (patch.missed_slot_carry_over !== undefined) state.missed_slot_carry_over = patch.missed_slot_carry_over === true
      if (patch.thaw_dlc_days !== undefined) {
        const d = patch.thaw_dlc_days
        if (!Number.isInteger(d) || d < 0 || d > 30) throw new ManagerError('validation', 'La DLC après décongélation doit être comprise entre 0 et 30 jours.', 400)
        state.thaw_dlc_days = d
      }
      if (patch.oil_polar_max !== undefined || patch.oil_polar_warn !== undefined) {
        const max = patch.oil_polar_max ?? state.oil_polar_max ?? DEMO_SETTINGS.oil_polar_max
        const warn = patch.oil_polar_warn ?? state.oil_polar_warn ?? DEMO_SETTINGS.oil_polar_warn
        const e = oilSettingsError(max, warn)
        if (e) throw new ManagerError('validation', e, 400)
        state.oil_polar_max = max
        state.oil_polar_warn = warn
      }
      pushSettings() // le nom d'établissement passe par withEstablishmentName()
      save()
      return settingsView()
    },

    async listSuppliers() {
      await gate(true)
      return clone(state.suppliers).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addSupplier(input) {
      await gate(true)
      const n = normalizeSupplierInput({ name: input.name, phone: input.phone ?? null, email: input.email ?? null })
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      const s: Supplier = { id: uuid(), name: n.value.name!, phone: n.value.phone ?? null, email: n.value.email ?? null, active: true, updated_at: nowIso() }
      state.suppliers.push(s)
      pushSupplier(s)
      save()
      return clone(s)
    },
    async updateSupplier(id, patch) {
      await gate(true)
      const s = state.suppliers.find((x) => x.id === id)
      if (!s) throw new ManagerError('validation', 'Fournisseur introuvable.', 404)
      const n = normalizeSupplierInput(patch)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      Object.assign(s, n.value)
      if (patch.active !== undefined) s.active = patch.active
      s.updated_at = nowIso()
      pushSupplier(s)
      save()
      return clone(s)
    },
    async listProducts() {
      await gate(true)
      return clone(state.products).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addProduct(input) {
      await gate(true)
      const n = normalizeProductInput(input)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      const p: Product = {
        id: uuid(),
        name: n.value.name!,
        allergens: n.value.allergens ?? [],
        storage: n.value.storage ?? 'fridge',
        shelf_life_opened_hours: n.value.shelf_life_opened_hours ?? null,
        shelf_life_thawed_hours: n.value.shelf_life_thawed_hours ?? null,
        may_contain: n.value.may_contain ?? [],
        cook_min_c: n.value.cook_min_c ?? null,
        active: true,
        updated_at: nowIso(),
      }
      state.products.push(p)
      pushProduct(p)
      save()
      return clone(p)
    },
    async updateProduct(id, patch) {
      await gate(true)
      const p = state.products.find((x) => x.id === id)
      if (!p) throw new ManagerError('validation', 'Produit introuvable.', 404)
      const { active, ...fields } = patch
      const n = normalizeProductInput(fields)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      Object.assign(p, n.value)
      if (active !== undefined) p.active = active
      p.updated_at = nowIso()
      pushProduct(p)
      save()
      return clone(p)
    },
    async listRecipes() {
      await gate(true)
      return clone(state.recipes).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addRecipe(input) {
      await gate(true)
      const n = normalizeRecipeInput(input)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      const ids = n.value.ingredient_product_ids ?? []
      if (ids.some((x) => !state.products.some((p) => p.id === x))) throw new ManagerError('validation', 'Ingrédient inconnu.', 400)
      const id = uuid()
      checkSubRecipes(id, n.value.ingredient_recipe_ids ?? [])
      const kind = n.value.kind ?? 'preparation'
      if (kind === 'preparation' && !n.value.shelf_life_hours) throw new ManagerError('validation', 'Indiquez une durée de vie.', 400)
      const r: Recipe = {
        id,
        name: n.value.name!,
        kind,
        category: n.value.category ?? null,
        ingredient_product_ids: ids,
        ingredient_recipe_ids: n.value.ingredient_recipe_ids ?? [],
        extra_allergens: n.value.extra_allergens ?? [],
        may_contain: n.value.may_contain ?? [],
        storage: n.value.storage ?? 'fridge',
        shelf_life_hours: kind === 'menu_item' ? null : n.value.shelf_life_hours!,
        active: true,
        updated_at: nowIso(),
      }
      state.recipes.push(r)
      pushRecipe(r)
      save()
      return clone(r)
    },
    async updateRecipe(id, patch) {
      await gate(true)
      const r = state.recipes.find((x) => x.id === id)
      if (!r) throw new ManagerError('validation', 'Recette introuvable.', 404)
      const { active, ...fields } = patch
      const n = normalizeRecipeInput(fields)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      if ((n.value.ingredient_product_ids ?? []).some((x) => !state.products.some((p) => p.id === x))) throw new ManagerError('validation', 'Ingrédient inconnu.', 400)
      if (n.value.ingredient_recipe_ids) checkSubRecipes(id, n.value.ingredient_recipe_ids)
      Object.assign(r, n.value)
      if (active !== undefined) r.active = active
      r.updated_at = nowIso()
      pushRecipe(r)
      save()
      return clone(r)
    },

    async listCleaningTasks() {
      await gate(true)
      return clone(state.cleaning_tasks).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addCleaningTask(input) {
      await gate(true)
      const n = normalizeCleaningTaskInput(input)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      const x: CleaningTask = {
        id: uuid(),
        name: n.value.name!,
        frequency: n.value.frequency ?? 'daily',
        product: n.value.product ?? null,
        method: n.value.method ?? null,
        active: true,
        updated_at: nowIso(),
      }
      state.cleaning_tasks.push(x)
      pushCleaningTask(x)
      save()
      return clone(x)
    },
    async updateCleaningTask(id, patch) {
      await gate(true)
      const x = state.cleaning_tasks.find((c) => c.id === id)
      if (!x) throw new ManagerError('validation', 'Tâche introuvable.', 404)
      const { active, ...fields } = patch
      const n = normalizeCleaningTaskInput(fields)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      Object.assign(x, n.value)
      if (active !== undefined) x.active = active
      x.updated_at = nowIso()
      pushCleaningTask(x)
      save()
      return clone(x)
    },
    async listChecklists() {
      await gate(true)
      return clone(state.checklists).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async addChecklist(input) {
      await gate(true)
      const n = normalizeChecklistInput(input)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      if (!n.value.items) throw new ManagerError('validation', 'Ajoutez au moins un point à contrôler.', 400)
      const x: Checklist = { id: uuid(), name: n.value.name!, kind: n.value.kind ?? 'other', items: n.value.items, active: true, updated_at: nowIso() }
      state.checklists.push(x)
      pushChecklist(x)
      save()
      return clone(x)
    },
    async updateChecklist(id, patch) {
      await gate(true)
      const x = state.checklists.find((c) => c.id === id)
      if (!x) throw new ManagerError('validation', 'Checklist introuvable.', 404)
      const { active, ...fields } = patch
      const n = normalizeChecklistInput(fields)
      if (!n.ok) throw new ManagerError('validation', n.message, 400)
      Object.assign(x, n.value)
      if (active !== undefined) x.active = active
      x.updated_at = nowIso()
      pushChecklist(x)
      save()
      return clone(x)
    },

    async downloadPhoto(path) {
      await gate(true)
      const bytes = t?.storedPhotos().get(path)
      if (!bytes) throw new ManagerError('validation', 'Photo introuvable sur le serveur (pas encore envoyée par l’appareil ?).', 404)
      return new Blob([bytes.slice().buffer], { type: 'image/webp' })
    },

    simulate: {
      setOffline(v) {
        offline = v
      },
      failNext(code, message) {
        pendingFailure = new ManagerError(code, message ?? (code in MESSAGES ? MESSAGES[code as keyof typeof MESSAGES] : 'Données refusées.'))
      },
      expireSession() {
        state.session = null
      },
      state: () => clone(state),
    },
  }
  return api
}
