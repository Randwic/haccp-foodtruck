// Assistant PMS (lot 7) : questionnaire, contenu construit avec les données de l'application, PDF et reprise des réponses.
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_CHECKLISTS, DEMO_CLEANING_TASKS, DEMO_EQUIPMENT, DEMO_SETTINGS, DEMO_SUPPLIERS, DEMO_THRESHOLDS } from '../../core/mockTransport.ts'
import { MENU_PRODUCTS, MENU_RECIPES } from '../../core/demoMenu.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { useInlineFonts } from '../labels/testFonts.ts'
import { buildPmsDocument, defaultAnswers, missingAnswers, parseAnswers, PMS_STEPS, type PmsAppData } from './model.ts'
import { answersFromPdf, buildPmsPdf } from './pdf.ts'

beforeAll(() => useInlineFonts())

const app: PmsAppData = {
  establishmentName: 'Space Diner',
  settings: { ...DEMO_SETTINGS, daily_check_times: ['16:30', '21:00'] },
  equipment: DEMO_EQUIPMENT,
  thresholds: DEMO_THRESHOLDS,
  products: MENU_PRODUCTS,
  recipes: MENU_RECIPES,
  cleaningTasks: DEMO_CLEANING_TASKS,
  checklists: DEMO_CHECKLISTS,
  suppliers: DEMO_SUPPLIERS,
  staff: [{ display_name: 'Cédric', role: 'manager', active: true }],
  documents: [],
}
const opts = { version: 2, date: new Date('2026-11-17T18:00:00Z'), timeZone: 'Europe/Paris' }

describe('assistant PMS', () => {
  it('propose des réponses ; seuls les champs administratifs restent à compléter', () => {
    const a = defaultAnswers({ establishmentName: 'Space Diner', ownerName: 'Cédric' })
    expect(missingAnswers(a).map((q) => q.field).sort()).toEqual(['address', 'ddpp', 'siret'])
    expect(PMS_STEPS.flatMap((s) => s.questions).length).toBe(Object.keys(a).length - 1)
  })

  it('reprend les données de l’application : seuils, cuissons par produit, nettoyage, allergènes', () => {
    const a = defaultAnswers({ establishmentName: 'Space Diner', ownerName: 'Cédric' })
    const doc = buildPmsDocument(a, app, opts)
    const text = JSON.stringify(doc.blocks)
    expect(doc.versionLabel).toBe('Version 2 du 17/11/2026')
    expect(doc.missing).toEqual(['Adresse du siège', 'Numéro SIRET', 'Déclaration à la DDPP'])
    expect(text).toContain('16:30 et à 21:00')
    expect(text).toMatch(/au moins 74 °C à cœur/) // poulet / nuggets
    expect(text).toMatch(/au moins 63 °C à cœur/) // porc
    expect(text).toContain(DEMO_CLEANING_TASKS[0].name)
    expect(text).toContain('Annexe 1 : produits utilisés')
    expect(text).toContain('Plan HACCP')
  })

  it('PDF A4 avec les réponses en métadonnées, relues pour la version suivante', async () => {
    const a = { ...defaultAnswers({ establishmentName: 'Space Diner', ownerName: 'Cédric' }), siret: '123 456 789 00012', place: 'Lyon' }
    const doc = buildPmsDocument(a, app, opts)
    const bytes = await buildPmsPdf(doc, a, await loadLabelFonts(), 'Document établi le 17 novembre 2026.')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(5)
    const back = await answersFromPdf(bytes, defaultAnswers({ establishmentName: '', ownerName: '' }))
    expect(back).toEqual(a)
  })

  it('refuse des réponses d’un autre format', () => {
    const d = defaultAnswers({ establishmentName: 'X', ownerName: 'Y' })
    expect(parseAnswers({ v: 99 }, d)).toBeNull()
    expect(parseAnswers({ v: 1, siret: 42, owner: 'Z' }, d)).toEqual({ ...d, owner: 'Z' })
  })
})
