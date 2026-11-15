import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChecklistDonePayload, CleaningDonePayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_CHECKLISTS, DEMO_CLEANING_TASKS } from '../../core/mockTransport.ts'
import { syntheticWebp, type PhotoEncoder } from '../../core/photoEncoder.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

// Dimanche 15/11/2026 10:00 à Paris (après le premier relevé de 08:00).
const NOW = '2026-11-15T09:00:00.000Z'
const task = (suffix: string) => DEMO_CLEANING_TASKS.find((t) => t.id.endsWith(suffix))!
const [OPENING, CLOSING] = DEMO_CHECKLISTS

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const encoder: PhotoEncoder = vi.fn(async () => ({ bytes: syntheticWebp(2000), width: 1600, height: 1200, encoder: 'native' as const, quality: 0.82 }))
function setup(opts: FakeCoreOptions = {}) {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', autoSyncDelayMs: null, photoEncoder: encoder, ...opts })
  renderWithCore(core)
  return core
}
const daysAgo = (d: number, h = 12) => new Date(Date.parse(NOW) - d * 86_400_000 + (h - 10) * 3_600_000).toISOString()
const seed = (type: FakeRecordSeed['type'], when: string, payload: Record<string, unknown>, extra: Partial<FakeRecordSeed> = {}): FakeRecordSeed => ({ type, author_id: 'staff-equipier', device_time: when, payload, ...extra })
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const last = async (core: ReturnType<typeof createFakeCore>, type: 'cleaning_done' | 'checklist_done' | 'correction') => (await core.listRecords({ type }))[0]

async function openCleaning() {
  fireEvent.click(await screen.findByRole('button', { name: /^Nettoyage :/ }))
  await screen.findByRole('heading', { name: 'Nettoyage', level: 1 })
}

describe('Nettoyage — accueil', () => {
  it('tuile : tâches à faire et checklists à faire ; rappels d’ouverture (en retard après 08:00) et de nuisibles', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Nettoyage : 11 tâches à faire, 2 checklists à faire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checklist Ouverture — En retard : à faire avant le relevé de 08:00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checklist Contrôle nuisibles — À faire cette semaine' })).toBeInTheDocument()
    // La fermeture n'est rappelée qu'après le dernier relevé (18:00).
    expect(screen.queryByRole('button', { name: /^Checklist Fermeture/ })).toBeNull()
  })

  it('tâches en retard : ambre puis rouge sur la tuile et dans la liste', async () => {
    setup({
      initialRecords: [
        seed('cleaning_done', daysAgo(4), { task_id: task('507').id }), // Sols (quotidien) : 3 jours de retard → rouge
        seed('cleaning_done', daysAgo(2), { task_id: task('508').id }), // Poubelles : 1 jour → ambre
      ],
    })
    expect(await screen.findByRole('button', { name: /^Nettoyage : 1 tâche très en retard, 1 tâche en retard, 9 tâches à faire/ })).toBeInTheDocument()
    await openCleaning()
    expect(screen.getByRole('button', { name: 'Sols — En retard de 3 jours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Poubelles — En retard de 1 jour' })).toBeInTheDocument()
    // Le plus urgent d'abord.
    const rows = within(screen.getByRole('heading', { name: /À faire maintenant/ }).parentElement!).getAllByRole('button')
    expect(rows[0]).toHaveAccessibleName('Sols — En retard de 3 jours')
  })
})

describe('Nettoyage — saisie', () => {
  it('tâche → fiche (produit, méthode) → « Fait » avec commentaire et photo → cleaning_done', async () => {
    const core = setup()
    await openCleaning()
    press('Plans de travail — À faire après le service')
    await screen.findByRole('heading', { name: 'Plans de travail', level: 1 })
    expect(screen.getByText('Détergent-désinfectant contact alimentaire')).toBeInTheDocument()
    expect(screen.getByText(/temps de contact du fabricant/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Commentaire (facultatif)'), { target: { value: 'Bac à sauces aussi' } })
    fireEvent.change(screen.getByLabelText('Prendre une photo — Photos'), { target: { files: [new File([new Uint8Array(500)], 'p.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('button', { name: /^Photos 1/ })
    press('Fait')
    await screen.findByRole('heading', { name: 'Nettoyage', level: 1 })
    const p = (await last(core, 'cleaning_done')).payload as unknown as CleaningDonePayload
    expect(p).toMatchObject({ task_id: task('501').id, comment: 'Bac à sauces aussi' })
    expect(p.photo_paths).toHaveLength(1)
    expect(validatePayload('cleaning_done', p)).toEqual({ ok: true })
    expect((await core.getPhotoStatuses(p.photo_paths!))[p.photo_paths![0]].state).toBe('pending')
    expect(await screen.findByRole('button', { name: 'Plans de travail — Fait aujourd’hui à 10:00' })).toBeInTheDocument()
  })

  it('checklist depuis le rappel : un « Non » exige un commentaire ; all_ok = false', async () => {
    const core = setup()
    fireEvent.click(await screen.findByRole('button', { name: /^Checklist Ouverture/ }))
    await screen.findByRole('heading', { name: 'Ouverture', level: 1 })
    expect(screen.getAllByText('Point critique')).toHaveLength(OPENING.items.length)
    const save = screen.getByRole('button', { name: 'Enregistrer la checklist' })
    for (const item of OPENING.items) {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: item.label })).getByRole('radio', { name: item.id === 'eau_potable' ? 'Non' : 'Oui' }))
    }
    expect(save).toBeDisabled()
    expect(screen.getByText(/À compléter : 1 commentaire pour un « Non »/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Commentaire (obligatoire)'), { target: { value: 'Réservoir vide : rempli au point d’eau' } })
    fireEvent.click(save)
    await screen.findByRole('heading', { name: 'Nettoyage', level: 1 })
    const p = (await last(core, 'checklist_done')).payload as unknown as ChecklistDonePayload
    expect(validatePayload('checklist_done', p)).toEqual({ ok: true })
    expect(p.all_ok).toBe(false)
    expect(p.answers).toHaveLength(6)
    expect(p.answers.find((a) => a.item_id === 'eau_potable')).toEqual({ item_id: 'eau_potable', ok: false, comment: 'Réservoir vide : rempli au point d’eau' })
    expect(screen.getByRole('button', { name: /^Checklist Ouverture — Faite aujourd’hui à 10:00/ })).toBeInTheDocument()
  })

  it('checklist tout « Oui » : all_ok = true ; plus de rappel sur l’accueil', async () => {
    const core = setup()
    await openCleaning()
    press(/^Checklist Contrôle nuisibles/)
    await screen.findByRole('heading', { name: 'Contrôle nuisibles', level: 1 })
    for (const g of screen.getAllByRole('radiogroup')) fireEvent.click(within(g).getByRole('radio', { name: 'Oui' }))
    press('Enregistrer la checklist')
    await screen.findByRole('heading', { name: 'Nettoyage', level: 1 })
    expect(((await last(core, 'checklist_done')).payload as unknown as ChecklistDonePayload).all_ok).toBe(true)
    press('Accueil')
    expect(await screen.findByRole('button', { name: 'Nettoyage : 11 tâches à faire, 1 checklist à faire' })).toBeInTheDocument()
  })
})

describe('Nettoyage — historique et correction', () => {
  it('correction d’un nettoyage : motif obligatoire, original barré', async () => {
    const id = 'c1ea0000-0000-4000-8000-0000000000aa'
    const core = setup({ initialRecords: [seed('cleaning_done', daysAgo(0, 8), { task_id: task('507').id }, { id })] })
    await openCleaning()
    press('Historique')
    await screen.findByRole('heading', { name: 'Historique — nettoyage' })
    press('Corriger le nettoyage de 08:00 (Sols)')
    await screen.findByRole('heading', { name: 'Corriger un nettoyage' })
    fireEvent.click(screen.getByRole('radio', { name: 'Poubelles' }))
    const save = screen.getByRole('button', { name: 'Enregistrer la correction' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mauvaise tâche cochée' }))
    fireEvent.click(save)
    await screen.findByRole('heading', { name: 'Historique — nettoyage' })
    const corr = await last(core, 'correction')
    expect(corr.supersedes_id).toBe(id)
    expect(validatePayload('correction', corr.payload, { supersededType: 'cleaning_done' })).toEqual({ ok: true })
    expect(await screen.findByLabelText('ancienne valeur Sols')).toBeInTheDocument()
    expect(screen.getByText(/motif : Mauvaise tâche cochée/)).toBeInTheDocument()
  })

  it('correction d’une checklist : un « Non » devient « Oui », all_ok recalculé', async () => {
    const id = 'c1ea0000-0000-4000-8000-0000000000bb'
    const answers = CLOSING.items.map((i) => (i.id === 'gaz' ? { item_id: 'gaz', ok: false, comment: 'Oubli' } : { item_id: i.id, ok: true }))
    const core = setup({ initialRecords: [seed('checklist_done', daysAgo(1, 23), { checklist_id: CLOSING.id, answers, all_ok: false }, { id })] })
    await openCleaning()
    press('Historique')
    fireEvent.click(screen.getByRole('tab', { name: 'Checklists' }))
    expect(await screen.findByRole('listitem', { name: /Checklist Fermeture de 23:00, 1 non-conformité/ })).toBeInTheDocument()
    press('Corriger la checklist Fermeture de 23:00')
    await screen.findByRole('heading', { name: 'Corriger : Fermeture' })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Gaz coupé' })).getByRole('radio', { name: 'Oui' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mauvaise réponse cochée' }))
    press('Enregistrer la correction')
    await screen.findByRole('heading', { name: 'Historique — nettoyage' })
    const corr = await last(core, 'correction')
    expect(validatePayload('correction', corr.payload, { supersededType: 'checklist_done' })).toEqual({ ok: true })
    expect((corr.payload.replacement as ChecklistDonePayload).all_ok).toBe(true)
    await waitFor(() => expect(screen.getByLabelText('ancienne valeur Non (Oubli)')).toBeInTheDocument())
  })
})
