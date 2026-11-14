import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore, typePin, unlockAs } from '../../ui/testUtils.tsx'

afterEach(() => {
  vi.useRealTimers()
})

describe('Écran de verrouillage', () => {
  it('affiche les équipiers avec leurs initiales', async () => {
    renderWithCore(createFakeCore({ enrolled: true }))
    expect(await screen.findByRole('radio', { name: /Gérant/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Équipier/ })).toBeInTheDocument()
    // Pavé désactivé tant qu'aucun équipier n'est choisi.
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
  })

  it('déverrouille avec le bon PIN et affiche l’accueil', async () => {
    const core = createFakeCore({ enrolled: true })
    renderWithCore(core)
    await unlockAs('Gérant', '123456')
    expect(await screen.findByRole('heading', { name: 'Aujourd’hui' })).toBeInTheDocument()
    expect(core.currentStaff()?.display_name).toBe('Gérant')
    expect(screen.getByRole('button', { name: /Verrouiller/ })).toBeInTheDocument()
  })

  it('annonce « PIN incorrect » et vide la saisie', async () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    renderWithCore(createFakeCore({ enrolled: true }))
    await unlockAs('Équipier', '111111')
    expect(await screen.findByText('PIN incorrect')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('PIN incorrect')
    expect(screen.getByRole('button', { name: 'Valider le code' })).toBeDisabled()
    expect(vibrate).toHaveBeenCalled()
  })

  it('bloque après 5 essais et affiche un compte à rebours', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderWithCore(createFakeCore({ enrolled: true }))
    fireEvent.click(await screen.findByRole('radio', { name: /Équipier/ }))
    for (let i = 0; i < 4; i++) {
      typePin('000000')
      await screen.findByText('PIN incorrect')
    }
    typePin('000000')
    expect(await screen.findByText('Bloqué, réessayez dans 5 min 0 s')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(28_000)
    })
    expect(screen.getByText(/Bloqué, réessayez dans 4 min 3\d s/)).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(screen.queryByText(/Bloqué/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled()
  })

  it('verrouille au bouton « Verrouiller »', async () => {
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant' }))
    fireEvent.click(await screen.findByRole('button', { name: /Verrouiller/ }))
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeInTheDocument()
  })
})
