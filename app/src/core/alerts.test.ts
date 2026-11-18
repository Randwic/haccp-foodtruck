// Lot 6 : alertes du serveur reçues par sync-pull, prise en compte (alert_ack), migration v4 → v5, Web Push.
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Alert } from '../../../shared/payloads.ts'
import { CoreDb } from './db.ts'
import { createHttpTransport } from './transport.ts'
import { DEMO_EQUIPMENT } from './mockTransport.ts'
import { disposeAll, enrollAndUnlock, makeHarness, uniqueDbName } from './testUtils.ts'

afterEach(disposeAll)

const alert = (id: string, opened_at: string, extra: Partial<Alert> = {}): Alert => ({
  id,
  kind: 'check_overdue',
  equipment_id: DEMO_EQUIPMENT[0].id,
  sensor_id: null,
  related_record_id: null,
  message: `${DEMO_EQUIPMENT[0].name} : relevé de 08:00 non fait`,
  opened_at,
  resolved_at: null,
  acknowledged_at: null,
  last_notified_at: null,
  ...extra,
})
const A1 = '00000000-0000-4000-8000-00000000a001'
const A2 = '00000000-0000-4000-8000-00000000a002'

describe('alertes (sync-pull)', () => {
  it('stockées localement ; listAlerts : ouvertes seulement, les plus récentes d’abord ; résolution suivie', async () => {
    const { core, server } = makeHarness()
    server.upsertAlert(alert(A1, '2026-11-14T08:00:00.000Z'))
    server.upsertAlert(alert(A2, '2026-11-14T09:00:00.000Z', { message: 'Congélateur : relevé de 08:00 non fait' }))
    await enrollAndUnlock(core)
    expect((await core.listAlerts()).map((a) => a.id)).toEqual([A2, A1])

    server.upsertAlert(alert(A1, '2026-11-14T08:00:00.000Z', { resolved_at: '2026-11-14T10:00:00.000Z' }))
    await core.syncNow()
    expect((await core.listAlerts()).map((a) => a.id)).toEqual([A2])
  })

  it('« Vu » : record alert_ack accepté par le serveur, puis prise en compte rapportée par le pull suivant', async () => {
    const { core, server } = makeHarness()
    server.upsertAlert(alert(A1, '2026-11-14T08:00:00.000Z'))
    await enrollAndUnlock(core)
    await core.addRecord('alert_ack', { alert_id: A1 })
    await core.syncNow()
    await core.syncNow()
    expect(server.acceptedRecords().some((r) => r.type === 'alert_ack' && r.payload.alert_id === A1)).toBe(true)
    expect((await core.listAlerts())[0].acknowledged_at).not.toBeNull()
  })

  it('serveur plus ancien (sans alerts dans la réponse) : rien ne casse', async () => {
    const { core } = makeHarness({
      transport: (server) => ({
        push: (r, a) => server.push(r, a),
        async pull(since, auth) {
          const res = await server.pull(since, auth)
          const old = { ...res } as Partial<typeof res>
          delete old.alerts
          return old as typeof res
        },
      }),
    })
    await enrollAndUnlock(core)
    expect(await core.listAlerts()).toEqual([])
    expect(await core.getPushPublicKey!()).toBeNull()
  })

  it('migration v4 → v5 : table des alertes ajoutée, sync-pull complet, registre intact', async () => {
    const dbName = uniqueDbName()
    const v4 = new Dexie(dbName)
    v4.version(1).stores({
      device: '&key',
      records: '&id, &[device_id+device_seq], type, device_time',
      record_sync: '&id, [state+device_seq], state',
      chain: '&device_id',
      staff: '&id',
      equipment: '&id',
      thresholds: '&id',
      pin_attempts: '&staff_id',
      meta: '&key',
    })
    v4.version(2).stores({ photos: '&path, state, created_at', suppliers: '&id' })
    v4.version(3).stores({ products: '&id', recipes: '&id', cleaning_tasks: '&id', checklists: '&id' })
    v4.version(4).stores({})
    await v4.open()
    const T = '2026-11-01T00:00:00.000Z'
    await v4.table('records').add({ id: 'rec-1', device_id: 'd', device_seq: 1, type: 'system_test', payload: {}, author_id: 'a', device_time: T, prev_hash: 'x', hash: 'y', supersedes_id: null })
    await v4.table('meta').put({ key: 'since', value: '2099-01-01T00:00:00.000Z' })
    v4.close()

    const db = new CoreDb(dbName)
    await db.open()
    expect(db.verno).toBe(5)
    expect(await db.getMeta('since', 'absent')).toBeNull()
    expect(await db.alerts.count()).toBe(0)
    expect(await db.records.count()).toBe(1)
    db.close()
  })
})

describe('Web Push (transport HTTP)', () => {
  it('push-config sans jeton d’appareil ; push-subscribe avec le jeton et seulement endpoint + keys', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('push-config')
        ? new Response(JSON.stringify({ enabled: true, vapid_public_key: 'BKEY' }), { status: 200 })
        : new Response(JSON.stringify({ ok: true }), { status: 201 }),
    )
    const t = createHttpTransport({ baseUrl: 'https://x.supabase.co/', anonKey: 'anon', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await t.getPushConfig!()).toEqual({ enabled: true, vapid_public_key: 'BKEY' })
    const [cfgUrl, cfgInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(cfgUrl).toBe('https://x.supabase.co/functions/v1/push-config')
    expect((cfgInit.headers as Record<string, string>)['x-device-token']).toBeUndefined()

    await t.subscribePush!({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'P', auth: 'A' } }, { device_token: 'tok' })
    const [subUrl, subInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(subUrl).toBe('https://x.supabase.co/functions/v1/push-subscribe')
    expect(subInit.method).toBe('POST')
    expect((subInit.headers as Record<string, string>)['x-device-token']).toBe('tok')
    expect(JSON.parse(String(subInit.body))).toEqual({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'P', auth: 'A' } })
  })
})
