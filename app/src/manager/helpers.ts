// Aides pures de l'espace gérant (testables sans DOM).
import type { EquipmentKind, RecordType } from '../../../shared/types.ts'
import { ALLERGENS, type Allergen, type Checklist, type ChecklistItem, type CleaningFrequency } from '../../../shared/payloads.ts'
import { STORAGE_KINDS } from '../../../shared/validation.ts'
import type { ChecklistInput, CleaningTaskInput, ProductInput, RecipeInput } from './api.ts'

/** Nom proposé pour l'appareil : « iPad », « iPhone »… (modifiable par l'utilisateur). */
export function guessDeviceName(
  nav: { userAgent: string; maxTouchPoints?: number } | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): string {
  if (!nav) return 'Appareil'
  const ua = nav.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android'
  return 'Ordinateur'
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** Indicateur simple : longueur d'abord (≥ 12 obligatoire), puis variété des caractères. */
export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return { score: 0, label: '' }
  if (pw.length < 12) return { score: 1, label: `Trop court (${pw.length}/12)` }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (new Set(pw).size < 5) return { score: 1, label: 'Trop simple' }
  let score: 2 | 3 | 4 = 2
  if (pw.length >= 16 || classes >= 3) score = 3
  if (pw.length >= 20 || (pw.length >= 14 && classes >= 3)) score = 4
  return { score, label: score === 2 ? 'Correct' : score === 3 ? 'Bon' : 'Excellent' }
}

export const EQUIPMENT_KINDS: { kind: EquipmentKind; label: string }[] = [
  { kind: 'fridge', label: 'Frigo' },
  { kind: 'freezer', label: 'Congélateur' },
  { kind: 'fryer_vat', label: 'Bac de friteuse' },
  { kind: 'hot_holding', label: 'Maintien au chaud' },
  { kind: 'other', label: 'Autre' },
]

export function kindLabel(kind: EquipmentKind): string {
  return EQUIPMENT_KINDS.find((k) => k.kind === kind)?.label ?? kind
}

/** Type de contrôle auquel s'applique le seuil principal d'un équipement. */
export function checkTypeFor(kind: EquipmentKind): RecordType {
  return kind === 'hot_holding' ? 'hot_holding' : 'temperature_check'
}

/** Seuils proposés par défaut (GBPH / arrêté du 21/12/2009) — à confirmer selon le PMS. */
export function defaultThreshold(kind: EquipmentKind): { min_c: number | null; max_c: number | null; tolerance_minutes: number } | null {
  switch (kind) {
    case 'fridge':
      return { min_c: null, max_c: 4, tolerance_minutes: 20 }
    case 'freezer':
      return { min_c: null, max_c: -18, tolerance_minutes: 30 }
    case 'hot_holding':
      return { min_c: 63, max_c: null, tolerance_minutes: 0 }
    default:
      return null
  }
}

/** Lit une température saisie (« -18 », « 3,5 », « −18 »). null si vide ; NaN si illisible. */
export function parseTemperature(s: string): number | null {
  const v = s.trim().replace(',', '.').replace(/[−–]/g, '-').replace(/\s/g, '')
  if (v === '') return null
  if (!/^[-+]?\d+(\.\d)?$/.test(v)) return Number.NaN
  return Number(v)
}

export function formatTemperature(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace('-', '−')} °C`
}

/** Mêmes règles que la table `suppliers` : nom 1–80, téléphone 1–30, email plausible ≤ 254 (null = vide). */
export function normalizeSupplierInput(input: { name?: string; phone?: string | null; email?: string | null }):
  | { ok: true; value: { name?: string; phone?: string | null; email?: string | null } }
  | { ok: false; field: 'name' | 'phone' | 'email'; message: string } {
  const value: { name?: string; phone?: string | null; email?: string | null } = {}
  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, ' ')
    if (!name) return { ok: false, field: 'name', message: 'Le nom du fournisseur est obligatoire.' }
    if (name.length > 80) return { ok: false, field: 'name', message: 'Nom trop long (80 caractères au plus).' }
    value.name = name
  }
  if (input.phone !== undefined) {
    const phone = (input.phone ?? '').trim().replace(/\s+/g, ' ')
    if (phone.length > 30) return { ok: false, field: 'phone', message: 'Numéro trop long (30 caractères au plus).' }
    if (phone && !/^[+0-9 .()-]+$/.test(phone)) return { ok: false, field: 'phone', message: 'Numéro de téléphone invalide.' }
    value.phone = phone || null
  }
  if (input.email !== undefined) {
    const email = (input.email ?? '').trim()
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return { ok: false, field: 'email', message: 'Adresse email invalide.' }
    value.email = email ? email.toLowerCase() : null
  }
  return { ok: true, value }
}

const EMAIL_KEY = 'haccp.manager.email'
/** Mémorise l'email du gérant pour préremplir la reconnexion (jamais le mot de passe). */
export function rememberManagerEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase())
  } catch {
    /* stockage indisponible */
  }
}
export function lastManagerEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function thresholdSummary(t: { min_c: number | null; max_c: number | null; tolerance_minutes: number } | undefined): string {
  if (!t) return 'Aucun seuil'
  const parts: string[] = []
  if (t.min_c !== null && t.max_c !== null) parts.push(`${formatTemperature(t.min_c)} à ${formatTemperature(t.max_c)}`)
  else if (t.max_c !== null) parts.push(`max ${formatTemperature(t.max_c)}`)
  else if (t.min_c !== null) parts.push(`min ${formatTemperature(t.min_c)}`)
  if (t.tolerance_minutes > 0) parts.push(`tolérance ${t.tolerance_minutes} min`)
  return parts.join(' · ')
}

/** Durée de vie maximale (heures) acceptée par la base : 90 jours. */
export const SHELF_LIFE_MAX_HOURS = 2160
export const RECIPE_INGREDIENTS_MAX = 50
export const RECIPE_SUBRECIPES_MAX = 20
export const CATEGORY_MAX = 40
/** Rubriques proposées (liste libre) pour les plats du menu, dans l'ordre du tableau des allergènes. */
export const MENU_CATEGORIES = ['Croq’Brioche', 'Dessert', 'Frites', 'Menu enfant'] as const
/** Température à cœur minimale acceptée pour un produit (°C, une décimale). */
export const COOK_MIN_RANGE = { min: 40, max: 100 } as const

type Normalized<T> = { ok: true; value: T } | { ok: false; field: string; message: string }

function normName(name: string | undefined, what: string): Normalized<string | undefined> {
  if (name === undefined) return { ok: true, value: undefined }
  const n = name.trim().replace(/\s+/g, ' ')
  if (!n) return { ok: false, field: 'name', message: `Le nom ${what} est obligatoire.` }
  if (n.length > 80) return { ok: false, field: 'name', message: 'Nom trop long (80 caractères au plus).' }
  return { ok: true, value: n }
}

/** Allergènes valides, sans doublon, dans l'ordre de l'annexe II. */
export function sortAllergens(list: readonly string[]): Allergen[] {
  const set = new Set(list)
  return ALLERGENS.filter((a) => set.has(a))
}

function checkHours(v: number | null | undefined, what: string, nullable: boolean): string | null {
  if (v === undefined) return null
  if (v === null) return nullable ? null : 'Indiquez une durée de vie.'
  if (!Number.isInteger(v) || v < 1 || v > SHELF_LIFE_MAX_HOURS) return `Durée de vie ${what} invalide : de 1 heure à 90 jours.`
  return null
}

const knownAllergens = (list: readonly string[]) => list.every((a) => (ALLERGENS as readonly string[]).includes(a))
const knownStorage = (s: string) => (STORAGE_KINDS as readonly string[]).includes(s)

/** Mêmes règles que la table `products` (nom 1–80, allergènes de l'annexe II, durées 1..2160 h ou null). */
export function normalizeProductInput(input: Partial<ProductInput>): Normalized<Partial<ProductInput>> {
  const out: Partial<ProductInput> = {}
  const n = normName(input.name, 'du produit')
  if (!n.ok) return n
  if (n.value !== undefined) out.name = n.value
  if (input.allergens !== undefined) {
    if (!knownAllergens(input.allergens)) return { ok: false, field: 'allergens', message: 'Allergène inconnu.' }
    out.allergens = sortAllergens(input.allergens)
  }
  if (input.storage !== undefined) {
    if (!knownStorage(input.storage)) return { ok: false, field: 'storage', message: 'Mode de conservation inconnu.' }
    out.storage = input.storage
  }
  const e1 = checkHours(input.shelf_life_opened_hours, 'après ouverture', true)
  if (e1) return { ok: false, field: 'shelf_life_opened_hours', message: e1 }
  const e2 = checkHours(input.shelf_life_thawed_hours, 'après décongélation', true)
  if (e2) return { ok: false, field: 'shelf_life_thawed_hours', message: e2 }
  if (input.shelf_life_opened_hours !== undefined) out.shelf_life_opened_hours = input.shelf_life_opened_hours
  if (input.shelf_life_thawed_hours !== undefined) out.shelf_life_thawed_hours = input.shelf_life_thawed_hours
  if (input.may_contain !== undefined) {
    if (!knownAllergens(input.may_contain)) return { ok: false, field: 'may_contain', message: 'Allergène inconnu.' }
    const traces = sortAllergens(input.may_contain)
    const present = out.allergens ?? input.allergens
    if (present && traces.some((a) => present.includes(a))) {
      return { ok: false, field: 'may_contain', message: 'Un allergène ne peut pas être à la fois présent et en traces.' }
    }
    out.may_contain = traces
  }
  if (input.cook_min_c !== undefined) {
    const c = input.cook_min_c
    if (c !== null && (!Number.isFinite(c) || Math.round(c * 10) / 10 !== c || c < COOK_MIN_RANGE.min || c > COOK_MIN_RANGE.max)) {
      return { ok: false, field: 'cook_min_c', message: `Température à cœur invalide : de ${COOK_MIN_RANGE.min} à ${COOK_MIN_RANGE.max} °C, une décimale au plus.` }
    }
    out.cook_min_c = c
  }
  return { ok: true, value: out }
}

/**
 * Mêmes règles que la table `recipes` : nom 1–80, 0..50 produits et 0..20 préparations distincts, rubrique 0..40,
 * durée 1..2160 h pour une préparation, null pour un plat du menu (forcée à null).
 */
export function normalizeRecipeInput(input: Partial<RecipeInput>): Normalized<Partial<RecipeInput>> {
  const out: Partial<RecipeInput> = {}
  const n = normName(input.name, 'de la recette')
  if (!n.ok) return n
  if (n.value !== undefined) out.name = n.value
  if (input.ingredient_product_ids !== undefined) {
    const ids = [...new Set(input.ingredient_product_ids)]
    if (ids.length > RECIPE_INGREDIENTS_MAX) return { ok: false, field: 'ingredient_product_ids', message: `${RECIPE_INGREDIENTS_MAX} ingrédients au plus.` }
    out.ingredient_product_ids = ids
  }
  if (input.extra_allergens !== undefined) {
    if (!knownAllergens(input.extra_allergens)) return { ok: false, field: 'extra_allergens', message: 'Allergène inconnu.' }
    out.extra_allergens = sortAllergens(input.extra_allergens)
  }
  if (input.storage !== undefined) {
    if (!knownStorage(input.storage)) return { ok: false, field: 'storage', message: 'Mode de conservation inconnu.' }
    out.storage = input.storage
  }
  if (input.kind !== undefined) {
    if (input.kind !== 'preparation' && input.kind !== 'menu_item') return { ok: false, field: 'kind', message: 'Type de recette inconnu.' }
    out.kind = input.kind
  }
  if (input.category !== undefined) {
    const c = (input.category ?? '').trim().replace(/\s+/g, ' ')
    if (c.length > CATEGORY_MAX) return { ok: false, field: 'category', message: `Rubrique trop longue (${CATEGORY_MAX} caractères au plus).` }
    out.category = c || null
  }
  if (input.ingredient_recipe_ids !== undefined) {
    const ids = [...new Set(input.ingredient_recipe_ids)]
    if (ids.length > RECIPE_SUBRECIPES_MAX) return { ok: false, field: 'ingredient_recipe_ids', message: `${RECIPE_SUBRECIPES_MAX} préparations au plus.` }
    out.ingredient_recipe_ids = ids
  }
  if (input.may_contain !== undefined) {
    if (!knownAllergens(input.may_contain)) return { ok: false, field: 'may_contain', message: 'Allergène inconnu.' }
    out.may_contain = sortAllergens(input.may_contain)
  }
  const kind = out.kind ?? input.kind
  if (kind === 'menu_item') {
    // Plat du menu : servi immédiatement, pas de durée de vie.
    if (input.shelf_life_hours !== undefined || input.kind !== undefined) out.shelf_life_hours = null
  } else {
    const e = checkHours(input.shelf_life_hours, 'de la préparation', false)
    if (e) return { ok: false, field: 'shelf_life_hours', message: e }
    if (input.shelf_life_hours !== undefined) out.shelf_life_hours = input.shelf_life_hours
  }
  return { ok: true, value: out }
}

// ───────────── Lot 5 : plan de nettoyage, checklists, réglages huile ─────────────

export const CLEANING_FREQUENCIES: readonly CleaningFrequency[] = ['after_service', 'daily', 'weekly', 'monthly']
export const CHECKLIST_KINDS: readonly Checklist['kind'][] = ['opening', 'closing', 'pest_control', 'other']
export const CHECKLIST_ITEMS_MAX = 40
const ITEM_ID_RE = /^[a-z0-9_-]{1,40}$/

/** Texte facultatif : vide → null, sinon espaces normalisés, longueur bornée. */
function optionalText(v: string | null | undefined, max: number, field: string, what: string): Normalized<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined }
  const t = (v ?? '').trim()
  if (t.length > max) return { ok: false, field, message: `${what} trop long (${max} caractères au plus).` }
  return { ok: true, value: t || null }
}

/** Mêmes règles que la table `cleaning_tasks` (nom 1–80, fréquence connue, produit ≤ 80, méthode ≤ 500). */
export function normalizeCleaningTaskInput(input: Partial<CleaningTaskInput>): Normalized<Partial<CleaningTaskInput>> {
  const out: Partial<CleaningTaskInput> = {}
  const n = normName(input.name, 'de la tâche')
  if (!n.ok) return n
  if (n.value !== undefined) out.name = n.value
  if (input.frequency !== undefined) {
    if (!CLEANING_FREQUENCIES.includes(input.frequency)) return { ok: false, field: 'frequency', message: 'Fréquence inconnue.' }
    out.frequency = input.frequency
  }
  const p = optionalText(input.product, 80, 'product', 'Produit')
  if (!p.ok) return p
  if (p.value !== undefined) out.product = p.value
  const m = optionalText(input.method, 500, 'method', 'Mode opératoire')
  if (!m.ok) return m
  if (m.value !== undefined) out.method = m.value
  return { ok: true, value: out }
}

/**
 * Identifiant stable d'un point de checklist tiré de son libellé : minuscules sans accents,
 * [a-z0-9_], 1..40, unique parmi `taken` (suffixe _2, _3… si besoin).
 */
export function checklistItemId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36)
      .replace(/_+$/, '') || 'point'
  if (!used.has(base)) return base
  for (let k = 2; ; k++) {
    const id = `${base}_${k}`
    if (!used.has(id)) return id
  }
}

/** Mêmes règles que la table `checklists` : nom 1–80, nature connue, 1..40 points { id unique, libellé 1..120, required }. */
export function normalizeChecklistInput(input: Partial<ChecklistInput>): Normalized<Partial<ChecklistInput>> {
  const out: Partial<ChecklistInput> = {}
  const n = normName(input.name, 'de la checklist')
  if (!n.ok) return n
  if (n.value !== undefined) out.name = n.value
  if (input.kind !== undefined) {
    if (!CHECKLIST_KINDS.includes(input.kind)) return { ok: false, field: 'kind', message: 'Nature de checklist inconnue.' }
    out.kind = input.kind
  }
  if (input.items !== undefined) {
    if (input.items.length < 1) return { ok: false, field: 'items', message: 'Ajoutez au moins un point à contrôler.' }
    if (input.items.length > CHECKLIST_ITEMS_MAX) return { ok: false, field: 'items', message: `${CHECKLIST_ITEMS_MAX} points au plus.` }
    const ids = new Set<string>()
    const items: ChecklistItem[] = []
    for (const [k, it] of input.items.entries()) {
      const label = it.label.trim().replace(/\s+/g, ' ')
      if (!label) return { ok: false, field: 'items', message: `Point ${k + 1} : libellé obligatoire.` }
      if (label.length > 120) return { ok: false, field: 'items', message: `Point ${k + 1} : libellé trop long (120 caractères au plus).` }
      if (!ITEM_ID_RE.test(it.id)) return { ok: false, field: 'items', message: `Point ${k + 1} : identifiant invalide.` }
      if (ids.has(it.id)) return { ok: false, field: 'items', message: `Point ${k + 1} : identifiant en double.` }
      ids.add(it.id)
      items.push({ id: it.id, label, required: it.required === true })
    }
    out.items = items
  }
  return { ok: true, value: out }
}

/** Réglages huile : même règle que la base (max 10..30, 0 < alerte < max, une décimale). null si valide. */
export function oilSettingsError(max: number, warn: number): string | null {
  const oneDecimal = (v: number) => Number.isFinite(v) && Math.round(v * 10) / 10 === v
  if (!oneDecimal(max) || max < 10 || max > 30) return 'La limite des composés polaires doit être comprise entre 10 et 30 % (une décimale au plus).'
  if (!oneDecimal(warn) || warn <= 0) return 'Le seuil d’alerte doit être un pourcentage positif (une décimale au plus).'
  if (warn >= max) return 'Le seuil d’alerte doit être inférieur à la limite.'
  return null
}
