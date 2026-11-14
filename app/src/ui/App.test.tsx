import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App.tsx'
import { createFakeCore } from './fakeCore.ts'
import './testUtils.tsx'

describe('<App />', () => {
  it('monte l’app complète (core injecté, bannières PWA)', async () => {
    const core = createFakeCore({ enrolled: true })
    render(<App core={core} />)
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeInTheDocument()
    // Non installée (navigateur de test) : la bannière d'installation est proposée.
    expect(screen.getByRole('complementary', { name: 'Installation' })).toBeInTheDocument()
  })

  it('affiche le bandeau hors-ligne', async () => {
    const core = createFakeCore({ enrolled: true })
    render(<App core={core} />)
    await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })
    act(() => core.simulate.setOnline(false))
    expect(screen.getByText('Hors-ligne – vos saisies sont enregistrées sur l’appareil')).toBeInTheDocument()
  })
})
