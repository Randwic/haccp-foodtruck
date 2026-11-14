import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCore, createMockTransport, type Core } from '../../core/index.ts'
import { uniqueDbName } from '../../core/testUtils.ts'
import { createMockManagerApi, MOCK_MANAGER_ACCOUNT, withEstablishmentName } from '../../manager/index.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore, typePin, unlockAs } from '../../ui/testUtils.tsx'

const opened: Core[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (opened.length) await opened.pop()!.dispose()
})

/** Vrai core (IndexedDB simulée) + serveur simulé + espace gérant simulé branché dessus, comme main.tsx. */
function realStack(seeded = false) {
  const server = createMockTransport({ seed: seeded })
  const manager = createMockManagerApi({ transport: server, seeded })
  const core = createCore({ transport: withEstablishmentName(server, () => manager.simulate.state().establishment_name), dbName: uniqueDbName(), background: false })
  opened.push(core)
  return { server, manager, core }
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function fillBootstrapUntilDevice() {
  expect(await screen.findByRole('heading', { name: 'Créer votre compte gérant' })).toBeInTheDocument()
  type('Nom de l’établissement', 'Chez Lulu')
  type('Votre prénom et nom', 'Lucie Martin')
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
  type('Email', 'Lucie@Exemple.fr')
  type('Mot de passe', 'trois mots secrets')
  type('Confirmez le mot de passe', 'trois mots secrets')
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
  expect(await screen.findByText('Choisissez un code PIN')).toBeInTheDocument()
  typePin('246810')
  expect(await screen.findByText('Confirmez le code PIN')).toBeInTheDocument()
  typePin('246810')
  expect(await screen.findByLabelText('Nom de cet appareil')).toBeInTheDocument()
}

describe('Premier lancement – création du compte gérant', () => {
  it('crée le compte, se connecte, enrôle l’appareil, synchronise ; le gérant se déverrouille avec son PIN et voit la Gestion', async () => {
    const { manager, core } = realStack()
    renderWithCore(core, undefined, manager)
    await fillBootstrapUntilDevice()
    expect(screen.getByText(/fermée définitivement/)).toBeInTheDocument()
    type('Nom de cet appareil', 'iPad cuisine')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))

    // Écran de verrouillage avec le nouveau gérant, récupéré par la synchro.
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Lucie Martin/ })).toBeInTheDocument()
    expect(await core.getDevice()).toMatchObject({ name: 'iPad cuisine' })
    expect((await core.getEstablishment())?.name).toBe('Chez Lulu')
    expect(manager.simulate.state()).toMatchObject({ bootstrapped: true, account: { email: 'lucie@exemple.fr' } })
    // Le PIN n'est jamais transmis en clair.
    expect(JSON.stringify(manager.simulate.state())).not.toContain('246810')

    await unlockAs('Lucie Martin', '246810')
    fireEvent.click(await screen.findByRole('button', { name: /Gestion/ }, { timeout: 5000 }))
    expect(await screen.findByRole('heading', { name: 'Gestion' })).toBeInTheDocument()
    expect(await screen.findByText(/Aucun équipement en service/)).toBeInTheDocument()
  }, 20_000)

  it('valide mot de passe (≥ 12 caractères, confirmation) et refuse un PIN trop simple', async () => {
    renderWithCore(createFakeCore(), undefined, createMockManagerApi())
    await screen.findByRole('heading', { name: 'Créer votre compte gérant' })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByText('Indiquez le nom de votre food truck.')).toBeInTheDocument()
    type('Nom de l’établissement', 'Chez Lulu')
    type('Votre prénom et nom', 'Lucie')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    type('Email', 'lucie@exemple.fr')
    type('Mot de passe', 'court')
    expect(screen.getByText('Force du mot de passe : Trop court (5/12)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByText(/Au moins 12 caractères/)).toBeInTheDocument()
    type('Mot de passe', 'un long mot de passe')
    type('Confirmez le mot de passe', 'un autre mot de passe')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByText('Les deux mots de passe ne correspondent pas.')).toBeInTheDocument()
    type('Confirmez le mot de passe', 'un long mot de passe')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await screen.findByText('Choisissez un code PIN')
    typePin('123456')
    expect(await screen.findByText(/Code trop facile à deviner/)).toBeInTheDocument()
    typePin('135790')
    await screen.findByText('Confirmez le code PIN')
    typePin('135791')
    expect(await screen.findByText(/ne correspondent pas/)).toBeInTheDocument()
    expect(screen.getByText('Choisissez un code PIN')).toBeInTheDocument()
  })

  it('compte déjà créé ailleurs (409) : bascule vers « Connexion gérant » avec l’email prérempli', async () => {
    const manager = createMockManagerApi()
    renderWithCore(createFakeCore(), undefined, manager)
    await fillBootstrapUntilDevice()
    manager.simulate.failNext('already_bootstrapped')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(await screen.findByRole('heading', { name: 'Connexion gérant' })).toBeInTheDocument()
    expect(screen.getByText(/Un compte gérant existe déjà/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('lucie@exemple.fr')
  })

  it('trop de tentatives (429) : message lisible, on reste sur l’écran', async () => {
    const manager = createMockManagerApi()
    renderWithCore(createFakeCore(), undefined, manager)
    await fillBootstrapUntilDevice()
    manager.simulate.failNext('rate_limited')
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(await screen.findByText(/Trop de tentatives/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Créer mon compte' })).toBeInTheDocument()
  })
})

describe('Premier lancement – connexion gérant (compte existant)', () => {
  it('mauvais mot de passe : erreur lisible, aucun appareil enrôlé', async () => {
    const core = createFakeCore()
    renderWithCore(core, undefined, createMockManagerApi({ seeded: true }))
    expect(await screen.findByRole('heading', { name: 'Connexion gérant' })).toBeInTheDocument()
    type('Email', MOCK_MANAGER_ACCOUNT.email)
    type('Mot de passe', 'pas le bon mot de passe')
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter et enregistrer l’appareil' }))
    expect(await screen.findByText('Email ou mot de passe incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('')
    expect(await core.getDevice()).toBeNull()
  })

  it('connexion réussie : enrôle l’appareil (nom modifiable) puis affiche l’écran de verrouillage', async () => {
    const { manager, core } = realStack(true)
    renderWithCore(core, undefined, manager)
    await screen.findByRole('heading', { name: 'Connexion gérant' })
    expect(screen.getByText('Food truck (démo)')).toBeInTheDocument()
    type('Email', MOCK_MANAGER_ACCOUNT.email)
    type('Mot de passe', MOCK_MANAGER_ACCOUNT.password)
    type('Nom de cet appareil', 'iPhone de Lucie')
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter et enregistrer l’appareil' }))
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Équipier/ })).toBeInTheDocument()
    expect(await core.getDevice()).toMatchObject({ name: 'iPhone de Lucie' })
  })

  it('hors-ligne : demande de connecter l’appareil à Internet, puis reprend au retour du réseau', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderWithCore(createFakeCore(), undefined, createMockManagerApi({ seeded: true }))
    expect(await screen.findByText('Connectez l’appareil à Internet pour la première configuration.')).toBeInTheDocument()
    spy.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion gérant' })).toBeInTheDocument())
  })

  it('serveur injoignable : message et bouton Réessayer', async () => {
    const manager = createMockManagerApi({ seeded: true })
    manager.simulate.setOffline(true)
    renderWithCore(createFakeCore(), undefined, manager)
    expect(await screen.findByText(/Serveur injoignable/)).toBeInTheDocument()
    manager.simulate.setOffline(false)
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { name: 'Connexion gérant' })).toBeInTheDocument()
  })
})
