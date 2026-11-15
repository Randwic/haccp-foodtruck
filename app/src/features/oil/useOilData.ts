import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Equipment, StaffMember } from '../../../../shared/types.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { buildOilChanges, buildOilChecks, OIL_HISTORY_DAYS, OIL_RECORD_TYPES, oilLimits, summarizeOil, vatStatuses, type OilChangeEntry, type OilCheckEntry, type OilLimits, type OilSummary, type VatStatus } from './model.ts'

export interface OilData {
  timeZone: string
  limits: OilLimits
  /** Bacs de friteuse actifs. */
  vats: Equipment[]
  staff: StaffMember[]
  checks: OilCheckEntry[]
  changes: OilChangeEntry[]
}

/** Bacs, réglages et 32 jours de contrôles / changements ; rechargés à chaque changement de synchro. */
export function useOilData() {
  const core = useCore()
  const [data, setData] = useState<OilData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - (OIL_HISTORY_DAYS + 2) * 86_400_000).toISOString()
      const [equipment, settings, establishment, staff, ...lists] = await Promise.all([
        core.listEquipment(),
        core.getSettings(),
        core.getEstablishment(),
        core.listStaff(),
        ...OIL_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      const records = lists.flat()
      setData({
        timeZone: establishment?.timezone || DEFAULT_TIMEZONE,
        limits: oilLimits(settings),
        vats: equipment.filter((e) => e.kind === 'fryer_vat' && e.active),
        staff,
        checks: buildOilChecks(records),
        changes: buildOilChanges(records),
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

export function useOilStatus(tickMs = 60_000) {
  const { data, error, reload } = useOilData()
  const now = useNow(tickMs)
  const statuses = useMemo<VatStatus[]>(
    () => (data ? vatStatuses({ vats: data.vats, checks: data.checks, changes: data.changes, limits: data.limits, now, timeZone: data.timeZone }) : []),
    [data, now],
  )
  const summary = useMemo<OilSummary | null>(() => (data ? summarizeOil(statuses) : null), [data, statuses])
  return { data, error, reload, now, statuses, summary }
}
