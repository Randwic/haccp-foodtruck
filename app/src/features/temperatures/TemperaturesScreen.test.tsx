import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_EQUIPMENT } from '../../core/mockTransport.ts'
import { createFakeCore, type FakeCoreOptions } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

const [FRIGO_1] = DEMO_EQUIPMENT
// Samedi 14/11/2026 09:30 à Paris : créneau en cours 08:00 (07:00 UTC).
const NOW = '2026-11-14T08:30:00.000Z'

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
async function openTemperatures() {
  fireEvent.click(await screen.findByRole('button', { name: /^Températures :/ }))
  await screen.findByRole('heading', { name: 'Températures' })
}
async function openEnclosure(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name},`) }))
  await screen.findByRole('button', { name: 'Enregistrer le relevé' })
}

describe('Températures – accueil', () => {
  it('compteur réel : relevés à faire, puis « tout est fait »', async () => {
    const core = setup()
    expect(await screen.findByRole('button', { name: 'Températures : 3 relevés à faire' })).toBeEnabled()
    await openTemperatures()
    for (const name of ['Frigo 1', 'Frigo 2']) {
      await openEnclosure(name)
      typeTemp('3')
      press('Enregistrer le relevé')
      await screen.findByRole('heading', { name: 'Températures' })
    }
    await openEnclosure('Congélateur')
    typeTemp('-20')
    press('Enregistrer le relevé')
    await screen.findByRole('heading', { name: 'Températures' })
    press('Accueil')
    expect(await screen.findByRole('button', { name: 'Températures : tout est fait' })).toBeInTheDocument()
    expect(screen.getByText('Tout est fait')).toBeInTheDocument()
    expect(await core.listRecords({ type: 'temperature_check' })).toHaveLength(3)
  })

  it('un relevé fait avant le créneau en cours ne compte pas', async () => {
    setup({
      initialRecords: [
        { type: 'temperature_check', author_id: 'staff-equipier', device_time: '2026-11-14T06:50:00.000Z', payload: { equipment_id: FRIGO_1.id, value_c: 3, source: 'manual', in_range: true } },
      ],
    })
    expect(await screen.findByRole('button', { name: 'Températures : 3 relevés à faire' })).toBeInTheDocument()
  })
})

describe('Températures – saisie', () => {
  it('saisie conforme : enregistrée avec le seuil de l’équipement, retour à la liste', async () => {
    const core = setup()
    await openTemperatures()
    await openEnclosure('Frigo 1')
    typeTemp('3,5')
    expect(screen.getByText('Conforme')).toBeInTheDocument()
    press('Enregistrer le relevé')
    await screen.findByRole('heading', { name: 'Températures' })
    expect(await screen.findByRole('button', { name: /^Frigo 1, relevé fait/ })).toBeInTheDocument()
    const [rec] = await core.listRecords({ type: 'temperature_check' })
    expect(rec.payload).toEqual({ equipment_id: FRIGO_1.id, value_c: 3.5, source: 'manual', in_range: true })
    expect(rec.author_id).toBe('staff-equipier')
  })

  it('hors seuil : action corrective obligatoire (commentaire exigé pour « Autre »)', async () => {
    const core = setup()
    await openTemperatures()
    await openEnclosure('Frigo 1')
    typeTemp('7,5')
    expect(screen.getByText('Hors seuil')).toBeInTheDocument()
    press('Enregistrer le relevé')
    expect(await screen.findByRole('heading', { name: 'Action corrective obligatoire' })).toBeInTheDocument()
    // Écran bloquant : pas de retour possible.
    expect(screen.queryByRole('button', { name: 'Températures' })).toBeNull()
    const save = screen.getByRole('button', { name: 'Enregistrer l’action corrective' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Autre action/ }))
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Commentaire (obligatoire)'), { target: { value: 'Frigo vidé, denrées comptées' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await screen.findByRole('heading', { name: 'Températures' })

    const [reading] = await core.listRecords({ type: 'temperature_check' })
    expect(reading.payload).toMatchObject({ value_c: 7.5, in_range: false })
    const [action] = await core.listRecords({ type: 'corrective_action' })
    expect(action.payload).toEqual({ related_record_id: reading.id, action: 'other', comment: 'Frigo vidé, denrées comptées' })
    expect(screen.queryByText(/action corrective manquante/i)).toBeNull()
  })

  it('action quittée (rechargement) : signalée en rouge jusqu’à ce qu’elle soit faite', async () => {
    const core = setup()
    await openTemperatures()
    await openEnclosure('Frigo 1')
    typeTemp('9')
    press('Enregistrer le relevé')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })

    // Rechargement de l'app : on repart de l'accueil avec le même registre.
    cleanup()
    renderWithCore(core)
    expect(await screen.findByRole('button', { name: /^Températures : 1 action corrective manquante/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 relevé hors seuil sans action corrective')

    fireEvent.click(screen.getByRole('button', { name: 'Traiter' }))
    await screen.findByRole('heading', { name: 'Températures' })
    expect(screen.getByRole('button', { name: /^Frigo 1, relevé fait, action corrective manquante/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Faire l’action corrective' }))
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    fireEvent.click(screen.getByRole('radio', { name: /Équipement réglé/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Températures' })
    await waitFor(() => expect(screen.queryByText('Faire l’action corrective')).toBeNull())
    press('Accueil')
    expect(await screen.findByRole('button', { name: 'Températures : 2 relevés à faire' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Températures – historique et correction', () => {
  it('corriger : nouvelle valeur + motif, l’original reste visible barré', async () => {
    const core = setup({
      initialRecords: [
        {
          id: '5e1d0000-0000-4000-8000-000000000001',
          type: 'temperature_check',
          author_id: 'staff-gerant',
          device_time: '2026-11-14T07:05:00.000Z',
          payload: { equipment_id: FRIGO_1.id, value_c: 35, source: 'manual', in_range: false },
        },
        {
          type: 'corrective_action',
          author_id: 'staff-gerant',
          device_time: '2026-11-14T07:06:00.000Z',
          payload: { related_record_id: '5e1d0000-0000-4000-8000-000000000001', action: 'adjust_equipment', comment: '' },
        },
      ],
    })
    await openTemperatures()
    press('Historique')
    await screen.findByRole('heading', { name: 'Historique des relevés' })
    const today = screen.getByRole('region', { name: 'Aujourd’hui' })
    expect(within(today).getByText(/par Gérant/)).toBeInTheDocument()
    expect(within(today).getByText(/Équipement réglé/)).toBeInTheDocument()
    fireEvent.click(within(today).getByRole('button', { name: 'Corriger le relevé de 08:05' }))
    await screen.findByRole('heading', { name: 'Corriger un relevé' })

    const save = screen.getByRole('button', { name: 'Enregistrer la correction' })
    expect(save).toBeDisabled() // valeur identique, pas de motif
    press('Effacer le dernier caractère')
    typeTemp(',5')
    expect(save).toBeDisabled() // motif obligatoire
    press('Erreur de frappe')
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await screen.findByRole('heading', { name: 'Historique des relevés' })

    const [corr] = await core.listRecords({ type: 'correction' })
    expect(corr.supersedes_id).toBe('5e1d0000-0000-4000-8000-000000000001')
    expect(corr.payload).toEqual({
      reason: 'Erreur de frappe',
      replacement: { equipment_id: FRIGO_1.id, value_c: 3.5, source: 'manual', in_range: true },
    })
    // L'original n'est ni modifié ni supprimé.
    const originals = await core.listRecords({ type: 'temperature_check' })
    expect(originals).toHaveLength(1)
    expect(originals[0].payload).toMatchObject({ value_c: 35 })

    const struck = await screen.findByLabelText(/^Valeur d’origine 35.°C, corrigée$/)
    expect(struck.tagName).toBe('S')
    expect(screen.getByText(/Corrigé 09:30 par Équipier/)).toBeInTheDocument()
    expect(screen.getByText(/motif : Erreur de frappe/)).toBeInTheDocument()
  })

  it('correction vers une valeur hors seuil : action corrective demandée, liée à la correction', async () => {
    const core = setup({
      initialRecords: [
        { id: '5e1d0000-0000-4000-8000-000000000002', type: 'temperature_check', author_id: 'staff-equipier', device_time: '2026-11-14T07:05:00.000Z', payload: { equipment_id: FRIGO_1.id, value_c: 3, source: 'manual', in_range: true } },
      ],
    })
    await openTemperatures()
    press('Historique')
    fireEvent.click(await screen.findByRole('button', { name: 'Corriger le relevé de 08:05' }))
    press('Effacer le dernier caractère')
    typeTemp('8')
    fireEvent.change(screen.getByLabelText('Motif de la correction (obligatoire)'), { target: { value: 'Valeur mal lue' } })
    press('Enregistrer la correction')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    fireEvent.click(screen.getByRole('radio', { name: /Produits jetés/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Historique des relevés' })
    const [corr] = await core.listRecords({ type: 'correction' })
    const [action] = await core.listRecords({ type: 'corrective_action' })
    expect(action.payload).toMatchObject({ related_record_id: corr.id, action: 'discard' })
  })
})
