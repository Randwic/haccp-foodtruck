// Libellés des procédés chronométrés (partagés par l'écran, l'accueil et les alertes).
import { describeThreshold } from '../../ui/temperature.ts'
import type { TimedKind, TimedRule } from './thresholds.ts'
import { formatMinutes } from './timing.ts'

export const TIMED_LABELS: Record<TimedKind, { title: string; one: string; many: string; startHint: string; defaults: readonly string[] }> = {
  cooling: {
    title: 'Refroidissement rapide',
    one: 'refroidissement en cours',
    many: 'refroidissements en cours',
    startHint: 'Mesurez à cœur dès la sortie de cuisson, avant la mise en cellule ou au froid.',
    defaults: ['Chili con carne', 'Sauce bolognaise', 'Riz', 'Pommes de terre'],
  },
  reheating: {
    title: 'Remise en température',
    one: 'remise en température en cours',
    many: 'remises en température en cours',
    startHint: 'Mesurez à cœur à la sortie du froid, juste avant de réchauffer.',
    defaults: ['Chili con carne', 'Sauce bolognaise', 'Soupe'],
  },
}

/** « De ≥ 63 °C à ≤ 10 °C en 2 h maximum ». */
export function objectiveLabel(rule: TimedRule): string {
  const d = formatMinutes(rule.maxMinutes * 60_000)
  return rule.start ? `De ${describeThreshold(rule.start)} à ${describeThreshold(rule.target)} en ${d} maximum` : `${describeThreshold(rule.target)} à cœur en ${d} maximum`
}

