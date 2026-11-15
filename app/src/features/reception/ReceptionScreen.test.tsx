import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceptionPayload, WastePayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_SUPPLIERS } from '../../core/mockTransport.ts'
import { syntheticWebp, type PhotoEncoder } from '../../core/photoEncoder.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { createFakeCore, type FakeCoreOptions, type FakeRecordSeed } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'

// Samedi 14/11/2026 09:30 à Paris.
const NOW = '2026-11-14T08:30:00.000Z'
const DEV = '00000000-0000-4000-8000-000000000001'
const [BOUCHERIE, PRIMEURS] = DEMO_SUPPLIERS

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

/** Encodeur simulé (pas de canvas dans jsdom). */
const encoder: PhotoEncoder = vi.fn(async () => ({ bytes: syntheticWebp(2000), width: 1600, height: 1200, encoder: 'native' as const, quality: 0.82 }))

function setup(opts: FakeCoreOptions = {}, staff = 'staff-gerant') {
  const core = createFakeCore({ enrolled: true, unlockedStaffId: staff, autoSyncDelayMs: null, photoEncoder: encoder, ...opts })
  renderWithCore(core)
  return core
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const typeTemp = (s: string) => {
  for (const ch of s) press(ch === ',' ? 'Virgule' : ch === '-' ? 'Moins (changer le signe)' : ch)
}
const image = () => new File([new Uint8Array(5000)], 'IMG_0001.jpg', { type: 'image/jpeg' })
async function takePhoto(field: string) {
  const before = screen.queryAllByRole('button', { name: new RegExp(`^${field} \\d`) }).length
  fireEvent.change(screen.getByLabelText(`Prendre une photo — ${field}`), { target: { files: [image()] } })
  await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(`^${field} \\d`) })).toHaveLength(before + 1))
}

async function openReception() {
  fireEvent.click(await screen.findByRole('button', { name: /^Réception :/ }))
  await screen.findByRole('heading', { name: 'Réception', level: 1 })
}

async function startDelivery(supplier = BOUCHERIE.name) {
  await openReception()
  press(/^Nouvelle réception/)
  fireEvent.click(await screen.findByRole('radio', { name: supplier }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Véhicule/ })).getByRole('radio', { name: 'Oui' }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Emballages/ })).getByRole('radio', { name: 'Oui' }))
  press('Continuer : produits')
}

async function fillItem(o: { product: string; lot?: string; temp?: string; decision: 'Accepté' | 'Refusé'; photos?: number }) {
  await screen.findByRole('heading', { name: 'Ajouter un produit' })
  fireEvent.change(screen.getByLabelText('Produit'), { target: { value: o.product } })
  if (o.lot) fireEvent.change(screen.getByLabelText('N° de lot'), { target: { value: o.lot } })
  for (let i = 0; i < (o.photos ?? 0); i++) await takePhoto('Photos de l’étiquette')
  if (o.temp) typeTemp(o.temp)
  fireEvent.click(screen.getByRole('radio', { name: o.decision }))
}

const lastOf = async (core: ReturnType<typeof createFakeCore>, type: 'reception' | 'waste' | 'correction' | 'corrective_action') => (await core.listRecords({ type }))[0]

describe('Réception d’une livraison', () => {
  it('réception complète avec photo d’étiquette et du bon : enregistrée, photos en file d’envoi', async () => {
    const core = setup()
    await startDelivery()
    press('Ajouter le premier produit livré')
    await fillItem({ product: 'Steak haché', lot: 'L2311A', temp: '2,8', decision: 'Accepté', photos: 1 })
    fireEvent.change(screen.getByLabelText(/^DLC/), { target: { value: '2026-11-18' } })
    press('Valider ce produit')
    expect(await screen.findByText('Lot L2311A · DLC 18/11/2026 · Frigo · 2,8 °C')).toBeInTheDocument()
    press('Livraison')
    await takePhoto('Photo du bon de livraison')
    press('Continuer : produits')
    press('Continuer : validation')
    press('Enregistrer la réception')
    await screen.findByRole('heading', { name: 'Réception', level: 1 })

    const rec = await lastOf(core, 'reception')
    const p = rec.payload as unknown as ReceptionPayload
    expect(validatePayload('reception', p)).toEqual({ ok: true })
    expect(p).toMatchObject({ supplier_id: BOUCHERIE.id, vehicle_ok: true, packaging_ok: true })
    expect(p.items).toEqual([{ product: 'Steak haché', lot: 'L2311A', dlc: '2026-11-18', storage: 'fridge', temperature_c: 2.8, accepted: true, photo_paths: [expect.stringMatching(new RegExp(`^${DEV}/[0-9a-f-]{36}\\.webp$`))] }])
    expect(p.photo_paths).toHaveLength(1)
    const st = await core.getPhotoStatuses([...p.items[0].photo_paths!, ...p.photo_paths!])
    expect(Object.values(st).map((s) => s.state)).toEqual(['pending', 'pending'])
    expect((await core.getSyncStatus()).photos_pending).toBe(2)
    expect(await screen.findByText(/2 photos en attente d’envoi\./)).toBeInTheDocument()
    core.simulate.flush()
    await waitFor(() => expect(screen.queryByText(/photos en attente d’envoi\./)).toBeNull())
  })

  it('ligne refusée : motif obligatoire, refus mis en évidence', async () => {
    const core = setup()
    await startDelivery(PRIMEURS.name)
    press('Ajouter le premier produit livré')
    await fillItem({ product: 'Salade', temp: '3', decision: 'Refusé' })
    expect(screen.getByRole('button', { name: 'Valider ce produit' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Emballage abîmé' }))
    press('Valider ce produit')
    expect(await screen.findByText('Motif : Emballage abîmé')).toBeInTheDocument()
    press('Continuer : validation')
    press('Enregistrer la réception')
    await screen.findByRole('heading', { name: 'Réception', level: 1 })
    const p = (await lastOf(core, 'reception')).payload as unknown as ReceptionPayload
    expect(p.items[0]).toMatchObject({ accepted: false, refusal_reason: 'Emballage abîmé' })
    expect(screen.getByRole('heading', { name: 'Refus des 7 derniers jours' })).toBeInTheDocument()
  })

  it('température hors seuil : avertissement, puis acceptation avec action corrective liée à la réception', async () => {
    const core = setup()
    await startDelivery()
    press('Ajouter le premier produit livré')
    await fillItem({ product: 'Poulet', temp: '7,5', decision: 'Accepté' })
    press('Valider ce produit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Température hors seuil : 7,5 °C')
    press('Accepter avec action corrective')
    expect(await screen.findByText('Action corrective à enregistrer')).toBeInTheDocument()
    press('Continuer : validation')
    expect(screen.getByText(/une action corrective sera demandée/)).toBeInTheDocument()
    press('Enregistrer la réception')
    await screen.findByRole('heading', { name: 'Action corrective obligatoire' })
    fireEvent.click(screen.getByRole('radio', { name: /Produits transférés/ }))
    press('Enregistrer l’action corrective')
    await screen.findByRole('heading', { name: 'Réception', level: 1 })
    const rec = await lastOf(core, 'reception')
    expect((await lastOf(core, 'corrective_action')).payload).toMatchObject({ related_record_id: rec.id, action: 'move_product' })
  })

  it('hors seuil : « Refuser ce produit » enregistre le refus avec la température en motif', async () => {
    setup()
    await startDelivery()
    press('Ajouter le premier produit livré')
    await fillItem({ product: 'Surgelés', decision: 'Accepté' })
    fireEvent.click(screen.getByRole('radio', { name: 'Congélateur' }))
    typeTemp('-12')
    press('Valider ce produit')
    press('Refuser ce produit')
    expect(await screen.findByText('Motif : Température non conforme (−12 °C)')).toBeInTheDocument()
  })

  it('plafond de 20 photos par réception, toutes lignes confondues', async () => {
    setup()
    await startDelivery()
    press('Livraison')
    for (let i = 0; i < 5; i++) await takePhoto('Photo du bon de livraison')
    expect(screen.getByText('5 photos au maximum ici.')).toBeInTheDocument()
    press('Continuer : produits')
    for (let line = 0; line < 3; line++) {
      press(line === 0 ? 'Ajouter le premier produit livré' : 'Ajouter un produit')
      await fillItem({ product: `Produit ${line}`, temp: '2', decision: 'Accepté', photos: 5 })
      press('Valider ce produit')
      await screen.findByText(`Produit ${line}`)
    }
    expect(screen.getByText('photos 20/20')).toBeInTheDocument()
    press('Ajouter un produit')
    await screen.findByRole('heading', { name: 'Ajouter un produit' })
    expect(screen.queryByLabelText('Prendre une photo — Photos de l’étiquette')).toBeNull()
    expect(screen.getByText('Plafond de photos atteint pour cette saisie.')).toBeInTheDocument()
  })
})

const reception = (items: unknown[], extra: Record<string, unknown> = {}) => ({ supplier_id: BOUCHERIE.id, delivery_note: '45821', vehicle_ok: true, packaging_ok: true, items, ...extra })
const R1 = '9b0c0000-0000-4000-8000-000000000001'
const PHOTO = `${DEV}/9b0c0000-0000-4000-8000-0000000000aa.webp`
const seedReception = (minAgo: number, payload: Record<string, unknown>, id = R1): FakeRecordSeed => ({
  id,
  type: 'reception',
  author_id: 'staff-equipier',
  device_time: new Date(Date.parse(NOW) - minAgo * 60_000).toISOString(),
  payload,
})

describe('Historique, correction, pertes', () => {
  it('correction d’une réception : motif obligatoire, ancienne valeur barrée', async () => {
    const core = setup({ initialRecords: [seedReception(60, reception([{ product: 'Steak haché', lot: 'L123', storage: 'fridge', temperature_c: 3, accepted: true }]))] })
    await openReception()
    press('Historique')
    await screen.findByRole('heading', { name: /Historique/ })
    press(/^Corriger la réception de 08:30/)
    await screen.findByRole('heading', { name: 'Corriger une réception' })
    press('Continuer : produits')
    press('Modifier — Steak haché')
    fireEvent.change(await screen.findByLabelText('N° de lot'), { target: { value: 'L124' } })
    press('Valider ce produit')
    press('Continuer : validation')
    const save = screen.getByRole('button', { name: 'Enregistrer la correction' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Erreur de saisie' }))
    fireEvent.click(save)
    await screen.findByRole('heading', { name: /Historique/ })
    const corr = await lastOf(core, 'correction')
    expect(corr.supersedes_id).toBe(R1)
    expect(validatePayload('correction', corr.payload, { supersededType: 'reception' })).toEqual({ ok: true })
    expect(await screen.findByLabelText('ancienne valeur L123')).toBeInTheDocument()
    expect(screen.getByText(/motif : Erreur de saisie/)).toBeInTheDocument()
  })

  it('historique : refus en évidence, photos et leur statut d’envoi', async () => {
    setup({
      initialRecords: [
        seedReception(30, reception([{ product: 'Poulet', storage: 'fridge', temperature_c: 9, accepted: false, refusal_reason: 'Trop chaud', photo_paths: [PHOTO] }])),
      ],
      initialPhotos: { [PHOTO]: { image: new Blob([syntheticWebp(100).slice().buffer]), state: 'pending' } },
    })
    await openReception()
    press('Historique')
    const card = await screen.findByRole('listitem', { name: /Réception de 09:00, Boucherie Martin, 1 produit refusé/ })
    expect(within(card).getByText('Motif : Trop chaud')).toBeInTheDocument()
    expect(within(card).getByText('1 photo en attente d’envoi')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: /Étiquette — Poulet 1 \(en attente d’envoi\)/ }))
    expect(screen.getByRole('dialog', { name: 'Étiquette — Poulet' })).toBeInTheDocument()
    press('Fermer la photo')
  })

  it('perte : motif « Autre » exige un commentaire, lien vers la réception du lot', async () => {
    const core = setup({ initialRecords: [seedReception(120, reception([{ product: 'Crème fraîche', lot: 'CF221', storage: 'fridge', temperature_c: 3, accepted: true }]))] })
    await openReception()
    press(/^Perte \/ produit jeté/)
    await screen.findByRole('heading', { name: 'Perte / produit jeté' })
    fireEvent.click(screen.getByRole('button', { name: 'Crème fraîche' }))
    fireEvent.click(screen.getByRole('button', { name: 'CF221' }))
    fireEvent.change(screen.getByLabelText('Quantité (facultatif)'), { target: { value: '1 L' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Autre' }))
    const save = screen.getByRole('button', { name: 'Enregistrer la perte' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Commentaire (obligatoire)'), { target: { value: 'Pot ouvert' } })
    fireEvent.click(screen.getByRole('radio', { name: /Boucherie Martin/ }))
    await takePhoto('Photo')
    fireEvent.click(save)
    await screen.findByRole('heading', { name: 'Réception', level: 1 })
    const w = (await lastOf(core, 'waste')).payload as unknown as WastePayload
    expect(w).toMatchObject({ product: 'Crème fraîche', lot: 'CF221', quantity: '1 L', reason: 'other', comment: 'Pot ouvert', related_record_id: R1 })
    expect(w.photo_paths).toHaveLength(1)
    expect(validatePayload('waste', w)).toEqual({ ok: true })
  })
})

describe('Accueil', () => {
  it('compteurs de la tuile : dernière réception, photos en attente, refus de la semaine, action manquante', async () => {
    const core = setup({
      initialRecords: [
        seedReception(18, reception([{ product: 'Poulet', storage: 'fridge', temperature_c: 9, accepted: false, refusal_reason: 'Trop chaud', photo_paths: [PHOTO] }])),
      ],
      initialPhotos: { [PHOTO]: { image: new Blob([syntheticWebp(100).slice().buffer]), state: 'pending' } },
    })
    expect(await screen.findByRole('button', { name: 'Réception : Dernière réception : aujourd’hui à 09:12, 1 photo en attente d’envoi, 1 refus cette semaine' })).toBeInTheDocument()
    core.simulate.flush()
    expect(await screen.findByRole('button', { name: 'Réception : Dernière réception : aujourd’hui à 09:12, 1 refus cette semaine' })).toBeInTheDocument()
  })

  it('produit accepté hors seuil sans action : tuile en alerte', async () => {
    setup({ initialRecords: [seedReception(10, reception([{ product: 'Mozzarella', storage: 'fridge', temperature_c: 8, accepted: true }]))] })
    expect(await screen.findByRole('button', { name: /^Réception : 1 action corrective manquante/ })).toBeInTheDocument()
  })
})

describe('Gestion › Fournisseurs', () => {
  it('ajout, modification, désactivation puis réactivation (jamais de suppression)', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true })
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-gerant', autoSyncDelayMs: null })
    renderWithCore(core, undefined, manager)
    fireEvent.click(await screen.findByRole('button', { name: /^Gestion/ }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Fournisseurs' }))
    await screen.findByText('Boucherie Martin')
    press('Ajouter un fournisseur')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nom du fournisseur'), { target: { value: '  Fromagerie   des Monts ' } })
    fireEvent.change(within(dialog).getByLabelText('Email (facultatif)'), { target: { value: 'pas-un-email' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    expect(await within(dialog).findByText('Adresse email invalide.')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Email (facultatif)'), { target: { value: 'Contact@Fromagerie.fr' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await screen.findByText('Fromagerie des Monts')
    expect(manager.simulate.state().suppliers.find((s) => s.name === 'Fromagerie des Monts')).toMatchObject({ email: 'contact@fromagerie.fr', active: true })

    press('Désactiver – Fromagerie des Monts')
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Désactiver' }))
    await screen.findByRole('button', { name: 'Réactiver – Fromagerie des Monts' })
    expect(manager.simulate.state().suppliers.find((s) => s.name === 'Fromagerie des Monts')?.active).toBe(false)
    press('Réactiver – Fromagerie des Monts')
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Réactiver' }))
    await screen.findByRole('button', { name: 'Désactiver – Fromagerie des Monts' })
    expect(manager.simulate.state().suppliers).toHaveLength(4)
  })

  it('le gérant crée un fournisseur pendant la réception ; l’équipier ne le peut pas', async () => {
    setup()
    await openReception()
    press(/^Nouvelle réception/)
    press('Nouveau fournisseur')
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau fournisseur' })
    fireEvent.change(within(dialog).getByLabelText('Nom du fournisseur'), { target: { value: 'Poissonnerie Nantua' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter le fournisseur' }))
    // Session gérant absente dans ce test : mot de passe redemandé dans la fenêtre.
    fireEvent.change(await within(dialog).findByLabelText('Mot de passe'), { target: { value: 'demo-demo-demo' } })
    fireEvent.change(within(dialog).getByLabelText('Email gérant'), { target: { value: 'gerant@demo.fr' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter le fournisseur' }))
    expect(await screen.findByRole('radio', { name: 'Poissonnerie Nantua', checked: true })).toBeInTheDocument()
  })

  it('équipier : pas de bouton « Nouveau fournisseur »', async () => {
    setup({}, 'staff-equipier')
    await openReception()
    press(/^Nouvelle réception/)
    await screen.findByRole('radio', { name: BOUCHERIE.name })
    expect(screen.queryByRole('button', { name: 'Nouveau fournisseur' })).toBeNull()
  })
})
