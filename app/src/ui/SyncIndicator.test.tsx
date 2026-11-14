import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SyncStatus } from '../core/api.ts'
import { createFakeCore } from './fakeCore.ts'
import { SyncIndicator } from './SyncIndicator.tsx'
import { describeSync } from './syncState.ts'
import { renderWithCore } from './testUtils.tsx'

const base: SyncStatus = { online: true, pending_count: 0, oldest_pending_at: null, last_success_at: null, last_error: null, rejected_count: 0 }
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

describe('describeSync', () => {
  it('vert quand rien n’attend', () => {
    expect(describeSync(base)).toMatchObject({ level: 'ok', label: 'Tout est synchronisé' })
  })
  it('orange avec le nombre de saisies en attente', () => {
    expect(describeSync({ ...base, pending_count: 3, oldest_pending_at: hoursAgo(1) })).toMatchObject({ level: 'pending', label: '3 saisies en attente' })
    expect(describeSync({ ...base, pending_count: 1, oldest_pending_at: hoursAgo(1) }).label).toBe('1 saisie en attente')
  })
  it('rouge si attente > 24 h, erreur ou refus', () => {
    expect(describeSync({ ...base, pending_count: 2, oldest_pending_at: hoursAgo(25) }).level).toBe('error')
    expect(describeSync({ ...base, pending_count: 2, oldest_pending_at: hoursAgo(1), last_error: 'HTTP 500' }).level).toBe('error')
    expect(describeSync({ ...base, rejected_count: 1 })).toMatchObject({ level: 'error', label: '1 saisie refusée' })
  })
})

describe('<SyncIndicator />', () => {
  it('affiche les 3 états et suit les changements en direct', async () => {
    const core = createFakeCore({ enrolled: true, autoSyncDelayMs: null })
    renderWithCore(core, <SyncIndicator />)
    const pill = await screen.findByRole('button', { name: /Synchronisation : Tout est synchronisé/ })
    expect(pill).toHaveAttribute('data-sync-level', 'ok')

    act(() => core.simulate.setSyncStatus({ pending_count: 3, oldest_pending_at: hoursAgo(1) }))
    expect(screen.getByRole('button', { name: /3 saisies en attente/ })).toHaveAttribute('data-sync-level', 'pending')

    act(() => core.simulate.setSyncStatus({ oldest_pending_at: hoursAgo(30) }))
    expect(screen.getByRole('button', { name: /en attente > 24 h/ })).toHaveAttribute('data-sync-level', 'error')

    act(() => core.simulate.setSyncStatus({ oldest_pending_at: hoursAgo(1), rejected_count: 2 }))
    expect(screen.getByRole('button', { name: /2 saisies refusées/ })).toHaveAttribute('data-sync-level', 'error')
  })

  it('ouvre le détail au toucher et permet de synchroniser', async () => {
    const core = createFakeCore({ enrolled: true, autoSyncDelayMs: null, sync: { pending_count: 2, oldest_pending_at: hoursAgo(1), last_error: 'Délai dépassé' } })
    renderWithCore(core, <SyncIndicator />)
    fireEvent.click(await screen.findByRole('button', { name: /Synchronisation/ }))
    const dialog = screen.getByRole('dialog', { name: 'Synchronisation' })
    expect(dialog).toHaveTextContent('Dernière erreur : Délai dépassé')
    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))
    expect(await screen.findByRole('button', { name: /Synchronisation : Tout est synchronisé/ })).toBeInTheDocument()
  })
})
