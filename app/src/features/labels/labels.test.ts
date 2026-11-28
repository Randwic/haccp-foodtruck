// Étiquettes DLC (lot 4) : calculs purs (DLC, fuseau Europe/Paris, allergènes, échéances, lots) et PDF.
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import type { LabelPrintedPayload, Product, Recipe } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_PRODUCTS, DEMO_RECIPES } from '../../core/mockTransport.ts'
import { buildReceptions, buildWastes } from '../reception/model.ts'
import { loadDisplayFont, loadLabelFonts } from './fonts.ts'
import { menuAllergenTable } from './allergenTable.ts'
import { MENU_PRODUCTS, MENU_RECIPES } from '../../core/demoMenu.ts'
import { DEFAULT_LABEL_HEIGHT_MM, layoutLabel, mmToPt } from './layout.ts'
import {
  allergenSources,
  buildLabels,
  capByOriginalDlc,
  computeDlc,
  dlcFromDate,
  dlcProblem,
  dueItems,
  dueState,
  formatLabelDateTime,
  formatShelfLife,
  fromLocalInputs,
  internalLot,
  originalDlcProblem,
  receivedForOpening,
  recentLots,
  recipeAllergens,
  sameProduct,
  shelfLifeHours,
  splitShelfLife,
  summarizeDue,
  toLocalInputs,
  type LabelContent,
} from './model.ts'
import { A4_LANDSCAPE, buildAllergenTablePdf, buildLabelPdf } from './pdf.ts'
import { useInlineFonts } from './testFonts.ts'

const TZ = 'Europe/Paris'
const [PAIN, CHEDDAR, STEAK, SAUCE, , , , CORNICHONS] = DEMO_PRODUCTS
const SAUCE_CHEDDAR = DEMO_RECIPES[0]

let seq = 0
function rec(type: HaccpRecord['type'], device_time: string, payload: Record<string, unknown>, extra: Partial<HaccpRecord> = {}): HaccpRecord {
  seq++
  return {
    id: extra.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    type,
    payload,
    author_id: 'a',
    device_id: 'd',
    device_seq: seq,
    device_time,
    prev_hash: '0',
    supersedes_id: null,
    hash: 'h',
    ...extra,
  }
}

describe('DLC (fuseau Europe/Paris)', () => {
  it('ouverture + durée de vie en heures réelles', () => {
    const opened = new Date('2026-11-15T13:30:00.000Z') // 14:30 à Paris
    expect(formatLabelDateTime(computeDlc(opened, PAIN.shelf_life_opened_hours!), TZ)).toBe('17/11/2026 14:30')
    expect(formatLabelDateTime(computeDlc(opened, 24), TZ)).toBe('16/11/2026 14:30')
  })

  it('changement d’heure : 24 h réelles (l’heure murale se décale d’une heure)', () => {
    // Samedi 24/10/2026 12:00 à Paris (UTC+2) ; passage à l'heure d'hiver le dimanche 25 à 3 h.
    const made = new Date('2026-10-24T10:00:00.000Z')
    expect(formatLabelDateTime(made, TZ)).toBe('24/10/2026 12:00')
    expect(formatLabelDateTime(computeDlc(made, 24), TZ)).toBe('25/10/2026 11:00')
  })

  it('saisie date / heure locale ↔ instant UTC, hiver comme été', () => {
    expect(fromLocalInputs('2026-11-17', '14:30', TZ)?.toISOString()).toBe('2026-11-17T13:30:00.000Z')
    expect(fromLocalInputs('2026-07-01', '08:00', TZ)?.toISOString()).toBe('2026-07-01T06:00:00.000Z')
    expect(fromLocalInputs('2026-02-30', '08:00', TZ)).toBeNull()
    expect(fromLocalInputs('2026-11-17', '25:00', TZ)).toBeNull()
    expect(toLocalInputs(new Date('2026-11-17T13:30:00.000Z'), TZ)).toEqual({ date: '2026-11-17', time: '14:30' })
  })

  it('DLC d’une décongélation du module procédés (date) : fin de journée locale', () => {
    expect(dlcFromDate('2026-11-18', TZ).toISOString()).toBe('2026-11-18T22:59:00.000Z')
  })

  it('contrôles du contrat : après la fabrication, 3 ans au plus', () => {
    const made = new Date('2026-11-15T10:00:00.000Z')
    expect(dlcProblem(made, new Date('2026-11-15T09:00:00.000Z'))).toMatch(/postérieure/)
    expect(dlcProblem(made, computeDlc(made, 1097 * 24))).toMatch(/3 ans/)
    expect(dlcProblem(made, computeDlc(made, 72))).toBeNull()
    expect(dlcProblem(made, null)).toMatch(/invalide/)
  })

  it('échéances : dépassée, aujourd’hui, demain (jours locaux)', () => {
    const now = new Date('2026-11-15T22:30:00.000Z') // 23:30 à Paris
    expect(dueState('2026-11-15T22:00:00.000Z', now, TZ)).toBe('expired')
    expect(dueState('2026-11-15T22:45:00.000Z', now, TZ)).toBe('today') // 23:45 Paris
    expect(dueState('2026-11-15T23:10:00.000Z', now, TZ)).toBe('tomorrow') // 00:10 le 16 à Paris (encore le 15 en UTC)
    expect(dueState('2026-11-16T23:30:00.000Z', now, TZ)).toBe('later')
  })

  it('durées conviviales', () => {
    expect(formatShelfLife(24)).toBe('24 h')
    expect(formatShelfLife(36)).toBe('36 h')
    expect(formatShelfLife(72)).toBe('3 jours')
    expect(formatShelfLife(48)).toBe('2 jours')
    expect(formatShelfLife(84)).toBe('3 jours 12 h')
    expect(formatShelfLife(null)).toBe('Non applicable')
    expect(splitShelfLife(72)).toEqual({ value: '3', unit: 'days' })
    expect(splitShelfLife(36)).toEqual({ value: '36', unit: 'hours' })
    expect(shelfLifeHours('3', 'days')).toBe(72)
    expect(shelfLifeHours('1,5', 'days')).toBe(36)
    expect(shelfLifeHours('', 'days')).toBeNull()
    expect(shelfLifeHours('abc', 'hours')).toBeNaN()
  })

  it('lot interne d’une préparation', () => {
    expect(internalLot(new Date('2026-11-15T13:30:00.000Z'), TZ)).toBe('P1511-1430')
  })
})

describe('allergènes', () => {
  it('recette = union des ingrédients + supplémentaires, dans l’ordre de l’annexe II', () => {
    expect(recipeAllergens(SAUCE_CHEDDAR, DEMO_PRODUCTS)).toEqual(['gluten', 'lait'])
    const burger: Recipe = { ...SAUCE_CHEDDAR, ingredient_product_ids: [PAIN.id, CHEDDAR.id, STEAK.id, SAUCE.id, CORNICHONS.id], extra_allergens: [] }
    expect(recipeAllergens(burger, DEMO_PRODUCTS)).toEqual(['gluten', 'oeufs', 'lait', 'moutarde', 'sesame'])
    expect(allergenSources(burger, DEMO_PRODUCTS).find((s) => s.allergen === 'moutarde')?.from).toEqual(['Sauce burger', 'Cornichons'])
    expect(allergenSources(SAUCE_CHEDDAR, DEMO_PRODUCTS).find((s) => s.allergen === 'gluten')?.from).toEqual(['ajouté à la recette'])
  })

  it('un ingrédient désactivé compte toujours ; un ingrédient inconnu est ignoré', () => {
    const products: Product[] = DEMO_PRODUCTS.map((p) => (p.id === CHEDDAR.id ? { ...p, active: false } : p))
    expect(recipeAllergens({ ingredient_product_ids: [CHEDDAR.id, 'inconnu'], extra_allergens: [] }, products)).toEqual(['lait'])
  })
})

describe('registre : étiquettes, pertes, échéances, lots', () => {
  const label = (o: Partial<LabelPrintedPayload> = {}): LabelPrintedPayload => ({
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

  it('correction appliquée, perte liée, échéances triées', () => {
    const now = new Date('2026-11-15T10:00:00.000Z')
    const a = rec('label_printed', '2026-11-12T09:00:00.000Z', { ...label() })
    const b = rec('label_printed', '2026-11-14T09:00:00.000Z', { ...label({ name: 'Sauce burger', dlc_at: '2026-11-15T20:00:00.000Z' }) })
    const c = rec('label_printed', '2026-11-14T10:00:00.000Z', { ...label({ name: 'Pain burger', dlc_at: '2026-11-16T10:00:00.000Z' }) })
    const corr = rec('correction', '2026-11-14T11:00:00.000Z', { reason: 'Erreur', replacement: { ...label({ name: 'Pain burger', dlc_at: '2026-11-16T08:00:00.000Z' }) } }, { supersedes_id: c.id })
    const d = rec('label_printed', '2026-11-14T12:00:00.000Z', { ...label({ name: 'Bacon', dlc_at: '2026-11-18T10:00:00.000Z' }) })
    const e = rec('label_printed', '2026-11-13T12:00:00.000Z', { ...label({ name: 'Salade', dlc_at: '2026-11-14T12:00:00.000Z' }) })
    const waste = rec('waste', '2026-11-15T09:30:00.000Z', { product: 'Salade', reason: 'expired', related_record_id: e.id })
    const records = [a, b, c, corr, d, e, waste]
    const labels = buildLabels(records, buildWastes(records))
    expect(labels.find((l) => l.id === c.id)?.payload.dlc_at).toBe('2026-11-16T08:00:00.000Z')
    expect(labels.find((l) => l.id === e.id)?.waste?.payload.reason).toBe('expired')
    const due = dueItems(labels, now, TZ)
    expect(due.map((d) => [d.entry.payload.name, d.state])).toEqual([
      ['Cheddar en tranches', 'expired'],
      ['Sauce burger', 'today'],
      ['Pain burger', 'tomorrow'],
    ])
    expect(summarizeDue(due)).toEqual({ expired: 1, today: 1, tomorrow: 1 })
    expect(dueItems(labels, now, TZ, new Set([a.id])).map((d) => d.entry.payload.name)).not.toContain('Cheddar en tranches')
  })

  it('lots reçus récemment pour un produit (libellés proches)', () => {
    expect(sameProduct('Pain burger', 'Pain burger brioché')).toBe(true)
    expect(sameProduct('Cheddar en tranches', 'Cheddar tranches')).toBe(true)
    expect(sameProduct('Steak haché surgelé', 'Steaks hachés')).toBe(true)
    expect(sameProduct('Sauce burger', 'Pain burger')).toBe(false)
    const r1 = rec('reception', '2026-11-10T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items: [{ product: 'Cheddar tranches', lot: 'CH01', storage: 'fridge', accepted: true }, { product: 'Pain burger brioché', lot: 'PB1', storage: 'ambient', accepted: true }] })
    const r2 = rec('reception', '2026-11-13T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items: [{ product: 'Cheddar tranches', lot: 'CH02', dlc: '2026-12-01', storage: 'fridge', accepted: true }, { product: 'Cheddar tranches', lot: 'CH03', storage: 'fridge', accepted: false, refusal_reason: 'Température' }] })
    const lots = recentLots(buildReceptions([r1, r2]), 'Cheddar en tranches')
    expect(lots.map((l) => [l.lot, l.receptionId])).toEqual([
      ['CH02', r2.id],
      ['CH01', r1.id],
    ])
  })
})

describe('achats repris à l’ouverture', () => {
  const now = new Date('2026-11-15T09:30:00.000Z')
  it('liste les achats acceptés à ouvrir (lot ou DLC), sans surgelés, refusés, périmés ni doublons', () => {
    const items = [
      { product: 'Sauce burger 1 L', lot: 'SB1', dlc: '2026-11-30', storage: 'fridge', accepted: true },
      { product: 'Steak haché', lot: 'ST1', storage: 'freezer', accepted: true },
      { product: 'Cheddar tranches', lot: 'CH9', storage: 'fridge', accepted: false, refusal_reason: 'Température' },
      { product: 'Pain burger', lot: 'PB0', dlc: '2026-11-14', storage: 'ambient', accepted: true },
      { product: 'Oignons', storage: 'ambient', accepted: true },
    ]
    const r1 = rec('reception', '2026-11-12T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items })
    const r2 = rec('reception', '2026-11-13T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items: [{ product: 'Sauce burger', lot: 'SB1', dlc: '2026-11-30', storage: 'fridge', accepted: true }] })
    const out = receivedForOpening(buildReceptions([r1, r2]), DEMO_PRODUCTS, now, TZ)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ receptionId: r2.id, lot: 'SB1', dlc: '2026-11-30' })
    expect(out[0].catalog?.id).toBe(SAUCE.id)
  })

  it('un achat déjà ouvert (étiquette imprimée depuis cette réception) n’est plus proposé', () => {
    const items = [
      { product: 'Sauce burger 1 L', lot: 'SB1', dlc: '2026-11-30', storage: 'fridge', accepted: true },
      { product: 'Cornichons', lot: 'CO7', dlc: '2027-03-01', storage: 'ambient', accepted: true },
    ]
    const r1 = rec('reception', '2026-11-10T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items: [items[0]] })
    const r2 = rec('reception', '2026-11-12T08:00:00.000Z', { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items })
    const label = (lot: string | undefined, product: Product, source: string) =>
      rec('label_printed', '2026-11-14T10:00:00.000Z', {
        kind: 'opened',
        product_id: product.id,
        name: product.name,
        made_at: '2026-11-14T10:00:00.000Z',
        dlc_at: '2026-11-17T10:00:00.000Z',
        allergens: [],
        storage: 'fridge',
        ...(lot ? { lot } : {}),
        source_record_ids: [source],
        copies: 1,
      })
    const receptions = buildReceptions([r1, r2])
    // Avant ouverture : sauce (réception la plus récente) et cornichons.
    expect(receivedForOpening(receptions, DEMO_PRODUCTS, now, TZ).map((r) => r.receptionId)).toEqual([r2.id, r2.id])
    // Sauce de la réception r2 ouverte : elle disparaît ; le pot identique reçu le 10/11 (pas encore ouvert) revient.
    const opened = buildLabels([label('SB1', SAUCE, r2.id)])
    const out = receivedForOpening(receptions, DEMO_PRODUCTS, now, TZ, opened)
    expect(out.map((r) => [r.product, r.receptionId])).toEqual([
      ['Cornichons', r2.id],
      ['Sauce burger 1 L', r1.id],
    ])
    // Les deux sauces et les cornichons ouverts : plus rien à proposer.
    const all = buildLabels([label('SB1', SAUCE, r2.id), label('SB1', SAUCE, r1.id), label(undefined, CORNICHONS, r2.id)])
    expect(receivedForOpening(receptions, DEMO_PRODUCTS, now, TZ, all)).toEqual([])
  })

  it('DLC après ouverture : jamais après la DLC d’origine', () => {
    const proposed = new Date('2026-11-18T09:30:00.000Z')
    expect(capByOriginalDlc(proposed, '2026-11-20', TZ)).toEqual({ dlc: proposed, capped: false })
    expect(capByOriginalDlc(proposed, '2026-11-16', TZ)).toEqual({ dlc: new Date('2026-11-16T22:59:00.000Z'), capped: true })
    expect(capByOriginalDlc(proposed, undefined, TZ).capped).toBe(false)
    expect(originalDlcProblem(now, proposed, '2026-11-20', TZ)).toBeNull()
    expect(originalDlcProblem(now, proposed, '2026-11-16', TZ)).toMatch(/ne peut pas dépasser la DLC d’origine \(16\/11\/2026\)/)
    expect(originalDlcProblem(now, null, '2026-11-14', TZ)).toMatch(/ne doit pas être ouvert/)
  })
})

describe('PDF', () => {
  beforeAll(() => useInlineFonts())

  const content: LabelContent = {
    kind: 'opened',
    name: 'Sauce burger',
    madeAt: '2026-11-15T13:30:00.000Z',
    dlcAt: '2026-11-18T13:30:00.000Z',
    storage: 'fridge',
    allergens: ['oeufs', 'moutarde'],
    lot: 'SB-2611',
    operator: 'GÉ',
    timeZone: TZ,
  }

  it('étiquette 62 × 50 mm, une page par copie, polices intégrées', async () => {
    const fonts = await loadLabelFonts()
    const layout = layoutLabel(content, fonts.measure)
    expect(layout.overflow).toBe(false)
    expect(layout.width).toBeCloseTo(175.75, 1) // 62 mm ≈ 175,7 pt
    expect(layout.height).toBeCloseTo(mmToPt(DEFAULT_LABEL_HEIGHT_MM), 3)
    const bytes = await buildLabelPdf(layout, 3, fonts)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
    for (const p of doc.getPages()) {
      expect(p.getWidth()).toBeCloseTo(175.748, 2)
      expect(p.getHeight()).toBeCloseTo(141.732, 2)
    }
    expect(doc.getTitle()).toBe('Étiquette DLC')
    // Texte de l'étiquette : nom, DLC, allergènes.
    const texts = layout.ops.flatMap((o) => (o.kind === 'text' ? [o.text] : []))
    expect(texts).toContain('Sauce burger')
    expect(texts).toContain('18/11/2026 14:30')
    expect(texts.join(' ')).toContain('Œufs, Moutarde')
    expect(texts.join(' ')).toMatch(/JUSQU’AU MERCREDI/)
  })

  it('DDM du fabricant : mention « de préférence » et date sans heure', async () => {
    const fonts = await loadLabelFonts()
    const texts = layoutLabel({ ...content, dlcAt: '2027-09-08T21:59:00.000Z', dateKind: 'ddm' }, fonts.measure).ops.flatMap((o) => (o.kind === 'text' ? [o.text] : []))
    expect(texts).toContain('08/09/2027')
    expect(texts.join(' ')).toMatch(/DDM · DE PRÉFÉRENCE AVANT LE MERCREDI/)
    expect(texts.join(' ')).not.toMatch(/JUSQU’AU/)
  })

  it('hauteur configurable ; contenu trop long : réduit puis signalé', async () => {
    const fonts = await loadLabelFonts()
    const big = layoutLabel({ ...content, allergens: ['gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait', 'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques'] }, fonts.measure, 62)
    expect(big.height).toBeCloseTo(mmToPt(62), 3)
    expect(big.overflow).toBe(false)
    const tiny = layoutLabel({ ...content, name: 'Préparation de sauce cheddar maison au lait entier et roux', allergens: big.ops.length ? ['gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait', 'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques'] : [] }, fonts.measure, 29)
    expect(tiny.overflow).toBe(true)
    // Aucun texte ne dépasse la largeur.
    for (const o of big.ops) if (o.kind === 'text') expect(o.x + fonts.measure(o.text, o.size, o.weight)).toBeLessThanOrEqual(big.width - mmToPt(2.9))
  })

  it('tableau des allergènes A4 paysage (affiche Space Diner, ● / ○), pagination si le menu est très long', async () => {
    const fonts = await loadLabelFonts()
    const display = await loadDisplayFont()
    const table = menuAllergenTable([...DEMO_RECIPES, ...MENU_RECIPES], [...DEMO_PRODUCTS, ...MENU_PRODUCTS])
    const bytes = await buildAllergenTablePdf({ updatedLabel: 'Mis à jour le 15/11/2026', groups: table.groups }, fonts, display)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE[0], 1)
    expect(doc.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE[1], 1)
    const many = [{ title: "Croq'Brioche", rows: Array.from({ length: 40 }, (_, k) => ({ name: `Plat ${k}`, allergens: ['gluten' as const], traces: ['lait' as const] })) }]
    expect((await PDFDocument.load(await buildAllergenTablePdf({ updatedLabel: '', groups: many }, fonts, display))).getPageCount()).toBeGreaterThan(1)
  })

  it('étiquette : « Traces possibles » imprimées sous les allergènes (sans les présents)', async () => {
    const fonts = await loadLabelFonts()
    const l = layoutLabel({ ...content, allergens: ['oeufs', 'moutarde'], traces: ['celeri', 'oeufs', 'sulfites'] }, fonts.measure, 50)
    const texts = l.ops.filter((o) => o.kind === 'text').map((o) => (o as { text: string }).text)
    expect(texts.join('|')).toContain('Traces possibles : Céleri, Sulfites')
    expect(texts.join('|')).not.toContain('Traces possibles : Œufs')
    expect(l.overflow).toBe(false)
  })

  it('le payload d’une étiquette est valide pour le contrat', () => {
    const p: LabelPrintedPayload = { kind: 'opened', product_id: CHEDDAR.id, name: 'Cheddar', made_at: content.madeAt, dlc_at: content.dlcAt, allergens: ['lait'], storage: 'fridge', copies: 2 }
    expect(validatePayload('label_printed', p).ok).toBe(true)
  })
})
