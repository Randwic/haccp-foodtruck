// Serveur simulé en mémoire, fidèle au contrat de shared/types.ts (sync-push / sync-pull).
// Sert au développement de l'interface (sans Supabase) et aux tests du core.
//
// Règles appliquées par sync-push, enregistrement par enregistrement, dans l'ordre reçu :
//   1. id déjà connu : même hash => accepté (idempotent, server_time d'origine) ; sinon id_conflict.
//   2. hash recalculé différent => invalid_hash.
//   3. device_seq ≠ dernier + 1 => seq_gap ; prev_hash ≠ dernier hash => broken_chain.
//      (ces refus n'avancent PAS la chaîne côté serveur)
//   4. type inconnu => unknown_type ; auteur inconnu/inactif => unknown_author ; payload non objet
//      => invalid_payload. Ces refus « de contenu » portent sur un maillon intègre : le serveur le
//      conserve en quarantaine et la chaîne AVANCE (sinon un seul refus bloquerait l'appareil à vie).
//      Hypothèse à valider avec le backend (voir docs/core-offline.md).
//
// photo-upload (lot 3) : même contrat que la fonction Supabase — chemin `<device_id>/<uuid>.webp` du
// dossier de l'appareil, signature RIFF/WEBP, ≤ PHOTO_MAX_BYTES ; absent → 201 created ; présent de même
// taille → 200 already_present ; taille différente → 409 photo_conflict (jamais d'écrasement).
import { computeRecordHash } from '../../../shared/canonical.ts'
import { PHOTO_MAX_BYTES, PHOTO_PATH_RE, type Alert, type Checklist, type CleaningTask, type Product, type Recipe, type Supplier } from '../../../shared/payloads.ts'
import {
  GENESIS_HASH,
  type DeviceEnrollResponse,
  type Equipment,
  type Establishment,
  type HaccpRecord,
  type RejectReason,
  type Settings,
  type StaffMember,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type Threshold,
} from '../../../shared/types.ts'
import { isWebp } from './photoEncoder.ts'
import { RECORD_TYPES } from './recordTypes.ts'
import { TransportError, type DeviceAuth, type PhotoUploadOutcome, type Transport } from './transport.ts'


// ---------- Données de démonstration ----------
const T0 = '2026-01-01T00:00:00.000Z'

export const DEMO_ESTABLISHMENT: Establishment = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  name: 'Food truck (démo)',
  timezone: 'Europe/Paris',
}

/** PIN de démonstration : Gérant 123456, Équipier 654321 (vrais hash PBKDF2-SHA256, 210 000 itérations). */
export const DEMO_PINS = { manager: '123456', staff: '654321' } as const

export const DEMO_STAFF: StaffMember[] = [
  {
    id: '6f1c2a4e-0000-4000-8000-000000000101',
    display_name: 'Gérant',
    role: 'manager',
    active: true,
    pin_salt: 'Z2VyYW50LWRlbW8tc2VsMQ==',
    pin_hash: 'bSxmlOKMlKxY8i3ahDpNxWPfIIK6noNbWllk+BDwBwg=',
    updated_at: T0,
  },
  {
    id: '6f1c2a4e-0000-4000-8000-000000000102',
    display_name: 'Équipier',
    role: 'staff',
    active: true,
    pin_salt: 'ZXF1aXBpZXItZGVtby1zMg==',
    pin_hash: 'zODTO3oWpiCw1XA8bCJIjerNbeqek7ucCXhUpS1UueU=',
    updated_at: T0,
  },
]

export const DEMO_EQUIPMENT: Equipment[] = [
  { id: '6f1c2a4e-0000-4000-8000-000000000201', name: 'Frigo 1', kind: 'fridge', active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000202', name: 'Frigo 2', kind: 'fridge', active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000203', name: 'Congélateur', kind: 'freezer', active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000204', name: 'Friteuse – bac 1', kind: 'fryer_vat', active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000205', name: 'Friteuse – bac 2', kind: 'fryer_vat', active: true, updated_at: T0 },
]

// Seuils par défaut issus du GBPH / arrêté du 21/12/2009 — [À CONFIRMER dans le PMS].
export const DEMO_THRESHOLDS: Threshold[] = [
  { id: '6f1c2a4e-0000-4000-8000-000000000301', equipment_id: DEMO_EQUIPMENT[0].id, check_type: 'temperature_check', min_c: null, max_c: 4, tolerance_minutes: 20, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000302', equipment_id: DEMO_EQUIPMENT[1].id, check_type: 'temperature_check', min_c: null, max_c: 4, tolerance_minutes: 20, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000303', equipment_id: DEMO_EQUIPMENT[2].id, check_type: 'temperature_check', min_c: null, max_c: -18, tolerance_minutes: 30, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000304', equipment_id: null, check_type: 'hot_holding', min_c: 63, max_c: null, tolerance_minutes: 0, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000305', equipment_id: null, check_type: 'cooling', min_c: null, max_c: 10, tolerance_minutes: 120, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000306', equipment_id: null, check_type: 'reheating', min_c: 63, max_c: null, tolerance_minutes: 60, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000307', equipment_id: null, check_type: 'cooking_check', min_c: 70, max_c: null, tolerance_minutes: 0, updated_at: T0 },
]

export const DEMO_SETTINGS: Settings = {
  daily_check_times: ['08:00', '18:00'],
  missed_slot_carry_over: true,
  thaw_dlc_days: 3,
  oil_polar_max: 25,
  oil_polar_warn: 22,
  sensor_silent_minutes: 60,
  alert_repeat_minutes: 15,
    retention_years: 3,
  auto_lock_minutes: 5, // [À CONFIRMER]
  clock_suspect_minutes: 5,
  email_alerts: true,
}

/** Fournisseurs de démonstration (lot 3). */
export const DEMO_SUPPLIERS: Supplier[] = [
  { id: '6f1c2a4e-0000-4000-8000-000000000501', name: 'Boucherie Martin', phone: '04 78 12 34 56', email: 'commandes@boucherie-martin.fr', active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000502', name: 'Primeurs du Rhône', phone: '04 72 98 76 54', email: null, active: true, updated_at: T0 },
  { id: '6f1c2a4e-0000-4000-8000-000000000503', name: 'Metro Lyon Nord', phone: null, email: null, active: true, updated_at: T0 },
]

/**
 * Produits et recette de démonstration (lot 4) : mêmes identifiants, allergènes et durées de vie que les
 * données initiales du serveur (supabase/migrations/20261114001100_lot4_produits.sql).
 * Allergènes indicatifs, à vérifier sur les fiches fournisseurs ; durées à confirmer selon le PMS.
 */
export const DEMO_PRODUCTS: Product[] = [
  { id: '00000000-0000-4000-8000-000000000401', name: 'Pain burger', allergens: ['gluten', 'sesame'], storage: 'ambient', shelf_life_opened_hours: 48, shelf_life_thawed_hours: 48, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000402', name: 'Cheddar en tranches', allergens: ['lait'], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000403', name: 'Steak haché surgelé', allergens: [], storage: 'freezer', shelf_life_opened_hours: null, shelf_life_thawed_hours: 24, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000404', name: 'Sauce burger', allergens: ['oeufs', 'moutarde'], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000405', name: 'Frites surgelées', allergens: [], storage: 'freezer', shelf_life_opened_hours: 168, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000406', name: 'Bacon en tranches', allergens: [], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000407', name: 'Salade iceberg (sachet)', allergens: [], storage: 'fridge', shelf_life_opened_hours: 24, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
  { id: '00000000-0000-4000-8000-000000000408', name: 'Cornichons', allergens: ['moutarde'], storage: 'ambient', shelf_life_opened_hours: 168, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true, updated_at: T0 },
]

/** Recette d'exemple du serveur : sauce cheddar maison (cheddar + roux à la farine de blé → gluten). */
export const DEMO_RECIPES: Recipe[] = [
  { id: '00000000-0000-4000-8000-000000000451', name: 'Sauce cheddar maison', kind: 'preparation', category: null, ingredient_product_ids: ['00000000-0000-4000-8000-000000000402'], ingredient_recipe_ids: [], extra_allergens: ['gluten'], may_contain: [], storage: 'fridge', shelf_life_hours: 72, active: true, updated_at: T0 },
]

/**
 * Plan de nettoyage et checklists de démonstration (lot 5) : mêmes identifiants, fréquences, produits et
 * points que les données initiales du serveur (supabase/migrations/20261114001300_lot5_nettoyage.sql).
 * Produits et modes opératoires génériques, à adapter selon le PMS.
 */
const PMS = ' À adapter selon votre PMS.'
const task = (n: number, name: string, frequency: CleaningTask['frequency'], product: string, method: string): CleaningTask => ({
  id: `00000000-0000-4000-8000-000000000${n}`,
  name,
  frequency,
  product,
  method: method + PMS,
  active: true,
  updated_at: T0,
})
export const DEMO_CLEANING_TASKS: CleaningTask[] = [
  task(501, 'Plans de travail', 'after_service', 'Détergent-désinfectant contact alimentaire', 'Débarrasser, nettoyer, appliquer le désinfectant (temps de contact du fabricant), rincer à l’eau potable si exigé, laisser sécher.'),
  task(502, 'Plancha / grill', 'after_service', 'Dégraissant plaque de cuisson', 'Racler à chaud, dégraisser, rincer, essuyer avec un papier à usage unique, huiler légèrement.'),
  task(503, 'Friteuse — extérieur', 'daily', 'Dégraissant', 'Friteuse froide et débranchée : dégraisser carrosserie, commandes et abords, rincer, sécher.'),
  task(504, 'Friteuse — vidange et nettoyage du bac', 'weekly', 'Produit de nettoyage pour friteuse', 'À chaque changement d’huile : vidanger l’huile froide, nettoyer bac, résistances et panier, rincer abondamment, sécher complètement avant remplissage.'),
  task(505, 'Réfrigérateurs — intérieur', 'weekly', 'Détergent-désinfectant contact alimentaire', 'Vider (produits mis au froid ailleurs), retirer clayettes, nettoyer, désinfecter, rincer, sécher, contrôler les joints.'),
  task(506, 'Congélateur — dégivrage', 'monthly', 'Détergent-désinfectant contact alimentaire', 'Transférer les produits dans une enceinte froide, débrancher, dégivrer, nettoyer, désinfecter, sécher, remettre en froid avant rechargement.'),
  task(507, 'Sols', 'daily', 'Détergent sols', 'Balayer, laver, rincer si nécessaire, laisser sécher (sol glissant).'),
  task(508, 'Poubelles', 'daily', 'Détergent-désinfectant', 'Vider, nettoyer et désinfecter les bacs et couvercles, poser un sac neuf.'),
  task(509, 'Hotte et filtres', 'weekly', 'Dégraissant', 'Démonter les filtres, tremper et dégraisser, rincer, sécher ; nettoyer l’intérieur de la hotte.'),
  task(510, 'Lave-mains', 'daily', 'Détergent-désinfectant', 'Nettoyer et désinfecter vasque et commande, réapprovisionner savon et essuie-mains à usage unique.'),
  task(511, 'Réservoirs d’eau du camion', 'monthly', 'Désinfectant pour réservoirs d’eau potable', 'Vidanger, désinfecter selon la notice, rincer abondamment à l’eau potable, remplir.'),
]

const items = (list: [string, string][]) => list.map(([id, label]) => ({ id, label, required: true }))
export const DEMO_CHECKLISTS: Checklist[] = [
  {
    id: '00000000-0000-4000-8000-000000000551',
    name: 'Ouverture',
    kind: 'opening',
    items: items([
      ['lave_mains', 'Lave-mains approvisionné (savon, papier)'],
      ['eau_potable', 'Eau potable disponible'],
      ['temperatures', 'Températures des enceintes relevées'],
      ['tenue', 'Tenue propre et cheveux attachés'],
      ['plans_travail', 'Plans de travail désinfectés'],
      ['nuisibles', 'Pas de nuisibles constatés'],
    ]),
    active: true,
    updated_at: T0,
  },
  {
    id: '00000000-0000-4000-8000-000000000552',
    name: 'Fermeture',
    kind: 'closing',
    items: items([
      ['produits_entames', 'Produits entamés filmés et étiquetés'],
      ['restes', 'Restes jetés ou refroidis'],
      ['enceintes', 'Enceintes froides fermées'],
      ['nettoyage', 'Nettoyage effectué'],
      ['poubelles', 'Poubelles vidées'],
      ['gaz', 'Gaz coupé'],
      ['friteuses', 'Friteuses couvertes'],
    ]),
    active: true,
    updated_at: T0,
  },
  {
    id: '00000000-0000-4000-8000-000000000553',
    name: 'Contrôle nuisibles',
    kind: 'pest_control',
    items: items([
      ['pieges', 'Pièges vérifiés'],
      ['traces', 'Aucune trace (déjections, emballages rongés…)'],
      ['ouvertures', 'Ouvertures protégées (moustiquaires, joints)'],
    ]),
    active: true,
    updated_at: T0,
  },
]

/** Appareil pré-enrôlé, pratique pour l'interface en développement. */
export const DEMO_DEVICE: DeviceEnrollResponse = {
  device_id: '6f1c2a4e-0000-4000-8000-000000000401',
  device_token: 'demo-device-token',
}

// ---------- Serveur simulé ----------
type RefTable = 'staff' | 'equipment' | 'thresholds' | 'suppliers' | 'products' | 'recipes' | 'cleaning_tasks' | 'checklists'

interface ServerDevice {
  device_id: string
  name: string
  revoked: boolean
  last_seq: number
  last_hash: string
}

interface ServerRecord {
  record: HaccpRecord
  server_time: string
  clock_suspect: boolean
  /** Refus de contenu (quarantaine) : maillon intègre mais non accepté. */
  rejected: RejectReason | null
}

export interface MockTransportOptions {
  now?: () => Date
  /** Latence simulée de chaque requête (défaut 0). */
  latencyMs?: number
  /** Charger les données de démonstration (défaut true). */
  seed?: boolean
}

export interface MockTransport extends Transport {
  /** Simule une absence de réseau (toutes les requêtes échouent en `network`). */
  setOffline(offline: boolean): void
  /** La prochaine requête push est traitée par le serveur MAIS la réponse est perdue. */
  dropNextPushResponse(): void
  /** La prochaine requête échoue en 5xx sans être traitée. */
  failNextWithServerError(): void
  /** Les `n` prochains envois de photo échouent en 5xx (sans être traités). */
  failNextPhotoUploads(n: number): void
  /** Photos reçues (chemin → octets), comme le bucket `photos`. */
  storedPhotos(): Map<string, Uint8Array>
  /** Dépose un objet dans le bucket (pour simuler un conflit). */
  putStoredPhoto(path: string, bytes: Uint8Array): void
  upsertSupplier(s: Omit<Supplier, 'updated_at'>): void
  upsertProduct(p: Omit<Product, 'updated_at'>): void
  upsertRecipe(r: Omit<Recipe, 'updated_at'>): void
  upsertCleaningTask(t: Omit<CleaningTask, 'updated_at'>): void
  upsertChecklist(c: Omit<Checklist, 'updated_at'>): void
  /** Lot 6 : ouvre / modifie une alerte (comme le moteur alerts-evaluate). */
  upsertAlert(a: Alert): void
  enrollDevice(name: string): DeviceEnrollResponse
  revokeDevice(device_id: string): void
  /** Enregistrements acceptés par le serveur (copie). */
  acceptedRecords(): HaccpRecord[]
  /** Enregistrements en quarantaine (refus de contenu). */
  quarantinedRecords(): { record: HaccpRecord; reason: RejectReason }[]
  upsertStaff(s: Omit<StaffMember, 'updated_at'>): void
  upsertEquipment(e: Omit<Equipment, 'updated_at'>): void
  upsertThreshold(t: Omit<Threshold, 'updated_at'>): void
  setSettings(s: Settings): void
  /** Désactive une référence : elle apparaîtra dans `deleted` des pulls suivants. */
  deactivate(table: RefTable, id: string): void
  /** Compteurs d'appels, pour les tests. */
  readonly calls: { push: number; pull: number; photo: number }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function createMockTransport(opts: MockTransportOptions = {}): MockTransport {
  const now = opts.now ?? (() => new Date())
  const latencyMs = opts.latencyMs ?? 0
  const seed = opts.seed ?? true

  const establishment: Establishment = clone(DEMO_ESTABLISHMENT)
  let settings: Settings = clone(DEMO_SETTINGS)
  const refs: {
    staff: Map<string, StaffMember>
    equipment: Map<string, Equipment>
    thresholds: Map<string, Threshold>
    suppliers: Map<string, Supplier>
    products: Map<string, Product>
    recipes: Map<string, Recipe>
    cleaning_tasks: Map<string, CleaningTask>
    checklists: Map<string, Checklist>
  } = {
    staff: new Map(seed ? DEMO_STAFF.map((s) => [s.id, clone(s)]) : []),
    equipment: new Map(seed ? DEMO_EQUIPMENT.map((e) => [e.id, clone(e)]) : []),
    thresholds: new Map(seed ? DEMO_THRESHOLDS.map((t) => [t.id, clone(t)]) : []),
    suppliers: new Map(seed ? DEMO_SUPPLIERS.map((s) => [s.id, clone(s)]) : []),
    // Comme le serveur : les données initiales des produits sont posées par la migration (même sans compte).
    products: new Map(DEMO_PRODUCTS.map((p) => [p.id, clone(p)])),
    recipes: new Map(DEMO_RECIPES.map((r) => [r.id, clone(r)])),
    // Lot 5 : plan de nettoyage et checklists posés par la migration, eux aussi.
    cleaning_tasks: new Map(DEMO_CLEANING_TASKS.map((t) => [t.id, clone(t)])),
    checklists: new Map(DEMO_CHECKLISTS.map((c) => [c.id, clone(c)])),
  }
  const photos = new Map<string, Uint8Array>()
  let photoFailures = 0
  const deletedLog: { table: RefTable; id: string; at: string }[] = []
  const devicesByToken = new Map<string, ServerDevice>()
  const records = new Map<string, ServerRecord>()
  const alerts = new Map<string, { alert: Alert; updated_at: string }>()
  let offline = false
  let dropNextPush = false
  let fail5xxNext = false
  let lastIssued = 0 // ms du dernier server_now émis
  const calls = { push: 0, pull: 0, photo: 0 }

  devicesByToken.set(DEMO_DEVICE.device_token, {
    device_id: DEMO_DEVICE.device_id,
    name: 'Appareil de démonstration',
    revoked: false,
    last_seq: 0,
    last_hash: GENESIS_HASH,
  })

  /** Horodatage strictement croissant : une modification est toujours > au dernier server_now émis. */
  function stamp(): string {
    const t = Math.max(now().getTime(), lastIssued + 1)
    lastIssued = t
    return new Date(t).toISOString()
  }

  async function gate(auth: DeviceAuth): Promise<ServerDevice> {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs))
    if (offline) throw new TransportError('network', 'Réseau indisponible (simulation)')
    if (fail5xxNext) {
      fail5xxNext = false
      throw new TransportError('server', 'Erreur serveur (503, simulation)', 503)
    }
    const dev = devicesByToken.get(auth.device_token)
    if (!dev) throw new TransportError('unauthorized', 'Appareil non autorisé (401) invalid_token', 401)
    if (dev.revoked) throw new TransportError('unauthorized', 'Appareil non autorisé (401) device_revoked', 401)
    return dev
  }

  async function push(reqIn: SyncPushRequest, auth: DeviceAuth): Promise<SyncPushResponse> {
    calls.push++
    const dev = await gate(auth)
    const req = clone(reqIn) // comme un vrai aller-retour JSON
    if (req.device_id !== dev.device_id) throw new TransportError('unauthorized', 'device_id ne correspond pas au jeton (403)', 403)
    if (!Array.isArray(req.records) || req.records.length > 500) throw new TransportError('client', 'Lot invalide (400)', 400)

    const res: SyncPushResponse = { accepted: [], rejected: [], last_device_seq: 0 }
    for (const r of req.records) {
      const known = records.get(r.id)
      if (known) {
        if (known.record.hash !== r.hash) res.rejected.push({ id: r.id, reason: 'id_conflict' })
        else if (known.rejected) res.rejected.push({ id: r.id, reason: known.rejected })
        else res.accepted.push({ id: r.id, server_time: known.server_time, clock_suspect: known.clock_suspect })
        continue
      }
      if (r.device_id !== dev.device_id) {
        res.rejected.push({ id: r.id, reason: 'broken_chain', detail: 'device_id étranger' })
        continue
      }
      let hash: string
      try {
        hash = await computeRecordHash(r)
      } catch {
        res.rejected.push({ id: r.id, reason: 'invalid_payload', detail: 'JSON non canonisable' })
        continue
      }
      if (hash !== r.hash) {
        res.rejected.push({ id: r.id, reason: 'invalid_hash' })
        continue
      }
      if (r.device_seq !== dev.last_seq + 1) {
        res.rejected.push({ id: r.id, reason: 'seq_gap', detail: `attendu ${dev.last_seq + 1}, reçu ${r.device_seq}` })
        continue
      }
      if (r.prev_hash !== dev.last_hash) {
        res.rejected.push({ id: r.id, reason: 'broken_chain' })
        continue
      }
      // Maillon intègre : la chaîne avance quoi qu'il arrive au contenu.
      dev.last_seq = r.device_seq
      dev.last_hash = r.hash
      const server_time = stamp()
      let contentReject: RejectReason | null = null
      const author = refs.staff.get(r.author_id)
      if (!(RECORD_TYPES as readonly string[]).includes(r.type)) contentReject = 'unknown_type'
      else if (!author || !author.active) contentReject = 'unknown_author'
      else if (typeof r.payload !== 'object' || r.payload === null || Array.isArray(r.payload)) contentReject = 'invalid_payload'
      else if (r.type === 'correction' && !r.supersedes_id) contentReject = 'invalid_payload'
      // Horloge suspecte : écart entre l'heure du serveur et `device_now` (horloge de l'appareil à
      // l'envoi), pour tout le lot. Une saisie faite hors réseau et envoyée des heures plus tard n'est
      // donc pas signalée. Ancien client sans `device_now` : repli sur device_time de chaque saisie.
      const reference = typeof req.device_now === 'string' ? req.device_now : r.device_time
      const drift = Math.abs(Date.parse(server_time) - Date.parse(reference))
      const clock_suspect = !Number.isFinite(drift) || drift > settings.clock_suspect_minutes * 60_000
      records.set(r.id, { record: { ...r, server_time }, server_time, clock_suspect, rejected: contentReject })
      // Lot 6 : comme le trigger records_alert_ack, la prise en compte est posée à l'insertion.
      const acked = !contentReject && r.type === 'alert_ack' ? alerts.get(String(r.payload.alert_id)) : undefined
      if (acked && acked.alert.acknowledged_at === null) alerts.set(acked.alert.id, { alert: { ...acked.alert, acknowledged_at: server_time }, updated_at: stamp() })
      if (contentReject) res.rejected.push({ id: r.id, reason: contentReject, quarantined: true })
      else res.accepted.push({ id: r.id, server_time, clock_suspect })
    }
    res.last_device_seq = dev.last_seq
    if (dropNextPush) {
      dropNextPush = false
      throw new TransportError('network', 'Connexion coupée pendant la réponse (simulation)')
    }
    return clone(res)
  }

  async function pull(since: string | null, auth: DeviceAuth): Promise<SyncPullResponse> {
    calls.pull++
    await gate(auth)
    const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY
    const changed = <T extends { updated_at: string }>(m: Map<string, T>) =>
      [...m.values()].filter((x) => Date.parse(x.updated_at) > sinceMs)
    const server_now = stamp()
    return clone({
      server_now,
      establishment,
      staff: changed(refs.staff),
      equipment: changed(refs.equipment),
      thresholds: changed(refs.thresholds),
      // Comme la fonction : fournisseurs ACTIFS modifiés depuis `since` (désactivés dans `deleted`).
      suppliers: changed(refs.suppliers).filter((s) => s.active),
      // Lot 4 : produits et recettes ACTIFS modifiés depuis `since` (désactivés dans `deleted`).
      products: changed(refs.products).filter((p) => p.active),
      recipes: changed(refs.recipes).filter((r) => r.active),
      // Lot 5 : tâches de nettoyage et checklists ACTIVES modifiées depuis `since`.
      cleaning_tasks: changed(refs.cleaning_tasks).filter((t) => t.active),
      checklists: changed(refs.checklists).filter((c) => c.active),
      sensors: [],
      // Lot 6 : alertes ouvertes, et celles modifiées depuis `since` (comme listAlerts du serveur).
      alerts: [...alerts.values()].filter((a) => a.alert.resolved_at === null || Date.parse(a.updated_at) > sinceMs).map((a) => clone(a.alert)),
      settings,
      deleted: deletedLog.filter((d) => Date.parse(d.at) > sinceMs).map(({ table, id }) => ({ table, id })),
    })
  }

  async function uploadPhoto(path: string, bytesIn: Uint8Array, auth: DeviceAuth): Promise<PhotoUploadOutcome> {
    calls.photo++
    const dev = await gate(auth)
    if (photoFailures > 0) {
      photoFailures--
      throw new TransportError('server', 'Erreur serveur (503, simulation)', 503)
    }
    if (!PHOTO_PATH_RE.test(path)) return { ok: false, error: 'invalid_path' }
    if (path.split('/')[0] !== dev.device_id) return { ok: false, error: 'device_mismatch' }
    if (bytesIn.byteLength > PHOTO_MAX_BYTES) return { ok: false, error: 'payload_too_large' }
    const bytes = new Uint8Array(bytesIn) // copie : comme un vrai envoi
    if (bytes.byteLength === 0 || !isWebp(bytes)) return { ok: false, error: 'invalid_photo' }
    const existing = photos.get(path)
    if (existing) return existing.byteLength === bytes.byteLength ? { ok: true, status: 'already_present' } : { ok: false, error: 'photo_conflict' }
    photos.set(path, bytes)
    return { ok: true, status: 'created' }
  }

  return {
    push,
    pull,
    uploadPhoto,
    calls,
    failNextPhotoUploads: (n) => {
      photoFailures = n
    },
    storedPhotos: () => new Map([...photos].map(([k, v]) => [k, new Uint8Array(v)])),
    putStoredPhoto: (path, bytes) => void photos.set(path, new Uint8Array(bytes)),
    upsertSupplier: (sup) => void refs.suppliers.set(sup.id, { ...clone(sup), updated_at: stamp() }),
    upsertProduct: (p) => void refs.products.set(p.id, { ...clone(p), updated_at: stamp() }),
    upsertRecipe: (r) => void refs.recipes.set(r.id, { ...clone(r), updated_at: stamp() }),
    upsertCleaningTask: (t) => void refs.cleaning_tasks.set(t.id, { ...clone(t), updated_at: stamp() }),
    upsertChecklist: (c) => void refs.checklists.set(c.id, { ...clone(c), updated_at: stamp() }),
    upsertAlert: (a) => void alerts.set(a.id, { alert: clone(a), updated_at: stamp() }),
    setOffline: (v) => {
      offline = v
    },
    dropNextPushResponse: () => {
      dropNextPush = true
    },
    failNextWithServerError: () => {
      fail5xxNext = true
    },
    enrollDevice(name) {
      const device_id = crypto.randomUUID()
      const device_token = crypto.randomUUID() + crypto.randomUUID()
      devicesByToken.set(device_token, { device_id, name, revoked: false, last_seq: 0, last_hash: GENESIS_HASH })
      return { device_id, device_token }
    },
    revokeDevice(device_id) {
      for (const d of devicesByToken.values()) if (d.device_id === device_id) d.revoked = true
    },
    acceptedRecords: () =>
      [...records.values()].filter((r) => !r.rejected).map((r) => clone(r.record)).sort((a, b) => a.device_seq - b.device_seq),
    quarantinedRecords: () =>
      [...records.values()].filter((r) => r.rejected).map((r) => ({ record: clone(r.record), reason: r.rejected as RejectReason })),
    upsertStaff: (s) => void refs.staff.set(s.id, { ...clone(s), updated_at: stamp() }),
    upsertEquipment: (e) => void refs.equipment.set(e.id, { ...clone(e), updated_at: stamp() }),
    upsertThreshold: (t) => void refs.thresholds.set(t.id, { ...clone(t), updated_at: stamp() }),
    setSettings: (s) => {
      // Les settings sont renvoyés en entier à chaque pull : pas besoin d'horodatage.
      settings = clone(s)
    },
    deactivate(table, id) {
      const at = stamp()
      if (table === 'thresholds') refs.thresholds.delete(id)
      else {
        const row = refs[table].get(id)
        if (row) refs[table].set(id, { ...row, active: false, updated_at: at } as never)
      }
      deletedLog.push({ table, id, at })
    },
  }
}
