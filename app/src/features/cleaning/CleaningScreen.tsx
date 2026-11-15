// Module Nettoyage (lot 5) : tâches dues du plan de nettoyage, checklists, historique 30 jours, corrections.
import { useState } from 'react'
import { Badge, Button, Notice } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconChevronRight, IconCleaning, IconHistory, IconOk, IconChecklist } from '../../ui/icons.tsx'
import { BackButton, EmptyCard, PageTitle, SectionLabel } from '../processes/common.tsx'
import { plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { ChecklistRun } from './ChecklistRun.tsx'
import { CleaningHistory, type CleaningHistoryTab } from './CleaningHistory.tsx'
import { CHECKLIST_KIND_LABELS, FREQUENCY_SHORT, taskNameOf } from './model.ts'
import { DueBadge, dueBorder } from './parts.tsx'
import { DUE_RANK, type ChecklistStatus, type TaskStatus } from './schedule.ts'
import { TaskSheet } from './TaskSheet.tsx'
import { useCleaningStatus } from './useCleaningData.ts'

type Back = { name: 'home' } | { name: 'history'; tab: CleaningHistoryTab }
type View =
  | Back
  | { name: 'task'; taskId: string }
  | { name: 'checklist'; checklistId: string; back: Back | 'exit' }
  | { name: 'correct-cleaning'; entryId: string; back: Back }
  | { name: 'correct-checklist'; entryId: string; back: Back }

export interface CleaningScreenProps {
  onBack: () => void
  /** Ouvre directement une checklist (rappel de l'accueil) ; « Annuler » revient alors à l'accueil. */
  openChecklistId?: string
}

export function CleaningScreen({ onBack, openChecklistId }: CleaningScreenProps) {
  const { data, error, reload, now, status } = useCleaningStatus(30_000)
  const [view, setView] = useState<View>(openChecklistId ? { name: 'checklist', checklistId: openChecklistId, back: 'exit' } : { name: 'home' })
  const goBack = (b: Back | 'exit') => (b === 'exit' ? onBack() : setView(b))

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data || !status) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else if (view.name === 'task' || view.name === 'correct-cleaning') {
    const entry = view.name === 'correct-cleaning' ? data.cleanings.find((e) => e.id === view.entryId) : undefined
    const taskId = view.name === 'task' ? view.taskId : entry?.payload.task_id
    const task = data.tasks.find((t) => t.id === taskId)
    const back: Back = view.name === 'correct-cleaning' ? view.back : { name: 'home' }
    body = !task ? (
      <Notice>Tâche introuvable.</Notice>
    ) : (
      <>
        <BackButton label={back.name === 'history' ? 'Historique' : 'Nettoyage'} onClick={() => setView(back)} />
        <TaskSheet
          key={view.name === 'task' ? view.taskId : view.entryId}
          task={task}
          status={status.tasks.find((s) => s.task.id === task.id)}
          tasks={data.tasks.filter((t) => t.active || t.id === task.id)}
          timeZone={data.timeZone}
          now={now}
          correcting={entry}
          onCancel={() => setView(back)}
          onSaved={async () => {
            await reload()
            setView(back)
          }}
        />
      </>
    )
  } else if (view.name === 'checklist' || view.name === 'correct-checklist') {
    const entry = view.name === 'correct-checklist' ? data.runs.find((e) => e.id === view.entryId) : undefined
    const id = view.name === 'checklist' ? view.checklistId : entry?.payload.checklist_id
    const checklist = data.checklists.find((c) => c.id === id)
    const back = view.back
    body = !checklist ? (
      <Notice>Checklist introuvable.</Notice>
    ) : (
      <>
        <BackButton label={back === 'exit' ? 'Accueil' : back.name === 'history' ? 'Historique' : 'Nettoyage'} onClick={() => goBack(back)} />
        <ChecklistRun
          key={view.name === 'checklist' ? view.checklistId : view.entryId}
          checklist={checklist}
          status={status.checklists.find((s) => s.checklist.id === checklist.id)}
          timeZone={data.timeZone}
          correcting={entry}
          onCancel={() => goBack(back)}
          onSaved={async () => {
            await reload()
            goBack(back === 'exit' ? { name: 'home' } : back)
          }}
        />
      </>
    )
  } else if (view.name === 'history') {
    const back: Back = view
    body = (
      <>
        <BackButton label="Nettoyage" onClick={() => setView({ name: 'home' })} />
        <CleaningHistory
          data={data}
          now={now}
          tab={view.tab}
          onTab={(tab) => setView({ name: 'history', tab })}
          onCorrectCleaning={(e) => setView({ name: 'correct-cleaning', entryId: e.id, back })}
          onCorrectChecklist={(e) => setView({ name: 'correct-checklist', entryId: e.id, back })}
        />
      </>
    )
  } else {
    const todo = status.tasks.filter((t) => t.state !== 'done')
    const upToDate = status.tasks.filter((t) => t.state === 'done')
    const tz = data.timeZone
    const todayStart = startOfLocalDay(now, tz).getTime()
    const doneToday = data.cleanings.filter((e) => Date.parse(e.time) >= todayStart)
    const taskName = taskNameOf(data.tasks)
    const checklists = [...status.checklists].sort((a, b) => DUE_RANK[a.state] - DUE_RANK[b.state] || a.checklist.name.localeCompare(b.checklist.name, 'fr'))
    const lateCount = status.summary.late + status.summary.overdue
    body = (
      <>
        <BackButton label="Accueil" onClick={onBack} />
        <PageTitle
          title="Nettoyage"
          subtitle="Plan de nettoyage et de désinfection, checklists"
          actions={
            <Button variant="secondary" onClick={() => setView({ name: 'history', tab: 'cleanings' })} icon={<IconHistory size={20} />}>
              Historique
            </Button>
          }
        />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
          <div className="min-w-0">
            <section aria-labelledby="cl-todo">
              <SectionLabel id="cl-todo">
                À faire maintenant{todo.length ? ` · ${todo.length}` : ''}
                {lateCount > 0 ? ` · ${plural(lateCount, 'en retard', 'en retard')}` : ''}
              </SectionLabel>
              {todo.length === 0 ? (
                <EmptyCard>
                  <span className="flex items-center gap-2 text-ok">
                    <IconOk size={20} /> Tout le plan de nettoyage est à jour.
                  </span>
                </EmptyCard>
              ) : (
                <ul className="space-y-2.5">
                  {todo.map((s) => (
                    <TaskRow key={s.task.id} status={s} onOpen={() => setView({ name: 'task', taskId: s.task.id })} />
                  ))}
                </ul>
              )}
            </section>
            {upToDate.length > 0 && (
              <section aria-labelledby="cl-done" className="mt-8">
                <SectionLabel id="cl-done">À jour · {upToDate.length}</SectionLabel>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  {upToDate.map((s) => (
                    <li key={s.task.id}>
                      <button type="button" onClick={() => setView({ name: 'task', taskId: s.task.id })} aria-label={`${s.task.name} — ${s.label}`} className="flex min-h-16 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left active:bg-pressed sm:px-5">
                        <IconOk size={20} className="shrink-0 text-ok" />
                        <span className="min-w-0 flex-1 text-[16px] font-semibold text-fg">{s.task.name}</span>
                        <span className="text-[15px] text-fg-muted">{s.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="min-w-0">
            <section aria-labelledby="cl-checklists">
              <SectionLabel id="cl-checklists">Checklists</SectionLabel>
              {checklists.length === 0 ? (
                <EmptyCard>Aucune checklist active. Le gérant peut en créer dans Gestion › Checklists.</EmptyCard>
              ) : (
                <ul className="space-y-2.5">
                  {checklists.map((s) => (
                    <ChecklistRow key={s.checklist.id} status={s} onOpen={() => setView({ name: 'checklist', checklistId: s.checklist.id, back: { name: 'home' } })} />
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="cl-today" className="mt-8">
              <SectionLabel id="cl-today">Fait aujourd’hui</SectionLabel>
              {doneToday.length === 0 ? (
                <EmptyCard>Aucun nettoyage enregistré aujourd’hui.</EmptyCard>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  {doneToday.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <span className="w-14 shrink-0 text-[16px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</span>
                      <span className="min-w-0 flex-1 text-[16px] text-fg">{taskName(e.payload.task_id)}</span>
                      <IconOk size={18} className="shrink-0 text-ok" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </>
    )
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}

function TaskRow({ status: s, onOpen }: { status: TaskStatus; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${s.task.name} — ${s.label}`}
        className={`flex min-h-20 w-full items-center gap-4 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-pressed sm:px-5 ${dueBorder(s.state)}`}
      >
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconCleaning size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] leading-snug font-semibold text-fg">{s.task.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{FREQUENCY_SHORT[s.task.frequency]}</Badge>
            <DueBadge state={s.state} label={s.label} />
          </span>
        </span>
        <IconChevronRight size={22} className="shrink-0 text-fg-subtle" />
      </button>
    </li>
  )
}

function ChecklistRow({ status: s, onOpen }: { status: ChecklistStatus; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Checklist ${s.checklist.name} — ${s.label}`}
        className={`flex min-h-20 w-full items-center gap-4 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-pressed sm:px-5 ${dueBorder(s.state)}`}
      >
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconChecklist size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] leading-snug font-semibold text-fg">{s.checklist.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{CHECKLIST_KIND_LABELS[s.checklist.kind]}</Badge>
            <DueBadge state={s.state} label={s.label} />
          </span>
        </span>
        <IconChevronRight size={22} className="shrink-0 text-fg-subtle" />
      </button>
    </li>
  )
}
