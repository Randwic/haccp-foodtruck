// Données de démonstration du lot 5 (?demo=unlocked&nettoyage=demo, &huiles=demo|alerte, &pertes=demo),
// cohérentes avec le plan de nettoyage et les checklists du serveur (DEMO_CLEANING_TASKS / DEMO_CHECKLISTS).
// Uniquement avec le core factice : jamais dans le vrai registre.
import { DEMO_CHECKLISTS, DEMO_CLEANING_TASKS, DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import type { FakeRecordSeed } from '../../ui/fakeCore.ts'
import { addDays, localDateOf, zonedTimeToDate } from '../temperatures/schedule.ts'

const TZ = 'Europe/Paris'
const T = Object.fromEntries(DEMO_CLEANING_TASKS.map((t) => [t.id.slice(-3), t.id]))
const [OPENING, CLOSING, PEST] = DEMO_CHECKLISTS
const VAT_1 = DEMO_EQUIPMENT[3].id
const VAT_2 = DEMO_EQUIPMENT[4].id

function helpers(now: Date, prefix: string) {
  const today = localDateOf(now, TZ)
  let n = 0
  const id = () => `${prefix}-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const at = (daysAgo: number, h: number, m: number) => zonedTimeToDate(addDays(today, -daysAgo), h, m, TZ).toISOString()
  const seeds: FakeRecordSeed[] = []
  const push = (type: FakeRecordSeed['type'], when: string, payload: Record<string, unknown>, author = 'staff-equipier', extra: Partial<FakeRecordSeed> = {}) => {
    if (Date.parse(when) > now.getTime()) return null
    const rid = extra.id ?? id()
    seeds.push({ id: rid, type, author_id: author, device_time: when, payload, ...extra })
    return rid
  }
  return { at, push, seeds }
}

const allOk = (items: { id: string }[]) => items.map((i) => ({ item_id: i.id, ok: true }))

/** Nettoyages des 10 derniers jours (dont tâches en retard), checklists (dont un « Non »), une correction. */
export function demoCleaningRecords(now: Date): FakeRecordSeed[] {
  const { at, push, seeds } = helpers(now, 'c1ea0000')
  for (let d = 9; d >= 1; d--) {
    push('cleaning_done', at(d, 22, 5), { task_id: T['501'] })
    if (d !== 1) push('cleaning_done', at(d, 22, 12), { task_id: T['502'] }) // plancha oubliée hier soir
    if (d > 2) push('cleaning_done', at(d, 22, 20), { task_id: T['503'] }) // friteuse extérieure : 2 jours de retard
    push('cleaning_done', at(d, 22, 30), { task_id: T['507'] })
    push('cleaning_done', at(d, 22, 34), { task_id: T['508'] })
    push('cleaning_done', at(d, 22, 38), { task_id: T['510'] })
    push('checklist_done', at(d, 8, 2), { checklist_id: OPENING.id, answers: allOk(OPENING.items), all_ok: true })
    push('checklist_done', at(d, 22, 45), { checklist_id: CLOSING.id, answers: allOk(CLOSING.items), all_ok: true }, 'staff-gerant')
  }
  push('cleaning_done', at(4, 15, 10), { task_id: T['505'], comment: 'Joint de porte du frigo 2 à surveiller' })
  push('cleaning_done', at(5, 15, 30), { task_id: T['504'] })
  push('cleaning_done', at(11, 15, 0), { task_id: T['509'] }) // hotte : en retard
  push('cleaning_done', at(26, 14, 0), { task_id: T['506'] })
  // Réservoirs d'eau : jamais faits dans la fenêtre → « à faire ».
  push('checklist_done', at(8, 9, 0), {
    checklist_id: PEST.id,
    answers: [
      { item_id: 'pieges', ok: true },
      { item_id: 'traces', ok: false, comment: 'Emballage de pain rongé dans la réserve : pièges ajoutés, réserve nettoyée' },
      { item_id: 'ouvertures', ok: true },
    ],
    all_ok: false,
  }, 'staff-gerant')
  // Correction : mauvaise tâche cochée avant-hier (« Sols » au lieu de « Poubelles »).
  const wrong = push('cleaning_done', at(2, 21, 50), { task_id: T['507'] })
  if (wrong) push('correction', at(2, 21, 55), { reason: 'Mauvaise tâche cochée', replacement: { task_id: T['508'], comment: 'Bacs désinfectés' } }, 'staff-equipier', { supersedes_id: wrong })
  return seeds
}

/** Contrôles d'huile depuis le dernier changement : bac 1 conforme, bac 2 à surveiller (ou hors limite sans action). */
export function demoOilRecords(now: Date, variant: 'demo' | 'alerte' = 'demo'): FakeRecordSeed[] {
  const { at, push, seeds } = helpers(now, '011c0000')
  push('oil_change', at(12, 9, 0), { equipment_id: VAT_1 }, 'staff-gerant')
  push('oil_change', at(6, 9, 0), { equipment_id: VAT_1, comment: 'Huile de tournesol oléique, 12 L ; bac nettoyé' }, 'staff-gerant')
  push('oil_change', at(9, 9, 0), { equipment_id: VAT_2, comment: '12 L' }, 'staff-gerant')
  const check = (vat: string, d: number, v: number, method: 'tester' | 'strip' = 'tester') => push('oil_check', at(d, 11, 15), { equipment_id: vat, polar_percent: v, method, in_range: v <= 25 })
  ;[8.5, 11, 13.5, 15].forEach((v, k) => check(VAT_1, 5 - k, v))
  ;[11, 13.5, 16, 18.5, 20, 21.5].forEach((v, k) => check(VAT_2, 8 - k, v, k % 2 ? 'strip' : 'tester'))
  // Erreur de frappe corrigée sur le bac 2.
  const typo = check(VAT_2, 2, 2.4)
  if (typo) push('correction', at(2, 11, 20), { reason: 'Erreur de frappe', replacement: { equipment_id: VAT_2, polar_percent: 22.4, method: 'tester', in_range: true } }, 'staff-equipier', { supersedes_id: typo })
  check(VAT_1, 0, 16.5)
  check(VAT_2, 0, variant === 'alerte' ? 27 : 23.5)
  return seeds
}

/** Produits jetés de la semaine (en plus de la perte des réceptions de démonstration). */
export function demoWasteRecords(now: Date): FakeRecordSeed[] {
  const { at, push, seeds } = helpers(now, '3a57e000')
  push('waste', at(0, 10, 5), { product: 'Sauce burger', lot: 'P1311-1030', quantity: '1 bac (0,5 L)', reason: 'expired' })
  push('waste', at(1, 21, 40), { product: 'Salade iceberg (sachet)', quantity: '1 sachet', reason: 'damaged', comment: 'Feuilles noircies à l’ouverture' })
  push('waste', at(3, 12, 10), { product: 'Steak haché surgelé', lot: 'SH4471', quantity: '6 pièces', reason: 'temperature', comment: 'Carton resté hors du congélateur pendant le service' }, 'staff-gerant')
  push('waste', at(12, 18, 0), { product: 'Cheddar en tranches', quantity: '200 g', reason: 'expired' })
  return seeds
}
