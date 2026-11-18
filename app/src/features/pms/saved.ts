// Réponses de l'assistant PMS déjà saisies : brouillon de cet appareil, sinon dernière version enregistrée
// dans les documents (réponses rangées dans le PDF). Partagé par l'assistant PMS et l'onglet RGPD.
import type { DocumentRef } from '../../../../shared/payloads.ts'
import type { ManagerApi } from '../../manager/api.ts'
import { parseAnswers, type PmsAnswers } from './model.ts'
import { answersFromPdf } from './pdf.ts'

const DRAFT_KEY = 'haccp.pms-draft.v1'
/** Note des PDF générés par l'assistant (reconnaissance des versions). */
export const PMS_NOTE = 'Généré par l’assistant PMS de l’application.'

export function readDraft(defaults: PmsAnswers): PmsAnswers | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? parseAnswers(JSON.parse(raw), defaults) : null
  } catch {
    return null
  }
}
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* rien */
  }
}
export function writeDraft(a: PmsAnswers) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(a))
  } catch {
    /* stockage plein : sans importance, le brouillon reste à l'écran */
  }
}

export const isAssistantPms = (d: DocumentRef) => d.category === 'pms' && d.mime_type === 'application/pdf' && (d.notes ?? '').startsWith(PMS_NOTE)

/** Réponses connues (brouillon, sinon dernier PMS enregistré), ou null. */
export async function savedPmsAnswers(manager: ManagerApi | null, defaults: PmsAnswers, documents?: DocumentRef[] | null): Promise<{ answers: PmsAnswers; origin: 'draft' | 'saved' } | null> {
  const draft = readDraft(defaults)
  if (draft) return { answers: draft, origin: 'draft' }
  if (!manager) return null
  const docs = documents ?? (await manager.listDocuments().catch(() => null))
  const last = docs?.filter((d) => d.active && isAssistantPms(d)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  if (!last) return null
  const saved = await manager
    .downloadDocument(last)
    .then((b) => b.arrayBuffer())
    .then((buf) => answersFromPdf(buf, defaults))
    .catch(() => null)
  return saved ? { answers: saved, origin: 'saved' } : null
}
