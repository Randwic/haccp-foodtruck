import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceptionPayload } from '../../../../../shared/payloads.ts'
import { DEMO_SUPPLIERS } from '../../../core/mockTransport.ts'
import { syntheticWebp, type PhotoEncoder } from '../../../core/photoEncoder.ts'
import { createFakeCore } from '../../../ui/fakeCore.ts'
import { renderWithCore } from '../../../ui/testUtils.tsx'
import { registerReceptionExtensions, resetReceptionExtensions, type LabelReading } from '../extensions.ts'

const NOW = '2026-11-14T08:30:00.000Z'
const encoder: PhotoEncoder = vi.fn(async () => ({ bytes: syntheticWebp(2000), width: 1600, height: 1200, encoder: 'native' as const, quality: 0.82 }))
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
  resetReceptionExtensions()
})

async function openItemEditor(seeds: Parameters<typeof createFakeCore>[0] = {}) {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null, photoEncoder: encoder, ...seeds })
  renderWithCore(core)
  fireEvent.click(await screen.findByRole('button', { name: /^Achats & réception :/ }))
  await screen.findByRole('heading', { name: 'Achats & réception', level: 1 })
  press(/^Nouvel approvisionnement/)
  fireEvent.click(await screen.findByRole('radio', { name: DEMO_SUPPLIERS[0].name }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Transport conforme/ })).getByRole('radio', { name: 'Oui' }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Emballages/ })).getByRole('radio', { name: 'Oui' }))
  press('Continuer : produits')
  press('Ajouter le premier produit acheté')
  await screen.findByRole('heading', { name: 'Ajouter un produit' })
  return core
}

describe('Achats : lecture de l’étiquette et code-barres', () => {
  it('la photo d’étiquette pré-remplit lot, DLC et code-barres (champs vides seulement), à vérifier', async () => {
    const readLabel = vi.fn(async (): Promise<LabelReading> => ({ lot: 'L23115A', dlc: '2026-11-25', gtin: '3017620422003' }))
    registerReceptionExtensions({ readLabel })
    await openItemEditor()
    fireEvent.change(screen.getByLabelText('Produit'), { target: { value: 'Steak haché' } })
    fireEvent.change(screen.getByLabelText('Prendre une photo — Photos de l’étiquette'), { target: { files: [new File([new Uint8Array(5000)], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText('Lu sur l’étiquette : lot, DLC, code-barres. Vérifiez avant de valider.')).toBeInTheDocument()
    expect(readLabel).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('N° de lot')).toHaveValue('L23115A')
    expect(screen.getByLabelText(/^DLC/)).toHaveValue('2026-11-25')
    expect(screen.getByLabelText('Produit')).toHaveValue('Steak haché') // déjà saisi : jamais écrasé
    expect(screen.getByText(/Code-barres 3017620422003/)).toBeInTheDocument()
  })

  it('photo illisible : message, saisie manuelle', async () => {
    registerReceptionExtensions({ readLabel: async () => null })
    await openItemEditor()
    fireEvent.change(screen.getByLabelText('Prendre une photo — Photos de l’étiquette'), { target: { files: [new File([new Uint8Array(5000)], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/Rien de lisible automatiquement/)).toBeInTheDocument()
  })

  it('scan d’un code GS1 : lot, date et produit déjà reçu avec ce code-barres ; enregistré dans la réception', async () => {
    const S = DEMO_SUPPLIERS[0].id
    const previous: ReceptionPayload = {
      supplier_id: S,
      vehicle_ok: true,
      packaging_ok: true,
      items: [{ product: 'Poulet émincé', gtin: '3017620422003', storage: 'fridge', accepted: true, temperature_c: 2 }],
    }
    registerReceptionExtensions({
      BarcodeScanner: ({ onResult }) => (
        <button type="button" onClick={() => onResult({ gtin: '3017620422003', lot: 'AB12C', dlc: '2026-11-25' })}>
          Simuler le scan
        </button>
      ),
    })
    const core = await openItemEditor({ initialRecords: [{ type: 'reception', payload: previous as unknown as Record<string, unknown>, author_id: 'staff-gerant', device_time: '2026-11-13T08:30:00.000Z' }] })
    press('Scanner le code-barres')
    press('Simuler le scan')
    expect(await screen.findByText('Lu sur le code-barres : produit, lot, DLC, code-barres. Vérifiez avant de valider.')).toBeInTheDocument()
    expect(screen.getByLabelText('Produit')).toHaveValue('Poulet émincé')
    expect(screen.getByLabelText('N° de lot')).toHaveValue('AB12C')
    for (const ch of '2,5') press(ch === ',' ? 'Virgule' : ch)
    fireEvent.click(screen.getByRole('radio', { name: 'Accepté' }))
    press('Valider ce produit')
    press('Continuer : validation')
    press('Enregistrer l’approvisionnement')
    await waitFor(async () => expect((await core.listRecords({ type: 'reception' })).length).toBe(2))
    const last = (await core.listRecords({ type: 'reception' }))[0].payload as unknown as ReceptionPayload
    expect(last.items[0]).toMatchObject({ product: 'Poulet émincé', gtin: '3017620422003', lot: 'AB12C', dlc: '2026-11-25' })
  })
})
