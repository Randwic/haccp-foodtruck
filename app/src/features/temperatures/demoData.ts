// Historique de relevés pour la démo de l'interface (?demo=unlocked&releves=demo|alerte) et les captures.
// Uniquement avec le core factice : jamais dans le vrai registre.
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import type { FakeRecordSeed } from '../../ui/fakeCore.ts'
import { addDays, localDateOf, zonedTimeToDate } from './schedule.ts'

const [FRIGO_1, FRIGO_2, CONGEL] = DEMO_EQUIPMENT.map((e) => e.id)
const TZ = 'Europe/Paris'

/** `alerte` : ajoute ce matin un relevé hors seuil sans action corrective. */
export function demoTemperatureRecords(now: Date, variant: 'demo' | 'alerte' = 'demo'): FakeRecordSeed[] {
  const seeds: FakeRecordSeed[] = []
  const today = localDateOf(now, TZ)
  let n = 0
  const id = () => `5e1d0000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const at = (daysAgo: number, h: number, m: number) => zonedTimeToDate(addDays(today, -daysAgo), h, m, TZ)
  const reading = (when: Date, equipment_id: string, value_c: number, max: number, author = 'staff-equipier', rid = id()) => {
    seeds.push({ id: rid, type: 'temperature_check', author_id: author, device_time: when.toISOString(), payload: { equipment_id, value_c, source: 'manual', in_range: value_c <= max } })
    return rid
  }
  const later = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)

  for (let d = 7; d >= 0; d--) {
    for (const [h, m] of [
      [8, 4],
      [18, 6],
    ] as const) {
      const t = at(d, h, m)
      if (t.getTime() > now.getTime()) continue
      const v = ((d * 7 + h) % 9) / 10
      if (d === 0 && h === 8) {
        // Aujourd'hui : Frigo 2 pas encore relevé (créneau « à faire »).
        reading(t, FRIGO_1, 3.2, 4, 'staff-gerant')
        reading(later(t, 1), CONGEL, -19.5, -18, 'staff-gerant')
        if (variant === 'alerte') reading(later(t, 3), FRIGO_2, 6.8, 4, 'staff-gerant')
        continue
      }
      if (d === 2 && h === 8) {
        // Erreur de frappe corrigée : 35 au lieu de 3,5.
        const orig = reading(t, FRIGO_1, 35, 4)
        const fixed = later(t, 2).toISOString()
        reading(later(t, 1), FRIGO_2, 2.9, 4)
        reading(later(t, 1.5), CONGEL, -20.1, -18)
        seeds.push({
          id: id(),
          type: 'correction',
          author_id: 'staff-equipier',
          device_time: fixed,
          supersedes_id: orig,
          payload: { reason: 'Erreur de frappe', replacement: { equipment_id: FRIGO_1, value_c: 3.5, source: 'manual', in_range: true } },
        })
        continue
      }
      if (d === 1 && h === 18) {
        // Hors seuil avec action corrective.
        reading(t, FRIGO_1, 3.6, 4)
        const out = reading(later(t, 1), FRIGO_2, 7.4, 4)
        reading(later(t, 2), CONGEL, -18.6, -18)
        seeds.push({
          id: id(),
          type: 'corrective_action',
          author_id: 'staff-equipier',
          device_time: later(t, 4).toISOString(),
          payload: { related_record_id: out, action: 'adjust_equipment', comment: 'Porte mal fermée, thermostat vérifié. Contrôle à 18:40 : 3,8 °C.' },
        })
        continue
      }
      reading(t, FRIGO_1, 2.6 + v, 4)
      reading(later(t, 1), FRIGO_2, 3.1 + v / 2, 4)
      reading(later(t, 2), CONGEL, -19.2 - v, -18)
    }
  }
  // Les plus récents pas encore envoyés au serveur.
  const sorted = seeds.sort((a, b) => a.device_time.localeCompare(b.device_time))
  for (const s of sorted.slice(-2)) s.synced = false
  return sorted
}
