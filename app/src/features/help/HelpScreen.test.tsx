import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { AppShell } from '../../ui/AppShell.tsx'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { GUIDE_PDF_URL, HelpScreen } from './HelpScreen.tsx'
import { helpTimeline } from './timeline.ts'

describe('timeline de l’aide', () => {
  it('suit l’ordre : avant l’ouverture, chaque jour, courses, semaine, mois, au besoin', () => {
    expect(helpTimeline().map((p) => p.id)).toEqual(['before', 'day', 'shopping', 'week', 'month', 'sometimes'])
  })

  it('reprend les horaires du service et les réglages des thermomètres', () => {
    const t = helpTimeline({ thermometerCheckDays: 30, thermometerToleranceC: 1 })
    const day = t.find((p) => p.id === 'day')!
    expect(day.steps.map((s) => s.when)).toEqual(expect.arrayContaining(['16 h 30', '21 h']))
    const month = t.find((p) => p.id === 'month')!
    expect(month.title).toBe('Chaque mois')
    expect(month.steps[0].what).toContain('1 °C')
    expect(helpTimeline({ thermometerCheckDays: 15, thermometerToleranceC: 0.5 }).find((p) => p.id === 'month')!.steps[0].what).toContain('0,5 °C')
  })

  it('affiche la date d’ouverture quand elle est réglée', () => {
    expect(helpTimeline({ openingDate: '2027-03-01' })[0].title).toBe('Avant l’ouverture (jusqu’au 1er mars 2027)')
    expect(helpTimeline({ openingDate: null })[0].title).toBe('Avant l’ouverture')
  })
})

describe('<HelpScreen />', () => {
  it('montre la timeline, le lien vers le guide PDF et se replie par période', () => {
    const onBack = vi.fn()
    render(<HelpScreen onBack={onBack} options={{ openingDate: '2027-03-01' }} />)
    expect(screen.getByRole('heading', { name: 'Aide', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Guide complet \(PDF\)/ })).toHaveAttribute('href', GUIDE_PDF_URL)
    const day = screen.getByRole('button', { name: /Chaque jour de service/ })
    expect(day).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Relever les 3 températures (frigo inox, desserte, congélateur)')).toBeVisible()
    fireEvent.click(day)
    expect(day).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Relever les 3 températures (frigo inox, desserte, congélateur)')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Accueil/ }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('accès à l’aide dans l’app', () => {
  it.each([['staff-equipier'], ['staff-gerant']])('bouton Aide de l’en-tête et tuile des Outils (%s)', async (staff) => {
    const core = createFakeCore({ enrolled: true, unlockedStaffId: staff, autoSyncDelayMs: null })
    renderWithCore(core, <AppShell />, createMockManagerApi({ seeded: true }))
    await screen.findByRole('heading', { name: 'Aujourd’hui' })
    fireEvent.click(screen.getByRole('button', { name: 'Aide' }))
    expect(await screen.findByRole('heading', { name: 'Aide', level: 1 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Accueil/ }))
    await screen.findByRole('heading', { name: 'Aujourd’hui' })
    const tools = screen.getByRole('region', { name: 'Outils' })
    fireEvent.click(within(tools).getByRole('button', { name: /Aide et guide/ }))
    expect(await screen.findByRole('heading', { name: 'Aide', level: 1 })).toBeInTheDocument()
  })
})
