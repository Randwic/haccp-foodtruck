import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

// Samedi 14/11/2026 09:30 à Paris.
const NOW = '2026-11-14T08:30:00.000Z'
const B1 = '11111111-1111-4111-8111-111111111111'
const [FRIGO_1] = DEMO_EQUIPMENT

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
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const typeTemp = (s: string) => {
  for (const ch of s) press(ch === ',' ? 'Virgule' : ch === '-' ? 'Moins (changer le signe)' : ch)
}
const minutesLater = (min: number) => vi.setSystemTime(new Date(Date.parse(NOW) + min * 60_000))
async function openTile(name: RegExp, heading: string) {
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('heading', { name: heading, level: 1 })
}
const seed = (type: FakeRecordSeed['type'], device_time: string, payload: Record<string, unknown>, id?: string): FakeRecordSeed => ({ id, type, author_id: 'staff-gerant', device_time, payload })

describe('Refroidissement rapide', () => {
  it('lot conforme : départ, mesure intermédiaire, clôture calculée par l’app', async () => {
    const core = setup()
    expect(await screen.findByRole('button', { name: 'Refroidissement : Aucun lot en cours' })).toBeInTheDocument()
    await openTile(/^Refroidissement :/, 'Refroidissement rapide')
    press('Démarrer un lot')
    await screen.findByRole('heading', { name: 'Démarrer un lot' })
    const start = screen.getByRole('button', { name: 'Démarrer le chronomètre' })
    typeTemp('75')
    expect(start).toBeDisabled() // produit obligatoire
    fireEvent.change(screen.getByLabelText('Produit'), { target: { value: 'Chili con carne' } })
    fireEvent.click(start)
    const card = await screen.findByRole('article', { name: /^Chili con carne, 2 h restantes/ })
    expect(within(card).getByText('Échéance 11:30')).toBeInTheDocument()

    minutesLater(40)
    fireEvent.click(within(card).getByRole('button', { name: 'Mesure intermédiaire — Chili con carne' }))
    await screen.findByRole('heading', { name: 'Mesure intermédiaire' })
    typeTemp('30')
    press('Enregistrer la mesure')
    await screen.findByText('Dernière mesure : 30 °C à 10:10')

    minutesLater(100)
    press('Clôturer — Chili con carne')
    await screen.findByRole('heading', { name: 'Clôturer le lot' })
    typeTemp('8')
    press('Clôturer le lot')
    await screen.findByRole('heading', { name: 'Refroidissement rapide' })
    expect(await screen.findByText('Clôturés aujourd’hui')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Action corrective obligatoire' })).toBeNull()

    const steps = (await core.listRecords({ type: 'cooling' })).reverse()
    expect(steps.map((r) => r.payload.step)).toEqual(['start', 'check', 'end'])
    const batch = steps[0].payload.batch_id
    expect(steps.every((r) => r.payload.batch_id === batch)).toBe(true)
    expect(steps[0].payload).toEqual({ batch_id: batch, step: 'start', product: 'Chili con carne', value_c: 75, source: 'manual' })
    expect(steps[2].payload).toEqual({ batch_id: batch, step: 'end', product: 'Chili con carne', value_c: 8, source: 'manual', in_range: true, duration_min: 100 })
  })

  it('départ sous 63 °C : avertissement clair, le lot reste possible', async () => {
    setup()
    await openTile(/^Refroidissement :/, 'Refroidissement rapide')
    press('Démarrer un lot')
    typeTemp('55')
    expect(await screen.findByText(/Départ sous 63/)).toBeInTheDocument()
  })

  it('hors délai : non conforme, action corrective obligatoire liée à la clôture, alerte d’échéance', async () => {
    const core = setup({ initialRecords: [seed('cooling', '2026-11-14T06:00:00.000Z', { batch_id: B1, step: 'start', product: 'Riz', value_c: 80, source: 'manual' })] })
    expect(await screen.findByRole('button', { name: 'Refroidissement : 1 en cours · dépassé de 30 min' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 refroidissement en cours · dépassé de 30 min — Riz' })).toBeInTheDocument()
    // Échéance passée, app ouverte : sans permission de notification → toast.
    expect(await screen.findByText('Refroidissement rapide : délai dépassé — Riz')).toBeInTheDocument()

    await openTile(/^Refroidissement :/, 'Refroidissement rapide')
    expect(screen.getByRole('article', { name: 'Riz, dépassé de 30 min' })).toBeInTheDocument()
    press('Clôturer — Riz')
    typeTemp('8')
    expect(screen.getByText('Hors objectif : action corrective obligatoire')).toBeInTheDocument()
    press('Clôturer le lot')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    fireEvent.click(screen.getByRole('radio', { name: /Produits jetés/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Refroidissement rapide' })

    const [end] = await core.listRecords({ type: 'cooling', limit: 1 })
    expect(end.payload).toMatchObject({ step: 'end', value_c: 8, in_range: false, duration_min: 150 })
    const [action] = await core.listRecords({ type: 'corrective_action' })
    expect(action.payload).toMatchObject({ related_record_id: end.id, action: 'discard' })
    expect(screen.queryByText(/action corrective manquante/i)).toBeNull()
  })

  it('lot en cours retrouvé après rechargement, rappel sur l’accueil', async () => {
    const core = setup()
    await openTile(/^Refroidissement :/, 'Refroidissement rapide')
    press('Démarrer un lot')
    fireEvent.change(screen.getByLabelText('Produit'), { target: { value: 'Bolognaise' } })
    typeTemp('70')
    press('Démarrer le chronomètre')
    await screen.findByRole('article', { name: /^Bolognaise/ })

    cleanup()
    minutesLater(48)
    renderWithCore(core)
    expect(await screen.findByRole('button', { name: 'Refroidissement : 1 en cours · 1 h 12 restante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 refroidissement en cours · 1 h 12 restante — Bolognaise' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 refroidissement en cours/ }))
    expect(await screen.findByRole('article', { name: 'Bolognaise, 1 h 12 restante' })).toBeInTheDocument()
  })
})

describe('Remise en température', () => {
  it('objectif ≥ 63 °C en 1 h : conforme à 40 min', async () => {
    const core = setup()
    await openTile(/^Remise en température :/, 'Remise en température')
    press('Démarrer un lot')
    fireEvent.change(screen.getByLabelText('Produit'), { target: { value: 'Soupe' } })
    typeTemp('4')
    press('Démarrer le chronomètre')
    await screen.findByRole('article', { name: /^Soupe, 1 h restante/ })
    minutesLater(40)
    press('Clôturer — Soupe')
    typeTemp('70')
    expect(screen.getByText('Objectif atteint dans le délai')).toBeInTheDocument()
    press('Clôturer le lot')
    await screen.findByText('Clôturés aujourd’hui')
    const [end] = await core.listRecords({ type: 'reheating', limit: 1 })
    expect(end.payload).toMatchObject({ step: 'end', product: 'Soupe', value_c: 70, in_range: true, duration_min: 40 })
    expect(await core.listRecords({ type: 'cooling' })).toHaveLength(0)
  })
})

describe('Cuisson & maintien', () => {
  it('cuisson hors seuil : action corrective obligatoire ; maintien conforme', async () => {
    const core = setup()
    await openTile(/^Cuisson & maintien :/, 'Cuisson & maintien')
    press('Nouvelle mesure — Cuisson à cœur')
    await screen.findByRole('heading', { name: 'Cuisson à cœur' })
    press('Steak haché') // suggestion
    typeTemp('65')
    expect(screen.getByText('Hors seuil')).toBeInTheDocument()
    press('Enregistrer la mesure')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    fireEvent.click(screen.getByRole('radio', { name: /remis en température/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Cuisson & maintien' })

    press('Nouvelle mesure — Maintien au chaud')
    fireEvent.change(screen.getByLabelText('Produit'), { target: { value: 'Chili' } })
    typeTemp('68')
    press('Enregistrer la mesure')
    await screen.findByRole('heading', { name: 'Cuisson & maintien' })

    const [cook] = await core.listRecords({ type: 'cooking_check' })
    expect(cook.payload).toEqual({ product: 'Steak haché', value_c: 65, source: 'manual', in_range: false })
    const [action] = await core.listRecords({ type: 'corrective_action' })
    expect(action.payload).toMatchObject({ related_record_id: cook.id, action: 'reheat' })
    const [hot] = await core.listRecords({ type: 'hot_holding' })
    expect(hot.payload).toEqual({ product: 'Chili', value_c: 68, source: 'manual', in_range: true })
    press('Accueil')
    expect(await screen.findByRole('button', { name: 'Cuisson & maintien : 2 mesures aujourd’hui' })).toBeInTheDocument()
  })
})

describe('Décongélation', () => {
  it('démarrer dans un frigo, terminer avec la DLC proposée (réglage) puis modifiée', async () => {
    const core = setup({ settings: { thaw_dlc_days: 2 } })
    await openTile(/^Décongélation :/, 'Décongélation')
    press('Démarrer')
    await screen.findByRole('heading', { name: 'Démarrer une décongélation' })
    press('Steaks hachés')
    const go = screen.getByRole('button', { name: 'Démarrer la décongélation' })
    expect(go).toBeDisabled() // enceinte obligatoire
    expect(screen.queryByRole('radio', { name: /Congélateur/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Frigo 1' }))
    fireEvent.click(go)
    await screen.findByRole('article', { name: 'Steaks hachés, Frigo 1' })
    press('Accueil')
    expect(await screen.findByRole('button', { name: 'Décongélation : 1 en cours' })).toBeInTheDocument()
    await openTile(/^Décongélation :/, 'Décongélation')

    press('Terminer — Steaks hachés')
    await screen.findByRole('heading', { name: 'Terminer la décongélation' })
    expect(screen.getByLabelText('DLC après décongélation')).toHaveValue('2026-11-16')
    expect(screen.getByText(/à confirmer selon votre PMS/)).toBeInTheDocument()
    press('J+3')
    expect(screen.getByText('DLC : mardi 17 novembre')).toBeInTheDocument()
    press('Terminer et enregistrer la DLC')
    await screen.findByText('Terminées aujourd’hui')

    const [end, start] = await core.listRecords({ type: 'thawing' })
    expect(start.payload).toEqual({ batch_id: end.payload.batch_id, step: 'start', product: 'Steaks hachés', equipment_id: FRIGO_1.id })
    expect(end.payload).toEqual({ batch_id: start.payload.batch_id, step: 'end', product: 'Steaks hachés', equipment_id: FRIGO_1.id, dlc: '2026-11-17' })
  })
})

describe('Historique et correction', () => {
  it('corriger la fin d’un lot : motif obligatoire, original barré, conformité recalculée', async () => {
    const END = '22222222-2222-4222-8222-222222222222'
    const core = setup({
      initialRecords: [
        seed('cooling', '2026-11-14T05:00:00.000Z', { batch_id: B1, step: 'start', product: 'Riz', value_c: 80, source: 'manual' }),
        seed('cooling', '2026-11-14T06:30:00.000Z', { batch_id: B1, step: 'end', product: 'Riz', value_c: 19, source: 'manual', in_range: false, duration_min: 90 }, END),
      ],
    })
    expect(await screen.findByRole('button', { name: 'Refroidissement : 1 action corrective manquante' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 mesure hors objectif sans action corrective')
    await openTile(/^Refroidissement :/, 'Refroidissement rapide')
    press('Historique')
    const lot = await screen.findByRole('article', { name: 'Lot Riz de 06:00' })
    expect(within(lot).getAllByText('Hors objectif').length).toBeGreaterThan(0)
    fireEvent.click(within(lot).getByRole('button', { name: 'Corriger fin de 07:30 (Riz)' }))
    await screen.findByRole('heading', { name: 'Corriger une mesure' })
    const save = screen.getByRole('button', { name: 'Enregistrer la correction' })
    press('Effacer le dernier caractère')
    press('Effacer le dernier caractère')
    typeTemp('9')
    expect(save).toBeDisabled() // motif obligatoire
    press('Erreur de frappe')
    fireEvent.click(save)
    await screen.findByRole('heading', { name: /^Historique/ })

    const [corr] = await core.listRecords({ type: 'correction' })
    expect(corr.supersedes_id).toBe(END)
    expect(corr.payload).toEqual({
      reason: 'Erreur de frappe',
      replacement: { batch_id: B1, step: 'end', product: 'Riz', value_c: 9, source: 'manual', in_range: true, duration_min: 90 },
    })
    expect(await core.listRecords({ type: 'cooling' })).toHaveLength(2) // rien n'est modifié
    const struck = await screen.findByLabelText(/^Valeur d’origine 19.°C, corrigée$/)
    expect(struck.tagName).toBe('S')
    expect(screen.getByText(/motif : Erreur de frappe/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Action corrective manquante')).toBeNull())
  })
})

describe('Accueil', () => {
  it('compteurs réels des procédés', async () => {
    setup({
      initialRecords: [
        // Refroidissement démarré il y a 1 h 40 : échéance proche.
        seed('cooling', '2026-11-14T06:50:00.000Z', { batch_id: B1, step: 'start', product: 'Chili', value_c: 70, source: 'manual' }),
        seed('hot_holding', '2026-11-14T08:00:00.000Z', { product: 'Chili', value_c: 55, source: 'manual', in_range: false }),
        seed('thawing', '2026-11-13T20:00:00.000Z', { batch_id: '33333333-3333-4333-8333-333333333333', step: 'start', product: 'Pain', equipment_id: FRIGO_1.id }),
      ],
    })
    const cooling = await screen.findByRole('button', { name: 'Refroidissement : 1 en cours · 20 min restantes' })
    expect(within(cooling).getByText('1 en cours · 20 min restantes')).toHaveClass('text-warn')
    expect(screen.getByRole('button', { name: 'Remise en température : Aucun lot en cours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cuisson & maintien : 1 action corrective manquante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Décongélation : 1 en cours' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 mesure hors objectif sans action corrective')
    expect(screen.queryByRole('button', { name: /Refroidissement \(Bientôt\)/ })).toBeNull()
  })
})
