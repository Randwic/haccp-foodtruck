import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Equipment, HaccpRecord, StaffMember, Threshold } from '../../../../shared/types.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { DEFAULT_TIMEZONE, startOfLocalDay } from '../temperatures/schedule.ts'
import { buildSpotChecks, buildThawBatches, buildTimedBatches, PROCESS_RECORD_TYPES, type SpotEntry, type ThawBatch, type TimedBatch } from './entries.ts'
import { spotRule, timedRule, type SpotRule, type TimedKind, type TimedRule } from './thresholds.ts'
import { summarizeSpot, summarizeThaw, summarizeTimed, type TimedSummary } from './timing.ts'

/** Historique affiché : aujourd'hui + 7 jours ; chargement avec une marge (fuseaux, lots longs). */
export const PROCESS_HISTORY_DAYS = 7
const LOAD_WINDOW_MS = (PROCESS_HISTORY_DAYS + 2) * 86_400_000

export interface ProcessData {
  equipment: Equipment[]
  thresholds: Threshold[]
  timeZone: string
  staff: StaffMember[]
  records: HaccpRecord[]
  cooling: TimedBatch[]
  reheating: TimedBatch[]
  thawing: ThawBatch[]
  spot: SpotEntry[]
  rules: { cooling: TimedRule; reheating: TimedRule; hot_holding: SpotRule; cooking_check: SpotRule }
}

export function buildProcessData(input: Omit<ProcessData, 'cooling' | 'reheating' | 'thawing' | 'spot' | 'rules'>): ProcessData {
  const { records, thresholds } = input
  return {
    ...input,
    cooling: buildTimedBatches(records, 'cooling'),
    reheating: buildTimedBatches(records, 'reheating'),
    thawing: buildThawBatches(records),
    spot: buildSpotChecks(records),
    rules: {
      cooling: timedRule('cooling', thresholds),
      reheating: timedRule('reheating', thresholds),
      hot_holding: spotRule('hot_holding', thresholds),
      cooking_check: spotRule('cooking_check', thresholds),
    },
  }
}

/** Références + enregistrements des procédés ; rechargés à chaque changement de synchro. */
export function useProcessData() {
  const core = useCore()
  const [data, setData] = useState<ProcessData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - LOAD_WINDOW_MS).toISOString()
      const [equipment, thresholds, establishment, staff, ...lists] = await Promise.all([
        core.listEquipment(),
        core.listThresholds(),
        core.getEstablishment(),
        core.listStaff(),
        ...PROCESS_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      setData(buildProcessData({ equipment, thresholds, timeZone: establishment?.timezone || DEFAULT_TIMEZONE, staff, records: lists.flat() }))
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

export interface ProcessSummary {
  cooling: TimedSummary
  reheating: TimedSummary
  spot: { today: number; missingActions: number }
  thawing: { running: number }
}

export function summarizeProcesses(data: ProcessData, now: Date): ProcessSummary {
  return {
    cooling: summarizeTimed(data.cooling, data.rules.cooling, now),
    reheating: summarizeTimed(data.reheating, data.rules.reheating, now),
    spot: summarizeSpot(data.spot, startOfLocalDay(now, data.timeZone)),
    thawing: summarizeThaw(data.thawing),
  }
}

/** Données + compteurs, horloge rafraîchie toutes les `tickMs` (chronomètres). */
export function useProcessStatus(tickMs = 15_000) {
  const { data, error, reload } = useProcessData()
  const now = useNow(tickMs)
  const summary = useMemo(() => (data ? summarizeProcesses(data, now) : null), [data, now])
  return { data, error, reload, now, summary }
}

export function batchesOf(data: ProcessData, kind: TimedKind): TimedBatch[] {
  return kind === 'cooling' ? data.cooling : data.reheating
}
