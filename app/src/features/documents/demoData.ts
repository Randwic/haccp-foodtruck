// Documents de démonstration (?demo=…) : un document à jour, un à renouveler bientôt, un échu, un archivé.
import type { DocumentRef } from '../../../../shared/payloads.ts'

const day = (now: Date, delta: number) => new Date(now.getTime() + delta * 86_400_000).toISOString().slice(0, 10)

export function demoDocuments(now: Date): DocumentRef[] {
  const at = now.toISOString()
  const doc = (n: number, d: Omit<DocumentRef, 'id' | 'file_path' | 'active' | 'updated_at' | 'mime_type' | 'size_bytes'> & Partial<DocumentRef>): DocumentRef => ({
    id: `d0c00000-0000-4000-8000-00000000000${n}`,
    file_path: `d0c00000-0000-4000-8000-00000000000${n}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 180_000 + n * 23_000,
    active: true,
    updated_at: at,
    ...d,
  })
  return [
    doc(1, { title: 'Récépissé de déclaration DDPP', category: 'registration', issued_on: day(now, -60), valid_until: null, notes: null }),
    doc(2, { title: 'Attestation de formation hygiène – Cédric', category: 'training', issued_on: day(now, -340), valid_until: day(now, 12), notes: 'Recyclage conseillé : à reprogrammer.' }),
    doc(3, { title: 'Contrat d’entretien du froid', category: 'maintenance', issued_on: day(now, -380), valid_until: day(now, -3), notes: null }),
    doc(4, { title: 'Fiche technique – Sauce cheddar', category: 'supplier', issued_on: day(now, -20), valid_until: null, notes: 'Allergènes : lait.', mime_type: 'image/jpeg', file_path: 'd0c00000-0000-4000-8000-000000000004.jpg' }),
    doc(5, { title: 'Ancienne attestation d’assurance', category: 'other', issued_on: day(now, -500), valid_until: day(now, -130), notes: null, active: false }),
  ]
}
