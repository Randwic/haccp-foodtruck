import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Checklist, CleaningTask } from '../../../../shared/payloads.ts'
import type { StaffMember } from '../../../../shared/types.ts'
import type { PhotoStatus } from '../../core/api.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { DEFAULT_TIMEZONE, normalizeCheckTimes, startOfLocalDay } from '../temperatures/schedule.ts'
import { buildChecklistRuns, buildCleanings, CLEANING_LOAD_DAYS, CLEANING_RECORD_TYPES, type ChecklistEntry, type CleaningEntry } from './model.ts'
import { checklistStatus, serviceDaysOf, summarizeCleaning, taskStatuses, type ChecklistStatus, type CleaningSummary, type TaskStatus } from './schedule.ts'

/** Jours examinés pour reconnaître les jours de service (saisies de tout type). */
const SERVICE_LOOKBACK_DAYS = 10

export interface CleaningData {
  timeZone: string
  checkTimes: string[]
  /** Tâches et checklists, désactivées comprises (noms de l'historique). */
  tasks: CleaningTask[]
  checklists: Checklist[]
  staff: StaffMember[]
  cleanings: CleaningEntry[]
  runs: ChecklistEntry[]
  serviceDays: Set<string>
  photoStatus: Record<string, PhotoStatus>
}

/** Plan de nettoyage, checklists et 45 jours de saisies ; rechargés à chaque changement de synchro. */
export function useCleaningData() {
  const core = useCore()
  const [data, setData] = useState<CleaningData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - (CLEANING_LOAD_DAYS + 1) * 86_400_000).toISOString()
      const recent = new Date(Date.now() - (SERVICE_LOOKBACK_DAYS + 1) * 86_400_000).toISOString()
      const [tasks, checklists, staff, establishment, settings, activity, ...lists] = await Promise.all([
        core.listCleaningTasks({ includeInactive: true }),
        core.listChecklists({ includeInactive: true }),
        core.listStaff(),
        core.getEstablishment(),
        core.getSettings(),
        core.listRecords({ since: recent }),
        ...CLEANING_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      const records = lists.flat()
      const cleanings = buildCleanings(records)
      const paths = [...new Set(cleanings.flatMap((c) => c.versions.flatMap((v) => v.payload.photo_paths ?? [])))]
      const photoStatus = paths.length ? await core.getPhotoStatuses(paths) : {}
      const timeZone = establishment?.timezone || DEFAULT_TIMEZONE
      setData({
        timeZone,
        checkTimes: normalizeCheckTimes(settings?.daily_check_times),
        tasks,
        checklists,
        staff,
        cleanings,
        runs: buildChecklistRuns(records),
        serviceDays: serviceDaysOf(
          activity.map((r) => r.device_time),
          timeZone,
        ),
        photoStatus,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [core])

  useEffect(() => {
    void reload()
    return core.onSyncStatusChange(() => {
      void reload()
    })
  }, [core, reload])

  return { data, error, reload }
}

/** Dernière heure (ISO) par clé, entrées déjà triées du plus récent au plus ancien. */
function lastBy<T extends { time: string }>(entries: readonly T[], key: (e: T) => string): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of entries) if (!out.has(key(e))) out.set(key(e), e.time)
  return out
}

export interface CleaningStatus {
  tasks: TaskStatus[]
  checklists: ChecklistStatus[]
  summary: CleaningSummary
}

export function computeCleaningStatus(data: CleaningData, now: Date): CleaningStatus {
  const lastDone = lastBy(data.cleanings, (c) => c.payload.task_id)
  const lastRun = lastBy(data.runs, (r) => r.payload.checklist_id)
  const tasks = taskStatuses({ tasks: data.tasks, lastDone, now, timeZone: data.timeZone, serviceDays: data.serviceDays })
  const checklists = data.checklists
    .filter((c) => c.active)
    .map((checklist) => checklistStatus({ checklist, lastAt: lastRun.get(checklist.id) ?? null, now, timeZone: data.timeZone, checkTimes: data.checkTimes }))
  const todayStart = startOfLocalDay(now, data.timeZone).getTime()
  const doneToday = data.cleanings.filter((c) => Date.parse(c.time) >= todayStart).length
  return { tasks, checklists, summary: summarizeCleaning(tasks, checklists, doneToday) }
}

/** Données + échéances, recalculées chaque minute. */
export function useCleaningStatus(tickMs = 60_000) {
  const { data, error, reload } = useCleaningData()
  const now = useNow(tickMs)
  const status = useMemo(() => (data ? computeCleaningStatus(data, now) : null), [data, now])
  return { data, error, reload, now, status }
}
