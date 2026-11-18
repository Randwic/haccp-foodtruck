// Alertes de démonstration (?demo=unlocked&alertes=demo) : ce que le serveur envoie réellement.
import type { Alert } from '../../../../shared/payloads.ts'
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'

export function demoAlerts(now: Date): Alert[] {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const base = { sensor_id: null, related_record_id: null, resolved_at: null, acknowledged_at: null, last_notified_at: null }
  return [
    { ...base, id: 'a0000000-0000-4000-8000-000000000001', kind: 'check_overdue', equipment_id: DEMO_EQUIPMENT[0].id, message: `${DEMO_EQUIPMENT[0].name} : relevé de 08:00 non fait`, opened_at: ago(70) },
    { ...base, id: 'a0000000-0000-4000-8000-000000000002', kind: 'check_overdue', equipment_id: DEMO_EQUIPMENT[2].id, message: `${DEMO_EQUIPMENT[2].name} : relevé de 08:00 non fait`, opened_at: ago(68) },
    { ...base, id: 'a0000000-0000-4000-8000-000000000003', kind: 'process_overdue', equipment_id: null, related_record_id: 'a0000000-0000-4000-8000-0000000000ff', message: 'Refroidissement « Chili » non clôturé : démarré 10:05, durée max 120 min', opened_at: ago(20) },
    { ...base, id: 'a0000000-0000-4000-8000-000000000004', kind: 'check_overdue', equipment_id: DEMO_EQUIPMENT[1].id, message: `${DEMO_EQUIPMENT[1].name} : relevé de 18:00 non fait`, opened_at: ago(60 * 26), acknowledged_at: ago(60 * 25) },
  ]
}
