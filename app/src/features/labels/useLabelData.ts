import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Product, Recipe } from '../../../../shared/payloads.ts'
import type { StaffMember } from '../../../../shared/types.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { buildThawBatches, type ThawBatch } from '../processes/entries.ts'
import { buildReceptions, buildWastes, type ReceptionEntry } from '../reception/model.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { getConsumed } from './labelSettings.ts'
import { buildLabels, dueItems, LABEL_RECORD_TYPES, summarizeDue, type DueSummary, type LabelEntry } from './model.ts'

/** Étiquettes chargées : 32 jours (échéances des produits à longue durée de vie, historique 7 jours). */
export const LABEL_LOAD_DAYS = 32
export const LABEL_HISTORY_DAYS = 7

export interface LabelData {
  timeZone: string
  /** Produits et recettes, désactivés compris (nom des anciennes étiquettes) ; trier sur `active` pour proposer. */
  products: Product[]
  recipes: Recipe[]
  staff: StaffMember[]
  labels: LabelEntry[]
  receptions: ReceptionEntry[]
  thaws: ThawBatch[]
}

/** Références + registre du module ; rechargés à chaque changement de synchro. */
export function useLabelData() {
  const core = useCore()
  const [data, setData] = useState<LabelData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - LABEL_LOAD_DAYS * 86_400_000).toISOString()
      const [products, recipes, staff, establishment, ...lists] = await Promise.all([
        core.listProducts({ includeInactive: true }),
        core.listRecipes({ includeInactive: true }),
        core.listStaff(),
        core.getEstablishment(),
        ...LABEL_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      const records = lists.flat()
      const wastes = buildWastes(records)
      setData({
        timeZone: establishment?.timezone || DEFAULT_TIMEZONE,
        products,
        recipes,
        staff,
        labels: buildLabels(records, wastes),
        receptions: buildReceptions(records),
        thaws: buildThawBatches(records),
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

/** Données + échéances (accueil, écran du module). `consumedVersion` force la relecture des « épuisés ». */
export function useLabelStatus(tickMs = 60_000, consumedVersion = 0) {
  const { data, error, reload } = useLabelData()
  const now = useNow(tickMs)
  const due = useMemo(() => {
    void consumedVersion
    return data ? dueItems(data.labels, now, data.timeZone, getConsumed()) : null
  }, [data, now, consumedVersion])
  const summary = useMemo<DueSummary | null>(() => (due ? summarizeDue(due) : null), [due])
  return { data, error, reload, now, due, summary }
}
