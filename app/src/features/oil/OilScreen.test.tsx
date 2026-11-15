import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OilChangePayload, OilCheckPayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { applyNumberKey, textToNumber } from '../../ui/numberPad.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { buildOilChecks, oilLevel, oilLimits, vatStatuses } from './model.ts'

const NOW = '2026-11-15T09:00:00.000Z' // dimanche 10:00 à Paris
const VAT_1 = DEMO_EQUIPMENT[3]
const VAT_2 = DEMO_EQUIPMENT[4]

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
const minAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString()
const seed = (type: FakeRecordSeed['type'], m: number, payload: Record<string, unknown>, extra: Partial<FakeRecordSeed> = {}): FakeRecordSeed => ({ type, author_id: 'staff-equipier', device_time: minAgo(m), payload, ...extra })
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const type = (s: string) => {
  for (const ch of s) press(ch === ',' ? 'Virgule' : ch)
}
async function openOil() {
  fireEvent.click(await screen.findByRole('button', { name: /^Huiles de friture :/ }))
  await screen.findByRole('heading', { name: 'Huiles de friture', level: 1 })
}
const records = async (core: ReturnType<typeof createFakeCore>, t: 'oil_check' | 'oil_change' | 'corrective_action' | 'correction') => core.listRecords({ type: t })

describe('pavé numérique générique et calculs', () => {
  it('une décimale, 0..50, refus au-delà', () => {
    const r = { min: 0, max: 50, decimals: 1 }
    expect(applyNumberKey('2', '3', r)).toBe('23')
    expect(applyNumberKey('23', ',', r)).toBe('23,')
    expect(applyNumberKey('23,', '5', r)).toBe('23,5')
    expect(applyNumberKey('23,5', '1', r)).toBeNull()
    expect(applyNumberKey('5', '1', r)).toBeNull()
    expect(applyNumberKey('0', '7', r)).toBe('7')
    expect(applyNumberKey('', ',', r)).toBe('0,')
    expect(textToNumber('23,')).toBe(23)
    expect(applyNumberKey('2', ',', { ...r, decimals: 0 })).toBeNull()
  })

  it('niveaux : vert < alerte ≤ ambre ≤ limite < rouge ; réglages par défaut 22 / 25', () => {
    const l = oilLimits(null)
    expect(l).toEqual({ max: 25, warn: 22 })
    expect([21.9, 22, 25, 25.1].map((v) => oilLevel(v, l))).toEqual(['ok', 'warn', 'warn', 'out'])
    expect(oilLimits({ oil_polar_max: 20, oil_polar_warn: 18 })).toEqual({ max: 20, warn: 18 })
  })

  it('par bac : contrôles depuis le dernier changement ; un changement remet la jauge à zéro', () => {
    const r = (id: string, type: 'oil_check' | 'oil_change', t: string, payload: Record<string, unknown>) => ({ id, type, payload, author_id: 'a', device_id: 'd', device_seq: 1, device_time: t, prev_hash: '', hash: '', supersedes_id: null })
    const recs = [
      r('a', 'oil_check', '2026-11-10T10:00:00Z', { equipment_id: VAT_1.id, polar_percent: 26, method: 'tester', in_range: false }),
      r('b', 'oil_change', '2026-11-11T10:00:00Z', { equipment_id: VAT_1.id }),
      r('c', 'oil_check', '2026-11-12T10:00:00Z', { equipment_id: VAT_1.id, polar_percent: 9, method: 'strip', in_range: true }),
    ]
    const [s] = vatStatuses({ vats: [VAT_1], checks: buildOilChecks(recs), changes: [{ id: 'b', time: '2026-11-11T10:00:00Z', payload: { equipment_id: VAT_1.id } } as never], limits: oilLimits(null), now: new Date(NOW), timeZone: 'Europe/Paris' })
    expect(s.sinceChange.map((c) => c.payload.polar_percent)).toEqual([9])
    expect(s.level).toBe('ok')
    expect(s.missingActions.map((c) => c.id)).toEqual(['a'])
  })
})

describe('Huiles de friture', () => {
  it('contrôle conforme au pavé numérique, méthode bandelette → oil_check validé', async () => {
    const core = setup()
    expect(await screen.findByRole('button', { name: 'Huiles de friture : Aucun contrôle aujourd’hui' })).toBeInTheDocument()
    await openOil()
    press(`Contrôle — ${VAT_1.name}`)
    await screen.findByRole('heading', { name: `Contrôle — ${VAT_1.name}` })
    fireEvent.click(screen.getByRole('radio', { name: 'Bandelette' }))
    type('18,5')
    expect(screen.getByRole('meter', { name: `Composés polaires — ${VAT_1.name}` })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^18,5 %, conforme/))
    press('Enregistrer le contrôle')
    await screen.findByRole('heading', { name: 'Huiles de friture', level: 1 })
    const [rec] = await records(core, 'oil_check')
    const p = rec.payload as unknown as OilCheckPayload
    expect(p).toEqual({ equipment_id: VAT_1.id, polar_percent: 18.5, method: 'strip', in_range: true })
    expect(validatePayload('oil_check', p)).toEqual({ ok: true })
  })

  it('au-delà de la limite : action corrective obligatoire ; « Changer l’huile » enregistre aussi un oil_change', async () => {
    const core = setup()
    await openOil()
    press(`Contrôle — ${VAT_2.name}`)
    type('27')
    expect(screen.getByText(/l’huile doit être changée/)).toBeInTheDocument()
    press('Enregistrer le contrôle')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    const [check] = await records(core, 'oil_check')
    expect(check.payload).toMatchObject({ polar_percent: 27, in_range: false })
    press(/^Changer l’huile/)
    await screen.findByRole('heading', { name: 'Huiles de friture', level: 1 })
    const [change] = await records(core, 'oil_change')
    expect(validatePayload('oil_change', change.payload)).toEqual({ ok: true })
    expect((change.payload as unknown as OilChangePayload).equipment_id).toBe(VAT_2.id)
    const [action] = await records(core, 'corrective_action')
    expect(action.payload).toMatchObject({ related_record_id: check.id, action: 'discard' })
    expect(validatePayload('corrective_action', action.payload)).toEqual({ ok: true })
    // Nouvelle huile : plus de valeur en cours sur ce bac.
    expect(within(screen.getByRole('region', { name: VAT_2.name })).getByText('Aucun contrôle depuis le changement d’huile')).toBeInTheDocument()
  })

  it('hors limite sans action (après rechargement) : bandeau et tuile en rouge ; « Autre action corrective »', async () => {
    const core = setup({ initialRecords: [seed('oil_check', 30, { equipment_id: VAT_1.id, polar_percent: 28, method: 'tester', in_range: false })] })
    expect(await screen.findByRole('button', { name: /^Huiles de friture : 1 action corrective manquante/ })).toBeInTheDocument()
    await openOil()
    press('Faire l’action corrective')
    press(/^Autre action corrective/)
    fireEvent.click(await screen.findByRole('radio', { name: /Technicien appelé/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Huiles de friture', level: 1 })
    expect((await records(core, 'corrective_action'))[0].payload).toMatchObject({ action: 'call_technician' })
    expect(screen.queryByText(/action corrective manquante/)).toBeNull()
  })

  it('valeur à surveiller (≥ 22 %) : ambre sur la tuile', async () => {
    setup({ initialRecords: [seed('oil_check', 30, { equipment_id: VAT_2.id, polar_percent: 23.5, method: 'tester', in_range: true })] })
    expect(await screen.findByRole('button', { name: `Huiles de friture : ${VAT_2.name} à surveiller (23,5 %), 1 bac non contrôlé aujourd’hui` })).toBeInTheDocument()
  })

  it('historique par bac et correction : motif obligatoire, original barré, conformité recalculée', async () => {
    const id = '011c0000-0000-4000-8000-0000000000aa'
    const core = setup({ initialRecords: [seed('oil_change', 60 * 24 * 3, { equipment_id: VAT_1.id }), seed('oil_check', 60, { equipment_id: VAT_1.id, polar_percent: 1.5, method: 'tester', in_range: true }, { id })] })
    await openOil()
    press(`Historique — ${VAT_1.name}`)
    await screen.findByRole('heading', { name: `Historique — ${VAT_1.name}` })
    expect(screen.getAllByRole('img', { name: /1 contrôle depuis le changement : 1,5 %/ }).length).toBeGreaterThan(0)
    press('Corriger le contrôle de 09:00')
    await screen.findByRole('heading', { name: 'Corriger un contrôle' })
    press('Effacer le dernier caractère')
    press('Effacer le dernier caractère')
    press('Effacer le dernier caractère')
    type('15')
    const save = screen.getByRole('button', { name: 'Enregistrer la correction' })
    expect(save).toBeDisabled()
    press('Erreur de frappe')
    fireEvent.click(save)
    await screen.findByRole('heading', { name: `Historique — ${VAT_1.name}` })
    const [corr] = await records(core, 'correction')
    expect(corr.supersedes_id).toBe(id)
    expect(validatePayload('correction', corr.payload, { supersededType: 'oil_check' })).toEqual({ ok: true })
    expect(corr.payload.replacement).toMatchObject({ polar_percent: 15, in_range: true })
    expect(screen.getByLabelText('ancienne valeur 1,5 %')).toBeInTheDocument()
  })

  it('changement d’huile avec commentaire → oil_change', async () => {
    const core = setup()
    await openOil()
    press(`Changement d’huile — ${VAT_1.name}`)
    await screen.findByRole('heading', { name: `Changement d’huile — ${VAT_1.name}` })
    fireEvent.change(screen.getByLabelText('Commentaire (facultatif)'), { target: { value: '12 L' } })
    press('Enregistrer le changement')
    await screen.findByRole('heading', { name: 'Huiles de friture', level: 1 })
    expect((await records(core, 'oil_change'))[0].payload).toEqual({ equipment_id: VAT_1.id, comment: '12 L' })
  })
})

describe('Gestion › Réglages : seuils huile', () => {
  it('limite et alerte via le ManagerApi ; alerte toujours sous la limite', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null })
    renderWithCore(core, undefined, manager)
    fireEvent.click(await screen.findByRole('button', { name: /^Gestion/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Réglages' }))
    await screen.findByLabelText('Limite : 25 %')
    for (let i = 0; i < 10; i++) press('Diminuer la limite') // 25 → 20
    expect(screen.getByLabelText('Limite : 20 %')).toBeInTheDocument()
    expect(screen.getByLabelText('Seuil d’alerte : 19,5 %')).toBeInTheDocument()
    press('Diminuer le seuil d’alerte')
    press('Enregistrer les réglages')
    await screen.findByText('Réglages enregistrés')
    expect(await manager.getSettings()).toMatchObject({ oil_polar_max: 20, oil_polar_warn: 19 })
    await expect(manager.saveSettings({ oil_polar_warn: 21 })).rejects.toThrow(/inférieur à la limite/)
    await expect(manager.saveSettings({ oil_polar_max: 31 })).rejects.toThrow(/entre 10 et 30/)
  })
})
