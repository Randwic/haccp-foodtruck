import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StaffMember } from '../../../../shared/types.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import {
  buildThermometerChecks,
  summarizeThermometers,
  THERMOMETER_HISTORY_DAYS,
  THERMOMETER_RECORD_TYPES,
  thermometerRules,
  thermometerStatuses,
  type ThermometerCheckEntry,
  type ThermometerRules,
  type ThermometerStatus,
  type ThermometerSummary,
} from './model.ts'

export interface ThermometerData {
  timeZone: string
  rules: ThermometerRules
  staff: StaffMember[]
  checks: ThermometerCheckEntry[]
}

/** Réglages et vérifications des thermomètres (≈ 400 jours) ; rechargés à chaque changement de synchro. */
export function useThermometerData() {
  const core = useCore()
  const [data, setData] = useState<ThermometerData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - (THERMOMETER_HISTORY_DAYS + 2) * 86_400_000).toISOString()
      const [settings, establishment, staff, ...lists] = await Promise.all([
        core.getSettings(),
        core.getEstablishment(),
        core.listStaff(),
        ...THERMOMETER_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      setData({
        timeZone: establishment?.timezone || DEFAULT_TIMEZONE,
        rules: thermometerRules(settings),
        staff,
        checks: buildThermometerChecks(lists.flat()),
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

export function useThermometerStatus(tickMs = 60_000) {
  const { data, error, reload } = useThermometerData()
  const now = useNow(tickMs)
  const statuses = useMemo<ThermometerStatus[]>(() => (data ? thermometerStatuses({ checks: data.checks, rules: data.rules, now, timeZone: data.timeZone }) : []), [data, now])
  const summary = useMemo<ThermometerSummary | null>(() => (data ? summarizeThermometers(statuses) : null), [data, statuses])
  return { data, error, reload, now, statuses, summary }
}
