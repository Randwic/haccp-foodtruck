// Formats d'affichage du module Températures (français, fuseau de l'établissement).
import { formatTime } from '../../ui/format.ts'
import { localDayKey, startOfLocalDay } from './schedule.ts'

/** « Aujourd'hui », « Hier », « Jeudi 12 novembre ». */
export function dayLabel(iso: string | Date, now: Date, timeZone: string): string {
  const key = localDayKey(iso, timeZone)
  if (key === localDayKey(now, timeZone)) return 'Aujourd’hui'
  if (key === localDayKey(startOfLocalDay(now, timeZone, 1), timeZone)) return 'Hier'
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date(iso))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « aujourd’hui à 08:12 », « hier à 18:03 », « jeudi 12 novembre à 18:03 ». */
export function whenLabel(iso: string, now: Date, timeZone: string): string {
  const day = dayLabel(iso, now, timeZone)
  return `${day.charAt(0).toLowerCase()}${day.slice(1)} à ${formatTime(iso, timeZone)}`
}
