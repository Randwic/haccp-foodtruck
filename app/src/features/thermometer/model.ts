// Vérification des thermomètres (lot 9) : chaque sonde est contrôlée régulièrement (eau glacée à 0 °C,
// eau bouillante ou thermomètre de référence). Fonctions pures, testées dans thermometer.test.ts.
// Les vérifications sont reconstruites depuis le registre comme les autres modules : corrections en
// chaîne (original barré), actions correctives liées.
import { DEFAULT_THERMOMETER_SETTINGS, type ThermometerCheckPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord, Settings } from '../../../../shared/types.ts'
import { isThermometerInRange, LIMITS, THERMOMETER_METHODS } from '../../../../shared/validation.ts'
import { formatTemperature } from '../../ui/temperature.ts'
import { buildEntries, type Entry } from '../processes/entries.ts'
import { startOfLocalDay } from '../temperatures/schedule.ts'

export const THERMOMETER_RECORD_TYPES = ['thermometer_check', 'correction', 'corrective_action'] as const
/** Historique lu sur l'appareil : couvre la fréquence la plus longue (365 jours) et un peu plus. */
export const THERMOMETER_HISTORY_DAYS = 400
/** « Bientôt à vérifier » : à partir de 3 jours avant l'échéance. */
export const DUE_SOON_DAYS = 3
/** Nom proposé pour la première vérification. */
export const DEFAULT_THERMOMETER_NAME = 'Sonde'

export type ThermometerMethod = ThermometerCheckPayload['method']
export const METHOD_ORDER: readonly ThermometerMethod[] = THERMOMETER_METHODS
export const METHOD_LABELS: Record<ThermometerMethod, string> = {
  ice_water: 'Eau glacée',
  boiling_water: 'Eau bouillante',
  reference: 'Thermomètre de référence',
}
export const METHOD_HINTS: Record<ThermometerMethod, string> = {
  ice_water: 'Verre rempli de glaçons et d’un peu d’eau, attendre 2 min : la sonde doit indiquer 0 °C.',
  boiling_water: 'Sonde plongée dans l’eau à gros bouillons : elle doit indiquer 100 °C (au niveau de la mer).',
  reference: 'Les deux thermomètres mesurent le même produit : comparer avec la valeur du thermomètre étalonné.',
}
/** Valeur attendue des méthodes à référence fixe (null : lue sur le thermomètre de référence). */
export const FIXED_REFERENCE: Record<ThermometerMethod, number | null> = { ice_water: 0, boiling_water: 100, reference: null }

export interface ThermometerRules {
  /** Écart admis (°C). */
  tolerance: number
  /** Vérifier chaque thermomètre au moins tous les N jours. */
  days: number
}

export function thermometerRules(settings: Partial<Pick<Settings, 'thermometer_tolerance_c' | 'thermometer_check_days'>> | null | undefined): ThermometerRules {
  const t = settings?.thermometer_tolerance_c
  const d = settings?.thermometer_check_days
  return {
    tolerance: typeof t === 'number' && Number.isFinite(t) && t >= LIMITS.thermometerToleranceMinC && t <= LIMITS.thermometerToleranceMaxC ? t : DEFAULT_THERMOMETER_SETTINGS.thermometer_tolerance_c,
    days: typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 365 ? d : DEFAULT_THERMOMETER_SETTINGS.thermometer_check_days,
  }
}

/** Écart signé mesure − référence, au dixième. */
export function deviation(measured: number, reference: number): number {
  return (Math.round(measured * 10) - Math.round(reference * 10)) / 10
}

export const formatDeviation = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${formatTemperature(Math.abs(d))}`
export const formatTolerance = (t: number) => `± ${formatTemperature(t)}`

/** Payload prêt à enregistrer (in_range calculé avec l'écart admis en vigueur). */
export function makeCheckPayload(input: { thermometer: string; method: ThermometerMethod; reference: number; measured: number; tolerance: number; comment?: string }): ThermometerCheckPayload {
  const p: ThermometerCheckPayload = {
    thermometer: input.thermometer.trim(),
    method: input.method,
    reference_c: input.reference,
    measured_c: input.measured,
    tolerance_c: input.tolerance,
    in_range: isThermometerInRange(input.measured, input.reference, input.tolerance),
  }
  if (input.comment?.trim()) p.comment = input.comment.trim()
  return p
}

// ---------- Lecture des payloads ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function asThermometerCheck(p: unknown): ThermometerCheckPayload | null {
  if (!isObj(p) || typeof p.thermometer !== 'string' || !(THERMOMETER_METHODS as readonly unknown[]).includes(p.method)) return null
  if (!num(p.reference_c) || !num(p.measured_c) || !num(p.tolerance_c) || typeof p.in_range !== 'boolean') return null
  const out: ThermometerCheckPayload = {
    thermometer: p.thermometer,
    method: p.method as ThermometerMethod,
    reference_c: p.reference_c,
    measured_c: p.measured_c,
    tolerance_c: p.tolerance_c,
    in_range: p.in_range,
  }
  if (typeof p.comment === 'string' && p.comment.trim()) out.comment = p.comment
  return out
}

export type ThermometerCheckEntry = Entry<ThermometerCheckPayload> & { missingAction: boolean }

export function buildThermometerChecks(records: readonly HaccpRecord[]): ThermometerCheckEntry[] {
  return buildEntries(records, ['thermometer_check'], asThermometerCheck)
    .map((e) => ({ ...e, missingAction: !e.payload.in_range && e.correctiveActions.length === 0 }))
    .sort((a, b) => b.time.localeCompare(a.time))
}

/** Clé d'un thermomètre : nom sans casse, accents ni espaces superflus (« sonde  1 » = « Sonde 1 »). */
export function thermometerKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

// ---------- Par thermomètre ----------

export type DueState = 'ok' | 'soon' | 'overdue'

export interface ThermometerStatus {
  /** Nom tel qu'écrit lors de la dernière vérification. */
  name: string
  key: string
  last: ThermometerCheckEntry
  /** Le dernier contrôle est hors tolérance : thermomètre à ne plus utiliser tant qu'il n'est pas revérifié. */
  out: boolean
  /** Prochaine vérification au plus tard (début de la journée locale). */
  dueAt: Date
  due: DueState
  /** Jours restants avant l'échéance (négatif : jours de retard). */
  daysLeft: number
  missingActions: ThermometerCheckEntry[]
}

export function thermometerStatuses(input: { checks: readonly ThermometerCheckEntry[]; rules: ThermometerRules; now: Date; timeZone: string }): ThermometerStatus[] {
  const byKey = new Map<string, ThermometerCheckEntry[]>()
  for (const c of input.checks) {
    const k = thermometerKey(c.payload.thermometer)
    if (!k) continue
    byKey.set(k, [...(byKey.get(k) ?? []), c])
  }
  const today = startOfLocalDay(input.now, input.timeZone).getTime()
  const out: ThermometerStatus[] = []
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => b.time.localeCompare(a.time))
    const last = sorted[0]
    const lastDay = startOfLocalDay(new Date(last.time), input.timeZone)
    const dueAt = startOfLocalDay(lastDay, input.timeZone, -input.rules.days)
    const daysLeft = Math.round((dueAt.getTime() - today) / 86_400_000)
    out.push({
      name: last.payload.thermometer.replace(/\s+/g, ' ').trim(),
      key,
      last,
      out: !last.payload.in_range,
      dueAt,
      due: daysLeft < 0 ? 'overdue' : daysLeft <= DUE_SOON_DAYS ? 'soon' : 'ok',
      daysLeft,
      missingActions: sorted.filter((c) => c.missingAction),
    })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, 'fr'))
}

export interface ThermometerSummary {
  thermometers: number
  missingActions: number
  /** Dernier contrôle hors tolérance. */
  out: number
  overdue: number
  soon: number
}

export function summarizeThermometers(statuses: readonly ThermometerStatus[]): ThermometerSummary {
  return {
    thermometers: statuses.length,
    missingActions: statuses.reduce((n, s) => n + s.missingActions.length, 0),
    out: statuses.filter((s) => s.out).length,
    overdue: statuses.filter((s) => s.due === 'overdue').length,
    soon: statuses.filter((s) => s.due === 'soon').length,
  }
}

/** « dans 12 jours », « demain », « aujourd'hui », « en retard de 3 jours ». */
export function dueLabel(s: Pick<ThermometerStatus, 'daysLeft'>): string {
  const d = s.daysLeft
  if (d < 0) return `en retard de ${-d} jour${d < -1 ? 's' : ''}`
  if (d === 0) return 'à faire aujourd’hui'
  if (d === 1) return 'à faire demain'
  return `à faire dans ${d} jours`
}

export interface Change {
  label: string
  before: string
  after: string
}

export function diffThermometerCheck(prev: ThermometerCheckPayload, next: ThermometerCheckPayload): Change[] {
  const out: Change[] = []
  if (prev.thermometer !== next.thermometer) out.push({ label: 'Thermomètre', before: prev.thermometer, after: next.thermometer })
  if (prev.method !== next.method) out.push({ label: 'Méthode', before: METHOD_LABELS[prev.method], after: METHOD_LABELS[next.method] })
  if (prev.reference_c !== next.reference_c) out.push({ label: 'Valeur attendue', before: formatTemperature(prev.reference_c), after: formatTemperature(next.reference_c) })
  if (prev.measured_c !== next.measured_c) out.push({ label: 'Valeur lue', before: formatTemperature(prev.measured_c), after: formatTemperature(next.measured_c) })
  if ((prev.comment ?? '') !== (next.comment ?? '')) out.push({ label: 'Commentaire', before: prev.comment || '—', after: next.comment || '—' })
  return out
}

/** Texte d'une vérification (mode Contrôle, historique). */
export function describeCheck(p: ThermometerCheckPayload): string {
  return `${METHOD_LABELS[p.method]} : lu ${formatTemperature(p.measured_c)} pour ${formatTemperature(p.reference_c)} attendu (écart ${formatDeviation(deviation(p.measured_c, p.reference_c))}, admis ${formatTolerance(p.tolerance_c)})`
}
