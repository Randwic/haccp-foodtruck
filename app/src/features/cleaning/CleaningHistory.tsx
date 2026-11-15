// Historique 30 jours : nettoyages et checklists, par jour ; corrections avec valeurs d'origine barrées.
import { Badge, Button } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconBan, IconCleaning, IconEdit, IconOk, IconChecklist } from '../../ui/icons.tsx'
import { PhotoGallery } from '../../ui/photos/Photos.tsx'
import { EmptyCard, PageTitle, SectionLabel, SyncBadge, entryRecords, useAuthorName } from '../processes/common.tsx'
import { dayLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { PhotoSyncLine } from '../reception/ReceptionHistory.tsx'
import { checklistNameOf, CLEANING_HISTORY_DAYS, diffChecklist, diffCleaning, FREQUENCY_SHORT, itemLabel, taskNameOf, type ChecklistEntry, type CleaningEntry } from './model.ts'
import { CorrectionTrail } from './parts.tsx'
import type { CleaningData } from './useCleaningData.ts'

export type CleaningHistoryTab = 'cleanings' | 'checklists'

function groupByDay<T extends { time: string }>(list: readonly T[], tz: string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const e of list) {
    const k = localDayKey(e.time, tz)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.entries()]
}

export function CleaningHistory(props: {
  data: CleaningData
  now: Date
  tab: CleaningHistoryTab
  onTab: (t: CleaningHistoryTab) => void
  onCorrectCleaning: (e: CleaningEntry) => void
  onCorrectChecklist: (e: ChecklistEntry) => void
}) {
  const { data, now, tab } = props
  const tz = data.timeZone
  const from = startOfLocalDay(now, tz, CLEANING_HISTORY_DAYS).getTime()
  const author = useAuthorName(data.staff)
  const taskName = taskNameOf(data.tasks)
  const checklistName = checklistNameOf(data.checklists)

  const tabs = (
    <div role="tablist" aria-label="Historique" className="mb-5 grid max-w-md grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
      {(
        [
          ['cleanings', 'Nettoyages', IconCleaning],
          ['checklists', 'Checklists', IconChecklist],
        ] as const
      ).map(([t, label, Icon]) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => props.onTab(t)}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-semibold ${tab === t ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`}
        >
          <Icon size={18} className={tab === t ? 'text-accent' : ''} />
          {label}
        </button>
      ))}
    </div>
  )

  let body
  if (tab === 'cleanings') {
    const list = data.cleanings.filter((e) => Date.parse(e.time) >= from)
    body =
      list.length === 0 ? (
        <EmptyCard>Aucun nettoyage enregistré sur cette période.</EmptyCard>
      ) : (
        groupByDay(list, tz).map(([key, items]) => (
          <section key={key} aria-label={dayLabel(items[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(items[0].time, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {items.map((e) => {
                const task = data.tasks.find((t) => t.id === e.payload.task_id)
                return (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Nettoyage de ${formatTime(e.time, tz)}, ${taskName(e.payload.task_id)}`}>
                    <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</div>
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[18px] font-semibold text-fg">{taskName(e.payload.task_id)}</span>
                        {task && <Badge tone="neutral">{FREQUENCY_SHORT[task.frequency]}</Badge>}
                        {e.corrected && (
                          <Badge tone="neutral">
                            <IconEdit size={14} /> Corrigé
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[15px] text-fg-muted">par {author(e.authorId)}</p>
                      {e.payload.comment && <p className="mt-1 text-[15px] text-fg">{e.payload.comment}</p>}
                      {(e.payload.photo_paths?.length ?? 0) > 0 && (
                        <div className="mt-2 space-y-2">
                          <PhotoGallery paths={e.payload.photo_paths!} label={`Nettoyage — ${taskName(e.payload.task_id)}`} status={data.photoStatus} />
                          <PhotoSyncLine paths={e.payload.photo_paths!} data={{ photoStatus: data.photoStatus }} />
                        </div>
                      )}
                      {e.versions.slice(1).map((v, k) => (
                        <CorrectionTrail key={v.record.id} when={formatTime(v.record.device_time, tz)} author={author(v.record.author_id)} reason={v.reason} changes={diffCleaning(e.versions[k].payload, v.payload, taskName)} />
                      ))}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                      <SyncBadge records={entryRecords(e)} />
                      <Button variant="secondary" onClick={() => props.onCorrectCleaning(e)} icon={<IconEdit size={18} />} aria-label={`Corriger le nettoyage de ${formatTime(e.time, tz)} (${taskName(e.payload.task_id)})`}>
                        Corriger
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )
  } else {
    const list = data.runs.filter((e) => Date.parse(e.time) >= from)
    body =
      list.length === 0 ? (
        <EmptyCard>Aucune checklist remplie sur cette période.</EmptyCard>
      ) : (
        groupByDay(list, tz).map(([key, items]) => (
          <section key={key} aria-label={dayLabel(items[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(items[0].time, now, tz)}</SectionLabel>
            <ul className="space-y-3">
              {items.map((e) => {
                const cl = data.checklists.find((c) => c.id === e.payload.checklist_id)
                const no = e.payload.answers.filter((a) => !a.ok)
                return (
                  <li
                    key={e.id}
                    aria-label={`Checklist ${checklistName(e.payload.checklist_id)} de ${formatTime(e.time, tz)}${no.length ? `, ${plural(no.length, 'non-conformité', 'non-conformités')}` : ', conforme'}`}
                    className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${no.length ? 'border-danger/35' : 'border-line'}`}
                  >
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                      <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</div>
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[18px] font-semibold text-fg">{checklistName(e.payload.checklist_id)}</span>
                          {e.payload.all_ok ? (
                            <Badge tone="ok">
                              <IconOk size={14} strokeWidth={2.25} /> Tout conforme
                            </Badge>
                          ) : (
                            <Badge tone="error">
                              <IconBan size={14} /> {plural(no.length, 'non-conformité', 'non-conformités')}
                            </Badge>
                          )}
                          {e.corrected && (
                            <Badge tone="neutral">
                              <IconEdit size={14} /> Corrigée
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[15px] text-fg-muted">
                          par {author(e.authorId)} · {e.payload.answers.length - no.length}/{e.payload.answers.length} points conformes
                        </p>
                        {no.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {no.map((a) => (
                              <li key={a.item_id} className="flex items-start gap-2 text-[15px] text-fg">
                                <IconBan size={16} className="mt-0.5 shrink-0 text-danger" />
                                <span>
                                  <span className="font-semibold">{itemLabel(cl, a.item_id)}</span>
                                  {a.comment ? <span className="text-fg-muted"> — {a.comment}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {e.versions.slice(1).map((v, k) => (
                          <CorrectionTrail key={v.record.id} when={formatTime(v.record.device_time, tz)} author={author(v.record.author_id)} reason={v.reason} changes={diffChecklist(e.versions[k].payload, v.payload, cl)} />
                        ))}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                        <SyncBadge records={entryRecords(e)} />
                        <Button variant="secondary" onClick={() => props.onCorrectChecklist(e)} icon={<IconEdit size={18} />} aria-label={`Corriger la checklist ${checklistName(e.payload.checklist_id)} de ${formatTime(e.time, tz)}`}>
                          Corriger
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )
  }

  return (
    <>
      <PageTitle title="Historique — nettoyage" subtitle={`Les ${CLEANING_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      {tabs}
      {body}
    </>
  )
}
