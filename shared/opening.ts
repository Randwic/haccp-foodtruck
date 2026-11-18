// Date d'ouverture de l'établissement (réglage du gérant) : tant qu'elle n'est pas atteinte, les alertes
// et les rappels sont en pause (pas d'alerte « relevé non fait » ni de notification avant d'ouvrir).
// Le registre n'est jamais touché : les saisies d'essai restent possibles et enregistrées normalement.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** « AAAA-MM-JJ » valide (date réelle), sinon false. */
export function isValidOpeningDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Jour local « AAAA-MM-JJ » de `now` dans le fuseau de l'établissement. */
export function localDayKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Vrai tant que le jour local n'a pas atteint la date d'ouverture (pause des alertes et rappels). */
export function isBeforeOpening(openingDate: string | null | undefined, now: Date, timeZone: string): boolean {
  if (!isValidOpeningDate(openingDate)) return false
  return localDayKey(now, timeZone) < openingDate
}

/** « 1er mars 2027 ». */
export function formatOpeningDate(openingDate: string): string {
  const [y, m, d] = openingDate.split('-').map(Number)
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  return `${d === 1 ? '1er' : d} ${month} ${y}`
}
