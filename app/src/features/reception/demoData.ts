// Réceptions de démonstration (?demo=unlocked&receptions=demo|alerte) pour la démo de l'interface et les captures.
// Uniquement avec le core factice : jamais dans le vrai registre.
import { DEMO_SUPPLIERS } from '../../core/mockTransport.ts'
import type { FakeCoreOptions, FakeRecordSeed } from '../../ui/fakeCore.ts'

const DEVICE = '00000000-0000-4000-8000-000000000001'
const [BOUCHERIE, PRIMEURS, METRO] = DEMO_SUPPLIERS.map((s) => s.id)

/** Étiquette factice dessinée sur un canevas (navigateur uniquement). */
function labelImage(title: string, lines: string[], tone: string): () => Promise<Blob> {
  return () =>
    new Promise<Blob>((resolve, reject) => {
      const c = document.createElement('canvas')
      c.width = 900
      c.height = 1200
      const g = c.getContext('2d')
      if (!g) return reject(new Error('canvas'))
      g.fillStyle = '#d9d4c7'
      g.fillRect(0, 0, 900, 1200)
      g.fillStyle = '#fbfaf6'
      g.translate(450, 600)
      g.rotate(-0.04)
      g.fillRect(-360, -460, 720, 920)
      g.fillStyle = tone
      g.fillRect(-360, -460, 720, 120)
      g.fillStyle = '#ffffff'
      g.font = 'bold 54px sans-serif'
      g.fillText(title, -330, -380)
      g.fillStyle = '#1b1b1b'
      g.font = '44px sans-serif'
      lines.forEach((l, i) => g.fillText(l, -330, -250 + i * 80))
      for (let i = 0; i < 46; i++) g.fillRect(-330 + i * 14, 300, i % 3 ? 6 : 10, 120)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/webp', 0.8)
    })
}

export function demoReceptions(now: Date, mode: 'demo' | 'alerte'): Pick<FakeCoreOptions, 'initialPhotos'> & { records: FakeRecordSeed[] } {
  let n = 0
  const id = () => `9b0c0000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const photos: NonNullable<FakeCoreOptions['initialPhotos']> = {}
  const photo = (title: string, lines: string[], tone = '#8c1c13', state: 'uploaded' | 'pending' = 'uploaded') => {
    const path = `${DEVICE}/${id()}.webp`
    photos[path] = { image: labelImage(title, lines, tone), state }
    return path
  }
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const day = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10)
  const records: FakeRecordSeed[] = []
  const add = (type: FakeRecordSeed['type'], minAgo: number, payload: Record<string, unknown>, extra: Partial<FakeRecordSeed> = {}) => {
    const rid = extra.id ?? id()
    records.push({ id: rid, type, author_id: 'staff-equipier', device_time: ago(minAgo), payload, ...extra })
    return rid
  }

  // Il y a 3 jours : Metro, un produit accepté hors seuil avec action corrective, puis une correction du lot.
  const r3 = add('reception', 3 * 1440 + 200, {
    supplier_id: METRO,
    delivery_note: 'M-778120',
    vehicle_ok: true,
    packaging_ok: true,
    items: [
      { product: 'Frites surgelées 9 mm', lot: 'FR2310', ddm: day(240), storage: 'freezer', temperature_c: -19.5, accepted: true },
      { product: 'Pain burger brioché', lot: 'PB4471', ddm: day(12), storage: 'ambient', accepted: true },
      { product: 'Cheddar tranches', lot: 'CH0918', dlc: day(25), storage: 'fridge', temperature_c: 5.2, accepted: true, photo_paths: [photo('CHEDDAR', ['Lot CH0918', `DLC ${day(25)}`, '+2/+6 °C'], '#c27c0e')] },
    ],
  })
  add('corrective_action', 3 * 1440 + 195, { related_record_id: r3, action: 'move_product', comment: 'Mis immédiatement au frigo 1 ; contrôlé à 3,4 °C 30 min après.' })
  add(
    'correction',
    3 * 1440 + 150,
    {
      reason: 'Erreur de saisie',
      replacement: {
        supplier_id: METRO,
        delivery_note: 'M-778120',
        vehicle_ok: true,
        packaging_ok: true,
        items: [
          { product: 'Frites surgelées 9 mm', lot: 'FR2310B', ddm: day(240), storage: 'freezer', temperature_c: -19.5, accepted: true },
          { product: 'Pain burger brioché', lot: 'PB4471', ddm: day(12), storage: 'ambient', accepted: true },
          { product: 'Cheddar tranches', lot: 'CH0918', dlc: day(25), storage: 'fridge', temperature_c: 5.2, accepted: true, photo_paths: Object.keys(photos).slice(0, 1) },
        ],
      },
    },
    { supersedes_id: r3 },
  )

  // Hier : primeurs, tout conforme.
  add('reception', 1440 + 120, {
    supplier_id: PRIMEURS,
    vehicle_ok: true,
    packaging_ok: true,
    items: [
      { product: 'Salade iceberg', lot: 'SI-47', dlc: day(4), storage: 'fridge', temperature_c: 3.6, accepted: true },
      { product: 'Tomates grappe', storage: 'ambient', accepted: true },
      { product: 'Oignons rouges', storage: 'ambient', accepted: true },
    ],
  })

  // Ce matin : boucherie, un refus, photos en attente d'envoi.
  const bl = photo('BON DE LIVRAISON', ['Boucherie Martin', 'BL n° 45821', '3 colis'], '#2a4d8f', 'pending')
  add('reception', 50, {
    supplier_id: BOUCHERIE,
    delivery_note: '45821',
    vehicle_ok: true,
    packaging_ok: true,
    photo_paths: [bl],
    items: [
      {
        product: 'Steak haché 15 % MG',
        lot: 'L2311A',
        dlc: day(4),
        storage: 'fridge',
        temperature_c: 2.8,
        accepted: true,
        photo_paths: [photo('STEAK HACHÉ', ['Lot L2311A', `DLC ${day(4)}`, 'FR 69.123.001 CE'], '#8c1c13', 'pending'), photo('STEAK HACHÉ', ['10 x 150 g', 'À conserver 0/+4 °C'])],
      },
      { product: 'Saucisses de Toulouse', lot: 'ST0911', dlc: day(6), storage: 'fridge', temperature_c: 3.1, accepted: true, photo_paths: [photo('SAUCISSES', ['Lot ST0911', `DLC ${day(6)}`])] },
      {
        product: 'Poulet fermier',
        lot: 'PF448',
        dlc: day(5),
        storage: 'fridge',
        temperature_c: 7.5,
        accepted: false,
        refusal_reason: 'Température non conforme (7,5 °C)',
        photo_paths: [photo('POULET FERMIER', ['Lot PF448', `DLC ${day(5)}`], '#5b6b1e')],
      },
    ],
  })

  add('waste', 30, { product: 'Crème fraîche 30 %', lot: 'CF221', quantity: '1 L', reason: 'expired', comment: 'Oubliée au fond du frigo 2.', photo_paths: [photo('CRÈME FRAÎCHE', ['Lot CF221', `DLC ${day(-1)}`], '#33658a')] })

  if (mode === 'alerte') {
    add('reception', 12, {
      supplier_id: METRO,
      vehicle_ok: false,
      packaging_ok: true,
      items: [{ product: 'Mozzarella', lot: 'MZ55', dlc: day(9), storage: 'fridge', temperature_c: 8, accepted: true }],
      comment: 'Camion non réfrigéré.',
    })
  }
  const sorted = records.sort((a, b) => a.device_time.localeCompare(b.device_time))
  for (const s of sorted.slice(-2)) s.synced = false
  return { records: sorted, initialPhotos: photos }
}
