// Données de démonstration du lot 9 (?demo=unlocked&thermometres=demo|alerte).
// Uniquement avec le core factice : jamais dans le vrai registre.
import type { FakeRecordSeed } from '../../ui/fakeCore.ts'
import { addDays, localDateOf, zonedTimeToDate } from '../temperatures/schedule.ts'
import { makeCheckPayload } from './model.ts'

const TZ = 'Europe/Paris'

/**
 * « Sonde cuisine » vérifiée il y a 26 jours puis corrigée (erreur de frappe) ; « Sonde réception »
 * hors tolérance il y a 40 jours (réglée, revérifiée conforme il y a 33 jours → vérification en retard).
 * Variante « alerte » : la sonde cuisine est hors tolérance ce matin, sans action corrective.
 */
export function demoThermometerRecords(now: Date, variant: 'demo' | 'alerte' = 'demo'): FakeRecordSeed[] {
  const today = localDateOf(now, TZ)
  let n = 0
  const id = () => `7e2a0000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const at = (daysAgo: number, h: number, m: number) => zonedTimeToDate(addDays(today, -daysAgo), h, m, TZ).toISOString()
  const seeds: FakeRecordSeed[] = []
  const push = (type: FakeRecordSeed['type'], when: string, payload: Record<string, unknown>, author = 'staff-gerant', extra: Partial<FakeRecordSeed> = {}) => {
    if (Date.parse(when) > now.getTime()) return null
    const rid = id()
    seeds.push({ id: rid, type, author_id: author, device_time: when, payload, ...extra })
    return rid
  }
  const check = (d: number, thermometer: string, measured: number, method: 'ice_water' | 'boiling_water' = 'ice_water') =>
    push('thermometer_check', at(d, 16, 10), { ...makeCheckPayload({ thermometer, method, reference: method === 'ice_water' ? 0 : 100, measured, tolerance: 1 }) })

  const bad = check(40, 'Sonde réception', 2.1)
  if (bad) push('corrective_action', at(40, 16, 15), { related_record_id: bad, action: 'adjust_equipment', comment: 'Thermomètre « Sonde réception » réglé, nouvelle vérification à faire' })
  check(40, 'Sonde réception', 0.3)
  check(33, 'Sonde réception', 99.4, 'boiling_water')
  const typo = check(26, 'Sonde cuisine', 3)
  if (typo) {
    push('correction', at(26, 16, 12), { reason: 'Erreur de frappe', replacement: makeCheckPayload({ thermometer: 'Sonde cuisine', method: 'ice_water', reference: 0, measured: 0.3, tolerance: 1 }) }, 'staff-gerant', { supersedes_id: typo })
  }
  if (variant === 'alerte') check(0, 'Sonde cuisine', -1.6)
  return seeds
}
