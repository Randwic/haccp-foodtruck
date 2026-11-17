// Mode Contrôle (lot 7) : synthèse du registre, période, CSV, PDF, intégrité, chargement serveur + appareil.
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { computeRecordHash } from '../../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord } from '../../../../shared/types.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { demoCleaningRecords, demoOilRecords } from '../cleaning/demoData.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { useInlineFonts } from '../labels/testFonts.ts'
import { demoProcessAlerts, demoProcessRecords } from '../processes/demoData.ts'
import { demoReceptions } from '../reception/demoData.ts'
import { demoTemperatureRecords } from '../temperatures/demoData.ts'
import { controlCsv, CSV_HEADERS } from './csv.ts'
import { verifyChains } from './integrity.ts'
import { loadControlData } from './load.ts'
import { buildControlReport, customRange, periodRange, type ControlRefs } from './model.ts'
import { buildControlPdf } from './pdf.ts'

const TZ = 'Europe/Paris'
const NOW = new Date('2026-11-17T18:00:00.000Z')

beforeAll(() => useInlineFonts())

function demoCore(extra: FakeRecordSeed[] = []) {
  const seeds = [
    ...demoTemperatureRecords(NOW, 'alerte'),
    ...demoProcessRecords(NOW),
    ...demoProcessAlerts(NOW),
    ...demoReceptions(NOW, 'alerte').records,
    ...demoCleaningRecords(NOW),
    ...demoOilRecords(NOW, 'alerte'),
    ...extra,
  ].sort((a, b) => a.device_time.localeCompare(b.device_time))
  return createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', initialRecords: seeds, autoSyncDelayMs: null })
}

describe('période', () => {
  it('7 derniers jours : du début du 6e jour avant à la fin d’aujourd’hui (heure de Paris)', () => {
    const r = periodRange('7d', NOW, TZ)
    expect(r.from.toISOString()).toBe('2026-11-10T23:00:00.000Z')
    expect(r.to.toISOString()).toBe('2026-11-17T22:59:59.999Z')
  })
  it('mois dernier et mois en cours', () => {
    expect(periodRange('last_month', NOW, TZ)).toEqual({ from: new Date('2026-09-30T22:00:00.000Z'), to: new Date('2026-10-31T22:59:59.999Z') })
    expect(periodRange('month', NOW, TZ).from.toISOString()).toBe('2026-10-31T23:00:00.000Z')
  })
  it('période libre : jours inclus, refus si inversée ou invalide', () => {
    expect(customRange('2026-11-01', '2026-11-03', TZ)).toEqual({ from: new Date('2026-10-31T23:00:00.000Z'), to: new Date('2026-11-03T22:59:59.999Z') })
    expect(customRange('2026-11-05', '2026-11-03', TZ)).toBeNull()
    expect(customRange('', '2026-11-03', TZ)).toBeNull()
  })
})

describe('synthèse du registre', () => {
  it('reprend chaque registre, les écarts, les actions manquantes et les corrections', async () => {
    const core = demoCore()
    const data = await loadControlData(core, null, periodRange('30d', NOW, TZ))
    expect(data.source).toBe('device')
    const report = buildControlReport({ records: data.records, pendingIds: data.pendingIds, ...periodRange('30d', NOW, TZ), refs: data.refs })
    const byModule = Object.fromEntries(report.modules.map((m) => [m.module, m]))
    expect(byModule.temperatures.total).toBeGreaterThan(5)
    expect(byModule.temperatures.missingActions).toBe(1) // relevé hors seuil de ce matin sans action
    expect(byModule.temperatures.corrected).toBeGreaterThan(0)
    expect(byModule.reception.total).toBeGreaterThan(0)
    expect(byModule.cleaning.total).toBeGreaterThan(0)
    expect(byModule.checklists.nonConform).toBeGreaterThan(0)
    expect(byModule.checklists.missingActions).toBe(0) // un « Non » de checklist n'exige pas d'action corrective
    expect(byModule.oil.total).toBeGreaterThan(0)
    expect(report.totals.nonConform).toBe(report.nonConformities.length)
    expect(report.totals.missingActions).toBeGreaterThanOrEqual(2)
    // Les actions correctives sont décrites avec leur auteur.
    const withAction = report.nonConformities.find((r) => r.actions.length > 0)
    expect(withAction?.actions[0]).toMatch(/\(Gérant|\(Équipier/)
    // Écarts du plus récent au plus ancien.
    const times = report.nonConformities.map((r) => r.time)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('limite la période à la date de la saisie d’origine (une correction postérieure est appliquée)', async () => {
    const core = demoCore()
    const data = await loadControlData(core, null, periodRange('7d', NOW, TZ))
    const day = customRange('2026-11-17', '2026-11-17', TZ)!
    const report = buildControlReport({ records: data.records, ...day, refs: data.refs })
    expect(report.modules.every((m) => m.rows.every((r) => r.time >= day.from.toISOString() && r.time <= day.to.toISOString()))).toBe(true)
  })

  it('ignore la quarantaine et les tests d’enregistrement (comptés à part)', () => {
    const refs: ControlRefs = {
      timeZone: TZ,
      staffName: () => 'Cédric',
      deviceName: () => 'iPad',
      equipmentName: () => 'Frigo',
      supplierName: () => 'Metro',
      cleaningTaskName: () => 'Plan de travail',
      checklist: () => undefined,
    }
    const base = { author_id: 'a', device_id: 'd', prev_hash: GENESIS_HASH, hash: GENESIS_HASH, supersedes_id: null }
    const records = [
      { ...base, id: '1', type: 'system_test' as const, payload: {}, device_seq: 1, device_time: '2026-11-15T10:00:00.000Z' },
      { ...base, id: '2', type: 'temperature_check' as const, payload: { equipment_id: 'e', value_c: 9, source: 'manual', in_range: false }, device_seq: 2, device_time: '2026-11-15T10:01:00.000Z', quarantine_reason: 'invalid_payload' },
      { ...base, id: '3', type: 'temperature_check' as const, payload: { equipment_id: 'e', value_c: 2, source: 'manual', in_range: true }, device_seq: 3, device_time: '2026-11-15T10:02:00.000Z' },
    ]
    const report = buildControlReport({ records, ...periodRange('7d', NOW, TZ), refs })
    expect(report.totals.entries).toBe(1)
    expect(report.quarantined).toBe(1)
    expect(report.tests).toBe(1)
    expect(report.modules[0].rows[0]).toMatchObject({ subject: 'Frigo', detail: '2 °C (saisie)', status: 'ok', author: 'Cédric' })
  })
})

describe('export', () => {
  it('CSV : en-têtes français, séparateur « ; », BOM, une ligne par saisie, formules neutralisées', async () => {
    const core = demoCore()
    const range = periodRange('30d', NOW, TZ)
    const data = await loadControlData(core, null, range)
    const report = buildControlReport({ records: data.records, ...range, refs: data.refs })
    const csv = controlCsv(report, TZ)
    expect(csv.startsWith('﻿' + CSV_HEADERS.join(';'))).toBe(true)
    expect(csv.trimEnd().split('\r\n').length).toBeGreaterThan(report.totals.entries) // + en-tête (cellules multilignes possibles)
    expect(csv).toContain('ACTION CORRECTIVE MANQUANTE')
    const tricky = controlCsv({ ...report, modules: [{ ...report.modules[0], rows: [{ ...report.modules[0].rows[0], subject: '=SOMME(A1)' }] }] }, TZ)
    expect(tricky).toContain(`'=SOMME(A1)`)
  })

  it('PDF A4 : page de titre, synthèse, registres, annexes', async () => {
    const core = demoCore()
    const range = periodRange('30d', NOW, TZ)
    const data = await loadControlData(core, null, range)
    const report = buildControlReport({ records: data.records, ...range, refs: data.refs })
    const integrity = await verifyChains(data.records, data.refs.deviceName, { complete: false })
    const bytes = await buildControlPdf(
      {
        report,
        establishmentName: 'Space Diner',
        timeZone: TZ,
        generatedAt: NOW,
        source: data.source,
        deviceCount: 1,
        integrity,
        staff: data.staff,
        equipment: data.equipment,
        thresholds: data.thresholds,
        documents: [],
      },
      await loadLabelFonts(),
    )
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(3)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 })
    expect(pdf.getTitle()).toContain('Dossier contrôle sanitaire')
  })
})

describe('intégrité', () => {
  async function chain(n: number): Promise<HaccpRecord[]> {
    const out: HaccpRecord[] = []
    for (let i = 1; i <= n; i++) {
      const core = {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        type: 'system_test' as const,
        payload: { i },
        author_id: 'a',
        device_id: 'd',
        device_seq: i,
        device_time: `2026-11-1${i}T10:00:00.000Z`,
        prev_hash: out[i - 2]?.hash ?? GENESIS_HASH,
        supersedes_id: null,
      }
      out.push({ ...core, hash: await computeRecordHash(core) })
    }
    return out
  }
  it('chaîne intacte, saisie modifiée, saisie retirée', async () => {
    const ok = await chain(4)
    expect((await verifyChains(ok, () => 'iPad')).ok).toBe(true)
    const tampered = ok.map((r, i) => (i === 1 ? { ...r, payload: { i: 99 } } : r))
    expect((await verifyChains(tampered, () => 'iPad')).devices[0].problems).toEqual([{ device_seq: 2, record_id: ok[1].id, problem: 'hash_mismatch' }])
    const gap = ok.filter((_, i) => i !== 2)
    expect((await verifyChains(gap, () => 'iPad')).devices[0].problems[0].problem).toBe('seq_gap')
    // Extrait (pas depuis le n° 1) : seul le chaînage interne est vérifié.
    expect((await verifyChains(ok.slice(2), () => 'iPad', { complete: false })).ok).toBe(true)
    expect((await verifyChains(ok.slice(2), () => 'iPad')).ok).toBe(false)
  })
})

describe('chargement serveur + appareil', () => {
  it('registre du serveur complété par les saisies locales non envoyées', async () => {
    const core = demoCore([{ type: 'temperature_check', author_id: 'staff-gerant', device_time: '2026-11-17T17:00:00.000Z', payload: { equipment_id: 'x', value_c: 3, source: 'manual', in_range: true }, synced: false }])
    const local = await core.listRecords()
    const server = local.filter((r) => r.server_time)
    const manager = createMockManagerApi({ seeded: true, signedIn: true, registrySource: async () => server })
    const range = periodRange('7d', NOW, TZ)
    const data = await loadControlData(core, manager, range)
    expect(data.source).toBe('server')
    const unsent = local.filter((r) => !r.server_time)
    expect(unsent.length).toBeGreaterThan(0)
    expect([...data.pendingIds].sort()).toEqual(unsent.map((r) => r.id).sort())
    expect(data.records.length).toBe(local.length)
    const report = buildControlReport({ records: data.records, pendingIds: data.pendingIds, ...range, refs: data.refs })
    expect(report.totals.pending).toBeGreaterThan(0)
  })
  it('repli sur l’appareil si le serveur ne répond pas', async () => {
    const core = demoCore()
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    manager.simulate.setOffline(true)
    const data = await loadControlData(core, manager, periodRange('7d', NOW, TZ))
    expect(data.source).toBe('device')
    expect(data.fallbackReason).toMatch(/Serveur injoignable/)
  })
})
