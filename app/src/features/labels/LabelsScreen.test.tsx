// Module Étiquettes (lot 4) : parcours jusqu'au label_printed, impression, échéances et « Jeté »,
// correction, Gestion › Produits / Recettes, tableau des allergènes.
import { LABEL_TRACES_IN_REGISTRY } from './LabelEditor.tsx'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabelPrintedPayload, WastePayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_PRODUCTS, DEMO_RECIPES } from '../../core/mockTransport.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { MENU_PRODUCTS, MENU_RECIPES, SAUCE_UFO_ID } from '../../core/demoMenu.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { useInlineFonts } from './testFonts.ts'

// Dimanche 15/11/2026 10:30 à Paris.
const NOW = '2026-11-15T09:30:00.000Z'
const [PAIN, CHEDDAR, STEAK, SAUCE] = DEMO_PRODUCTS

beforeAll(() => useInlineFonts())
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  window.print = vi.fn()
  URL.createObjectURL = vi.fn(() => 'blob:etiquette')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

function setup(opts: FakeCoreOptions = {}) {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null, ...opts })
  renderWithCore(core)
  return core
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const lastLabel = async (core: ReturnType<typeof createFakeCore>) => (await core.listRecords({ type: 'label_printed' }))[0]

async function openLabels() {
  fireEvent.click(await screen.findByRole('button', { name: /^Étiquettes DLC/ }))
  await screen.findByRole('heading', { name: 'Étiquettes DLC', level: 1 })
}
/** Attend l'aperçu et le PDF, imprime (impression directe), confirme « Imprimé ? ». */
async function printAndConfirm(direct = true) {
  await screen.findByRole('img', { name: /Aperçu de l’étiquette/ })
  await waitFor(() => expect(screen.getByRole('button', { name: /^Imprimer/ })).toBeEnabled(), { timeout: 4000 })
  if (direct) press('Impression directe')
  else press(/^Imprimer/)
  const dialog = await screen.findByRole('dialog', { name: 'Étiquette imprimée ?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Oui, enregistrer' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('parcours', () => {
  it('ouverture : produit → DLC = maintenant + durée après ouverture, lot reçu → source_record_ids', async () => {
    const rec: FakeRecordSeed = {
      id: '11111111-0000-4000-8000-000000000001',
      type: 'reception',
      author_id: 'staff-equipier',
      device_time: '2026-11-13T08:00:00.000Z',
      payload: { supplier_id: '6f1c2a4e-0000-4000-8000-000000000503', vehicle_ok: true, packaging_ok: true, items: [{ product: 'Sauce burger 1 L', lot: 'SB2611', storage: 'fridge', temperature_c: 3, accepted: true }] },
    }
    const core = setup({ initialRecords: [rec] })
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Sauce burger — DLC ouverture \+ 3 jours/ }))
    expect(await screen.findByText('Ouvert le 15/11/2026 à 10:30')).toBeInTheDocument()
    expect(screen.getByLabelText('Date limite de consommation')).toHaveValue('2026-11-18')
    expect(screen.getByLabelText('Heure limite de consommation')).toHaveValue('10:30')
    press(/^Lot SB2611/)
    press('Une étiquette de plus')
    await printAndConfirm()
    expect(window.print).toHaveBeenCalled()
    const r = await lastLabel(core)
    const p = r.payload as unknown as LabelPrintedPayload
    expect(p).toEqual({
      kind: 'opened',
      product_id: SAUCE.id,
      name: 'Sauce burger',
      made_at: '2026-11-15T09:30:00.000Z',
      dlc_at: '2026-11-18T09:30:00.000Z',
      allergens: ['oeufs', 'moutarde'],
      storage: 'fridge',
      lot: 'SB2611',
      source_record_ids: [rec.id],
      copies: 2,
    })
    expect(validatePayload('label_printed', p).ok).toBe(true)
    expect(await screen.findByText(/2 étiquettes enregistrées : Sauce burger/)).toBeInTheDocument()
  })

  const reception = (id: string, items: Record<string, unknown>[], at = '2026-11-13T08:00:00.000Z'): FakeRecordSeed => ({
    id,
    type: 'reception',
    author_id: 'staff-equipier',
    device_time: at,
    payload: { supplier_id: '6f1c2a4e-0000-4000-8000-000000000503', vehicle_ok: true, packaging_ok: true, items },
  })

  it('ouverture d’un produit reçu aux Achats : lot et DLC d’origine repris, DLC raccourcie à la DLC d’origine', async () => {
    const rec = reception('11111111-0000-4000-8000-000000000002', [{ product: 'Sauce burger', lot: 'SB2611', dlc: '2026-11-17', storage: 'fridge', temperature_c: 3, accepted: true }])
    const core = setup({ initialRecords: [rec] })
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Ouvrir Sauce burger reçu .*, lot SB2611/ }))
    expect(await screen.findByText('Ouvert le 15/11/2026 à 10:30')).toBeInTheDocument()
    // Ouverture + 3 jours = 18/11 ; la DLC d'origine (17/11) est plus courte : elle l'emporte.
    expect(screen.getByLabelText('Date limite de consommation')).toHaveValue('2026-11-17')
    expect(screen.getByLabelText('Heure limite de consommation')).toHaveValue('23:59')
    expect(screen.getByText(/DLC d’origine du fabricant \(plus courte que ouverture \+ 3/)).toBeInTheDocument()
    expect(screen.getByLabelText('N° de lot (facultatif)')).toHaveValue('SB2611')
    // Dépasser la DLC d'origine est refusé.
    fireEvent.change(screen.getByLabelText('Date limite de consommation'), { target: { value: '2026-11-18' } })
    expect(await screen.findByText(/ne peut pas dépasser la DLC d’origine \(17\/11\/2026\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impression directe' })).toBeDisabled()
    press('Rétablir')
    await printAndConfirm()
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p).toMatchObject({ kind: 'opened', product_id: SAUCE.id, dlc_at: '2026-11-17T22:59:00.000Z', lot: 'SB2611', source_record_ids: [rec.id] })
    expect(validatePayload('label_printed', p).ok).toBe(true)
  })

  it('ouverture depuis le catalogue : lot unique pré-rempli ; DLC d’origine dépassée → impression bloquée', async () => {
    setup({ initialRecords: [reception('11111111-0000-4000-8000-000000000003', [{ product: 'Sauce burger', lot: 'SB0911', dlc: '2026-11-14', storage: 'fridge', accepted: true }])] })
    await openLabels()
    press(/^Ouverture d’un produit/)
    // Périmé : pas proposé dans les achats à ouvrir.
    await screen.findByRole('button', { name: /^Sauce burger — DLC ouverture/ })
    expect(screen.queryByRole('button', { name: /^Ouvrir Sauce burger/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Sauce burger — DLC ouverture/ }))
    expect(await screen.findByLabelText('N° de lot (facultatif)')).toHaveValue('SB0911')
    expect(await screen.findByText(/DLC d’origine dépassée \(14\/11\/2026\) : ce produit ne doit pas être ouvert/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impression directe' })).toBeDisabled()
  })

  it('ouverture « selon l’étiquette » d’un produit reçu : la DLC d’achat se reprend en un toucher', async () => {
    const core = setup({
      products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS],
      recipes: [...DEMO_RECIPES, ...MENU_RECIPES],
      initialRecords: [reception('11111111-0000-4000-8000-000000000004', [{ product: 'Mayonnaise (seau)', lot: 'MY77', dlc: '2026-12-20', storage: 'fridge', accepted: true }])],
    })
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Ouvrir Mayonnaise \(seau\) reçu .*, lot MY77/ }))
    expect(await screen.findByLabelText('Date limite de consommation')).toHaveValue('')
    press(/^Reprendre la DLC d’achat : 20\/12\/2026/)
    expect(screen.getByLabelText('Date limite de consommation')).toHaveValue('2026-12-20')
    await printAndConfirm()
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p).toMatchObject({ product_id: MENU_PRODUCTS[4].id, dlc_at: '2026-12-20T22:59:00.000Z', lot: 'MY77', source_record_ids: ['11111111-0000-4000-8000-000000000004'] })
  })

  it('préparation maison : recette → allergènes calculés, DLC modifiée avant impression, lot interne', async () => {
    const core = setup()
    await openLabels()
    press(/^Préparation maison/)
    fireEvent.click(await screen.findByRole('button', { name: /^Sauce cheddar maison/ }))
    await screen.findByRole('img', { name: /Aperçu de l’étiquette/ })
    fireEvent.change(screen.getByLabelText('Date limite de consommation'), { target: { value: '2026-11-17' } })
    fireEvent.change(screen.getByLabelText('Heure limite de consommation'), { target: { value: '18:00' } })
    press(/^Lot interne P1511-1030/)
    await printAndConfirm()
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p.kind).toBe('prepared')
    expect(p.recipe_id).toBe(DEMO_RECIPES[0].id)
    expect(p.product_id).toBeUndefined()
    expect(p.allergens).toEqual(['gluten', 'lait'])
    expect(p.dlc_at).toBe('2026-11-17T17:00:00.000Z')
    expect(p.lot).toBe('P1511-1030')
  })

  it('ouverture « selon l’étiquette du fabricant » : DLC saisie à la main (heure facultative), obligatoire, traces imprimées', async () => {
    const core = setup({ products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS], recipes: [...DEMO_RECIPES, ...MENU_RECIPES] })
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Mayonnaise \(seau\) — DLC selon l’étiquette du fabricant/ }))
    expect(await screen.findByText(/Saisissez la DLC indiquée sur l’emballage/)).toBeInTheDocument()
    expect(screen.getByLabelText('Date limite de consommation')).toHaveValue('')
    expect(screen.getByText('Obligatoire avant l’impression.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impression directe' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Rétablir' })).not.toBeInTheDocument()
    // Date seule : DLC jusqu'à 23:59 ce jour-là (heure de Paris).
    fireEvent.change(screen.getByLabelText('Date limite de consommation'), { target: { value: '2026-12-20' } })
    const preview = await screen.findByRole('img', { name: /Aperçu de l’étiquette Mayonnaise/ })
    expect(preview).toHaveTextContent('Allergènes : Œufs, Moutarde')
    expect(preview).toHaveTextContent('Traces possibles : Céleri, Sulfites')
    expect(preview).toHaveTextContent('20/12/2026 23:59')
    await printAndConfirm()
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p).toMatchObject({ kind: 'opened', product_id: MENU_PRODUCTS[4].id, made_at: '2026-11-15T09:30:00.000Z', dlc_at: '2026-12-20T22:59:00.000Z', allergens: ['oeufs', 'moutarde'], ...(LABEL_TRACES_IN_REGISTRY ? { may_contain: ['celeri', 'sulfites'] } : {}) })
    expect(validatePayload('label_printed', p).ok).toBe(true)
  })

  it('DLC du fabricant avec heure ; antérieure à l’ouverture : refusée', async () => {
    const core = setup({ products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS] })
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Ketchup — DLC selon l’étiquette/ }))
    fireEvent.change(await screen.findByLabelText('Date limite de consommation'), { target: { value: '2026-11-10' } })
    expect(await screen.findByText(/postérieure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impression directe' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Date limite de consommation'), { target: { value: '2027-01-05' } })
    fireEvent.change(screen.getByLabelText('Heure limite de consommation (facultative)'), { target: { value: '12:00' } })
    await printAndConfirm()
    expect(((await lastLabel(core)).payload as unknown as LabelPrintedPayload).dlc_at).toBe('2027-01-05T11:00:00.000Z')
  })

  it('préparation maison : seules les recettes « préparation » sont proposées (pas les plats du menu) ; sous-recettes et traces', async () => {
    const core = setup({ products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS], recipes: [...DEMO_RECIPES, ...MENU_RECIPES] })
    await openLabels()
    press(/^Préparation maison/)
    const ufo = await screen.findByRole('button', { name: /^Sauce UFO/ })
    expect(ufo).toHaveTextContent('traces possibles : Céleri, Sulfites')
    expect(screen.queryByRole('button', { name: /^Supernova/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Menu enfant/ })).not.toBeInTheDocument()
    fireEvent.click(ufo)
    const preview = await screen.findByRole('img', { name: /Aperçu de l’étiquette Sauce UFO/ })
    expect(preview).toHaveTextContent('Traces possibles : Céleri, Sulfites')
    await printAndConfirm()
    const saved = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(saved.allergens).toEqual(['oeufs', 'poissons', 'moutarde'])
    // Traces enregistrées telles qu'imprimées (registre fidèle à l'étiquette).
    expect(saved.may_contain).toEqual(LABEL_TRACES_IN_REGISTRY ? ['celeri', 'sulfites'] : undefined)
  })

  it('DLC antérieure à la fabrication : impression bloquée', async () => {
    setup()
    await openLabels()
    press(/^Préparation maison/)
    fireEvent.click(await screen.findByRole('button', { name: /^Sauce cheddar maison/ }))
    await screen.findByRole('img', { name: /Aperçu de l’étiquette/ })
    fireEvent.change(screen.getByLabelText('Date limite de consommation'), { target: { value: '2026-11-14' } })
    expect(await screen.findByText(/postérieure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impression directe' })).toBeDisabled()
  })

  it('décongélation : reprise d’une décongélation terminée (DLC du procédé, source = fin)', async () => {
    const batch = '22222222-0000-4000-8000-000000000001'
    const end = '22222222-0000-4000-8000-000000000003'
    const core = setup({
      initialRecords: [
        { id: '22222222-0000-4000-8000-000000000002', type: 'thawing', author_id: 'staff-equipier', device_time: '2026-11-14T18:00:00.000Z', payload: { batch_id: batch, step: 'start', product: 'Steaks hachés', equipment_id: '6f1c2a4e-0000-4000-8000-000000000201' } },
        { id: end, type: 'thawing', author_id: 'staff-equipier', device_time: '2026-11-15T07:00:00.000Z', payload: { batch_id: batch, step: 'end', product: 'Steaks hachés', equipment_id: '6f1c2a4e-0000-4000-8000-000000000201', dlc: '2026-11-16' } },
      ],
    })
    await openLabels()
    press(/^Décongélation/)
    fireEvent.click(await screen.findByRole('button', { name: /^Reprendre la décongélation Steaks hachés/ }))
    expect(await screen.findByRole('heading', { name: 'Steak haché surgelé' })).toBeInTheDocument()
    await printAndConfirm()
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p).toMatchObject({ kind: 'thawed', product_id: STEAK.id, made_at: '2026-11-15T07:00:00.000Z', dlc_at: '2026-11-16T22:59:00.000Z', storage: 'fridge', source_record_ids: [end] })
  })

  it('décongélation d’un produit : DLC = maintenant + durée après décongélation ; partage iOS d’un PDF 62 mm', async () => {
    const shared: File[] = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { files: File[] }) => void shared.push(...d.files) })
    const core = setup()
    await openLabels()
    press(/^Décongélation/)
    fireEvent.click(await screen.findByRole('button', { name: /^Pain burger — DLC décongélation \+ 2 jours/ }))
    await printAndConfirm(false)
    expect(shared).toHaveLength(1)
    expect(shared[0].type).toBe('application/pdf')
    const doc = await PDFDocument.load(new Uint8Array(await shared[0].arrayBuffer()))
    expect(doc.getPage(0).getWidth()).toBeCloseTo(175.75, 1)
    const p = (await lastLabel(core)).payload as unknown as LabelPrintedPayload
    expect(p).toMatchObject({ kind: 'thawed', product_id: PAIN.id, dlc_at: '2026-11-17T09:30:00.000Z', allergens: ['gluten', 'sesame'] })
  })

  it('« Non, pas encore » : rien n’est enregistré', async () => {
    const core = setup()
    await openLabels()
    press(/^Ouverture d’un produit/)
    fireEvent.click(await screen.findByRole('button', { name: /^Cheddar en tranches/ }))
    await screen.findByRole('img', { name: /Aperçu de l’étiquette/ })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Imprimer/ })).toBeEnabled(), { timeout: 4000 })
    press('Impression directe')
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Non, pas encore' }))
    expect(await core.listRecords({ type: 'label_printed' })).toHaveLength(0)
  })
})

const label = (o: Partial<LabelPrintedPayload>): LabelPrintedPayload => ({
  kind: 'opened',
  product_id: CHEDDAR.id,
  name: 'Cheddar en tranches',
  made_at: '2026-11-12T09:00:00.000Z',
  dlc_at: '2026-11-15T09:00:00.000Z',
  allergens: ['lait'],
  storage: 'fridge',
  copies: 1,
  ...o,
})
const seed = (id: string, p: LabelPrintedPayload, time = p.made_at): FakeRecordSeed => ({ id, type: 'label_printed', author_id: 'staff-equipier', device_time: time, payload: { ...p } })

describe('échéances', () => {
  const expiredId = '33333333-0000-4000-8000-000000000001'
  const records = [
    seed(expiredId, label({})),
    seed('33333333-0000-4000-8000-000000000002', label({ name: 'Sauce burger', product_id: SAUCE.id, dlc_at: '2026-11-15T20:00:00.000Z', made_at: '2026-11-13T10:00:00.000Z' })),
    seed('33333333-0000-4000-8000-000000000003', label({ name: 'Pain burger', product_id: PAIN.id, dlc_at: '2026-11-16T08:00:00.000Z', made_at: '2026-11-14T08:00:00.000Z' })),
  ]

  it('compteur de l’accueil, liste, « Jeté » → perte liée (motif date dépassée)', async () => {
    const core = setup({ initialRecords: records })
    const tile = await screen.findByRole('button', { name: /^Étiquettes DLC : 1 DLC dépassée, 1 produit à DLC aujourd’hui, 1 produit à DLC demain/ })
    fireEvent.click(tile)
    await screen.findByRole('heading', { name: 'Étiquettes DLC', level: 1 })
    expect(screen.getByRole('alert')).toHaveTextContent('1 produit a dépassé sa DLC')
    press('Jeté – Cheddar en tranches')
    const dialog = await screen.findByRole('dialog', { name: 'Produit jeté' })
    fireEvent.change(within(dialog).getByLabelText('Quantité (facultatif)'), { target: { value: '1/2 paquet' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer la perte' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const w = (await core.listRecords({ type: 'waste' }))[0].payload as unknown as WastePayload
    expect(w).toEqual({ product: 'Cheddar en tranches', reason: 'expired', related_record_id: expiredId, quantity: '1/2 paquet' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jeté – Cheddar en tranches' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('« Épuisé » retire de la liste sans rien écrire au registre', async () => {
    const core = setup({ initialRecords: records })
    await openLabels()
    press('Épuisé (utilisé) – Pain burger')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jeté – Pain burger' })).not.toBeInTheDocument())
    expect(await core.listRecords({ type: 'waste' })).toHaveLength(0)
  })
})

describe('historique et correction', () => {
  it('corriger la DLC : original barré, correction valide, réimpression proposée', async () => {
    const id = '44444444-0000-4000-8000-000000000001'
    const core = setup({ initialRecords: [seed(id, label({ made_at: '2026-11-15T08:00:00.000Z', dlc_at: '2026-11-18T08:00:00.000Z' }))] })
    await openLabels()
    press(/^Historique/)
    press('Corriger (Cheddar en tranches)')
    fireEvent.change(await screen.findByLabelText('Date limite de consommation'), { target: { value: '2026-11-17' } })
    press('Erreur de DLC')
    press('Enregistrer la correction')
    expect(await screen.findByRole('heading', { name: 'Réimprimer l’étiquette corrigée' })).toBeInTheDocument()
    const c = (await core.listRecords({ type: 'correction' }))[0]
    expect(c.supersedes_id).toBe(id)
    expect(validatePayload('correction', c.payload, { supersededType: 'label_printed' }).ok).toBe(true)
    expect((c.payload.replacement as LabelPrintedPayload).dlc_at).toBe('2026-11-17T08:00:00.000Z')
    press('Terminé')
    expect(await screen.findByLabelText('DLC d’origine 18/11/2026 09:00, corrigée')).toBeInTheDocument()
  })
})

describe('tableau des allergènes', () => {
  it('plats du menu seulement, groupés par rubrique (Croq’Brioche, Dessert, Frites, Menu enfant), ● présent / ○ peut en contenir, PDF A4', async () => {
    setup({ products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS], recipes: [...DEMO_RECIPES, ...MENU_RECIPES] })
    fireEvent.click(await screen.findByRole('button', { name: /^Tableau des allergènes/ }))
    const table = await screen.findByRole('table')
    // Rubriques dans l'ordre du menu.
    expect(within(table).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent)).toEqual(["CROQ'BRIOCHE", 'DESSERT', 'FRITES', 'MENU ENFANT'])
    // Les préparations (Sauce UFO, Sauce cheddar maison) ne sont pas des plats du menu.
    expect(within(table).queryByRole('row', { name: /Sauce UFO/ })).not.toBeInTheDocument()
    expect(within(table).queryByRole('row', { name: /Sauce cheddar maison/ })).not.toBeInTheDocument()
    const supernova = within(table).getByRole('row', { name: /Supernova/ })
    expect(within(supernova).getAllByRole('img', { name: /^Présent/ }).map((x) => x.getAttribute('aria-label'))).toEqual([
      'Présent : Céréales contenant du gluten',
      'Présent : Œufs',
      'Présent : Poissons',
      'Présent : Lait',
      'Présent : Moutarde',
    ])
    expect(within(supernova).getAllByRole('img', { name: /^Peut en contenir/ }).map((x) => x.getAttribute('aria-label'))).toEqual([
      'Peut en contenir : Céleri',
      'Peut en contenir : Anhydride sulfureux et sulfites',
    ])
    // Frites : friteuse séparée des nuggets, donc aucune trace de gluten.
    const frites = within(table).getByRole('row', { name: /Frites nature/ })
    expect(within(frites).queryAllByRole('img')).toHaveLength(0)
    const roswell = within(table).getByRole('row', { name: /Frites Roswell/ })
    expect(within(roswell).getAllByRole('img')).toHaveLength(2)
    expect(within(roswell).getByRole('img', { name: 'Peut en contenir : Anhydride sulfureux et sulfites' })).toBeInTheDocument()
    const poster = screen.getByRole('region', { name: 'Tableau des allergènes' })
    expect(within(poster).getByText('présent dans la recette')).toBeInTheDocument()
    expect(within(poster).getByText(/peut en contenir \(selon le produit du fournisseur\)/)).toBeInTheDocument()
    expect(within(poster).getByText(/Tout est préparé dans la même remorque/)).toBeInTheDocument()
    expect(within(poster).getByText(/Boissons : voir l’étiquette/)).toBeInTheDocument()
    expect(within(poster).getByText(/Parle-nous-en avant de commander/)).toBeInTheDocument()
    expect(within(poster).getByRole('img', { name: 'Space Diner' })).toBeInTheDocument()
    // Version iPhone : un bloc par plat, présents puis traces en toutes lettres.
    const phone = screen.getByRole('region', { name: 'Allergènes par plat (liste)' })
    const nova = within(phone).getByText('Supernova').closest('li')!
    expect(nova).toHaveTextContent('Présents : Gluten, Œufs, Poissons, Lait, Moutarde')
    expect(nova).toHaveTextContent('Peut en contenir : Céleri, Sulfites')
    await waitFor(() => expect(screen.getByRole('button', { name: /^Imprimer/ })).toBeEnabled(), { timeout: 4000 })
    window.open = vi.fn(() => ({}) as Window)
    press(/^Imprimer/)
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:etiquette', '_blank'))
    press('Impression directe')
    expect(window.print).toHaveBeenCalled()
    expect(document.getElementById('a4-print-root')).toHaveTextContent('Supernova')
    press('Accueil')
    expect(await screen.findByRole('heading', { name: 'Aujourd’hui' })).toBeInTheDocument()
  })

  it('sans plat du menu : message', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /^Tableau des allergènes/ }))
    expect(await screen.findByText(/Aucun plat du menu/)).toBeInTheDocument()
  })
})

describe('Gestion › Produits et Recettes', () => {
  async function openTab(tab: string) {
    fireEvent.click(await screen.findByRole('button', { name: /^Gestion/ }))
    fireEvent.click(await screen.findByRole('tab', { name: tab }))
  }

  it('ajouter un produit (allergènes cochés, durées en jours / heures), désactiver', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null })
    renderWithCore(core, undefined, manager)
    await openTab('Produits')
    press('Ajouter un produit')
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un produit' })
    fireEvent.change(within(dialog).getByLabelText('Nom du produit'), { target: { value: 'Mayonnaise' } })
    fireEvent.click(within(dialog).getAllByLabelText(/^Œufs/)[0])
    fireEvent.click(within(dialog).getAllByLabelText(/^Moutarde/)[0])
    fireEvent.click(within(dialog).getByRole('button', { name: '24 h' }))
    expect(within(dialog).getByText('Soit 24 h.')).toBeInTheDocument()
    expect(within(dialog).getByText(/à vérifier sur vos fiches fournisseurs/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const p = manager.simulate.state().products.find((x) => x.name === 'Mayonnaise')!
    expect(p).toMatchObject({ allergens: ['oeufs', 'moutarde'], may_contain: [], cook_min_c: null, storage: 'fridge', shelf_life_opened_hours: 24, shelf_life_thawed_hours: null, active: true })

    press('Désactiver – Mayonnaise')
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Désactiver' }))
    await waitFor(() => expect(manager.simulate.state().products.find((x) => x.id === p.id)?.active).toBe(false))
    expect(await screen.findByRole('button', { name: 'Réactiver – Mayonnaise' })).toBeInTheDocument()
  })

  it('produit (lot 4 bis) : traces exclusives des allergènes présents, cuisson à cœur, DLC « selon l’étiquette du fabricant »', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null }), undefined, manager)
    await openTab('Produits')
    press('Ajouter un produit')
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un produit' })
    fireEvent.change(within(dialog).getByLabelText('Nom du produit'), { target: { value: 'Nuggets de poulet' } })
    // Gluten présent : la même case est verrouillée dans « Peut en contenir ».
    fireEvent.click(within(dialog).getAllByLabelText(/^Céréales contenant du gluten/)[0])
    const [, glutenTrace] = within(dialog).getAllByLabelText(/^Céréales contenant du gluten/)
    expect(glutenTrace).toBeDisabled()
    expect(within(dialog).getAllByText('déjà coché en « présent »').length).toBe(1)
    // Céleri en traces : la case « présent » est verrouillée.
    fireEvent.click(within(dialog).getAllByLabelText(/^Céleri/)[1])
    expect(within(dialog).getAllByLabelText(/^Céleri/)[0]).toBeDisabled()
    fireEvent.click(within(dialog).getAllByLabelText(/^Œufs/)[1])
    fireEvent.click(within(dialog).getByLabelText('Selon l’étiquette du fabricant'))
    expect(within(dialog).getByText(/recopie la DLC indiquée sur l’emballage/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '74 °C' }))
    expect(within(dialog).getByLabelText(/^Température à cœur minimale/)).toHaveValue('74')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(manager.simulate.state().products.find((x) => x.name === 'Nuggets de poulet')).toMatchObject({
      allergens: ['gluten'],
      may_contain: ['oeufs', 'celeri'],
      cook_min_c: 74,
      shelf_life_opened_hours: null,
    })
    const card = (await screen.findByRole('heading', { name: 'Nuggets de poulet' })).closest('li')!
    expect(card).toHaveTextContent('Après ouverture : selon l’étiquette du fabricant')
    expect(card).toHaveTextContent('traces possibles : Œufs, Céleri')
    expect(card).toHaveTextContent('Cuisson à cœur : ≥ 74 °C')
  })

  it('préparation : ingrédients + allergènes supplémentaires, allergènes calculés en direct', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null }), undefined, manager)
    await openTab('Recettes')
    fireEvent.click(await screen.findByRole('tab', { name: /^Préparations/ }))
    await screen.findByRole('button', { name: 'Modifier – Sauce cheddar maison' })
    press('Ajouter une préparation')
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter une préparation' })
    fireEvent.change(within(dialog).getByLabelText('Nom de la préparation'), { target: { value: 'Burger maison' } })
    fireEvent.click(within(dialog).getByLabelText(/^Pain burger/))
    fireEvent.click(within(dialog).getByLabelText(/^Cheddar en tranches/))
    const computed = within(dialog).getByRole('region', { name: 'Allergènes calculés' })
    expect(computed).toHaveTextContent('Céréales contenant du gluten — Pain burger')
    expect(computed).toHaveTextContent('Lait — Cheddar en tranches')
    // Lait apporté par le cheddar : coché et verrouillé dans les allergènes ajoutés.
    expect(within(dialog).getAllByLabelText(/^Lait/)[0]).toBeDisabled()
    fireEvent.click(within(dialog).getAllByLabelText(/^Céleri/)[0])
    expect(computed).toHaveTextContent('Céleri — ajouté à la recette')
    fireEvent.click(within(dialog).getByRole('button', { name: '24 h' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(manager.simulate.state().recipes.find((r) => r.name === 'Burger maison')).toMatchObject({
      kind: 'preparation',
      category: null,
      ingredient_product_ids: [PAIN.id, CHEDDAR.id],
      ingredient_recipe_ids: [],
      extra_allergens: ['celeri'],
      shelf_life_hours: 24,
    })
    expect(await screen.findByText(/Gluten, Lait, Céleri, Sésame/)).toBeInTheDocument()
  })

  it('plat du menu : rubrique, sous-recette (Sauce UFO), traces propres, ● présents et ○ traces avec leur origine', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true, catalog: { products: [...DEMO_PRODUCTS, ...MENU_PRODUCTS], recipes: [...DEMO_RECIPES, ...MENU_RECIPES] } })
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null }), undefined, manager)
    await openTab('Recettes')
    // Onglet « Menu » par défaut, plats groupés par rubrique.
    expect(await screen.findByRole('button', { name: 'Modifier – Supernova' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(expect.arrayContaining(["Croq'Brioche(2)", 'Dessert(2)', 'Frites(2)', 'Menu enfant(1)']))
    expect(screen.queryByRole('button', { name: 'Modifier – Sauce UFO' })).not.toBeInTheDocument()
    press('Ajouter un plat')
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un plat du menu' })
    fireEvent.change(within(dialog).getByLabelText('Nom du plat'), { target: { value: 'Orion' } })
    fireEvent.click(within(dialog).getByRole('button', { name: "Croq'Brioche" }))
    fireEvent.click(within(dialog).getByLabelText(/^Sauce UFO/))
    fireEvent.click(within(dialog).getByLabelText(/^Pain brioché/))
    const computed = within(dialog).getByRole('region', { name: 'Allergènes calculés' })
    expect(computed).toHaveTextContent('Poissons — Sauce UFO')
    expect(computed).toHaveTextContent('Œufs — Pain brioché, Sauce UFO')
    expect(computed).toHaveTextContent('Céleri — Sauce UFO')
    // Soja en trace propre (friteuse, plan de travail commun…).
    fireEvent.click(within(dialog).getAllByLabelText(/^Soja/)[1])
    expect(computed).toHaveTextContent('Soja — indiqué sur la recette')
    // Pas de durée de vie pour un plat du menu.
    expect(within(dialog).queryByText('Durée de vie de la préparation')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(manager.simulate.state().recipes.find((r) => r.name === 'Orion')).toMatchObject({
      kind: 'menu_item',
      category: "Croq'Brioche",
      ingredient_recipe_ids: [SAUCE_UFO_ID],
      may_contain: ['soja'],
      shelf_life_hours: null,
    })
    expect(await screen.findByRole('button', { name: 'Modifier – Orion' })).toBeInTheDocument()
  })

  it('démo ?demo= : un produit créé dans Gestion apparaît aussitôt dans Étiquettes (même catalogue que le core factice)', async () => {
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null })
    const manager = createMockManagerApi({ seeded: true, signedIn: true, referenceSink: core.simulate })
    renderWithCore(core, undefined, manager)
    await openTab('Produits')
    press('Ajouter un produit')
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un produit' })
    fireEvent.change(within(dialog).getByLabelText('Nom du produit'), { target: { value: 'Sauce barbecue' } })
    fireEvent.click(within(dialog).getByLabelText('Selon l’étiquette du fabricant'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await core.listProducts()).map((p) => p.name)).toContain('Sauce barbecue')
  })

  it('Réglages : hauteur des étiquettes enregistrée sur l’appareil', async () => {
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null }), undefined, createMockManagerApi({ seeded: true, signedIn: true }))
    await openTab('Réglages')
    fireEvent.click(await screen.findByRole('button', { name: '62 mm' }))
    expect(screen.getByLabelText('Hauteur des étiquettes')).toHaveTextContent('62 × 62 mm')
    press('Hauteur : 1 mm de plus')
    expect(localStorage.getItem('haccp.labels.height_mm')).toBe('63')
  })
})
