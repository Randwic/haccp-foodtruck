// Rappels d'échéance des documents pour la tuile d'accueil (gérant connecté et en ligne seulement).
import { useEffect, useState } from 'react'
import { useManager } from '../../manager/ManagerContext.tsx'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { expiringDocuments } from './model.ts'

export interface DocumentReminders {
  expired: number
  soon: number
}

/** null : inconnu (hors-ligne, pas de session gérant, ou pas encore chargé). */
export function useDocumentReminders(enabled: boolean, timeZone = DEFAULT_TIMEZONE, refreshMs = 15 * 60_000): DocumentReminders | null {
  const manager = useManager()
  const online = useOnline()
  const [state, setState] = useState<DocumentReminders | null>(null)
  useEffect(() => {
    if (!enabled || !online) {
      setState(null)
      return
    }
    let alive = true
    const load = async () => {
      try {
        if ((await manager.sessionEmail()) === null) return alive && setState(null)
        const list = expiringDocuments(await manager.listDocuments(), new Date(), timeZone)
        if (alive) setState({ expired: list.filter((d) => d.days < 0).length, soon: list.filter((d) => d.days >= 0).length })
      } catch {
        if (alive) setState(null)
      }
    }
    void load()
    const id = setInterval(load, refreshMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [manager, online, enabled, timeZone, refreshMs])
  return state
}
