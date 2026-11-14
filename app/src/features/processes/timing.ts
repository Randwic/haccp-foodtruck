// Délais, conformité et échéances des procédés (fonctions pures).
import { LIMITS } from '../../../../shared/validation.ts'
import { isInRange } from '../../ui/temperature.ts'
import { addDays, localDateOf, type LocalDate } from '../temperatures/schedule.ts'
import type { SpotEntry, ThawBatch, TimedBatch } from './entries.ts'
import type { TimedRule } from './thresholds.ts'

const MIN = 60_000

/** Minutes écoulées entre deux instants, arrondies au-dessus (1 s de trop compte : contrôle strict). */
export function elapsedMinutes(fromIso: string, to: Date | string): number {
  const ms = new Date(to).getTime() - Date.parse(fromIso)
  return Math.max(0, Math.ceil(ms / MIN))
}

/**
 * Conformité de la clôture d'un lot, calculée par l'app (jamais saisie) : objectif de température
 * atteint ET durée depuis le début ≤ durée maximale. `duration_min` est borné à la limite du contrat.
 */
export function evaluateEnd(input: { startedAt: string; endedAt: Date | string; value_c: number; rule: TimedRule }): {
  in_range: boolean
  duration_min: number
  targetReached: boolean
  withinTime: boolean
} {
  const raw = elapsedMinutes(input.startedAt, input.endedAt)
  const withinTime = raw <= input.rule.maxMinutes
  const targetReached = isInRange(input.value_c, input.rule.target)
  return { in_range: withinTime && targetReached, duration_min: Math.min(raw, LIMITS.durationMaxMin), targetReached, withinTime }
}

export type Urgency = 'ok' | 'soon' | 'overdue'

export interface Countdown {
  deadline: Date
  /** Millisecondes écoulées depuis le début. */
  elapsedMs: number
  /** Millisecondes restantes avant l'échéance (négatif si dépassée). */
  remainingMs: number
  /** Avancement 0..1 (plafonné à 1). */
  progress: number
  urgency: Urgency
}

/** Seuil « échéance proche » : le dernier quart du délai, au moins 15 min (30 min sur 2 h). */
export function soonThresholdMinutes(maxMinutes: number): number {
  return Math.max(15, Math.round(maxMinutes / 4))
}

export function countdown(startedAt: string, rule: Pick<TimedRule, 'maxMinutes'>, now: Date): Countdown {
  const start = Date.parse(startedAt)
  const deadline = new Date(start + rule.maxMinutes * MIN)
  const elapsedMs = Math.max(0, now.getTime() - start)
  const remainingMs = deadline.getTime() - now.getTime()
  const urgency: Urgency = remainingMs <= 0 ? 'overdue' : remainingMs <= soonThresholdMinutes(rule.maxMinutes) * MIN ? 'soon' : 'ok'
  return { deadline, elapsedMs, remainingMs, progress: Math.min(1, elapsedMs / (rule.maxMinutes * MIN)), urgency }
}

/** « 1 h 12 », « 2 h », « 45 min », « 0 min » (minutes entières, arrondi en dessous). */
export function formatMinutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** « 1 h 12 restante », « dépassé de 8 min ». */
export function remainingLabel(c: Countdown): string {
  if (c.remainingMs <= 0) return `dépassé de ${formatMinutes(-c.remainingMs)}`
  const t = Math.ceil(c.remainingMs / MIN)
  const h = Math.floor(t / 60)
  return `${formatMinutes(t * MIN)} restante${h >= 2 || (h === 0 && t >= 2) ? 's' : ''}`
}

// ---------- DLC après décongélation ----------

/** Délai par défaut de la DLC après décongélation (J+3), À CONFIRMER selon le PMS. */
export const DEFAULT_THAW_DLC_DAYS = 3

export function isoDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** DLC par défaut : date locale de fin + `days`. */
export function defaultDlc(endedAt: Date, timeZone: string, days = DEFAULT_THAW_DLC_DAYS): string {
  return isoDate(addDays(localDateOf(endedAt, timeZone), days))
}

/** « mardi 17 novembre » pour une date AAAA-MM-JJ. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

// ---------- Compteurs (accueil) ----------

export interface TimedSummary {
  running: number
  overdue: number
  soon: number
  missingActions: number
  /** Lot en cours dont l'échéance est la plus proche. */
  next: { batch: TimedBatch; countdown: Countdown } | null
}

export function summarizeTimed(batches: readonly TimedBatch[], rule: TimedRule, now: Date): TimedSummary {
  const running = batches.filter((b) => b.running).map((batch) => ({ batch, countdown: countdown(batch.startedAt, rule, now) }))
  running.sort((a, b) => a.countdown.remainingMs - b.countdown.remainingMs)
  return {
    running: running.length,
    overdue: running.filter((r) => r.countdown.urgency === 'overdue').length,
    soon: running.filter((r) => r.countdown.urgency === 'soon').length,
    missingActions: batches.filter((b) => b.missingAction).length,
    next: running[0] ?? null,
  }
}

export function summarizeSpot(entries: readonly SpotEntry[], since: Date): { today: number; missingActions: number } {
  return {
    today: entries.filter((e) => Date.parse(e.time) >= since.getTime()).length,
    missingActions: entries.filter((e) => e.missingAction).length,
  }
}

export function summarizeThaw(batches: readonly ThawBatch[]): { running: number } {
  return { running: batches.filter((b) => b.running).length }
}
