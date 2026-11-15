// Nettoyage et checklists (lot 5) : lecture des payloads et entrées reconstruites depuis le registre
// (corrections en chaîne, original barré), libellés. Fonctions pures, testées dans cleaning.test.ts.
import type { Checklist, ChecklistDonePayload, CleaningDonePayload, CleaningFrequency, CleaningTask } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { buildEntries, type Entry } from '../processes/entries.ts'

/** Historique affiché (jours). */
export const CLEANING_HISTORY_DAYS = 30
/** Fenêtre de chargement : l'historique, et assez pour une tâche mensuelle en retard (30 j + marge). */
export const CLEANING_LOAD_DAYS = 45
/** Photos par nettoyage (contrat : 0..3). */
export const CLEANING_PHOTOS_MAX = 3

export const CLEANING_RECORD_TYPES = ['cleaning_done', 'checklist_done', 'correction'] as const

export const FREQUENCY_LABELS: Record<CleaningFrequency, string> = {
  after_service: 'Après chaque service',
  daily: 'Tous les jours',
  weekly: 'Toutes les semaines',
  monthly: 'Tous les mois',
}
export const FREQUENCY_SHORT: Record<CleaningFrequency, string> = {
  after_service: 'Après service',
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
}

export const CHECKLIST_KIND_LABELS: Record<Checklist['kind'], string> = {
  opening: 'Ouverture',
  closing: 'Fermeture',
  pest_control: 'Nuisibles',
  other: 'Autre',
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

export function asCleaningDone(p: unknown): CleaningDonePayload | null {
  if (!isObj(p) || !str(p.task_id)) return null
  const out: CleaningDonePayload = { task_id: p.task_id }
  if (str(p.comment) && p.comment.trim()) out.comment = p.comment
  if (Array.isArray(p.photo_paths)) {
    const photos = p.photo_paths.filter(str)
    if (photos.length) out.photo_paths = photos
  }
  return out
}

export function asChecklistDone(p: unknown): ChecklistDonePayload | null {
  if (!isObj(p) || !str(p.checklist_id) || !Array.isArray(p.answers) || typeof p.all_ok !== 'boolean') return null
  const answers: ChecklistDonePayload['answers'] = []
  for (const a of p.answers) {
    if (!isObj(a) || !str(a.item_id) || typeof a.ok !== 'boolean') return null
    answers.push(str(a.comment) && a.comment.trim() ? { item_id: a.item_id, ok: a.ok, comment: a.comment } : { item_id: a.item_id, ok: a.ok })
  }
  if (answers.length === 0) return null
  return { checklist_id: p.checklist_id, answers, all_ok: p.all_ok }
}

export type CleaningEntry = Entry<CleaningDonePayload>
export type ChecklistEntry = Entry<ChecklistDonePayload>

const newestFirst = <T extends { time: string }>(a: T, b: T) => b.time.localeCompare(a.time)

export function buildCleanings(records: readonly HaccpRecord[]): CleaningEntry[] {
  return buildEntries(records, ['cleaning_done'], asCleaningDone).sort(newestFirst)
}

export function buildChecklistRuns(records: readonly HaccpRecord[]): ChecklistEntry[] {
  return buildEntries(records, ['checklist_done'], asChecklistDone).sort(newestFirst)
}

/** Réponses → payload : `all_ok` = toutes les réponses ok (règle du validateur serveur). */
export function checklistPayload(checklistId: string, answers: readonly { item_id: string; ok: boolean; comment?: string }[]): ChecklistDonePayload {
  const clean = answers.map((a) => {
    const c = a.comment?.trim()
    return c ? { item_id: a.item_id, ok: a.ok, comment: c } : { item_id: a.item_id, ok: a.ok }
  })
  return { checklist_id: checklistId, answers: clean, all_ok: clean.every((a) => a.ok) }
}

/** Libellé d'un point : celui de la checklist actuelle, sinon l'identifiant (point retiré depuis). */
export function itemLabel(checklist: Checklist | undefined, itemId: string): string {
  return checklist?.items.find((i) => i.id === itemId)?.label ?? itemId.replace(/[_-]+/g, ' ')
}

// ---------- Corrections : ce qui a changé (original barré dans l'historique) ----------

export interface Change {
  label: string
  before: string
  after: string
}

export function diffCleaning(prev: CleaningDonePayload, next: CleaningDonePayload, taskName: (id: string) => string): Change[] {
  const out: Change[] = []
  const push = (label: string, a: string, b: string) => {
    if (a !== b) out.push({ label, before: a, after: b })
  }
  push('Tâche', taskName(prev.task_id), taskName(next.task_id))
  push('Commentaire', prev.comment ?? '—', next.comment ?? '—')
  push('Photos', String(prev.photo_paths?.length ?? 0), String(next.photo_paths?.length ?? 0))
  return out
}

const answerText = (a: { ok: boolean; comment?: string } | undefined) => (!a ? '—' : a.ok ? 'Oui' : `Non${a.comment ? ` (${a.comment})` : ''}`)

export function diffChecklist(prev: ChecklistDonePayload, next: ChecklistDonePayload, checklist: Checklist | undefined): Change[] {
  const out: Change[] = []
  const ids = [...new Set([...prev.answers.map((a) => a.item_id), ...next.answers.map((a) => a.item_id)])]
  for (const id of ids) {
    const a = answerText(prev.answers.find((x) => x.item_id === id))
    const b = answerText(next.answers.find((x) => x.item_id === id))
    if (a !== b) out.push({ label: itemLabel(checklist, id), before: a, after: b })
  }
  return out
}

export function taskNameOf(tasks: readonly CleaningTask[]): (id: string) => string {
  return (id) => tasks.find((t) => t.id === id)?.name ?? 'Tâche inconnue'
}
export function checklistNameOf(lists: readonly Checklist[]): (id: string) => string {
  return (id) => lists.find((c) => c.id === id)?.name ?? 'Checklist inconnue'
}
