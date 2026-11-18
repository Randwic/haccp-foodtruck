// « Pas encore ouvert » : l'écran Aujourd'hui met alertes et rappels en pause jusqu'à la date d'ouverture.
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoAlerts } from '../alerts/demoData.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

const NOW = new Date('2026-11-18T09:30:00.000Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

function setup(opening_date: string | null) {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null, alerts: demoAlerts(NOW), settings: { opening_date } })
  renderWithCore(core)
}

describe('écran Aujourd’hui avant l’ouverture', () => {
  it('bandeau « Pas encore ouvert », aucune alerte, rappels des tuiles en pause, pas de rappel de checklist', async () => {
    setup('2027-03-01')
    expect(await screen.findByText(/Pas encore ouvert : alertes et rappels en pause jusqu’au 1er mars 2027/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /alertes à voir/ })).toBeNull()
    expect(screen.getAllByText('Rappels en pause jusqu’au 1er mars 2027').length).toBeGreaterThanOrEqual(2) // Températures, Nettoyage
    expect(screen.queryByRole('region', { name: 'Checklists à faire' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Températures : rappels en pause jusqu’au 1er mars 2027/ })).toBeInTheDocument()
  })

  it('date d’ouverture passée (ou aucune) : alertes et rappels comme avant', async () => {
    setup('2026-11-01')
    expect(await screen.findByRole('heading', { name: '3 alertes à voir' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Pas encore ouvert/)).toBeNull())
    expect(screen.queryByText(/Rappels en pause/)).toBeNull()
  })
})
