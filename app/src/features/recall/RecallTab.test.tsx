import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WastePayload } from '../../../../shared/payloads.ts'
import { DEMO_SUPPLIERS } from '../../core/mockTransport.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { AppShell } from '../../ui/AppShell.tsx'

const NOW = '2026-11-14T08:30:00.000Z'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

function setup(staff = 'staff-gerant') {
  const recId = '00000000-0000-4000-8000-0000000000a1'
  const core = createFakeCore({
    enrolled: true,
    unlockedStaffId: staff,
    autoSyncDelayMs: null,
    initialRecords: [
      {
        id: recId,
        type: 'reception',
        author_id: 'staff-gerant',
        device_time: '2026-11-12T15:00:00.000Z',
        payload: {
          supplier_id: DEMO_SUPPLIERS[0].id,
          vehicle_ok: true,
          packaging_ok: true,
          items: [
            { product: 'Épaule de porc', lot: 'L2311A', dlc: '2026-11-20', storage: 'fridge', accepted: true, temperature_c: 2.5 },
            { product: 'Salade', lot: 'S1', storage: 'fridge', accepted: true, temperature_c: 3 },
          ],
        },
      },
      {
        type: 'label_printed',
        author_id: 'staff-gerant',
        device_time: '2026-11-13T15:00:00.000Z',
        payload: { kind: 'prepared', name: 'Porc effiloché', made_at: '2026-11-13T15:00:00.000Z', dlc_at: '2026-11-16T15:00:00.000Z', allergens: [], storage: 'fridge', copies: 1, source_record_ids: [recId] },
      },
    ],
  })
  const manager = createMockManagerApi({ seeded: true, signedIn: true, registrySource: () => core.listRecords(), devices: [{ id: '00000000-0000-4000-8000-000000000001', name: 'iPad', revoked_at: null }] })
  renderWithCore(core, <AppShell />, manager)
  return { core, recId }
}

describe('Rappel produit', () => {
  it('depuis Achats : lot retrouvé (achat + préparation faite avec), retrait noté et lié à l’achat', async () => {
    const { core, recId } = setup()
    fireEvent.click(await screen.findByRole('button', { name: /^Achats & réception :/ }))
    await screen.findByRole('heading', { name: 'Achats & réception', level: 1 })
    press(/^Rappel produit/)
    expect(await screen.findByRole('tab', { name: /Rappel produit/, selected: true })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('N° de lot ou code-barres'), { target: { value: 'l 2311a' } })
    press('Chercher')
    expect(await screen.findByText('2 produit(s) à retirer ou à vérifier')).toBeInTheDocument()
    expect(screen.getByText('Épaule de porc')).toBeInTheDocument()
    expect(screen.queryByText('Salade')).toBeNull()
    expect(screen.getByText('Porc effiloché')).toBeInTheDocument()
    expect(screen.getByText(/faite avec un produit du lot/)).toBeInTheDocument()

    press('Noter le retrait')
    const dialog = await screen.findByRole('dialog', { name: 'Noter le retrait' })
    fireEvent.change(within(dialog).getByLabelText('Quantité (facultatif)'), { target: { value: '1,2 kg' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le retrait' }))
    await waitFor(async () => expect(await core.listRecords({ type: 'waste' })).toHaveLength(1))
    const w = (await core.listRecords({ type: 'waste' }))[0].payload as unknown as WastePayload
    expect(w).toEqual({ product: 'Épaule de porc', reason: 'recall', related_record_id: recId, lot: 'L2311A', quantity: '1,2 kg', comment: 'Rappel produit' })
    expect(await screen.findByText('1 produit(s) à retirer ou à vérifier')).toBeInTheDocument()
    expect(screen.getAllByText('Retrait noté').length).toBeGreaterThan(0)
  })

  it('lot inconnu : message rassurant mais prudent', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /^Achats & réception :/ }))
    await screen.findByRole('heading', { name: 'Achats & réception', level: 1 })
    press(/^Rappel produit/)
    fireEvent.change(await screen.findByLabelText('N° de lot ou code-barres'), { target: { value: 'ZZZ' } })
    press('Chercher')
    expect(await screen.findByText(/Aucun achat, étiquette ni produit jeté avec « ZZZ »/)).toBeInTheDocument()
  })

  it('l’équipier n’a pas accès au rappel produit', async () => {
    setup('staff-equipier')
    fireEvent.click(await screen.findByRole('button', { name: /^Achats & réception :/ }))
    await screen.findByRole('heading', { name: 'Achats & réception', level: 1 })
    expect(screen.queryByRole('button', { name: /^Rappel produit/ })).toBeNull()
  })
})
