// Formats d'affichage (français, fuseau de l'établissement).
const DEFAULT_TZ = 'Europe/Paris'

export function formatTime(iso: string | Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function formatDateTime(iso: string | Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function formatLongDate(d: Date, timeZone = DEFAULT_TZ): string {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « 4 min 32 s », « 45 s », « 1 h 02 min ». */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${sec} s`
  return `${sec} s`
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s\-–]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
