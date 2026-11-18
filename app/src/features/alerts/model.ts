// Alertes du serveur (lot 6) affichées sur l'appareil : fonctions pures (testées sans interface).
// Le serveur calcule les alertes toutes les 5 minutes (alerts-evaluate) et les transmet par sync-pull ;
// l'appareil ne fait que les montrer et enregistrer « vu » (record `alert_ack`).
import type { Alert, AlertKind } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'

/** Titres courts (mêmes libellés que les notifications envoyées par le serveur). */
export const ALERT_TITLES: Record<AlertKind, string> = {
  sensor_out_of_range: 'Température hors seuil',
  sensor_silent: 'Capteur muet',
  sensor_battery_low: 'Pile du capteur faible',
  check_overdue: 'Relevé en retard',
  process_overdue: 'Procédé non clôturé',
  corrective_action_missing: 'Action corrective manquante',
}

export function alertTitle(kind: AlertKind | string): string {
  return ALERT_TITLES[kind as AlertKind] ?? 'Alerte'
}

/** Écran où l'on traite l'alerte (null : rien à ouvrir, la prise en compte suffit). */
export type AlertTarget = 'temperatures' | 'processes' | null

export function alertTarget(a: Pick<Alert, 'kind' | 'equipment_id'>): AlertTarget {
  if (a.kind === 'check_overdue' || a.kind === 'sensor_out_of_range') return 'temperatures'
  if (a.kind === 'process_overdue') return 'processes'
  // Action corrective manquante : sur une enceinte (relevé) → Températures ; sinon cuisson / procédé.
  if (a.kind === 'corrective_action_missing') return a.equipment_id ? 'temperatures' : 'processes'
  return null
}

/** Alertes « vues » sur cet appareil : record alert_ack local, même s'il n'est pas encore remonté au serveur. */
export function acknowledgedIds(acks: readonly HaccpRecord[]): Set<string> {
  const out = new Set<string>()
  for (const r of acks) if (r.type === 'alert_ack' && typeof r.payload.alert_id === 'string') out.add(r.payload.alert_id)
  return out
}

export interface AlertView {
  alert: Alert
  title: string
  /** Prise en compte (sur le serveur ou sur cet appareil). */
  seen: boolean
  target: AlertTarget
}

/** Alertes ouvertes : non vues d'abord (les plus récentes en tête), puis celles déjà vues mais toujours en cours. */
export function buildAlertViews(open: readonly Alert[], localAcks: ReadonlySet<string>): AlertView[] {
  const views = open
    .filter((a) => a.resolved_at === null)
    .map((a) => ({ alert: a, title: alertTitle(a.kind), seen: a.acknowledged_at !== null || localAcks.has(a.id), target: alertTarget(a) }))
  return views.sort((x, y) => Number(x.seen) - Number(y.seen) || y.alert.opened_at.localeCompare(x.alert.opened_at))
}

/** Alertes non vues pas encore signalées par une notification sur cet appareil. */
export function alertsToNotify(views: readonly AlertView[], alreadyNotified: ReadonlySet<string>): AlertView[] {
  return views.filter((v) => !v.seen && !alreadyNotified.has(v.alert.id))
}

/** Écran de procédé à ouvrir pour une alerte « procédé » (le serveur nomme le procédé en tête du message). */
export function processViewOf(message: string): 'cooling' | 'reheating' | 'cooking' {
  if (message.startsWith('Refroidissement')) return 'cooling'
  if (message.startsWith('Remise en température')) return 'reheating'
  return 'cooking'
}
