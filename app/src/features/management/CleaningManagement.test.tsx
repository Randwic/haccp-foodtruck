import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createCore } from '../../core/core.ts'
import { createMockTransport, DEMO_CHECKLISTS, DEMO_DEVICE } from '../../core/mockTransport.ts'
import { uniqueDbName } from '../../core/testUtils.ts'
import { checklistItemId, normalizeChecklistInput, normalizeCleaningTaskInput } from '../../manager/helpers.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { draftToItems } from './ChecklistSection.tsx'

function setup() {
  const manager = createMockManagerApi({ seeded: true, signedIn: true })
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null })
  renderWithCore(core, undefined, manager)
  return manager
}
async function openTab(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: /^Gestion/ }))
  fireEvent.click(await screen.findByRole('tab', { name }))
}

describe('aides : identifiants de points et règles de la base', () => {
  it('slug stable et unique', () => {
    expect(checklistItemId('Lave-mains approvisionné (savon, papier)', [])).toBe('lave_mains_approvisionne_savon_papie')
    expect(checklistItemId('Œufs  à 4 °C', [])).toBe('oeufs_a_4_c')
    expect(checklistItemId('Gaz coupé', ['gaz_coupe'])).toBe('gaz_coupe_2')
    expect(checklistItemId('!!!', [])).toBe('point')
    expect(checklistItemId('x'.repeat(80), []).length).toBeLessThanOrEqual(40)
    // Les ids existants sont gardés, les nouveaux évitent les doublons.
    expect(draftToItems([
      { key: '1', id: 'gaz', label: 'Gaz coupé et vanne fermée', required: true },
      { key: '2', label: 'Gaz', required: false },
      { key: '3', label: 'Gaz', required: false },
    ]).map((i) => i.id)).toEqual(['gaz', 'gaz_2', 'gaz_3'])
  })

  it('validations', () => {
    expect(normalizeCleaningTaskInput({ name: '  ', frequency: 'daily' })).toMatchObject({ ok: false, field: 'name' })
    expect(normalizeCleaningTaskInput({ name: 'Sols', product: '  ', method: 'x'.repeat(501) })).toMatchObject({ ok: false, field: 'method' })
    expect(normalizeCleaningTaskInput({ name: ' Sols ', product: ' ' })).toEqual({ ok: true, value: { name: 'Sols', product: null } })
    expect(normalizeChecklistInput({ items: [] })).toMatchObject({ ok: false, field: 'items' })
    expect(normalizeChecklistInput({ items: [{ id: 'a', label: 'A', required: true }, { id: 'a', label: 'B', required: false }] })).toMatchObject({ ok: false, message: 'Point 2 : identifiant en double.' })
    expect(normalizeChecklistInput({ items: [{ id: 'A b', label: 'A', required: true }] })).toMatchObject({ ok: false })
  })
})

describe('Gestion › Nettoyage', () => {
  it('ajout (fréquence, produit, méthode), modification, désactivation puis réactivation', async () => {
    const manager = setup()
    await openTab('Nettoyage')
    await screen.findByText('Plans de travail')
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une tâche' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter une tâche' })
    fireEvent.change(within(dialog).getByLabelText('Zone ou équipement'), { target: { value: 'Bacs gastronormes' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Après chaque service' }))
    fireEvent.change(within(dialog).getByLabelText('Produit utilisé (facultatif)'), { target: { value: 'Détergent-désinfectant' } })
    fireEvent.change(within(dialog).getByLabelText('Mode opératoire (facultatif)'), { target: { value: 'Laver, désinfecter, sécher.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await screen.findByText('Bacs gastronormes')
    const added = manager.simulate.state().cleaning_tasks.find((t) => t.name === 'Bacs gastronormes')
    expect(added).toMatchObject({ frequency: 'after_service', product: 'Détergent-désinfectant', method: 'Laver, désinfecter, sécher.', active: true })

    fireEvent.click(screen.getByRole('button', { name: 'Modifier – Bacs gastronormes' }))
    const edit = await screen.findByRole('dialog')
    fireEvent.click(within(edit).getByRole('radio', { name: 'Tous les jours' }))
    fireEvent.click(within(edit).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(manager.simulate.state().cleaning_tasks.find((t) => t.id === added!.id)?.frequency).toBe('daily'))

    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver – Bacs gastronormes' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Désactiver' }))
    await screen.findByRole('button', { name: 'Réactiver – Bacs gastronormes' })
    expect(manager.simulate.state().cleaning_tasks.find((t) => t.id === added!.id)?.active).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Réactiver – Bacs gastronormes' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Réactiver' }))
    await screen.findByRole('button', { name: 'Désactiver – Bacs gastronormes' })
    expect(manager.simulate.state().cleaning_tasks).toHaveLength(12) // jamais de suppression
  })
})

describe('Gestion › Checklists', () => {
  it('nouvelle checklist : points ordonnés, point critique, retrait ; ids en slug unique', async () => {
    const manager = setup()
    await openTab('Checklists')
    await screen.findByRole('heading', { name: 'Ouverture' })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une checklist' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter une checklist' })
    fireEvent.change(within(dialog).getByLabelText('Nom de la checklist'), { target: { value: 'Livraison eau' } })
    fireEvent.change(within(dialog).getByLabelText('Point 1'), { target: { value: 'Bidons propres' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter un point' }))
    fireEvent.change(within(dialog).getByLabelText('Point 2'), { target: { value: 'Robinet désinfecté' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter un point' }))
    fireEvent.change(within(dialog).getByLabelText('Point 3'), { target: { value: 'À retirer' } })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Point critique – point 2' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Monter le point 2' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer le point 3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await screen.findByRole('heading', { name: 'Livraison eau' })
    const c = manager.simulate.state().checklists.find((x) => x.name === 'Livraison eau')
    expect(c).toMatchObject({
      kind: 'other',
      active: true,
      items: [
        { id: 'robinet_desinfecte', label: 'Robinet désinfecté', required: false },
        { id: 'bidons_propres', label: 'Bidons propres', required: true },
      ],
    })
  })

  it('modifier une checklist existante : les ids des points ne changent pas ; nouveau point ajouté', async () => {
    const manager = setup()
    await openTab('Checklists')
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier – Fermeture' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Point 6'), { target: { value: 'Gaz coupé, bouteille fermée' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter un point' }))
    fireEvent.change(within(dialog).getByLabelText('Point 8'), { target: { value: 'Gaz coupé' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(manager.simulate.state().checklists.find((c) => c.kind === 'closing')!.items).toHaveLength(8))
    const items = manager.simulate.state().checklists.find((c) => c.kind === 'closing')!.items
    expect(items.map((i) => i.id)).toEqual([...DEMO_CHECKLISTS[1].items.map((i) => i.id), 'gaz_coupe'])
    expect(items[5]).toEqual({ id: 'gaz', label: 'Gaz coupé, bouteille fermée', required: true })
  })

  it('répercussion dans la base locale de l’appareil (vrai core + serveur simulé)', async () => {
    const server = createMockTransport()
    const manager = createMockManagerApi({ seeded: true, signedIn: true, transport: server })
    const core = createCore({ transport: server, dbName: uniqueDbName() })
    await core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad' })
    await manager.updateChecklist(DEMO_CHECKLISTS[2].id, { active: false })
    await manager.addCleaningTask({ name: 'Bacs gastronormes', frequency: 'after_service', product: null, method: null })
    await core.syncNow()
    expect((await core.listChecklists()).map((c) => c.name)).toEqual(['Fermeture', 'Ouverture'])
    expect((await core.listCleaningTasks()).map((t) => t.name)).toContain('Bacs gastronormes')
  })
})
