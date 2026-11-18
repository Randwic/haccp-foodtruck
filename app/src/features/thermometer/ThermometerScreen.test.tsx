import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThermometerCheckPayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { buildControlReport } from '../control/model.ts'
import { buildThermometerChecks, dueLabel, makeCheckPayload, thermometerKey, thermometerRules, thermometerStatuses } from './model.ts'
import { parseReference } from './ThermometerForm.tsx'

const NOW = '2026-11-15T09:00:00.000Z' // dimanche 10:00 à Paris
const TZ = 'Europe/Paris'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(opts: FakeCoreOptions = {}) {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', autoSyncDelayMs: null, ...opts })
  renderWithCore(core)
  return core
}
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()
const check = (d: number, thermometer: string, measured: number, extra: Partial<FakeRecordSeed> = {}): FakeRecordSeed => ({
  type: 'thermometer_check',
  author_id: 'staff-equipier',
  device_time: daysAgo(d),
  payload: { ...makeCheckPayload({ thermometer, method: 'ice_water', reference: 0, measured, tolerance: 1 }) },
  ...extra,
})
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const type = (s: string) => {
  for (const ch of s) press(ch === ',' ? 'Virgule' : ch === '-' ? 'Moins (changer le signe)' : ch)
}
async function openModule() {
  fireEvent.click(await screen.findByRole('button', { name: /^Thermomètres :/ }))
  await screen.findByRole('heading', { name: 'Thermomètres', level: 1 })
}

describe('règles et calculs', () => {
  it('réglages par défaut ±1 °C / 30 jours, valeurs hors bornes ignorées', () => {
    expect(thermometerRules(null)).toEqual({ tolerance: 1, days: 30 })
    expect(thermometerRules({ thermometer_tolerance_c: 0.5, thermometer_check_days: 7 })).toEqual({ tolerance: 0.5, days: 7 })
    expect(thermometerRules({ thermometer_tolerance_c: 5, thermometer_check_days: 0 })).toEqual({ tolerance: 1, days: 30 })
  })
  it('payload : in_range calculé, nom nettoyé, commentaire vide omis ; valide pour le serveur', () => {
    const p = makeCheckPayload({ thermometer: '  Sonde 1 ', method: 'reference', reference: 22.3, measured: 22.6, tolerance: 0.3, comment: '  ' })
    expect(p).toEqual({ thermometer: 'Sonde 1', method: 'reference', reference_c: 22.3, measured_c: 22.6, tolerance_c: 0.3, in_range: true })
    expect(validatePayload('thermometer_check', p)).toEqual({ ok: true })
    expect(makeCheckPayload({ thermometer: 'S', method: 'ice_water', reference: 0, measured: -1.1, tolerance: 1 }).in_range).toBe(false)
  })
  it('référence saisie au clavier : virgule, signe, bornes', () => {
    expect(parseReference('21,5')).toBe(21.5)
    expect(parseReference('-3')).toBe(-3)
    expect(parseReference('21,55')).toBeNull()
    expect(parseReference('abc')).toBeNull()
    expect(parseReference('150')).toBeNull()
  })
  it('statut par thermomètre : même sonde malgré casse / accents, échéance, retard, hors tolérance', () => {
    const fake = (s: FakeRecordSeed, i: number) => ({ id: `r${i}`, author_id: s.author_id, device_id: 'd', device_seq: i + 1, device_time: s.device_time!, prev_hash: '', hash: '', supersedes_id: null, type: s.type, payload: s.payload })
    const seeds = [check(40, 'Sonde réception', 0.2), check(10, 'sonde  RÉCEPTION', 0.4), check(31, 'Sonde cuisine', 0), check(2, 'Sonde frites', 1.5)]
    const checks = buildThermometerChecks(seeds.map(fake))
    const st = thermometerStatuses({ checks, rules: { tolerance: 1, days: 30 }, now: new Date(NOW), timeZone: TZ })
    expect(st.map((s) => [s.name, s.due, s.daysLeft, s.out, s.missingActions.length])).toEqual([
      ['Sonde cuisine', 'overdue', -1, false, 0],
      ['Sonde frites', 'ok', 28, true, 1],
      ['sonde RÉCEPTION', 'ok', 20, false, 0],
    ])
    expect(thermometerKey('sonde  RÉCEPTION')).toBe(thermometerKey('Sonde réception'))
    expect(dueLabel({ daysLeft: -1 })).toBe('en retard de 1 jour')
    expect(dueLabel({ daysLeft: 0 })).toBe('à faire aujourd’hui')
    expect(dueLabel({ daysLeft: 12 })).toBe('à faire dans 12 jours')
  })
})

describe('Thermomètres (écran)', () => {
  it('tuile d’accueil « Aucune vérification » puis vérification conforme à l’eau glacée → thermometer_check validé', async () => {
    const core = setup()
    expect(await screen.findByRole('button', { name: 'Thermomètres : Aucune vérification enregistrée' })).toBeInTheDocument()
    await openModule()
    press('Vérifier un thermomètre')
    await screen.findByRole('heading', { name: 'Vérifier un thermomètre' })
    expect(screen.getByRole('textbox', { name: 'Thermomètre vérifié' })).toHaveValue('Sonde')
    fireEvent.change(screen.getByRole('textbox', { name: 'Thermomètre vérifié' }), { target: { value: 'Sonde cuisine' } })
    type('0,4')
    expect(screen.getByText(/^Conforme — écart/)).toBeInTheDocument()
    press('Enregistrer la vérification')
    await screen.findByRole('heading', { name: 'Thermomètres', level: 1 })
    const [rec] = await core.listRecords({ type: 'thermometer_check' })
    const p = rec.payload as unknown as ThermometerCheckPayload
    expect(p).toEqual({ thermometer: 'Sonde cuisine', method: 'ice_water', reference_c: 0, measured_c: 0.4, tolerance_c: 1, in_range: true })
    expect(validatePayload('thermometer_check', p)).toEqual({ ok: true })
    const panel = screen.getByRole('region', { name: 'Sonde cuisine' })
    expect(within(panel).getByText(/Prochaine vérification à faire dans 30 jours/)).toBeInTheDocument()
  })

  it('hors tolérance : action corrective obligatoire ; « Thermomètre réglé » l’enregistre puis rouvre une vérification', async () => {
    const core = setup({ initialRecords: [check(3, 'Sonde cuisine', 0.2)] })
    await openModule()
    press('Vérifier — Sonde cuisine')
    await screen.findByRole('heading', { name: 'Vérifier un thermomètre' })
    expect(screen.getByRole('textbox', { name: 'Thermomètre vérifié' })).toHaveValue('Sonde cuisine')
    type('-1,6')
    expect(screen.getByText('Hors tolérance')).toBeInTheDocument()
    press('Enregistrer la vérification')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    const [bad] = (await core.listRecords({ type: 'thermometer_check' })).filter((r) => r.payload.measured_c === -1.6)
    expect(bad.payload).toMatchObject({ in_range: false, tolerance_c: 1 })
    press(/^Thermomètre réglé/)
    await screen.findByRole('heading', { name: 'Vérifier un thermomètre' })
    const [action] = await core.listRecords({ type: 'corrective_action' })
    expect(action.payload).toMatchObject({ related_record_id: bad.id, action: 'adjust_equipment' })
    expect(validatePayload('corrective_action', action.payload)).toEqual({ ok: true })
    expect(screen.getByRole('textbox', { name: 'Thermomètre vérifié' })).toHaveValue('Sonde cuisine')
  })

  it('vérification en retard signalée sur l’accueil ; action manquante listée dans le module', async () => {
    setup({ initialRecords: [check(45, 'Sonde réception', 0), check(1, 'Sonde frites', 2)] })
    expect(
      await screen.findByRole('button', { name: /^Thermomètres : 1 action corrective manquante, Sonde réception : vérification en retard de 15 jours/ }),
    ).toBeInTheDocument()
    await openModule()
    expect(screen.getByRole('heading', { name: '1 action corrective manquante' })).toBeInTheDocument()
  })

  it('correction d’une vérification : motif obligatoire, original conservé', async () => {
    const core = setup({ initialRecords: [check(2, 'Sonde cuisine', 3, { id: '7e2a0000-0000-4000-8000-000000000001' })] })
    await openModule()
    press('Historique des vérifications')
    await screen.findByRole('heading', { name: 'Historique des vérifications' })
    press(/^Corriger la vérification de Sonde cuisine/)
    await screen.findByRole('heading', { name: 'Corriger une vérification' })
    press('Effacer le dernier caractère')
    type('0,3')
    expect(screen.getByRole('button', { name: 'Enregistrer la correction' })).toBeDisabled()
    press('Erreur de frappe')
    press('Enregistrer la correction')
    await screen.findByRole('heading', { name: 'Historique des vérifications' })
    const [corr] = await core.listRecords({ type: 'correction' })
    expect(corr.supersedes_id).toBe('7e2a0000-0000-4000-8000-000000000001')
    expect(validatePayload('correction', corr.payload, { supersededType: 'thermometer_check' })).toEqual({ ok: true })
    expect(screen.getByText('Conforme')).toBeInTheDocument()
  })
})

describe('mode Contrôle et réglages', () => {
  it('le dossier de contrôle a une rubrique « Vérification des thermomètres » (non-conformité comptée)', () => {
    const fake = (s: FakeRecordSeed, i: number) => ({ id: `r${i}`, author_id: s.author_id, device_id: 'd', device_seq: i + 1, device_time: s.device_time!, prev_hash: '', hash: '', supersedes_id: null, type: s.type, payload: s.payload })
    const records = [check(2, 'Sonde cuisine', 0.3), check(1, 'Sonde cuisine', 1.5)].map(fake)
    const report = buildControlReport({
      records,
      pendingIds: new Set(),
      refs: { timeZone: TZ, staffName: () => 'Cédric', deviceName: () => 'iPad', equipmentName: () => '', supplierName: () => '', cleaningTaskName: () => '', checklist: () => undefined },
      from: new Date(daysAgo(7)),
      to: new Date(NOW),
      timeZone: TZ,
    } as unknown as Parameters<typeof buildControlReport>[0])
    const m = report.modules.find((x) => x.module === 'thermometers')!
    expect(m.title).toBe('Vérification des thermomètres')
    expect(m.total).toBe(2)
    expect(m.nonConform).toBe(1)
    expect(m.missingActions).toBe(1)
    expect(m.rows[0].detail).toMatch(/^Eau glacée : lu 0,3 °C pour 0 °C attendu/)
  })

  it('réglages du gérant : écart admis et fréquence enregistrés, bornes refusées', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true, latencyMs: 0 })
    expect(await manager.getSettings()).toMatchObject({ thermometer_tolerance_c: 1, thermometer_check_days: 30 })
    await manager.saveSettings({ thermometer_tolerance_c: 0.5, thermometer_check_days: 7 })
    expect(await manager.getSettings()).toMatchObject({ thermometer_tolerance_c: 0.5, thermometer_check_days: 7 })
    await expect(manager.saveSettings({ thermometer_tolerance_c: 3 })).rejects.toThrow(/écart admis/)
    await expect(manager.saveSettings({ thermometer_check_days: 0 })).rejects.toThrow(/fréquence/)
  })
})
