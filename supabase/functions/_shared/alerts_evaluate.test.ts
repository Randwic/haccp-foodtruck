// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { ALERTS_LIMITS, ALERTS_SECRET_HEADER, createAlertsEvaluateHandler, runAlertsEvaluation, type AlertsRunResult } from './alerts_evaluate.ts'
import { disabledEmailSender, type EmailMessage, type EmailSender } from './email.ts'
import type { MemoryRepo } from './memory_repo.ts'
import { processPush } from './sync_push.ts'
import { ChainBuilder, DEVICE_ID, FRIDGE_ID, memoryLogger, NOW, seededRepo } from './test_helpers.ts'
import { classifyPushStatus, type PushMessage, type PushTarget, type WebPushSender } from './webpush.ts'

const SECRET = 'a'.repeat(40)
const SENSOR_ID = '00000000-0000-4000-8000-0000000005e1'
const P256DH = 'B' + 'A'.repeat(86)
const AUTH = 'A'.repeat(22)
const SUB_APPLE = 'https://web.push.apple.com/QG-apple'
const SUB_FCM = 'https://fcm.googleapis.com/fcm/send/xyz'

class FakePush implements WebPushSender {
  calls: { endpoint: string; message: PushMessage }[] = []
  status = new Map<string, number>()
  async send(target: PushTarget, message: PushMessage) {
    this.calls.push({ endpoint: target.endpoint, message })
    const status = this.status.get(target.endpoint) ?? 201
    return { status, outcome: classifyPushStatus(status) }
  }
}
class FakeEmail implements EmailSender {
  readonly enabled = true
  sent: EmailMessage[] = []
  fail = false
  async send(m: EmailMessage) {
    if (this.fail) throw new Error('resend : statut 500')
    this.sent.push(m)
  }
}

let repo: MemoryRepo
let push: FakePush
let clock: Date
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

beforeEach(async () => {
  repo = await seededRepo()
  clock = NOW // 2026-11-14T10:00Z = 11:00 à Paris : le relevé de 08:00 du Frigo 1 n'est pas fait.
  repo.serverClock = () => clock
  repo.sensors.push({
    id: SENSOR_ID,
    name: 'Shelly',
    equipment_id: FRIDGE_ID,
    vendor: 'shelly_ht',
    active: true,
    last_seen_at: '2026-11-14T08:30:00.000Z', // muet depuis 90 min
    last_value_c: 3.5,
    battery_percent: 80,
    updated_at: '2026-11-01T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z',
    token_hash: 'f'.repeat(64),
  })
  repo.pushSubscriptions.push(
    { id: 's1', device_id: DEVICE_ID, endpoint: SUB_APPLE, p256dh: P256DH, auth: AUTH, failures: 0, last_success_at: null },
    { id: 's2', device_id: DEVICE_ID, endpoint: SUB_FCM, p256dh: P256DH, auth: AUTH, failures: 0, last_success_at: null },
  )
  push = new FakePush()
})

const run = (over: { push?: WebPushSender | null; email?: EmailSender } = {}): Promise<AlertsRunResult> =>
  runAlertsEvaluation({ repo, push: over.push === undefined ? push : over.push, email: over.email ?? disabledEmailSender, logger: memoryLogger(), now: () => clock })
const open = () => repo.alerts.filter((a) => a.resolved_at === null)

describe('alerts-evaluate : authentification', () => {
  const handler = (secret: string | undefined) =>
    createAlertsEvaluateHandler({ repo, push, email: disabledEmailSender, secret, logger: memoryLogger(), allowedOrigins: [], now: () => clock })
  const req = (s: string | null, method = 'POST') => new Request('https://fn.example/alerts-evaluate', { method, headers: s === null ? {} : { [ALERTS_SECRET_HEADER]: s } })
  it('secret absent ou trop court → 503 not_configured ; mauvais → 401 ; GET → 405', async () => {
    expect((await handler(undefined)(req(SECRET))).status).toBe(503)
    expect((await handler('court')(req('court'))).status).toBe(503)
    expect((await handler(SECRET)(req(null))).status).toBe(401)
    expect((await handler(SECRET)(req('b'.repeat(40)))).status).toBe(401)
    expect((await handler(SECRET)(req(SECRET, 'GET'))).status).toBe(405)
    expect(repo.alerts).toHaveLength(0)
  })
  it('bon secret → 200 et résumé', async () => {
    const res = await handler(SECRET)(req(SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, opened: 2, resolved: 0, open: 2, notified: 2, push: { enabled: true, sent: 4 }, email: 'disabled' })
  })
})

describe('alerts-evaluate : ouverture, notifications, rappels', () => {
  it('ouvre les alertes (capteur muet, relevé en retard) et notifie chaque abonnement', async () => {
    const r = await run()
    expect(r).toMatchObject({ opened: 2, open: 2, notified: 2, push: { enabled: true, sent: 4, failed: 0, removed: 0 } })
    expect(open().map((a) => [a.kind, a.message]).sort()).toEqual([
      ['check_overdue', 'Frigo 1 : relevé de 08:00 non fait'],
      ['sensor_silent', 'Frigo 1 (Shelly) : aucune mesure depuis 09:30'],
    ])
    expect(push.calls).toHaveLength(4)
    const silent = open().find((a) => a.kind === 'sensor_silent')!
    expect(push.calls.find((c) => c.message.alert_id === silent.id)!.message).toEqual({
      title: 'Capteur muet',
      body: 'Frigo 1 (Shelly) : aucune mesure depuis 09:30',
      url: '/',
      tag: silent.id,
      alert_id: silent.id,
      kind: 'sensor_silent',
    })
    expect(open().every((a) => a.last_notified_at === NOW.toISOString())).toBe(true)
    expect(repo.pushSubscriptions.every((s) => s.last_success_at === NOW.toISOString())).toBe(true)
  })
  it('pas de doublon ni de rappel avant alert_repeat_minutes (15) ; rappel ensuite', async () => {
    await run()
    clock = minutes(5)
    expect(await run()).toMatchObject({ opened: 0, notified: 0 })
    clock = minutes(10)
    await run()
    expect(push.calls).toHaveLength(4)
    clock = minutes(15)
    expect(await run()).toMatchObject({ opened: 0, notified: 2 })
    expect(push.calls).toHaveLength(8)
    expect(repo.alerts).toHaveLength(2)
  })
  it('réglage alert_repeat_minutes respecté (30)', async () => {
    repo.settings!.alert_repeat_minutes = 30
    await run()
    clock = minutes(15)
    await run()
    expect(push.calls).toHaveLength(4)
    clock = minutes(30)
    await run()
    expect(push.calls).toHaveLength(8)
  })
  it('prise en compte par un record alert_ack (sync-push) : plus de rappel ; alert_id inconnu → quarantaine', async () => {
    await run()
    const silent = open().find((a) => a.kind === 'sensor_silent')!
    const chain = new ChainBuilder()
    const unknown = await chain.next({ type: 'alert_ack', payload: { alert_id: '00000000-0000-4000-8000-0000000009ff' } })
    const ack = await chain.next({ type: 'alert_ack', payload: { alert_id: silent.id, comment: 'pile changée, capteur relancé' } })
    const device = { id: DEVICE_ID, name: 'Tablette', revoked_at: null }
    const res = await processPush(device, [unknown, ack], repo, { now: () => clock, logger: memoryLogger() })
    expect(res.rejected).toEqual([{ id: unknown.id, reason: 'invalid_payload', detail: expect.stringMatching(/quarantaine\[invalid_payload\].*alert_id : alerte inconnue/), quarantined: true }])
    expect(res.accepted.map((a) => a.id)).toEqual([ack.id])
    expect(repo.alerts.find((a) => a.id === silent.id)).toMatchObject({ acknowledged_at: NOW.toISOString(), acknowledged_by_record_id: ack.id })
    clock = minutes(15)
    await run()
    expect(push.calls.slice(4).map((c) => c.message.kind)).toEqual(['check_overdue', 'check_overdue'])
  })
  it('condition disparue → résolue (relevé fait, capteur revenu), plus de notification', async () => {
    await run()
    const chain = new ChainBuilder()
    const reading = await chain.next({ type: 'temperature_check', payload: { equipment_id: FRIDGE_ID, value_c: 3.2, source: 'manual', in_range: true }, device_time: minutes(3).toISOString() })
    await processPush({ id: DEVICE_ID, name: 'Tablette', revoked_at: null }, [reading], repo, { now: () => clock, logger: memoryLogger() })
    repo.sensors[0].last_seen_at = minutes(4).toISOString()
    clock = minutes(5)
    expect(await run()).toMatchObject({ opened: 0, resolved: 2, open: 0, notified: 0 })
    expect(repo.alerts.every((a) => a.resolved_at === minutes(5).toISOString())).toBe(true)
    clock = minutes(30)
    await run()
    expect(push.calls).toHaveLength(4)
  })
  it('un relevé en quarantaine ne satisfait pas le créneau', async () => {
    const chain = new ChainBuilder()
    const bad = await chain.next({ type: 'temperature_check', payload: { equipment_id: FRIDGE_ID, value_c: 3.2, source: 'manual', in_range: true, extra: 1 } })
    const res = await processPush({ id: DEVICE_ID, name: 'Tablette', revoked_at: null }, [bad], repo, { now: () => clock, logger: memoryLogger() })
    expect(res.rejected[0].quarantined).toBe(true)
    await run()
    expect(open().some((a) => a.kind === 'check_overdue')).toBe(true)
  })
})

describe('alerts-evaluate : abonnements push', () => {
  it('404 / 410 : abonnement supprimé aussitôt, pas réessayé pour les autres alertes', async () => {
    push.status.set(SUB_APPLE, 410)
    const r = await run()
    expect(r.push).toMatchObject({ sent: 2, removed: 1 })
    expect(push.calls.filter((c) => c.endpoint === SUB_APPLE)).toHaveLength(1)
    expect(repo.pushSubscriptions.map((s) => s.id)).toEqual(['s2'])
  })
  it('échecs temporaires comptés, remis à zéro au succès ; neutralisé après N échecs', async () => {
    push.status.set(SUB_APPLE, 500)
    await run()
    expect(repo.pushSubscriptions.find((s) => s.id === 's1')!.failures).toBe(2)
    push.status.delete(SUB_APPLE)
    clock = minutes(15)
    await run()
    expect(repo.pushSubscriptions.find((s) => s.id === 's1')!.failures).toBe(0)
    push.status.set(SUB_APPLE, 403)
    repo.pushSubscriptions.find((s) => s.id === 's1')!.failures = ALERTS_LIMITS.maxPushFailures - 1
    clock = minutes(30)
    const r = await run()
    expect(r.push.removed).toBe(1)
    expect(repo.pushSubscriptions.map((s) => s.id)).toEqual(['s2'])
  })
  it('aucun canal disponible : last_notified_at reste vide (nouvel essai au tour suivant)', async () => {
    repo.pushSubscriptions = []
    expect(await run()).toMatchObject({ opened: 2, notified: 0 })
    expect(open().every((a) => a.last_notified_at === null)).toBe(true)
    expect(await run({ push: null })).toMatchObject({ notified: 0, push: { enabled: false } })
  })
})

describe('alerts-evaluate : e-mail', () => {
  it('désactivé (pas de RESEND_API_KEY / ALERT_EMAIL_TO) : ignoré proprement', async () => {
    expect((await run()).email).toBe('disabled')
  })
  it('activé : un récapitulatif des NOUVELLES alertes, pas à chaque rappel', async () => {
    const email = new FakeEmail()
    expect((await run({ email })).email).toBe('sent')
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0].subject).toBe('[HACCP] 2 nouvelles alertes')
    expect(email.sent[0].text).toContain('Capteur muet — Frigo 1 (Shelly) : aucune mesure depuis 09:30 (ouverte 11:00)')
    expect(email.sent[0].text).toContain('Relevé en retard — Frigo 1 : relevé de 08:00 non fait')
    clock = minutes(15)
    expect((await run({ email })).email).toBe('skipped')
    expect(email.sent).toHaveLength(1)
  })
  it('settings.email_alerts = false : pas d’e-mail même configuré', async () => {
    repo.settings!.email_alerts = false
    const email = new FakeEmail()
    expect((await run({ email })).email).toBe('disabled')
    expect(email.sent).toHaveLength(0)
  })
  it('e-mail seul (sans Web Push) : alertes marquées notifiées ; échec d’envoi sans blocage', async () => {
    const email = new FakeEmail()
    expect(await run({ push: null, email })).toMatchObject({ notified: 2, email: 'sent' })
    const failing = new FakeEmail()
    failing.fail = true
    repo.alerts = []
    expect(await run({ push: null, email: failing })).toMatchObject({ opened: 2, notified: 0, email: 'failed' })
  })
})
