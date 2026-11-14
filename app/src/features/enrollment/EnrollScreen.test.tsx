import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

const VALID_ID = '3f2a9c1e-1b2c-4d5e-8f90-123456789abc'

function fill(name: string, id: string, token: string) {
  fireEvent.change(screen.getByLabelText('Nom de l’appareil'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Identifiant d’appareil'), { target: { value: id } })
  fireEvent.change(screen.getByLabelText('Jeton d’appareil'), { target: { value: token } })
}

async function openAdvanced() {
  fireEvent.click(await screen.findByRole('button', { name: 'Configuration avancée' }))
  await screen.findByRole('heading', { name: 'Configuration avancée' })
}

describe('Configuration avancée (enrôlement manuel)', () => {
  it('s’ouvre depuis la connexion gérant et valide les champs', async () => {
    renderWithCore(createFakeCore())
    await openAdvanced()

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’appareil' }))
    expect(screen.getByText(/Donnez un nom à cet appareil/)).toBeInTheDocument()
    expect(screen.getByLabelText('Nom de l’appareil')).toHaveAttribute('aria-invalid', 'true')

    fill('iPad cuisine', 'pas-un-uuid', 'jeton-secret-123')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’appareil' }))
    expect(screen.getByText(/Format attendu/)).toBeInTheDocument()
  })

  it('affiche clairement l’erreur renvoyée par le core', async () => {
    renderWithCore(createFakeCore())
    await openAdvanced()
    fill('iPad cuisine', VALID_ID, 'invalide')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’appareil' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Jeton d’appareil refusé')
  })

  it('passe à l’écran de verrouillage après un enrôlement réussi', async () => {
    const core = createFakeCore()
    renderWithCore(core)
    await openAdvanced()
    fill('iPad cuisine', VALID_ID, 'jeton-secret-123')
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’appareil' }))
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeInTheDocument()
    expect(await core.getDevice()).toMatchObject({ device_id: VALID_ID, name: 'iPad cuisine' })
  })
})

describe('Configuration avancée – retour', () => {
  it('revient à la connexion gérant', async () => {
    renderWithCore(createFakeCore())
    await openAdvanced()
    fireEvent.click(screen.getByRole('button', { name: '← Retour' }))
    expect(await screen.findByRole('heading', { name: 'Connexion gérant' })).toBeInTheDocument()
  })
})
