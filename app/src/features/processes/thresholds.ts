// Seuils des procédés (refroidissement, remise en température, maintien au chaud, cuisson à cœur).
// Source : seuil générique (equipment_id null) du check_type, sinon DEFAULT_PROCESS_THRESHOLDS
// (shared/payloads.ts). Pour cooling / reheating, la durée maximale est dans `tolerance_minutes`.
import { DEFAULT_PROCESS_THRESHOLDS } from '../../../../shared/payloads.ts'
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
