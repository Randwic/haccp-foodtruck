// Contrat des payloads HACCP — lot 2 (températures). NE PAS MODIFIER sans accord du chef de projet.
// Les validateurs serveur (shared/validation.ts) et les écrans (app) suivent exactement ces formes.
// Températures en °C, 1 décimale max, plage −50..300. Identifiants : uuid minuscules.

export type MeasureSource = 'manual' | 'probe' | 'sensor'

/** Relevé d'une enceinte (frigo, congélateur…) — type 'temperature_check'. */
export interface TemperatureCheckPayload {
  equipment_id: string
  value_c: number
  source: MeasureSource
  in_range: boolean // calculé par l'app avec le seuil en vigueur au moment du relevé
  corrective_action_id?: string // (historique, non utilisé : l'action corrective référence le relevé)
}

/** Action corrective — type 'corrective_action'. Obligatoire après toute saisie hors seuil (imposé par l'app). */
export interface CorrectiveActionPayload {
  related_record_id: string // le relevé / l'étape hors seuil
  action: 'discard' | 'reheat' | 'move_product' | 'adjust_equipment' | 'call_technician' | 'other'
  comment: string // obligatoire (non vide) si action = 'other'
  photo_path?: string
}

/**
 * Procédés suivis en plusieurs étapes, reliées par `batch_id` (uuid généré à l'étape 'start') :
 * - 'cooling'   refroidissement rapide : start ≥ +63 °C → end ≤ +10 °C en ≤ 120 min
 * - 'reheating' remise en température : start (sortie froid) → end ≥ +63 °C en ≤ 60 min
 * - 'thawing'   décongélation en enceinte froide : start → end (avec nouvelle DLC)
 * Les seuils exacts viennent des `thresholds` génériques (equipment_id null) ; valeurs ci-dessus = défauts.
 */
export type ProcessStep = 'start' | 'check' | 'end'

export interface CoolingPayload {
  batch_id: string
  step: ProcessStep
  product: string // 1..80 caractères, requis à 'start', répété aux étapes suivantes
  value_c: number // température à cœur
  source: MeasureSource
  in_range?: boolean // requis à 'end' : objectif atteint dans le délai
  duration_min?: number // requis à 'end' : minutes depuis 'start' (entier ≥ 0)
}

export type ReheatingPayload = CoolingPayload

export interface ThawingPayload {
  batch_id: string
  step: 'start' | 'end'
  product: string // 1..80
  equipment_id: string // enceinte froide où a lieu la décongélation
  dlc?: string // requis à 'end' : date AAAA-MM-JJ (DLC après décongélation)
}

/** Maintien au chaud — type 'hot_holding' : ≥ +63 °C. */
export interface HotHoldingPayload {
  product: string // 1..80
  value_c: number
  source: MeasureSource
  in_range: boolean
  equipment_id?: string // vitrine / bain-marie si déclaré
}

/** Contrôle de cuisson à cœur — type 'cooking_check' (ex. steak haché ≥ +70 °C, à confirmer selon le PMS). */
export interface CookingCheckPayload {
  product: string // 1..80
  value_c: number
  source: MeasureSource
  in_range: boolean
}

/** Valeurs par défaut des seuils génériques (equipment_id null) — à confirmer selon le PMS. */
export const DEFAULT_PROCESS_THRESHOLDS = {
  cooling: { start_min_c: 63, target_max_c: 10, max_minutes: 120 },
  reheating: { target_min_c: 63, max_minutes: 60 },
  hot_holding: { min_c: 63 },
  cooking_check: { min_c: 70 },
} as const

// ───────────────────────────── Lot 3 : réception & traçabilité ─────────────────────────────

/**
 * Photos : prises sur l'appareil, compressées (WebP, ≤ 1 Mo, idéalement ~200 Ko), stockées
 * localement puis envoyées par la fonction `photo-upload` dès qu'il y a du réseau.
 * Chemin imposé (référencé dans les payloads) : `<device_id>/<uuid>.webp` dans le bucket privé `photos`.
 */
export const PHOTO_BUCKET = 'photos'
export const PHOTO_MAX_BYTES = 1_000_000
export const PHOTO_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/

/** Au plus 20 photos par réception, toutes lignes confondues (RECEPTION_MAX_PHOTOS). */

/** Réponse de PUT /functions/v1/photo-upload?path=<device_id>/<uuid>.webp (en-tête x-device-token, corps WebP). */
export type PhotoUploadResponse =
  | { ok: true; path: string; status: 'created' | 'already_present'; size: number } // 201 / 200
  | {
      ok?: false
      error: 'invalid_path' | 'device_mismatch' | 'payload_too_large' | 'invalid_photo' | 'photo_conflict' | 'unauthorized' | 'device_revoked'
    } // 400 / 403 / 413 / 415 / 409 / 401

/** Une ligne de livraison. */
export interface ReceptionItem {
  product: string // 1..80
  lot?: string // n° de lot, 1..40
  dlc?: string // AAAA-MM-JJ
  ddm?: string // AAAA-MM-JJ (date de durabilité minimale)
  gtin?: string // code-barres EAN/GTIN, 8 à 14 chiffres
  temperature_c?: number // à cœur ou en surface, 1 décimale, −50..300
  storage: 'fridge' | 'freezer' | 'ambient' // conservation exigée
  accepted: boolean // false = refusé à la livraison
  refusal_reason?: string // requis si accepted = false (1..200)
  photo_paths?: string[] // 0..5, format PHOTO_PATH_RE (étiquette, n° de lot…)
}

/** Réception d'une livraison — type 'reception'. */
export interface ReceptionPayload {
  supplier_id: string
  delivery_note?: string // n° de bon de livraison, 1..40
  vehicle_ok: boolean // propreté / température du véhicule
  packaging_ok: boolean // emballages intacts
  items: ReceptionItem[] // 1..50
  photo_paths?: string[] // 0..5 (bon de livraison…)
  comment?: string // 0..500
}

/** Refus / anomalie constatée après coup (ex. produit non conforme découvert à l'ouverture) — type 'waste'. */
export interface WastePayload {
  product: string // 1..80
  lot?: string
  quantity?: string // texte libre court, ex. « 2 kg », 1..40
  reason: 'expired' | 'non_compliant' | 'temperature' | 'damaged' | 'recall' | 'other'
  comment?: string // requis si reason = 'other'
  related_record_id?: string // réception / relevé concerné
  photo_paths?: string[]
}

/** Fournisseur (donnée de référence, gérée dans Gestion, transmise par sync-pull). */
export interface Supplier {
  id: string
  name: string // 1..80
  phone?: string | null
  email?: string | null
  active: boolean
  updated_at: string
}

// ───────────────────────────── Lot 4 : produits, recettes, allergènes, étiquettes ─────────────────────────────

/** Les 14 allergènes à déclaration obligatoire (règlement UE 1169/2011, annexe II). */
export const ALLERGENS = [
  'gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait',
  'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques',
] as const
export type Allergen = (typeof ALLERGENS)[number]

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: 'Céréales contenant du gluten', crustaces: 'Crustacés', oeufs: 'Œufs', poissons: 'Poissons',
  arachides: 'Arachides', soja: 'Soja', lait: 'Lait', fruits_a_coque: 'Fruits à coque', celeri: 'Céleri',
  moutarde: 'Moutarde', sesame: 'Graines de sésame', sulfites: 'Anhydride sulfureux et sulfites',
  lupin: 'Lupin', mollusques: 'Mollusques',
}

export type StorageMode = 'fridge' | 'freezer' | 'ambient'

/** Produit / matière première (référence gérée dans Gestion, transmise par sync-pull). */
export interface Product {
  id: string
  name: string // 1..80
  allergens: Allergen[]
  storage: StorageMode
  // Durées de vie secondaires en heures (null = non applicable) — à confirmer selon le PMS
  shelf_life_opened_hours: number | null // après ouverture ; null = « selon l'étiquette du fabricant » (DLC saisie à la main)
  shelf_life_thawed_hours: number | null // après décongélation
  // Lot 4 bis (données réelles Space Diner)
  may_contain: Allergen[] // « peut en contenir » (traces, selon le fournisseur) — disjoint de `allergens`
  cook_min_c: number | null // température à cœur minimale à la cuisson / remise en température (ex. porc 63, poulet 74)
  active: boolean
  updated_at: string
}

/** Recette / préparation maison (référence). Les allergènes = union de ceux des ingrédients + extra. */
export interface Recipe {
  id: string
  name: string // 1..80
  // Lot 4 bis : 'preparation' = préparation maison (sauce, mélange…) ; 'menu_item' = plat vendu (tableau des allergènes)
  kind: 'preparation' | 'menu_item'
  category: string | null // rubrique du menu, ex. « Croq'Brioche », « Dessert », « Frites », « Menu enfant » (0..40)
  ingredient_product_ids: string[] // 0..50 Product.id
  ingredient_recipe_ids: string[] // 0..20 Recipe.id de kind 'preparation' (ex. Supernova → Sauce UFO), sans cycle
  extra_allergens: Allergen[] // allergènes non portés par un produit / une préparation référencés
  may_contain: Allergen[] // « peut en contenir » propres à la recette (en plus de ceux des ingrédients)
  storage: StorageMode
  shelf_life_hours: number | null // préparation : 1..2160 ; plat du menu : null (servi immédiatement)
  active: boolean
  updated_at: string
}
// Allergènes d'une recette = union récursive (produits + préparations + extra) ; « peut en contenir » = union
// récursive des may_contain, moins les allergènes présents.

/** Étiquette imprimée — type 'label_printed' (traçabilité aval). */
export interface LabelPrintedPayload {
  kind: 'opened' | 'prepared' | 'thawed' // ouverture d'un produit, préparation maison, décongélation
  product_id?: string // requis si kind = 'opened' | 'thawed'
  recipe_id?: string // requis si kind = 'prepared'
  name: string // libellé imprimé, 1..80
  made_at: string // ISO UTC canonique : ouverture / fabrication / fin de décongélation
  dlc_at: string // ISO UTC canonique : date-heure limite calculée
  allergens: Allergen[] // tels qu'imprimés (gras sur l'étiquette)
  may_contain?: Allergen[] // « traces possibles » telles qu'imprimées (sans les allergènes présents) ; absent = aucune
  storage: StorageMode
  lot?: string // lot interne ou lot fournisseur, 1..40
  source_record_ids?: string[] // 0..20 : réceptions / décongélations utilisées (traçabilité amont→aval)
  copies: number // 1..20
}

// ───────────────────────────── Lot 5 : nettoyage, checklists, huiles ─────────────────────────────

export type CleaningFrequency = 'after_service' | 'daily' | 'weekly' | 'monthly'

/** Tâche du plan de nettoyage et désinfection (référence gérée dans Gestion, transmise par sync-pull). */
export interface CleaningTask {
  id: string
  name: string // zone / équipement, 1..80 (ex. « Plan de travail », « Friteuse »)
  frequency: CleaningFrequency
  product: string | null // produit utilisé, 0..80
  method: string | null // mode opératoire, 0..500
  active: boolean
  updated_at: string
}

/** Nettoyage réalisé — type 'cleaning_done'. */
export interface CleaningDonePayload {
  task_id: string
  comment?: string // 0..300
  photo_paths?: string[] // 0..3 (format PHOTO_PATH_RE)
}

export interface ChecklistItem {
  id: string // identifiant stable dans la checklist (1..40, [a-z0-9_-])
  label: string // 1..120
  required: boolean
}

/** Checklist (ouverture, fermeture, nuisibles…) — référence gérée dans Gestion, transmise par sync-pull. */
export interface Checklist {
  id: string
  name: string // 1..80
  kind: 'opening' | 'closing' | 'pest_control' | 'other'
  items: ChecklistItem[] // 1..40
  active: boolean
  updated_at: string
}

/** Checklist remplie — type 'checklist_done'. Tout point « non » requiert un commentaire. */
export interface ChecklistDonePayload {
  checklist_id: string
  answers: { item_id: string; ok: boolean; comment?: string }[] // 1..40, un par point de la checklist
  all_ok: boolean // calculé par l'app (tous les points ok)
}

/** Contrôle de l'huile de friture — type 'oil_check' (composés polaires, limite légale 25 %, décret 2008-184). */
export interface OilCheckPayload {
  equipment_id: string // bac de friteuse (kind 'fryer_vat')
  polar_percent: number // 0..50, 1 décimale
  method: 'tester' | 'strip' // testeur électronique ou bandelette
  in_range: boolean // calculé par l'app : polar_percent ≤ settings.oil_polar_max
}

/** Changement d'huile — type 'oil_change'. */
export interface OilChangePayload {
  equipment_id: string // bac de friteuse
  comment?: string // 0..300
}

/** Réglages huile (ajoutés à Settings) : limite 25 % (légale), alerte préventive 22 % (par défaut). */
export const DEFAULT_OIL_SETTINGS = { oil_polar_max: 25, oil_polar_warn: 22 } as const

// ───────────────────────────── Lot 9 : vérification des thermomètres ─────────────────────────────

/**
 * Vérification d'un thermomètre (sonde) — type 'thermometer_check'.
 * Méthodes : eau glacée (0 °C), eau bouillante (100 °C au niveau de la mer) ou comparaison avec un
 * thermomètre de référence (étalonné). `in_range` = |measured_c − reference_c| ≤ tolerance_c.
 * La tolérance en vigueur est enregistrée avec la mesure (preuve lisible même si le réglage change).
 */
export interface ThermometerCheckPayload {
  thermometer: string // nom du thermomètre, 1..40 (ex. « Sonde cuisine »)
  method: 'ice_water' | 'boiling_water' | 'reference'
  reference_c: number // valeur attendue : 0 (eau glacée), 100 (eau bouillante) ou lecture de la référence ; -20..110, 1 décimale
  measured_c: number // valeur lue sur le thermomètre vérifié ; -30..130, 1 décimale
  tolerance_c: number // écart admis au moment du contrôle ; 0,1..2, 1 décimale
  in_range: boolean // calculé par l'app (et revérifié par le serveur)
  comment?: string // 0..300
}

/** Réglages thermomètres (ajoutés à Settings) : écart admis ±1 °C, vérification au moins tous les 30 jours. */
export const DEFAULT_THERMOMETER_SETTINGS = { thermometer_tolerance_c: 1, thermometer_check_days: 30 } as const

// ───────────────────────────── Lot 6 : capteurs & alertes ─────────────────────────────

export type SensorVendor = 'shelly_ht' | 'thermoworks_node' | 'tempstick' | 'generic'

/** Capteur fixe (référence gérée dans Gestion, transmise par sync-pull). Le jeton d'envoi n'est jamais transmis. */
export interface Sensor {
  id: string
  name: string // 1..80
  equipment_id: string // enceinte surveillée
  vendor: SensorVendor
  active: boolean
  last_seen_at: string | null // dernière mesure reçue
  last_value_c: number | null
  battery_percent: number | null // 0..100 si fourni par le capteur
  updated_at: string
}

export type AlertKind =
  | 'sensor_out_of_range' // enceinte hors seuil au-delà de la tolérance
  | 'sensor_silent' // aucune mesure depuis settings.sensor_silent_minutes
  | 'sensor_battery_low' // pile < 20 %
  | 'check_overdue' // relevé manuel d'un créneau non fait (après 1 h)
  | 'process_overdue' // refroidissement / remise en température non clôturé à l'échéance
  | 'corrective_action_missing' // saisie hors seuil sans action corrective (après 30 min)

/** Alerte (calculée par le serveur, transmise par sync-pull ; jamais supprimée). */
export interface Alert {
  id: string
  kind: AlertKind
  equipment_id: string | null
  sensor_id: string | null
  related_record_id: string | null
  message: string // texte prêt à afficher (français)
  opened_at: string
  resolved_at: string | null // condition disparue (ex. température revenue dans le seuil)
  acknowledged_at: string | null // pris en compte via un record 'alert_ack'
  last_notified_at: string | null
}

/** Prise en compte d'une alerte — type 'alert_ack'. */
export interface AlertAckPayload {
  alert_id: string
  comment?: string // 0..300
  corrective_action_id?: string // action corrective saisie en réponse
}

/** Abonnement Web Push d'un appareil (POST /functions/v1/push-subscribe, en-tête x-device-token). */
export interface PushSubscribeRequest {
  endpoint: string // URL https du service push
  keys: { p256dh: string; auth: string }
}

/** Réglages alertes (ajoutés à Settings) — défauts. */
export const DEFAULT_ALERT_SETTINGS = {
  sensor_silent_minutes: 60,
  alert_repeat_minutes: 15, // rappel tant que non prise en compte
} as const

// ───────────────────────────── Lot 7 : documents, PMS, mode Contrôle ─────────────────────────────

export type DocumentCategory =
  | 'pms' // plan de maîtrise sanitaire (versions successives)
  | 'training' // attestation de formation hygiène
  | 'health' // aptitude (date de validité seulement — jamais de détail médical)
  | 'pest_control' // contrat / passages dératisation
  | 'maintenance' // contrat froid, entretien
  | 'supplier' // fiches fournisseurs, fiches techniques
  | 'lab_analysis' // analyses de laboratoire
  | 'inspection' // rapports de contrôle sanitaire
  | 'registration' // déclaration DDPP, agrément
  | 'other'

/**
 * Document (référence gérée par le gérant). Fichier dans le bucket privé `documents`
 * (PDF, JPEG, PNG ou WebP, ≤ 10 Mo), chemin `<uuid>.<ext>`, déposé par le gérant connecté.
 */
export interface DocumentRef {
  id: string
  title: string // 1..120
  category: DocumentCategory
  file_path: string // ^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$
  mime_type: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  size_bytes: number
  issued_on: string | null // AAAA-MM-JJ
  valid_until: string | null // AAAA-MM-JJ — rappel avant échéance
  notes: string | null // 0..500
  active: boolean
  updated_at: string
}
export const DOCUMENT_BUCKET = 'documents'
export const DOCUMENT_MAX_BYTES = 10_000_000

/** Rapport de vérification d'intégrité du registre (fonction `verify-integrity`, gérant connecté). */
export interface IntegrityReport {
  checked_at: string
  total_records: number
  devices: {
    device_id: string
    device_name: string
    records: number
    first_seq: number
    last_seq: number
    ok: boolean
    problems: { device_seq: number; record_id: string; problem: 'hash_mismatch' | 'broken_chain' | 'seq_gap' }[]
  }[]
  anchors_used: number // maillons purgés (rétention) remplacés par une ancre
  ok: boolean
}
