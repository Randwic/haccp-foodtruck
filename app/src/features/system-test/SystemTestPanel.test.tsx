import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

describe('Test d’enregistrement', () => {
  it('crée un system_test signé par l’équipier, en attente puis synchronisé', async () => {
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', autoSyncDelayMs: null })
    renderWithCore(core)

    // Les modules à venir sont désactivés avec la mention « Bientôt ».
    expect(await screen.findByRole('button', { name: 'Refroidissement (Bientôt)' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Test d’enregistrement/ }))
    expect(await screen.findByText('Aucun enregistrement pour l’instant.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Créer un enregistrement test' }))
    const list = await screen.findByRole('list', { name: 'Derniers enregistrements' })
    const item = within(list).getAllByRole('listitem')[0]
    expect(item).toHaveTextContent('Équipier')
    expect(item).toHaveTextContent('Test système')
    expect(item).toHaveTextContent('En attente')
    expect(screen.getByRole('button', { name: /1 saisie en attente/ })).toBeInTheDocument()

    const [rec] = await core.listRecords({ type: 'system_test' })
    expect(rec).toMatchObject({ type: 'system_test', author_id: 'staff-equipier', device_seq: 1 })

    await act(async () => core.simulate.flush())
    expect(await within(list).findByText('Synchronisé')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tout est synchronisé/ })).toBeInTheDocument()
  })
})
