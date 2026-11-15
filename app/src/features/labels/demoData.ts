// Étiquettes de démonstration (?demo=unlocked&etiquettes=demo) pour la démo de l'interface et les captures.
// Uniquement avec le core factice : jamais dans le vrai registre.
import type { LabelPrintedPayload, Recipe } from '../../../../shared/payloads.ts'
import { DEMO_PRODUCTS, DEMO_RECIPES, DEMO_SUPPLIERS } from '../../core/mockTransport.ts'
import type { FakeRecordSeed } from '../../ui/fakeCore.ts'
import { recipeAllergens } from './model.ts'

const [PAIN, CHEDDAR, STEAK, SAUCE, FRITES, BACON, SALADE, CORNICHONS] = DEMO_PRODUCTS
const T0 = '2026-01-01T00:00:00.000Z'

/** Plats de la carte (démo du tableau des allergènes) en plus de la recette du serveur. */
export const DEMO_MENU_RECIPES: Recipe[] = [
  ...DEMO_RECIPES,
  { id: '8c0d0000-0000-4000-8000-000000000001', name: 'Burger classique', ingredient_product_ids: [PAIN.id, STEAK.id, CHEDDAR.id, SAUCE.id, SALADE.id, CORNICHONS.id], extra_allergens: [], storage: 'fridge', shelf_life_hours: 4, active: true, updated_at: '2026-11-10T09:12:00.000Z' },
  { id: '8c0d0000-0000-4000-8000-000000000002', name: 'Cheese bacon', ingredient_product_ids: [PAIN.id, STEAK.id, CHEDDAR.id, BACON.id, DEMO_PRODUCTS[3].id], extra_allergens: [], storage: 'fridge', shelf_life_hours: 4, active: true, updated_at: '2026-11-10T09:12:00.000Z' },
  { id: '8c0d0000-0000-4000-8000-000000000003', name: 'Frites maison', ingredient_product_ids: [FRITES.id], extra_allergens: [], storage: 'ambient', shelf_life_hours: 2, active: true, updated_at: T0 },
]

export function demoLabels(now: Date): FakeRecordSeed[] {
  let n = 0
  const id = () => `8c0e0000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const min = (m: number) => new Date(Math.floor((now.getTime() - m * 60_000) / 60_000) * 60_000)
  const records: FakeRecordSeed[] = []
  const add = (type: FakeRecordSeed['type'], minAgo: number, payload: Record<string, unknown>, extra: Partial<FakeRecordSeed> = {}) => {
    const rid = extra.id ?? id()
    records.push({ id: rid, type, author_id: extra.author_id ?? 'staff-equipier', device_time: min(minAgo).toISOString(), payload, ...extra })
    return rid
  }
  const label = (minAgo: number, p: Omit<LabelPrintedPayload, 'made_at' | 'dlc_at' | 'copies'> & { hours: number; copies?: number }) => {
    const made = min(minAgo)
    const { hours, ...rest } = p
    const payload: LabelPrintedPayload = { ...rest, made_at: made.toISOString(), dlc_at: new Date(made.getTime() + hours * 3_600_000).toISOString(), copies: p.copies ?? 1 }
    return { id: add('label_printed', minAgo, { ...payload }), payload }
  }

  // Réception d'il y a 2 jours : lots proposés à l'ouverture.
  const rec = add('reception', 2 * 1440 + 30, {
    supplier_id: DEMO_SUPPLIERS[2].id,
    delivery_note: 'M-779402',
    vehicle_ok: true,
    packaging_ok: true,
    items: [
      { product: 'Sauce burger 1 L', lot: 'SB2611', dlc: isoIn(now, 60), storage: 'fridge', temperature_c: 3.1, accepted: true },
      { product: 'Cornichons bocal', lot: 'CO118', ddm: isoIn(now, 300), storage: 'ambient', accepted: true },
      { product: 'Cheddar tranches', lot: 'CH0921', dlc: isoIn(now, 24), storage: 'fridge', temperature_c: 3.4, accepted: true },
    ],
  })

  // DLC dépassée ce matin (salade ouverte hier, 24 h).
  label(26 * 60, { kind: 'opened', product_id: SALADE.id, name: SALADE.name, allergens: [], storage: 'fridge', hours: 24 })
  // DLC aujourd'hui : sauce burger ouverte il y a 3 jours moins 4 h, lot de la réception.
  label(72 * 60 - 240, { kind: 'opened', product_id: SAUCE.id, name: SAUCE.name, allergens: ['oeufs', 'moutarde'], storage: 'fridge', lot: 'SB2611', source_record_ids: [rec], hours: 72 })
  // Demain : cheddar ouvert il y a 2 jours (72 h), corrigé (lot).
  const ch = label(48 * 60 + 15, { kind: 'opened', product_id: CHEDDAR.id, name: CHEDDAR.name, allergens: ['lait'], storage: 'fridge', lot: 'CH092', hours: 72 })
  add('correction', 48 * 60, { reason: 'Erreur de lot', replacement: { ...ch.payload, lot: 'CH0921', source_record_ids: [rec] } }, { supersedes_id: ch.id })
  // Jeté hier : pain ouvert il y a 3 jours.
  const pain = label(3 * 1440, { kind: 'opened', product_id: PAIN.id, name: PAIN.name, allergens: ['gluten', 'sesame'], storage: 'ambient', hours: 48 })
  add('waste', 1440 - 60, { product: PAIN.name, reason: 'expired', quantity: '4 pains', related_record_id: pain.id })
  // Aujourd'hui : sauce cheddar maison (lot interne, 3 étiquettes) et steaks décongelés.
  const sc = DEMO_RECIPES[0]
  label(95, { kind: 'prepared', recipe_id: sc.id, name: sc.name, allergens: recipeAllergens(sc, DEMO_PRODUCTS), storage: 'fridge', lot: 'P' + lotStamp(min(95)), hours: 72, copies: 3 })
  label(40, { kind: 'thawed', product_id: STEAK.id, name: STEAK.name, allergens: [], storage: 'fridge', hours: 24, copies: 2 })
  // Décongélation terminée (module procédés), à reprendre pour une étiquette.
  const batch = '8c0e0000-0000-4000-8000-0000000000ff'
  add('thawing', 14 * 60, { batch_id: batch, step: 'start', product: 'Pain burger', equipment_id: '6f1c2a4e-0000-4000-8000-000000000202' })
  add('thawing', 25, { batch_id: batch, step: 'end', product: 'Pain burger', equipment_id: '6f1c2a4e-0000-4000-8000-000000000202', dlc: isoIn(now, 2) })
  return records
}

function isoIn(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
function lotStamp(d: Date): string {
  const p = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')}${g('month')}-${g('hour')}${g('minute')}`
}
