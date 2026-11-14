import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Equipment, StaffMember, Threshold } from '../../../../shared/types.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import type { TemperatureThreshold } from '../../ui/temperature.ts'
import { buildReadings, READING_RECORD_TYPES, type Reading } from './readings.ts'
import { DEFAULT_TIMEZONE, enclosureStatuses, isMonitoredEnclosure, normalizeCheckTimes, summarize, type EnclosureStatus, type TemperatureSummary } from './schedule.ts'

/** Historique chargé : aujourd'hui + 7 jours (avec une marge pour les fuseaux). */
export const HISTORY_DAYS = 7
const LOAD_WINDOW_MS = (HISTORY_DAYS + 2) * 86_400_000

/** Seuils par défaut si aucun n'est défini dans Gestion (à confirmer selon le PMS). */
export const DEFAULT_ENCLOSURE_THRESHOLDS: Partial<Record<Equipment['kind'], TemperatureThreshold>> = {
  fridge: { min_c: null, max_c: 4 },
  freezer: { min_c: null, max_c: -18 },
}

export interface EnclosureThreshold extends TemperatureThreshold {
  /** true : aucun seuil enregistré, valeur par défaut du type d'équipement. */
  isDefault: boolean
}

/** Seuil `temperature_check` en vigueur pour l'enceinte : le sien, sinon le générique, sinon le défaut du type. */
export function enclosureThreshold(equipment: Equipment, thresholds: readonly Threshold[]): EnclosureThreshold {
  const own = thresholds.find((t) => t.equipment_id === equipment.id && t.check_type === 'temperature_check')
  const generic = thresholds.find((t) => t.equipment_id === null && t.check_type === 'temperature_check')
  const t = own ?? generic
  if (t) return { min_c: t.min_c, max_c: t.max_c, isDefault: false }
  return { ...(DEFAULT_ENCLOSURE_THRESHOLDS[equipment.kind] ?? { min_c: null, max_c: null }), isDefault: true }
}

export interface TemperatureData {
  /** Enceintes suivies (frigos, congélateurs actifs). */
  enclosures: Equipment[]
  thresholds: Threshold[]
  checkTimes: string[]
  /** Réglage `missed_slot_carry_over` : créneau oublié la veille reporté (défaut true). */
  carryOver: boolean
  timeZone: string
  readings: Reading[]
  staff: StaffMember[]
}

/** Charge références + relevés récents depuis le core ; recharge à chaque changement de synchro. */
export function useTemperatureData() {
  const core = useCore()
  const [data, setData] = useState<TemperatureData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - LOAD_WINDOW_MS).toISOString()
      const [equipment, thresholds, settings, establishment, staff, ...lists] = await Promise.all([
        core.listEquipment(),
        core.listThresholds(),
        core.getSettings(),
        core.getEstablishment(),
        core.listStaff(),
        ...READING_RECORD_TYPES.map((type) => core.listRecords({ type, since })),
      ])
      setData({
        enclosures: equipment.filter(isMonitoredEnclosure),
        thresholds,
        checkTimes: normalizeCheckTimes(settings?.daily_check_times),
        carryOver: settings?.missed_slot_carry_over ?? true,
        timeZone: establishment?.timezone || DEFAULT_TIMEZONE,
        readings: buildReadings(lists.flat()),
        staff,
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

/** Statuts des enceintes et compteurs, recalculés chaque minute (passage d'un créneau). */
export function useTemperatureStatus(): {
  data: TemperatureData | null
  error: string | null
  reload: () => Promise<void>
  now: Date
  statuses: EnclosureStatus[]
  summary: TemperatureSummary | null
} {
  const { data, error, reload } = useTemperatureData()
  const now = useNow(30_000)
  const statuses = useMemo(
    () => (data ? enclosureStatuses({ equipment: data.enclosures, readings: data.readings, now, checkTimes: data.checkTimes, timeZone: data.timeZone, carryOver: data.carryOver }) : []),
    [data, now],
  )
  const summary = useMemo(() => (data ? summarize(statuses) : null), [data, statuses])
  return { data, error, reload, now, statuses, summary }
}
