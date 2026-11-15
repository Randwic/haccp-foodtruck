// Aides pures de l'espace gérant (testables sans DOM).
import type { EquipmentKind, RecordType } from '../../../shared/types.ts'
import { ALLERGENS, type Allergen } from '../../../shared/payloads.ts'
import { STORAGE_KINDS } from '../../../shared/validation.ts'
import type { ProductInput, RecipeInput } from './api.ts'

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
  return { ok: true, value: out }
}

/** Mêmes règles que la table `recipes` (nom 1–80, 0..50 ingrédients distincts, durée 1..2160 h). */
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
  const e = checkHours(input.shelf_life_hours, 'de la préparation', false)
  if (e) return { ok: false, field: 'shelf_life_hours', message: e }
  if (input.shelf_life_hours !== undefined) out.shelf_life_hours = input.shelf_life_hours
  return { ok: true, value: out }
}
