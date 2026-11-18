// Seuils des procédés (refroidissement, remise en température, maintien au chaud, cuisson à cœur).
// Source : seuil générique (equipment_id null) du check_type, sinon DEFAULT_PROCESS_THRESHOLDS
// (shared/payloads.ts). Pour cooling / reheating, la durée maximale est dans `tolerance_minutes`.
import { DEFAULT_PROCESS_THRESHOLDS, type Product } from '../../../../shared/payloads.ts'
import type { RecordType, Threshold } from '../../../../shared/types.ts'
import type { TemperatureThreshold } from '../../ui/temperature.ts'

export type TimedKind = 'cooling' | 'reheating'
export type SpotKind = 'hot_holding' | 'cooking_check'

export interface TimedRule {
  kind: TimedKind
  /** Température de départ attendue (cooling : ≥ 63 °C), contrôlée à titre d'avertissement. */
  start: TemperatureThreshold | null
  /** Objectif à atteindre à la fin (cooling : ≤ 10 °C ; reheating : ≥ 63 °C). */
  target: TemperatureThreshold
  /** Délai maximal entre le début et l'atteinte de l'objectif. */
  maxMinutes: number
  /** true : au moins une valeur vient des défauts du contrat (aucun seuil générique enregistré). */
  isDefault: boolean
}

export interface SpotRule {
  kind: SpotKind
  threshold: TemperatureThreshold
  isDefault: boolean
}

function generic(thresholds: readonly Threshold[], type: RecordType): Threshold | undefined {
  return thresholds.find((t) => t.equipment_id === null && t.check_type === type)
}

/** Règle du refroidissement / de la remise en température en vigueur. */
export function timedRule(kind: TimedKind, thresholds: readonly Threshold[]): TimedRule {
  const t = generic(thresholds, kind)
  // Une durée nulle n'a pas de sens pour un procédé : on retombe sur le défaut du contrat.
  const minutes = t && t.tolerance_minutes > 0 ? t.tolerance_minutes : null
  if (kind === 'cooling') {
    const d = DEFAULT_PROCESS_THRESHOLDS.cooling
    const targetMax = t?.max_c ?? null
    return {
      kind,
      start: { min_c: t?.min_c ?? d.start_min_c, max_c: null },
      target: { min_c: null, max_c: targetMax ?? d.target_max_c },
      maxMinutes: minutes ?? d.max_minutes,
      isDefault: targetMax === null || minutes === null,
    }
  }
  const d = DEFAULT_PROCESS_THRESHOLDS.reheating
  const targetMin = t?.min_c ?? null
  return {
    kind,
    start: null,
    target: { min_c: targetMin ?? d.target_min_c, max_c: null },
    maxMinutes: minutes ?? d.max_minutes,
    isDefault: targetMin === null || minutes === null,
  }
}

/** Seuil minimal du maintien au chaud / de la cuisson à cœur en vigueur. */
export function spotRule(kind: SpotKind, thresholds: readonly Threshold[]): SpotRule {
  const t = generic(thresholds, kind)
  if (t && (t.min_c !== null || t.max_c !== null)) return { kind, threshold: { min_c: t.min_c, max_c: t.max_c }, isDefault: false }
  return { kind, threshold: { min_c: DEFAULT_PROCESS_THRESHOLDS[kind].min_c, max_c: null }, isDefault: true }
}

// ---------- Lot 4 bis : cuisson à cœur par produit ----------

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Produits du catalogue proposés pour la cuisson à cœur : actifs, avec une température minimale, triés par nom. */
export function cookableProducts(products: readonly Product[]): Product[] {
  return products.filter((p) => p.active && p.cook_min_c !== null).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Produit du catalogue désigné par ce libellé (même nom, sans tenir compte des accents ni de la casse). */
export function catalogProductNamed(products: readonly Product[], name: string): Product | null {
  const k = key(name)
  if (!k) return null
  return products.find((p) => p.cook_min_c !== null && key(p.name) === k) ?? null
}

export interface CookingRule extends SpotRule {
  /** Produit du catalogue dont vient le seuil (cook_min_c), sinon null (seuil générique). */
  product: Product | null
}

/**
 * Seuil de la cuisson à cœur pour un produit : `cook_min_c` du produit du catalogue (ex. porc 63 °C,
 * poulet / nuggets 74 °C) ; sinon le seuil générique `cooking_check` (défaut 70 °C).
 */
export function cookingRuleFor(productName: string, products: readonly Product[], generic: SpotRule): CookingRule {
  const product = catalogProductNamed(products, productName)
  if (product) return { kind: 'cooking_check', threshold: { min_c: product.cook_min_c, max_c: null }, isDefault: false, product }
  return { ...generic, product: null }
}

/**
 * Règle d'un lot de remise en température : l'objectif est le plus exigeant entre le seuil générique
 * (≥ 63 °C) et la cuisson à cœur du produit du catalogue (`cook_min_c`, ex. poulet / nuggets 74 °C).
 * Refroidissement : règle inchangée.
 */
export function ruleForBatch(rule: TimedRule, productName: string, products: readonly Product[]): TimedRule & { product: Product | null } {
  if (rule.kind !== 'reheating') return { ...rule, product: null }
  const product = catalogProductNamed(products, productName)
  const generic = rule.target.min_c ?? -Infinity
  if (!product || product.cook_min_c === null || product.cook_min_c <= generic) return { ...rule, product: null }
  return { ...rule, target: { min_c: product.cook_min_c, max_c: null }, product }
}
