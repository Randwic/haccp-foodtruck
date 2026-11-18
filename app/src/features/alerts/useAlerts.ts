// Alertes du serveur pour l'écran Aujourd'hui : relues à chaque synchro (et toutes les 30 s), notification
// sur l'appareil pour chaque nouvelle alerte non vue, « Vu » enregistré dans le registre (record alert_ack).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCore } from '../../ui/CoreContext.tsx'
import { loadNotified, saveNotified, showSystemNotification } from '../processes/notifications.ts'
import { acknowledgedIds, alertsToNotify, buildAlertViews, type AlertView } from './model.ts'

const NOTIFIED_KEY = 'haccp.server-alerts-notified'
/** Au-delà, une seule notification résume les alertes (pas de rafale). */
const MAX_SEPARATE_NOTIFICATIONS = 3
const ACK_LOOKBACK_MS = 14 * 86_400_000

export interface AlertsState {
  /** null : chargement ; [] : aucune alerte (ou appareil sans alertes). */
  views: AlertView[] | null
  acknowledge: (alertId: string) => Promise<void>
  acknowledgeAll: () => Promise<void>
}

export function useAlerts(refreshMs = 30_000): AlertsState {
  const core = useCore()
  const [views, setViews] = useState<AlertView[] | null>(null)
  const viewsRef = useRef<AlertView[]>([])

  const reload = useCallback(async () => {
    if (!core.listAlerts) {
      setViews([])
      return
    }
    try {
      const since = new Date(Date.now() - ACK_LOOKBACK_MS).toISOString()
      const [open, acks] = await Promise.all([core.listAlerts(), core.listRecords({ type: 'alert_ack', since })])
      const next = buildAlertViews(open, acknowledgedIds(acks))
      viewsRef.current = next
      setViews(next)
      const notified = loadNotified(NOTIFIED_KEY)
      const fresh = alertsToNotify(next, notified)
      if (fresh.length === 0) return
      if (fresh.length > MAX_SEPARATE_NOTIFICATIONS) {
        await showSystemNotification(`${fresh.length} alertes HACCP`, fresh.map((v) => v.alert.message).slice(0, 3).join('\n'), 'haccp-alerts')
      } else {
        for (const v of fresh) await showSystemNotification(v.title, v.alert.message, v.alert.id)
      }
      for (const v of fresh) notified.add(v.alert.id)
      saveNotified(notified, NOTIFIED_KEY)
    } catch {
      // base fermée ou momentanément indisponible : on garde l'affichage précédent
    }
  }, [core])

  useEffect(() => {
    void reload()
    const unsub = core.onSyncStatusChange(() => void reload())
    const id = setInterval(() => void reload(), refreshMs)
    return () => {
      unsub()
      clearInterval(id)
    }
  }, [core, reload, refreshMs])

  const acknowledge = useCallback(
    async (alertId: string) => {
      await core.addRecord('alert_ack', { alert_id: alertId })
      await reload()
    },
    [core, reload],
  )

  const acknowledgeAll = useCallback(async () => {
    for (const v of viewsRef.current) if (!v.seen) await core.addRecord('alert_ack', { alert_id: v.alert.id })
    await reload()
  }, [core, reload])

  return { views, acknowledge, acknowledgeAll }
}
