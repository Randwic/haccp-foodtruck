import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Supplier } from '../../../../shared/payloads.ts'
import type { StaffMember } from '../../../../shared/types.ts'
import type { PhotoStatus } from '../../core/api.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import {
  buildReceptions,
  buildWastes,
  RECEPTION_HISTORY_DAYS,
  RECEPTION_RECORD_TYPES,
  summarizeReceptions,
  type ReceptionEntry,
  type ReceptionSummary,
  type WasteEntry,
} from './model.ts'

const LOAD_WINDOW_MS = (RECEPTION_HISTORY_DAYS + 2) * 86_400_000

export interface ReceptionData {
  timeZone: string
  /** Fournisseurs, désactivés compris (nom des anciennes réceptions). */
  suppliers: Supplier[]
  staff: StaffMember[]
  receptions: ReceptionEntry[]
  wastes: WasteEntry[]
  /** État de chaque photo référencée (réceptions et pertes). */
  photoStatus: Record<string, PhotoStatus>
}

export interface PhotoCounts {
  pending: number
  failed: number
}

export function photoCounts(paths: readonly string[], status: Record<string, PhotoStatus>): PhotoCounts {
  let pending = 0
  let failed = 0
  for (const p of paths) {
    const s = status[p]?.state
    if (s === 'pending' || s === 'draft') pending++
    else if (s === 'failed') failed++
  }
  return { pending, failed }
}

/** Réceptions et pertes des 30 derniers jours + références ; rechargées à chaque changement de synchro. */
export function useReceptionData() {
  const core = useCore()
  const [data, setData] = useState<ReceptionData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - LOAD_WINDOW_MS).toISOString()
      const [suppliers, staff, establishment, ...lists] = await Promise.all([
        core.listSuppliers({ includeInactive: true }),
        core.listStaff(),
        core.getEstablishment(),
        ...RECEPTION_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      const records = lists.flat()
      const receptions = buildReceptions(records)
      const wastes = buildWastes(records)
      const paths = [...receptions.flatMap((r) => r.photos), ...wastes.flatMap((w) => w.versions.flatMap((v) => v.payload.photo_paths ?? []))]
      const photoStatus = paths.length ? await core.getPhotoStatuses([...new Set(paths)]) : {}
      setData({ timeZone: establishment?.timezone || DEFAULT_TIMEZONE, suppliers, staff, receptions, wastes, photoStatus })
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

export interface ReceptionStatus extends ReceptionSummary {
  photos: PhotoCounts
}

/** Données + compteurs de l'accueil. */
export function useReceptionStatus(tickMs = 60_000) {
  const { data, error, reload } = useReceptionData()
  const now = useNow(tickMs)
  const summary = useMemo<ReceptionStatus | null>(() => {
    if (!data) return null
    const paths = [...data.receptions.flatMap((r) => r.photos), ...data.wastes.flatMap((w) => w.payload.photo_paths ?? [])]
    return { ...summarizeReceptions(data.receptions, now, data.timeZone), photos: photoCounts(paths, data.photoStatus) }
  }, [data, now])
  return { data, error, reload, now, summary }
}
