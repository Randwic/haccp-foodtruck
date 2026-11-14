// Procédés de démonstration (?demo=unlocked&procedes=demo) pour la démo de l'interface et les captures.
// Uniquement avec le core factice : jamais dans le vrai registre.
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import type { FakeRecordSeed } from '../../ui/fakeCore.ts'

const [FRIGO_1, FRIGO_2] = DEMO_EQUIPMENT.map((e) => e.id)

export function demoProcessRecords(now: Date): FakeRecordSeed[] {
  let n = 0
  const id = () => `9a0c0000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const seeds: FakeRecordSeed[] = []
  const add = (type: FakeRecordSeed['type'], minAgo: number, payload: Record<string, unknown>, extra: Partial<FakeRecordSeed> = {}) => {
    const rid = extra.id ?? id()
    seeds.push({ id: rid, type, author_id: 'staff-equipier', device_time: ago(minAgo), payload, ...extra })
    return rid
  }
  const batch = () => id()

  // Refroidissements en cours : un dans les temps, un proche de l'échéance.
  const c1 = batch()
  add('cooling', 48, { batch_id: c1, step: 'start', product: 'Chili con carne', value_c: 78, source: 'manual' })
  add('cooling', 20, { batch_id: c1, step: 'check', product: 'Chili con carne', value_c: 34.5, source: 'manual' })
  const c2 = batch()
  add('cooling', 104, { batch_id: c2, step: 'start', product: 'Riz', value_c: 71, source: 'manual' })
  add('cooling', 45, { batch_id: c2, step: 'check', product: 'Riz', value_c: 18, source: 'manual' })
  // Hier : un conforme, un hors délai avec action corrective, une erreur corrigée.
  const c3 = batch()
  add('cooling', 26 * 60, { batch_id: c3, step: 'start', product: 'Sauce bolognaise', value_c: 82, source: 'manual' })
  add('cooling', 26 * 60 - 60, { batch_id: c3, step: 'check', product: 'Sauce bolognaise', value_c: 31, source: 'manual' })
  const e3 = add('cooling', 26 * 60 - 105, { batch_id: c3, step: 'end', product: 'Sauce bolognaise', value_c: 70, source: 'manual', in_range: false, duration_min: 105 })
  add('correction', 26 * 60 - 107, { reason: 'Erreur de frappe', replacement: { batch_id: c3, step: 'end', product: 'Sauce bolognaise', value_c: 7, source: 'manual', in_range: true, duration_min: 105 } }, { supersedes_id: e3 })
  const c4 = batch()
  add('cooling', 24 * 60, { batch_id: c4, step: 'start', product: 'Pommes de terre', value_c: 68, source: 'manual' })
  const e4 = add('cooling', 24 * 60 - 135, { batch_id: c4, step: 'end', product: 'Pommes de terre', value_c: 11.5, source: 'manual', in_range: false, duration_min: 135 })
  add('corrective_action', 24 * 60 - 137, { related_record_id: e4, action: 'discard', comment: 'Bac de 6 kg jeté.' })

  // Remise en température en cours.
  const r1 = batch()
  add('reheating', 18, { batch_id: r1, step: 'start', product: 'Soupe de légumes', value_c: 4, source: 'manual' })

  // Cuisson & maintien.
  add('cooking_check', 95, { product: 'Steak haché', value_c: 72.5, source: 'manual', in_range: true })
  add('cooking_check', 60, { product: 'Volaille', value_c: 76, source: 'manual', in_range: true })
  const h1 = add('hot_holding', 40, { product: 'Chili con carne', value_c: 60.5, source: 'manual', in_range: false })
  add('corrective_action', 38, { related_record_id: h1, action: 'reheat', comment: 'Remis à 75 °C.' })
  add('hot_holding', 10, { product: 'Chili con carne', value_c: 66, source: 'manual', in_range: true })

  // Décongélations : une en cours, une terminée ce matin.
  add('thawing', 15 * 60, { batch_id: batch(), step: 'start', product: 'Steaks hachés', equipment_id: FRIGO_1 })
  const t2 = batch()
  add('thawing', 30 * 60, { batch_id: t2, step: 'start', product: 'Pain burger', equipment_id: FRIGO_2 })
  add('thawing', 120, { batch_id: t2, step: 'end', product: 'Pain burger', equipment_id: FRIGO_2, dlc: dlcIn(now, 3) })

  const sorted = seeds.sort((a, b) => a.device_time.localeCompare(b.device_time))
  for (const s of sorted.slice(-2)) s.synced = false
  return sorted
}

function dlcIn(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** Variante « alerte » : un refroidissement en retard et une cuisson hors seuil sans action. */
export function demoProcessAlerts(now: Date): FakeRecordSeed[] {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  return [
    { id: '9a0c0000-0000-4000-8000-100000000001', type: 'cooling', author_id: 'staff-equipier', device_time: ago(132), payload: { batch_id: '9a0c0000-0000-4000-8000-100000000002', step: 'start', product: 'Lasagnes', value_c: 74, source: 'manual' } },
    { id: '9a0c0000-0000-4000-8000-100000000003', type: 'cooking_check', author_id: 'staff-equipier', device_time: ago(25), payload: { product: 'Steak haché', value_c: 64, source: 'manual', in_range: false } },
  ]
}
