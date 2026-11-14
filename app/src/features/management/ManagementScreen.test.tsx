import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCore, createMockTransport, DEMO_PINS, DEMO_STAFF, type Core } from '../../core/index.ts'
import { uniqueDbName } from '../../core/testUtils.ts'
import { createMockManagerApi, type MockManagerApi } from '../../manager/index.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore, typePin, unlockAs } from '../../ui/testUtils.tsx'

const opened: Core[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (opened.length) await opened.pop()!.dispose()
})

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function openManagement(manager: MockManagerApi = createMockManagerApi({ seeded: true, signedIn: true })) {
  renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant' }), undefined, manager)
  fireEvent.click(await screen.findByRole('button', { name: /Gestion/ }))
  await screen.findByRole('heading', { name: 'Gestion' })
  return manager
}

describe('Gestion – accès', () => {
  it('la tuile Gestion est invisible pour un équipier', async () => {
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier' }))
    expect(await screen.findByRole('heading', { name: 'Aujourd’hui' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gestion/ })).toBeNull()
  })

  it('visible pour le gérant ; sans session, demande le mot de passe gérant', async () => {
    const manager = createMockManagerApi({ seeded: true })
    await openManagement(manager)
    expect(await screen.findByRole('heading', { name: 'Mot de passe gérant' })).toBeInTheDocument()
    type('Email', 'gerant@demo.fr')
    type('Mot de passe', 'faux-mot-de-passe')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Email ou mot de passe incorrect.')).toBeInTheDocument()
    type('Mot de passe', 'demo-demo-demo')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByRole('tab', { name: 'Équipements' })).toBeInTheDocument()
  })

  it('session expirée pendant l’usage : redemande le mot de passe', async () => {
    const manager = await openManagement()
    await screen.findByText('Frigo 1')
    manager.simulate.expireSession()
    fireEvent.click(screen.getByRole('tab', { name: 'Équipe' }))
    expect(await screen.findByRole('heading', { name: 'Mot de passe gérant' })).toBeInTheDocument()
    expect(screen.getByText(/session gérant a expiré/)).toBeInTheDocument()
  })

  it('hors-ligne : explique que la gestion nécessite Internet', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await openManagement()
    expect(screen.getByText('La gestion nécessite une connexion Internet.')).toBeInTheDocument()
  })
})

describe('Gestion – équipements', () => {
  it('ajoute un frigo avec le seuil prérempli (max 4 °C)', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un équipement' }))
    const dialog = screen.getByRole('dialog', { name: 'Ajouter un équipement' })
    expect(within(dialog).getByLabelText('Maximum')).toHaveValue('4')
    expect(within(dialog).getByText(/à confirmer selon votre PMS/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Congélateur/ }))
    expect(within(dialog).getByLabelText('Maximum')).toHaveValue('-18')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Frigo/ }))
    fireEvent.change(within(dialog).getByLabelText('Nom'), { target: { value: 'Saladette' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))

    expect(await screen.findByText('« Saladette » ajouté')).toBeInTheDocument()
    const card = (await screen.findByRole('heading', { name: 'Saladette' })).closest('li')!
    expect(card).toHaveTextContent(/max 4\s°C · tolérance 20\smin/)
    const eq = manager.simulate.state().equipment.find((e) => e.name === 'Saladette')!
    expect(manager.simulate.state().thresholds).toContainEqual(expect.objectContaining({ equipment_id: eq.id, check_type: 'temperature_check', max_c: 4, min_c: null }))
  })

  it('refuse un nom vide et une température illisible', async () => {
    await openManagement()
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un équipement' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Maximum'), { target: { value: 'abc' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    expect(within(dialog).getByText(/Donnez un nom/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Nombre attendu/)).toBeInTheDocument()
  })

  it('retire un équipement du service (avec confirmation) puis le remet en service', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer du service – Frigo 2' }))
    const dialog = screen.getByRole('dialog', { name: 'Retirer du service ?' })
    expect(dialog).toHaveTextContent('L’historique est conservé')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer du service' }))
    expect(await screen.findByRole('button', { name: 'Remettre en service – Frigo 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Retirés du service/ })).toBeInTheDocument()
    expect(manager.simulate.state().equipment.find((e) => e.name === 'Frigo 2')?.active).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Remettre en service – Frigo 2' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remettre en service' }))
    expect(await screen.findByRole('button', { name: 'Retirer du service – Frigo 2' })).toBeInTheDocument()
    expect(manager.simulate.state().equipment.find((e) => e.name === 'Frigo 2')?.active).toBe(true)
  })

  it('renomme un équipement', async () => {
    await openManagement()
    fireEvent.click(await screen.findByRole('button', { name: 'Renommer – Frigo 1' }))
    fireEvent.change(screen.getByLabelText('Nouveau nom'), { target: { value: 'Frigo boissons' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('heading', { name: 'Frigo boissons' })).toBeInTheDocument()
  })

  it('modifie le seuil du congélateur (bouton ± pour le signe moins)', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('button', { name: 'Seuils – Congélateur' }))
    const dialog = screen.getByRole('dialog', { name: 'Seuils – Congélateur' })
    const max = within(dialog).getByLabelText('Maximum')
    expect(max).toHaveValue('-18')
    fireEvent.change(max, { target: { value: '20' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Changer le signe – Maximum' }))
    expect(max).toHaveValue('-20')
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '-10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le seuil' }))
    expect(within(dialog).getByText(/maximum doit être supérieur/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('Tolérance (minutes)'), { target: { value: '45' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le seuil' }))
    expect(await screen.findByText('Seuil de « Congélateur » enregistré')).toBeInTheDocument()
    const card = screen.getByRole('heading', { name: 'Congélateur' }).closest('li')!
    expect(card).toHaveTextContent(/max −20\s°C · tolérance 45\smin/)
    const th = manager.simulate.state().thresholds.filter((t) => t.check_type === 'temperature_check' && t.max_c === -20)
    expect(th).toHaveLength(1)
    expect(th[0].tolerance_minutes).toBe(45)
  })
})

describe('Gestion – équipe', () => {
  it('ajoute un employé avec un PIN saisi deux fois (seul le hash est envoyé)', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('tab', { name: 'Équipe' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un employé' }))
    fireEvent.change(screen.getByLabelText('Prénom et nom'), { target: { value: 'Léa Dupont' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByText('Choisissez un code PIN pour Léa Dupont')).toBeInTheDocument()
    typePin('2580')
    await screen.findByText('Confirmez le code PIN')
    typePin('2580')
    expect(await screen.findByText('Léa Dupont a été ajouté à l’équipe')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Léa Dupont' })).toBeInTheDocument()
    const lea = manager.simulate.state().staff.find((s) => s.display_name === 'Léa Dupont')!
    expect(lea).toMatchObject({ role: 'staff', active: true })
    expect(lea.pin_hash).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(lea.pin_salt).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it('désactive puis réactive un employé ; impossible de se désactiver soi-même', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('tab', { name: 'Équipe' }))
    await screen.findByRole('button', { name: 'Désactiver – Équipier' })
    expect(screen.queryByRole('button', { name: 'Désactiver – Gérant' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Désactiver – Équipier' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }))
    expect(await screen.findByRole('button', { name: 'Réactiver – Équipier' })).toBeInTheDocument()
    expect(manager.simulate.state().staff.find((s) => s.display_name === 'Équipier')?.active).toBe(false)
  })
})

describe('Gestion – réglages', () => {
  it('modifie le nom et le délai de verrouillage (1 à 30 min)', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('tab', { name: 'Réglages' }))
    const name = await screen.findByLabelText('Nom de l’établissement')
    fireEvent.change(name, { target: { value: 'Chez Lulu' } })
    for (let i = 0; i < 40; i++) fireEvent.click(screen.getByRole('button', { name: 'Augmenter d’une minute' }))
    expect(screen.getByText('30 min')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Augmenter d’une minute' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }))
    expect(await screen.findByText('Réglages enregistrés')).toBeInTheDocument()
    expect(manager.simulate.state()).toMatchObject({ establishment_name: 'Chez Lulu', auto_lock_minutes: 30 })
  })

  it('heures des relevés : 1 à 6 heures HH:MM, sans doublon, enregistrées triées', async () => {
    const manager = await openManagement()
    fireEvent.click(await screen.findByRole('tab', { name: 'Réglages' }))
    expect(await screen.findByLabelText('Heure de relevé 1')).toHaveValue('08:00')
    expect(screen.getByLabelText('Heure de relevé 2')).toHaveValue('18:00')

    // Doublon refusé.
    fireEvent.change(screen.getByLabelText('Heure de relevé 2'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }))
    expect(await screen.findByText('Chaque heure ne doit apparaître qu’une fois.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Heure de relevé 2'), { target: { value: '19:30' } })
    const add = screen.getByRole('button', { name: 'Ajouter une heure' })
    fireEvent.click(add)
    expect(screen.getByLabelText('Heure de relevé 3')).toHaveValue('12:00')
    for (let i = 0; i < 3; i++) fireEvent.click(add)
    expect(screen.getByLabelText('Heure de relevé 6')).toBeInTheDocument()
    expect(add).toBeDisabled()
    for (const t of ['19:30', '14:00', '10:00', '16:00']) fireEvent.click(screen.getByRole('button', { name: `Retirer l’heure ${t}` }))
    fireEvent.change(screen.getByLabelText('Heure de relevé 2'), { target: { value: '06:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }))
    expect(await screen.findByText('Réglages enregistrés')).toBeInTheDocument()
    expect(manager.simulate.state().daily_check_times).toEqual(['06:15', '08:00'])

    // Au moins une heure : la dernière ne peut pas être retirée.
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’heure 06:15' }))
    expect(screen.getByRole('button', { name: 'Retirer l’heure 08:00' })).toBeDisabled()
  })

  it('le mock du ManagerApi refuse des heures invalides', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    await expect(manager.saveSettings({ daily_check_times: [] })).rejects.toThrow(/1 à 6/)
    await expect(manager.saveSettings({ daily_check_times: ['8:00'] })).rejects.toThrow(/HH:MM/)
    await expect(manager.saveSettings({ daily_check_times: ['08:00', '08:00'] })).rejects.toThrow(/une fois/)
    expect((await manager.saveSettings({ daily_check_times: ['18:00', '07:45'] })).daily_check_times).toEqual(['07:45', '18:00'])
  })
})

describe('Gestion – répercussion sur l’appareil (vrai core + serveur simulé)', () => {
  it('un équipement ajouté et un employé désactivé arrivent dans la base locale après synchro', async () => {
    const server = createMockTransport()
    const manager = createMockManagerApi({ transport: server, seeded: true, signedIn: true })
    const core = createCore({ transport: server, dbName: uniqueDbName(), background: false })
    opened.push(core)
    const dev = server.enrollDevice('iPad')
    await core.enrollDevice({ ...dev, name: 'iPad' })
    renderWithCore(core, undefined, manager)
    await unlockAs('Gérant', DEMO_PINS.manager)
    fireEvent.click(await screen.findByRole('button', { name: /Gestion/ }, { timeout: 5000 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un équipement' }))
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Frigo 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    await screen.findByRole('heading', { name: 'Frigo 3' })
    await waitFor(async () => expect((await core.listEquipment()).map((e) => e.name)).toContain('Frigo 3'))
    const eq = (await core.listEquipment()).find((e) => e.name === 'Frigo 3')!
    await waitFor(async () => expect(await core.listThresholds()).toContainEqual(expect.objectContaining({ equipment_id: eq.id, max_c: 4 })))

    fireEvent.click(screen.getByRole('tab', { name: 'Équipe' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver – Équipier' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }))
    await waitFor(async () => expect((await core.listStaff()).map((s) => s.id)).not.toContain(DEMO_STAFF[1].id))
  }, 20_000)

  it('les heures de relevé enregistrées arrivent dans les réglages de l’appareil', async () => {
    const server = createMockTransport()
    const manager = createMockManagerApi({ transport: server, seeded: true, signedIn: true })
    const core = createCore({ transport: server, dbName: uniqueDbName(), background: false })
    opened.push(core)
    const dev = server.enrollDevice('iPad')
    await core.enrollDevice({ ...dev, name: 'iPad' })
    await manager.saveSettings({ daily_check_times: ['07:30', '12:00', '19:00'] })
    await core.syncNow()
    expect((await core.getSettings())?.daily_check_times).toEqual(['07:30', '12:00', '19:00'])
  })
})
