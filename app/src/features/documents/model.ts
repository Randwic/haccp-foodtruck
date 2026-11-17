// Documents du contrôle sanitaire (lot 7) : libellés, échéances, documents attendus. Fonctions pures.
import type { DocumentCategory, DocumentRef } from '../../../../shared/payloads.ts'
import { localDayKey } from '../temperatures/schedule.ts'

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  pms: 'Plan de maîtrise sanitaire (PMS)',
  registration: 'Déclaration et agrément DDPP',
  training: 'Formation hygiène',
  health: 'Aptitude du personnel',
  pest_control: 'Lutte contre les nuisibles',
  maintenance: 'Entretien du matériel',
  supplier: 'Fournisseurs et fiches techniques',
  lab_analysis: 'Analyses (eau, surfaces…)',
  inspection: 'Rapports de contrôle',
  other: 'Autres documents',
}

export const CATEGORY_HINTS: Record<DocumentCategory, string> = {
  pms: 'Versions successives du plan (générées par l’assistant ou déposées).',
  registration: 'Récépissé de déclaration d’activité (Cerfa 13984), agrément éventuel.',
  training: 'Attestation de formation hygiène alimentaire (14 h) de chaque personne concernée.',
  health: 'Date de validité seulement : jamais de détail médical.',
  pest_control: 'Contrat, plan des appâts, passages du prestataire.',
  maintenance: 'Contrat ou factures d’entretien du froid, de la friteuse, du groupe électrogène…',
  supplier: 'Fiches techniques (allergènes, durées après ouverture), certificats.',
  lab_analysis: 'Analyses d’eau du réservoir, prélèvements de surfaces.',
  inspection: 'Rapports de visite de la DDPP, réponses apportées.',
  other: 'Assurance, permis de stationnement, attestations diverses.',
}

/** Délai de rappel avant échéance (jours). */
export const EXPIRY_WARNING_DAYS = 30

export type ExpiryState = 'expired' | 'soon' | 'valid' | 'none'

/** Jours restants avant l'échéance (négatif = échu), dans le fuseau de l'établissement, ou null. */
export function daysLeft(validUntil: string | null, now: Date, timeZone: string): number | null {
  if (!validUntil) return null
  const today = localDayKey(now, timeZone)
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const b = Date.UTC(Number(validUntil.slice(0, 4)), Number(validUntil.slice(5, 7)) - 1, Number(validUntil.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

export function expiryState(doc: Pick<DocumentRef, 'valid_until'>, now: Date, timeZone: string): ExpiryState {
  const d = daysLeft(doc.valid_until, now, timeZone)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  if (d <= EXPIRY_WARNING_DAYS) return 'soon'
  return 'valid'
}

/** « Échu depuis 3 jours », « Expire aujourd’hui », « Expire dans 12 jours », « Valable jusqu’au 01/03/2027 ». */
export function expiryLabel(doc: Pick<DocumentRef, 'valid_until'>, now: Date, timeZone: string): string {
  const d = daysLeft(doc.valid_until, now, timeZone)
  if (d === null) return 'Sans échéance'
  if (d < -1) return `Échu depuis ${-d} jours`
  if (d === -1) return 'Échu depuis hier'
  if (d === 0) return 'Expire aujourd’hui'
  if (d === 1) return 'Expire demain'
  if (d <= EXPIRY_WARNING_DAYS) return `Expire dans ${d} jours`
  return `Valable jusqu’au ${formatIsoDay(doc.valid_until!)}`
}

export function formatIsoDay(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} o`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} Ko`
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} Mo`
}

/** Rappels : documents actifs échus ou arrivant à échéance, le plus urgent d'abord. */
export function expiringDocuments(docs: readonly DocumentRef[], now: Date, timeZone: string): (DocumentRef & { days: number })[] {
  return docs
    .filter((d) => d.active)
    .map((d) => ({ ...d, days: daysLeft(d.valid_until, now, timeZone) }))
    .filter((d): d is DocumentRef & { days: number } => d.days !== null && d.days <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, 'fr'))
}

/**
 * Documents habituellement demandés lors d'un contrôle d'un food truck (DDPP). Une catégorie est « présente »
 * si un document actif non échu y est rangé.
 */
export const EXPECTED_DOCUMENTS: readonly { category: DocumentCategory; title: string; why: string }[] = [
  { category: 'registration', title: 'Déclaration d’activité à la DDPP', why: 'Obligatoire avant l’ouverture (Cerfa 13984).' },
  { category: 'training', title: 'Attestation de formation hygiène', why: 'Au moins une personne formée (14 h) en restauration commerciale.' },
  { category: 'pms', title: 'Plan de maîtrise sanitaire', why: 'Le PMS écrit, à jour, signé par l’exploitant.' },
  { category: 'pest_control', title: 'Lutte contre les nuisibles', why: 'Contrat ou plan d’autocontrôle et suivi des passages.' },
  { category: 'supplier', title: 'Fiches techniques des produits', why: 'Allergènes et durées de conservation des produits achetés.' },
]

export function missingExpected(docs: readonly DocumentRef[], now: Date, timeZone: string): typeof EXPECTED_DOCUMENTS[number][] {
  return EXPECTED_DOCUMENTS.filter((e) => !docs.some((d) => d.active && d.category === e.category && expiryState(d, now, timeZone) !== 'expired'))
}

/** Nom de fichier pour l'ouverture / le partage : « attestation-formation-hygiene.pdf ». */
export function downloadName(doc: Pick<DocumentRef, 'title' | 'file_path'>): string {
  const ext = doc.file_path.split('.').pop() ?? 'pdf'
  const slug = doc.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${slug || 'document'}.${ext}`
}
