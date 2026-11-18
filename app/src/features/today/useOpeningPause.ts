// « Pas encore ouvert » (Gestion › Réglages) : tant que la date d'ouverture n'est pas atteinte, l'écran
// Aujourd'hui met en pause alertes et rappels. Relu à chaque synchro (réglage modifié sur un autre appareil).
import { useEffect, useState } from 'react'
import { formatOpeningDate, isBeforeOpening } from '../../../../shared/opening.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'

export interface OpeningPause {
  /** « 1er mars 2027 ». */
  until: string
}

/** undefined : pas encore lu ; null : ouvert (ou pas de date d'ouverture). */
export function useOpeningPause(refreshMs = 60_000): OpeningPause | null | undefined {
  const core = useCore()
  const [pause, setPause] = useState<OpeningPause | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [settings, establishment] = await Promise.all([core.getSettings(), core.getEstablishment()])
        const date = settings?.opening_date ?? null
        const paused = isBeforeOpening(date, new Date(), establishment?.timezone || DEFAULT_TIMEZONE)
        if (!alive) return
        setPause((prev) => (paused && date ? (prev?.until === formatOpeningDate(date) ? prev : { until: formatOpeningDate(date) }) : null))
      } catch {
        /* base indisponible : on considère l'établissement ouvert (comportement d'avant) */
        if (alive) setPause((prev) => (prev === undefined ? null : prev))
      }
    }
    void load()
    const unsub = core.onSyncStatusChange(() => void load())
    const id = setInterval(() => void load(), refreshMs)
    return () => {
      alive = false
      unsub()
      clearInterval(id)
    }
  }, [core, refreshMs])
  return pause
}
