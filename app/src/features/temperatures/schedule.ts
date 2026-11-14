// Créneaux de relevé des enceintes et statuts (fonctions pures, sans React).
// Les heures `settings.daily_check_times` sont des heures LOCALES de l'établissement
// (`establishment.timezone`, ex. Europe/Paris) : les créneaux suivent les changements d'heure.
import type { Equipment } from '../../../../shared/types.ts'
import type { Reading } from './readings.ts'

export const DEFAULT_TIMEZONE = 'Europe/Paris'
export const MIN_CHECK_TIMES = 1
export const MAX_CHECK_TIMES = 6

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidCheckTime(s: string): boolean {
  return HHMM.test(s)
}

/** Heures valides, sans doublon, triées. */
export function normalizeCheckTimes(times: readonly string[] | null | undefined): string[] {
  return [...new Set((times ?? []).filter(isValidCheckTime))].sort()
}

export interface LocalDate {
  year: number
  month: number // 1..12
  day: number
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatters.set(timeZone, f)
  }
  return f
}

/** Date et heure murales de `date` dans le fuseau. */
export function zonedParts(date: Date, timeZone: string): LocalDate & { hour: number; minute: number; second: number } {
  const p: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second }
}

/** Décalage du fuseau à cet instant, en ms (Paris : +1 h l'hiver, +2 h l'été). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Instant correspondant à une heure murale du fuseau. Heure inexistante (passage à l'heure d'été,
 * 02:30) : décalée d'une heure plus tard (03:30) ; heure ambiguë (retour à l'heure d'hiver) : l'une des
 * deux occurrences (sans conséquence pour des relevés quotidiens).
 */
export function zonedTimeToDate(d: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(d.year, d.month - 1, d.day, hour, minute)
  const first = wall - offsetMs(new Date(wall), timeZone)
  const second = wall - offsetMs(new Date(first), timeZone)
  if (first === second) return new Date(first)
  // Les deux essais divergent autour d'un changement d'heure : on garde celui qui retombe sur l'heure murale,
  // sinon (heure inexistante) le plus tardif.
  const matches = (t: number) => {
    const p = zonedParts(new Date(t), timeZone)
    return p.hour === hour && p.minute === minute
  }
  const candidates = [first, second].filter(matches).sort((a, b) => a - b)
  return new Date(candidates[0] ?? Math.max(first, second))
}

/** Jour local décalé de `delta` jours. */
export function addDays(d: LocalDate, delta: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + delta))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function localDateOf(date: Date, timeZone: string): LocalDate {
  const { year, month, day } = zonedParts(date, timeZone)
  return { year, month, day }
}

/** « 2026-11-14 » : clé de regroupement par jour local. */
export function localDayKey(date: Date | string, timeZone: string): string {
  const d = localDateOf(typeof date === 'string' ? new Date(date) : date, timeZone)
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** Début (00:00 local) du jour de `now` moins `daysBack` jours. */
export function startOfLocalDay(now: Date, timeZone: string, daysBack = 0): Date {
  return zonedTimeToDate(addDays(localDateOf(now, timeZone), -daysBack), 0, 0, timeZone)
}

/** Créneaux d'un jour local, triés. */
export function slotsOfDay(day: LocalDate, times: readonly string[], timeZone: string): Date[] {
  return normalizeCheckTimes(times).map((t) => {
    const [, h, m] = HHMM.exec(t)!
    return zonedTimeToDate(day, Number(h), Number(m), timeZone)
  })
}

/**
 * Créneau le plus récent déjà passé (≤ now), aujourd'hui ou à défaut hier. null si aucune heure.
 * `carryOver` false (réglage `missed_slot_carry_over`) : le créneau de la veille n'est pas reporté,
 * rien n'est « à faire » avant le premier créneau du jour.
 */
export function currentSlot(now: Date, times: readonly string[], timeZone: string, carryOver = true): Date | null {
  const today = localDateOf(now, timeZone)
  const candidates = [...(carryOver ? slotsOfDay(addDays(today, -1), times, timeZone) : []), ...slotsOfDay(today, times, timeZone)]
  const past = candidates.filter((s) => s.getTime() <= now.getTime())
  return past.length ? past[past.length - 1] : null
}

/** Prochain créneau (> now), aujourd'hui ou demain. */
export function nextSlot(now: Date, times: readonly string[], timeZone: string): Date | null {
  const today = localDateOf(now, timeZone)
  const candidates = [...slotsOfDay(today, times, timeZone), ...slotsOfDay(addDays(today, 1), times, timeZone)]
  return candidates.find((s) => s.getTime() > now.getTime()) ?? null
}

// ---------- Statut des enceintes ----------

/** Enceintes froides suivies par les relevés : frigos et congélateurs actifs. */
export function isMonitoredEnclosure(e: Equipment): boolean {
  return e.active && (e.kind === 'fridge' || e.kind === 'freezer')
}

export type SlotState = 'due' | 'done' | 'no_schedule'

export interface EnclosureStatus {
  equipment: Equipment
  /** Dernier relevé (le plus récent, corrections appliquées), ou null. */
  last: Reading | null
  /** Créneau en cours (le plus récent passé), ou null si aucune heure de relevé. */
  slot: Date | null
  /** 'due' : pas de relevé de cette enceinte depuis le créneau en cours. */
  state: SlotState
  /** Relevés hors seuil de cette enceinte sans action corrective. */
  missingActions: Reading[]
}

/**
 * Statut de chaque enceinte. `readings` : relevés (tous équipements, ordre quelconque) ;
 * un relevé compte pour le créneau si son heure (device_time) est ≥ au créneau.
 */
export function enclosureStatuses(input: {
  equipment: readonly Equipment[]
  readings: readonly Reading[]
  now: Date
  checkTimes: readonly string[]
  timeZone: string
  /** Réglage `missed_slot_carry_over` (défaut true). */
  carryOver?: boolean
}): EnclosureStatus[] {
  const slot = currentSlot(input.now, input.checkTimes, input.timeZone, input.carryOver ?? true)
  return input.equipment.filter(isMonitoredEnclosure).map((equipment) => {
    const mine = input.readings.filter((r) => r.equipmentId === equipment.id).sort((a, b) => b.time.localeCompare(a.time))
    const last = mine[0] ?? null
    const state: SlotState = slot === null ? 'no_schedule' : mine.some((r) => Date.parse(r.time) >= slot.getTime()) ? 'done' : 'due'
    return { equipment, last, slot, state, missingActions: mine.filter((r) => r.missingAction) }
  })
}

export interface TemperatureSummary {
  enclosures: number
  due: number
  missingActions: number
}

export function summarize(statuses: readonly EnclosureStatus[]): TemperatureSummary {
  return {
    enclosures: statuses.length,
    due: statuses.filter((s) => s.state === 'due').length,
    missingActions: statuses.reduce((n, s) => n + s.missingActions.length, 0),
  }
}

/** « 2 relevés à faire », « 1 action corrective manquante »… */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}
