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
