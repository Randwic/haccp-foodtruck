// Échéances du plan de nettoyage et rappels des checklists (fonctions pures, sans React).
// Les jours sont des jours LOCAUX de l'établissement (`establishment.timezone`), changements d'heure compris.
//
// Tâches (fréquence → règle) :
//  - after_service : une fois par JOUR DE SERVICE. Faite aujourd'hui → « fait » ; sinon « à faire ». En retard
//    si elle n'a pas été faite lors du ou des derniers jours de service (un jour de service = un jour local où
//    l'appareil a enregistré au moins une saisie HACCP) : 1 service manqué → ambre, 2 et plus → rouge.
//  - daily : une fois par jour calendaire. Pas faite hier → ambre (1–2 jours de retard), 3 jours et plus → rouge.
//  - weekly : 7 jours glissants depuis la dernière fois (faite le lundi → due le lundi suivant) ; 1–2 jours de
//    retard → ambre, 3 et plus → rouge.
//  - monthly : 30 jours glissants ; 1–6 jours de retard → ambre, 7 et plus → rouge.
//  Une tâche jamais faite (dans la fenêtre chargée) est « à faire », sans retard (pas de fausse alerte pour une
//  tâche qui vient d'être ajoutée au plan).
//
// Checklists (rappels de l'accueil) :
//  - opening : une fois par jour, avant le premier créneau de relevé (`daily_check_times`) ; passé ce créneau
//    sans checklist → en retard (ambre).
//  - closing : rappelée une fois le dernier créneau de relevé du jour passé, tant qu'elle n'est pas faite.
//  - pest_control : hebdomadaire (7 jours glissants, mêmes retards que les tâches hebdomadaires).
//  - other : sur demande, jamais rappelée.
import type { Checklist, CleaningFrequency, CleaningTask } from '../../../../shared/payloads.ts'
import { formatTime } from '../../ui/format.ts'
import { addDays, localDateOf, localDayKey, slotsOfDay, type LocalDate } from '../temperatures/schedule.ts'

export type DueState = 'done' | 'due' | 'late' | 'overdue'

/** Rang de tri : le plus urgent d'abord. */
export const DUE_RANK: Record<DueState | 'upcoming' | 'none', number> = { overdue: 0, late: 1, due: 2, upcoming: 3, done: 4, none: 5 }

const dayNumber = (d: LocalDate) => Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000)
const keyOf = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
const shortDate = (d: LocalDate) => `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}`

/** Écart en jours locaux entre deux instants (b − a). */
export function localDaysBetween(a: Date | string, b: Date | string, timeZone: string): number {
  return dayNumber(localDateOf(new Date(b), timeZone)) - dayNumber(localDateOf(new Date(a), timeZone))
}

/** Jours de service : jours locaux (AAAA-MM-JJ) où au moins une saisie a été faite. */
export function serviceDaysOf(times: Iterable<string>, timeZone: string): Set<string> {
  const out = new Set<string>()
  for (const t of times) out.add(localDayKey(t, timeZone))
  return out
}

export interface TaskStatus {
  task: CleaningTask
  /** Heure (ISO) du dernier nettoyage de cette tâche, ou null. */
  lastAt: string | null
  state: DueState
  /** Jours de retard (services manqués pour `after_service`). */
  lateBy: number
  /** Prochaine échéance (AAAA-MM-JJ) d'une tâche hebdomadaire / mensuelle à jour. */
  nextDue: string | null
  /** Texte court de l'échéance (« À faire aujourd’hui », « En retard de 3 jours »…). */
  label: string
}

const PERIOD: Partial<Record<CleaningFrequency, { days: number; amberUpTo: number }>> = {
  weekly: { days: 7, amberUpTo: 2 },
  monthly: { days: 30, amberUpTo: 6 },
}

function lateLabel(n: number): string {
  return `En retard de ${n} jour${n > 1 ? 's' : ''}`
}

/** Échéance d'une tâche selon sa fréquence et son dernier nettoyage. */
export function taskStatus(input: {
  task: CleaningTask
  lastAt: string | null
  now: Date
  timeZone: string
  /** Jours de service (voir `serviceDaysOf`) : utilisés par `after_service`. */
  serviceDays?: ReadonlySet<string>
}): TaskStatus {
  const { task, lastAt, now, timeZone: tz } = input
  const today = localDateOf(now, tz)
  const todayN = dayNumber(today)
  const last = lastAt ? localDateOf(new Date(lastAt), tz) : null
  const lastN = last ? dayNumber(last) : null
  const base = { task, lastAt, nextDue: null as string | null }
  const doneLabel = (prefix: string) => `${prefix} ${lastAt ? `à ${formatTime(lastAt, tz)}` : ''}`.trim()

  if (task.frequency === 'after_service' || task.frequency === 'daily') {
    if (lastN !== null && lastN >= todayN) return { ...base, state: 'done', lateBy: 0, label: doneLabel('Fait aujourd’hui') }
    const due = task.frequency === 'after_service' ? 'À faire après le service' : 'À faire aujourd’hui'
    if (lastN === null) return { ...base, state: 'due', lateBy: 0, label: due }
    let missed: number
    if (task.frequency === 'daily') missed = todayN - lastN - 1
    else {
      missed = 0
      for (const k of input.serviceDays ?? []) {
        const [y, m, d] = k.split('-').map(Number)
        const n = dayNumber({ year: y, month: m, day: d })
        if (n > lastN && n < todayN) missed++
      }
    }
    if (missed <= 0) return { ...base, state: 'due', lateBy: 0, label: due }
    const state: DueState = task.frequency === 'after_service' ? (missed >= 2 ? 'overdue' : 'late') : missed >= 3 ? 'overdue' : 'late'
    const label = task.frequency === 'after_service' ? (missed > 1 ? `Oubliée aux ${missed} derniers services` : 'Oubliée au dernier service') : lateLabel(missed)
    return { ...base, state, lateBy: missed, label }
  }

  const period = PERIOD[task.frequency]!
  if (lastN === null || last === null) return { ...base, state: 'due', lateBy: 0, label: 'À faire' }
  const dueDay = addDays(last, period.days)
  const late = todayN - dayNumber(dueDay)
  if (late < 0) return { ...base, nextDue: keyOf(dueDay), state: 'done', lateBy: 0, label: `À jour · prochaine fois le ${shortDate(dueDay)}` }
  if (late === 0) return { ...base, state: 'due', lateBy: 0, label: 'À faire aujourd’hui' }
  return { ...base, state: late > period.amberUpTo ? 'overdue' : 'late', lateBy: late, label: lateLabel(late) }
}

/** Statut de chaque tâche active, du plus urgent au moins urgent (puis par nom). */
export function taskStatuses(input: {
  tasks: readonly CleaningTask[]
  /** Dernier nettoyage par tâche (ISO), corrections appliquées. */
  lastDone: ReadonlyMap<string, string>
  now: Date
  timeZone: string
  serviceDays?: ReadonlySet<string>
}): TaskStatus[] {
  return input.tasks
    .filter((t) => t.active)
    .map((task) => taskStatus({ task, lastAt: input.lastDone.get(task.id) ?? null, now: input.now, timeZone: input.timeZone, serviceDays: input.serviceDays }))
    .sort((a, b) => DUE_RANK[a.state] - DUE_RANK[b.state] || b.lateBy - a.lateBy || a.task.name.localeCompare(b.task.name, 'fr'))
}

// ---------- Checklists ----------

export type ChecklistState = DueState | 'upcoming' | 'none'

export interface ChecklistStatus {
  checklist: Checklist
  lastAt: string | null
  state: ChecklistState
  /** À rappeler sur l'accueil (à faire ou en retard). */
  reminder: boolean
  label: string
}

/** Rappel d'une checklist selon sa nature (voir l'en-tête du fichier). */
export function checklistStatus(input: { checklist: Checklist; lastAt: string | null; now: Date; timeZone: string; checkTimes: readonly string[] }): ChecklistStatus {
  const { checklist, lastAt, now, timeZone: tz } = input
  const today = localDateOf(now, tz)
  const doneToday = lastAt !== null && localDaysBetween(lastAt, now, tz) <= 0
  const slots = slotsOfDay(today, input.checkTimes, tz)
  const out = (state: ChecklistState, label: string): ChecklistStatus => ({ checklist, lastAt, state, label, reminder: state === 'due' || state === 'late' || state === 'overdue' })
  const doneLabel = () => `Faite aujourd’hui à ${formatTime(lastAt!, tz)}`

  switch (checklist.kind) {
    case 'opening': {
      if (doneToday) return out('done', doneLabel())
      const first = slots[0]
      if (!first) return out('due', 'À faire à l’ouverture')
      return now.getTime() < first.getTime()
        ? out('due', `À faire avant ${formatTime(first, tz)}`)
        : out('late', `En retard : à faire avant le relevé de ${formatTime(first, tz)}`)
    }
    case 'closing': {
      if (doneToday) return out('done', doneLabel())
      const lastSlot = slots[slots.length - 1]
      if (!lastSlot) return out('upcoming', 'À faire en fin de service')
      return now.getTime() >= lastSlot.getTime() ? out('due', 'À faire avant de partir') : out('upcoming', `Après le relevé de ${formatTime(lastSlot, tz)}`)
    }
    case 'pest_control': {
      if (!lastAt) return out('due', 'À faire cette semaine')
      const lastDay = localDateOf(new Date(lastAt), tz)
      const dueDay = addDays(lastDay, 7)
      const late = dayNumber(today) - dayNumber(dueDay)
      if (late < 0) return out('done', `À jour · prochain contrôle le ${shortDate(dueDay)}`)
      if (late === 0) return out('due', 'À faire aujourd’hui')
      return out(late > 2 ? 'overdue' : 'late', lateLabel(late))
    }
    default:
      return out('none', doneToday ? doneLabel() : 'Sur demande')
  }
}

export interface CleaningSummary {
  /** Tâches à faire (dont en retard). */
  todo: number
  late: number
  overdue: number
  doneToday: number
  /** Checklists à rappeler. */
  checklists: ChecklistStatus[]
}

export function summarizeCleaning(tasks: readonly TaskStatus[], checklists: readonly ChecklistStatus[], doneToday: number): CleaningSummary {
  return {
    todo: tasks.filter((t) => t.state !== 'done').length,
    late: tasks.filter((t) => t.state === 'late').length,
    overdue: tasks.filter((t) => t.state === 'overdue').length,
    doneToday,
    checklists: checklists.filter((c) => c.reminder).sort((a, b) => DUE_RANK[a.state] - DUE_RANK[b.state]),
  }
}
