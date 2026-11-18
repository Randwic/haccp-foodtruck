// RGPD (lot 8) : registre des traitements, note d'information, export des données d'un membre.
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { demoCleaningRecords } from '../cleaning/demoData.ts'
import { CSV_HEADERS } from '../control/csv.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { useInlineFonts } from '../labels/testFonts.ts'
import { buildStaffExport } from '../management/staffExport.ts'
import { demoTemperatureRecords } from '../temperatures/demoData.ts'
import { missingIdentity, processings, type RgpdContext } from './model.ts'
import { buildRegisterPdf, buildStaffNoticePdf } from './pdf.ts'

const NOW = new Date('2026-11-17T18:00:00.000Z')
const CTX: RgpdContext = { legalName: 'Space Diner', owner: 'Cédric', address: '', siret: '', contact: '', retentionYears: 3, staffCount: 2 }

beforeAll(() => useInlineFonts())

describe('registre des traitements', () => {
  it('trois traitements, durée de conservation reprise des réglages', () => {
    const p = processings(CTX)
    expect(p.map((x) => x.name)).toEqual(['Registres d’hygiène (HACCP) et traçabilité', 'Compte gérant de l’application', 'Documents de l’établissement'])
    expect(p[0].retention).toMatch(/^3 ans après la saisie/)
    expect(processings({ ...CTX, retentionYears: 1 })[0].retention).toMatch(/^1 an après/)
    expect(p[2].data).toContain('jamais de détail médical')
  })
  it('signale l’identité incomplète', () => {
    expect(missingIdentity(CTX)).toEqual(['adresse', 'téléphone ou email de contact'])
    expect(missingIdentity({ ...CTX, address: '1 rue', contact: '06' })).toEqual([])
  })
  it('PDF du registre et de la note d’information (A4)', async () => {
    const fonts = await loadLabelFonts()
    for (const bytes of [await buildRegisterPdf(CTX, fonts, 'Établi le 17 novembre 2026'), await buildStaffNoticePdf(CTX, fonts, 'Établi le 17 novembre 2026')]) {
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
      expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 })
    }
  })
})

describe('export des données d’un membre', () => {
  it('identité en tête, puis seulement ses saisies', async () => {
    const seeds = [...demoTemperatureRecords(NOW, 'alerte'), ...demoCleaningRecords(NOW)].sort((a, b) => a.device_time.localeCompare(b.device_time))
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', initialRecords: seeds, autoSyncDelayMs: null })
    const staff = await core.listStaff()
    const authors = new Set(seeds.map((s) => s.author_id))
    const member = staff.find((s) => authors.has(s.id))!
    const other = staff.find((s) => s.id !== member.id)!
    const mine = await buildStaffExport(core, null, { ...member, forgotten_at: null }, NOW)
    expect(mine.name).toMatch(/^donnees-[a-z0-9-]+-2026-11-17\.csv$/)
    expect(mine.csv.startsWith('﻿Export des données personnelles (RGPD)')).toBe(true)
    expect(mine.csv).toContain(`Nom;${member.display_name}`)
    const lines = mine.csv.split('\r\n')
    const header = lines.indexOf(CSV_HEADERS.join(';'))
    expect(header).toBeGreaterThan(0)
    const rows = lines.slice(header + 1).filter(Boolean)
    expect(rows.length).toBeGreaterThan(0)
    expect(lines.find((l) => l.startsWith('Saisies signées;'))).toBe(`Saisies signées;${rows.length}`)
    expect(rows.every((r) => r.includes(`;${member.display_name};`))).toBe(true)
    const theirs = await buildStaffExport(core, null, { ...other, forgotten_at: null }, NOW)
    expect(theirs.csv).not.toContain(`;${member.display_name};`)
  })
})
