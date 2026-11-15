// Créneaux de relevé des enceintes, côté serveur (moteur d'alertes `check_overdue`).
// COPIE FIDÈLE des fonctions de app/src/features/temperatures/schedule.ts (l'Edge Function ne
// peut pas importer app/) : même calcul des créneaux en heure locale de l'établissement, même
// règle de report `missed_slot_carry_over`. Toute évolution de l'une doit être reportée dans l'autre.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface LocalDate {
  year: number
  month: number // 1..12
  day: number
}

/** Heures valides, sans doublon, triées. */
export function normalizeCheckTimes(times: readonly string[] | null | undefined): string[] {
  return [...new Set((times ?? []).filter((t) => HHMM.test(t)))].sort()
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

/** Fuseau utilisable (IANA connu d'Intl), sinon Europe/Paris. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'Europe/Paris'
  try {
    partsFormatter(tz)
    return tz
  } catch {
    return 'Europe/Paris'
  }
}

/** Date et heure murales de `date` dans le fuseau. */
export function zonedParts(date: Date, timeZone: string): LocalDate & { hour: number; minute: number; second: number } {
  const p: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second }
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Instant d'une heure murale du fuseau (heure inexistante : décalée plus tard ; ambiguë : l'une des deux). */
export function zonedTimeToDate(d: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(d.year, d.month - 1, d.day, hour, minute)
  const first = wall - offsetMs(new Date(wall), timeZone)
  const second = wall - offsetMs(new Date(first), timeZone)
  if (first === second) return new Date(first)
  const matches = (t: number) => {
    const p = zonedParts(new Date(t), timeZone)
    return p.hour === hour && p.minute === minute
  }
  const candidates = [first, second].filter(matches).sort((a, b) => a - b)
  return new Date(candidates[0] ?? Math.max(first, second))
}

export function addDays(d: LocalDate, delta: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + delta))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function localDateOf(date: Date, timeZone: string): LocalDate {
  const { year, month, day } = zonedParts(date, timeZone)
  return { year, month, day }
}

/** Créneaux d'un jour local, triés. */
export function slotsOfDay(day: LocalDate, times: readonly string[], timeZone: string): Date[] {
  return normalizeCheckTimes(times).map((t) => {
    const [, h, m] = HHMM.exec(t)!
    return zonedTimeToDate(day, Number(h), Number(m), timeZone)
  })
}

/**
 * Créneau le plus récent déjà passé (≤ now), aujourd'hui ou à défaut hier (si `carryOver`).
 * Identique à `currentSlot` de l'app.
 */
export function currentSlot(now: Date, times: readonly string[], timeZone: string, carryOver = true): Date | null {
  const today = localDateOf(now, timeZone)
  const candidates = [...(carryOver ? slotsOfDay(addDays(today, -1), times, timeZone) : []), ...slotsOfDay(today, times, timeZone)]
  const past = candidates.filter((s) => s.getTime() <= now.getTime())
  return past.length ? past[past.length - 1] : null
}

/** « 14:05 » en heure locale. */
export function formatLocalTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** « 14:05 », « hier 18:00 » ou « 12/11 18:00 » selon le jour local par rapport à `now`. */
export function formatLocalMoment(date: Date, now: Date, timeZone: string): string {
  const d = localDateOf(date, timeZone)
  const today = localDateOf(now, timeZone)
  const same = (a: LocalDate, b: LocalDate) => a.year === b.year && a.month === b.month && a.day === b.day
  const time = formatLocalTime(date, timeZone)
  if (same(d, today)) return time
  if (same(d, addDays(today, -1))) return `hier ${time}`
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')} ${time}`
}
