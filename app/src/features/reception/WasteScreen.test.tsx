import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WastePayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_SUPPLIERS } from '../../core/mockTransport.ts'
import { createFakeCore, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { buildReceptions } from './model.ts'
import { wasteSuggestions } from './wasteModel.ts'

const NOW = '2026-11-15T09:00:00.000Z'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()
const seed = (type: FakeRecordSeed['type'], when: string, payload: Record<string, unknown>): FakeRecordSeed => ({ type, author_id: 'staff-equipier', device_time: when, payload })

describe('Produits jetés', () => {
  it('suggestions : étiquettes en cours, puis produits reçus, puis catalogue, sans doublon', () => {
    const now = new Date(NOW)
    const receptions = buildReceptions([
      { id: 'r', type: 'reception', payload: { supplier_id: 's', vehicle_ok: true, packaging_ok: true, items: [{ product: 'Bacon en tranches', storage: 'fridge', accepted: true }, { product: 'Oignons', storage: 'ambient', accepted: true }] }, author_id: 'a', device_id: 'd', device_seq: 1, device_time: NOW, prev_hash: '', hash: '', supersedes_id: null },
    ])
    const labels = [
      { payload: { name: 'Sauce cheddar maison', dlc_at: daysAgo(-1) }, waste: null },
      { payload: { name: 'Vieille sauce', dlc_at: daysAgo(5) }, waste: null },
      { payload: { name: 'Déjà jetée', dlc_at: daysAgo(-1) }, waste: {} },
    ]
    const products = [
      { name: 'bacon en tranches', active: true },
      { name: 'Cornichons', active: true },
      { name: 'Ancien', active: false },
    ]
    expect(wasteSuggestions({ labels, receptions, products, now })).toEqual(['Sauce cheddar maison', 'Bacon en tranches', 'Oignons', 'Cornichons'])
  })

  it('tuile dédiée : saisie rapide avec suggestion du catalogue, total de la semaine', async () => {
    const core = createFakeCore({
      enrolled: true,
      unlockedStaffId: 'staff-equipier',
      autoSyncDelayMs: null,
      initialRecords: [seed('waste', daysAgo(10), { product: 'Ancienne perte', reason: 'expired' }), seed('waste', daysAgo(2), { product: 'Pain burger', reason: 'damaged' })],
    })
    renderWithCore(core)
    fireEvent.click(await screen.findByRole('button', { name: 'Produits jetés : 1 produit jeté en 7 jours' }))
    await screen.findByRole('heading', { name: 'Produits jetés', level: 1 })
    expect(screen.getByText('Abîmé : 1')).toBeInTheDocument()
    expect(screen.getByText('Ancienne perte')).toBeInTheDocument() // historique 30 jours
    fireEvent.click(screen.getByRole('button', { name: /^Déclarer un produit jeté/ }))
    await screen.findByRole('heading', { name: 'Produit jeté', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Cheddar en tranches' }))
    fireEvent.change(screen.getByLabelText('Quantité (facultatif)'), { target: { value: '200 g' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Date dépassée' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le produit jeté' }))
    await screen.findByRole('heading', { name: 'Produits jetés', level: 1 })
    const w = (await core.listRecords({ type: 'waste' }))[0].payload as unknown as WastePayload
    expect(w).toEqual({ product: 'Cheddar en tranches', quantity: '200 g', reason: 'expired' })
    expect(validatePayload('waste', w)).toEqual({ ok: true })
    expect(screen.getByText('2 produits jetés')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accueil' }))
    expect(await screen.findByRole('button', { name: 'Produits jetés : 2 produits jetés en 7 jours' })).toBeInTheDocument()
  })

  it('toujours accessible depuis Achats & réception', async () => {
    renderWithCore(createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', autoSyncDelayMs: null, suppliers: DEMO_SUPPLIERS }))
    fireEvent.click(await screen.findByRole('button', { name: /^Achats & réception :/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Produit jeté/ }))
    expect(await screen.findByRole('heading', { name: 'Produit jeté', level: 1 })).toBeInTheDocument()
  })
})
