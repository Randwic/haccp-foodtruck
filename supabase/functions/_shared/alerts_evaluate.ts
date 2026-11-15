// alerts-evaluate : ouverture / résolution des alertes et notifications (Web Push, e-mail).
// POST /functions/v1/alerts-evaluate   en-tête x-alerts-secret: <ALERTS_EVALUATE_SECRET>
// Appelée toutes les 5 minutes par pg_cron + pg_net (voir docs/backend-logic.md).
import type { Alert } from '../../../shared/payloads.ts'
import { ALERT_RULES, alertsDueForNotification, alertTitle, ENGINE_RECORD_TYPES, evaluateAlerts } from './alerts_engine.ts'
import { secretsEqual } from './crypto.ts'
import type { EmailSender } from './email.ts'
import { HttpError, jsonResponse, withHttp, type HttpEnv, type Logger } from './http.ts'
import type { AlertsRepo, PushSubscriptionRow } from './repo.ts'
import { formatLocalMoment, safeTimeZone } from './schedule.ts'
import type { PushMessage, WebPushSender } from './webpush.ts'

export const ALERTS_SECRET_HEADER = 'x-alerts-secret'
export const ALERTS_LIMITS = {
  minSecretLength: 32,
  /** Abonnement supprimé après autant d'échecs consécutifs (hors 404/410, supprimés aussitôt). */
  maxPushFailures: 20,
} as const

export interface AlertsRunResult {
  ok: true
  opened: number
  resolved: number
  open: number
  notified: number
  push: { enabled: boolean; sent: number; failed: number; removed: number }
  email: 'disabled' | 'skipped' | 'sent' | 'failed'
}

export interface AlertsRunDeps {
  repo: AlertsRepo
  /** null : VAPID non configuré, pas de Web Push. */
  push: WebPushSender | null
  email: EmailSender
  logger: Logger
  now: () => Date
}

export function pushMessageFor(a: Alert): PushMessage {
  return { title: alertTitle(a.kind), body: a.message, url: '/', tag: a.id, alert_id: a.id, kind: a.kind }
}

export async function runAlertsEvaluation(deps: AlertsRunDeps): Promise<AlertsRunResult> {
  const { repo, logger } = deps
  const now = deps.now()
  const [settings, establishment, equipment, thresholds, sensors, openBefore] = await Promise.all([
    repo.getSettings(),
    repo.getEstablishment(),
    repo.listEquipment(null),
    repo.listThresholds(null),
    repo.listSensorsForAlerts(),
    repo.listOpenAlerts(),
  ])
  if (!settings) throw new HttpError(503, 'not_configured', 'paramètres absents')
  const timeZone = safeTimeZone(establishment?.timezone)

  const maxTolerance = Math.max(0, ...thresholds.map((t) => t.tolerance_minutes), 30)
  const readingsSince = new Date(now.getTime() - (ALERT_RULES.readingsLookbackHours * 60 + maxTolerance) * 60_000).toISOString()
  const recordsSince = new Date(now.getTime() - ALERT_RULES.recordsLookbackDays * 86_400_000).toISOString()
  const activeSensorIds = sensors.filter((s) => s.active).map((s) => s.id)
  const [readings, records] = await Promise.all([
    activeSensorIds.length > 0 ? repo.listSensorReadings(activeSensorIds, readingsSince) : Promise.resolve([]),
    repo.listRecentRecords(recordsSince, ENGINE_RECORD_TYPES),
  ])

  const decision = evaluateAlerts({
    now,
    timeZone,
    settings: {
      daily_check_times: settings.daily_check_times,
      missed_slot_carry_over: settings.missed_slot_carry_over ?? true,
      sensor_silent_minutes: settings.sensor_silent_minutes ?? 60,
    },
    equipment,
    thresholds,
    sensors,
    readings,
    records,
    openAlerts: openBefore,
  })

  // Résoudre d'abord (libère l'index « une alerte ouverte par sujet »), puis ouvrir.
  if (decision.resolve.length > 0) await repo.resolveAlerts(decision.resolve)
  let opened = 0
  for (const row of decision.open) {
    const a = await repo.openAlert(row)
    if (a) {
      opened++
      logger.log('warn', 'alert_opened', { alert_id: a.id, kind: a.kind, equipment_id: a.equipment_id, sensor_id: a.sensor_id, related_record_id: a.related_record_id })
    }
  }
  for (const id of decision.resolve) logger.log('info', 'alert_resolved', { alert_id: id })

  const open = await repo.listOpenAlerts()
  const due = alertsDueForNotification(open, now, settings.alert_repeat_minutes ?? 15)
  const result: AlertsRunResult = {
    ok: true,
    opened,
    resolved: decision.resolve.length,
    open: open.length,
    notified: 0,
    push: { enabled: deps.push !== null, sent: 0, failed: 0, removed: 0 },
    email: deps.email.enabled && settings.email_alerts ? 'skipped' : 'disabled',
  }
  if (due.length === 0) return result

  const delivered = new Set<string>()

  // Web Push : une notification par alerte et par abonnement.
  if (deps.push) {
    let subs: PushSubscriptionRow[] = await repo.listPushSubscriptions()
    for (const alert of due) {
      const msg = pushMessageFor(alert)
      const remaining: PushSubscriptionRow[] = []
      for (const sub of subs) {
        let outcome: 'ok' | 'gone' | 'failed'
        let status = 0
        try {
          ;({ status, outcome } = await deps.push.send(sub, msg))
        } catch (e) {
          outcome = 'failed'
          logger.log('warn', 'push_error', { subscription_id: sub.id, error: e instanceof Error ? e.message : String(e) })
        }
        if (outcome === 'ok') {
          result.push.sent++
          delivered.add(alert.id)
          await repo.recordPushSuccess(sub.id, now.toISOString())
          remaining.push({ ...sub, failures: 0 })
        } else if (outcome === 'gone') {
          result.push.removed++
          await repo.deletePushSubscriptionById(sub.id)
          logger.log('info', 'push_subscription_gone', { subscription_id: sub.id, device_id: sub.device_id, status })
        } else {
          result.push.failed++
          const failures = await repo.recordPushFailure(sub.id)
          if (failures >= ALERTS_LIMITS.maxPushFailures) {
            result.push.removed++
            await repo.deletePushSubscriptionById(sub.id)
            logger.log('warn', 'push_subscription_disabled', { subscription_id: sub.id, device_id: sub.device_id, failures })
          } else {
            remaining.push({ ...sub, failures })
            logger.log('warn', 'push_failed', { subscription_id: sub.id, status })
          }
        }
      }
      subs = remaining
    }
  }

  // E-mail : un seul message récapitulatif, pour les alertes notifiées pour la première fois.
  const fresh = due.filter((a) => a.last_notified_at === null)
  if (result.email === 'skipped' && fresh.length > 0) {
    const lines = fresh.map((a) => `• ${alertTitle(a.kind)} — ${a.message} (ouverte ${formatLocalMoment(new Date(a.opened_at), now, timeZone)})`)
    try {
      await deps.email.send({
        subject: fresh.length === 1 ? `[HACCP] ${alertTitle(fresh[0].kind)}` : `[HACCP] ${fresh.length} nouvelles alertes`,
        text: `${lines.join('\n')}\n\nÀ prendre en compte dans l'app (Alertes).\n`,
      })
      result.email = 'sent'
      for (const a of fresh) delivered.add(a.id)
    } catch (e) {
      result.email = 'failed'
      logger.log('warn', 'email_failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // last_notified_at : seulement si au moins un canal a remis le message (sinon on réessaie au tour suivant).
  if (delivered.size > 0) await repo.markAlertsNotified([...delivered])
  result.notified = delivered.size
  return result
}

export interface AlertsEvaluateDeps extends HttpEnv {
  repo: AlertsRepo
  push: WebPushSender | null
  email: EmailSender
  /** ALERTS_EVALUATE_SECRET (≥ 32 caractères) ; absent → 503 not_configured. */
  secret: string | undefined
}

export function createAlertsEvaluateHandler(deps: AlertsEvaluateDeps): (req: Request) => Promise<Response> {
  return withHttp('alerts-evaluate', ['POST'], deps, async (req, ctx) => {
    const secret = deps.secret ?? ''
    if (secret.length < ALERTS_LIMITS.minSecretLength) throw new HttpError(503, 'not_configured', 'ALERTS_EVALUATE_SECRET absent')
    if (!(await secretsEqual(req.headers.get(ALERTS_SECRET_HEADER) ?? '', secret))) {
      ctx.logger.log('warn', 'alerts_auth_failed')
      throw new HttpError(401, 'unauthorized')
    }
    const res = await runAlertsEvaluation({ repo: deps.repo, push: deps.push, email: deps.email, logger: ctx.logger, now: ctx.now })
    const { push, ...counts } = res
    ctx.logger.log('info', 'alerts_evaluate', { ...counts, push_sent: push.sent, push_failed: push.failed, push_removed: push.removed })
    return jsonResponse(200, res)
  })
}
