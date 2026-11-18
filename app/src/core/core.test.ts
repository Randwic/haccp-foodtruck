import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeRecordHash } from '../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord, type SyncPushRequest, type SyncPushResponse } from '../../../shared/types.ts'
import type { SyncStatus } from './api.ts'
import { BACKOFF_MAX_MS, computeBackoffMs, createCore, CoreError, notifyActivity } from './core.ts'
import { CoreDb } from './db.ts'
import { createMockTransport, DEMO_DEVICE, DEMO_EQUIPMENT, DEMO_PINS, DEMO_THRESHOLDS, type MockTransport } from './mockTransport.ts'
import { disposeAll, enrollAndUnlock, makeClock, makeHarness, MANAGER, STAFF, uniqueDbName } from './testUtils.ts'
import { TransportError, type Transport } from './transport.ts'

afterEach(async () => {
  await disposeAll()
})

const temp = (v: number) => ({ equipment_id: DEMO_EQUIPMENT[0].id, value_c: v, source: 'manual' })

function sortedBySeq(rs: HaccpRecord[]): HaccpRecord[] {
  return [...rs].sort((a, b) => a.device_seq - b.device_seq)
}

async function expectValidChain(rs: HaccpRecord[]): Promise<void> {
  const s = sortedBySeq(rs)
  let prev = GENESIS_HASH
  for (let i = 0; i < s.length; i++) {
    expect(s[i].device_seq).toBe(i + 1)
    expect(s[i].prev_hash).toBe(prev)
    expect(await computeRecordHash(s[i])).toBe(s[i].hash)
    prev = s[i].hash
  }
}

describe('registre et chaîne de hachage', () => {
  it('100 saisies forment une chaîne correcte, acceptée intégralement par le serveur', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    for (let i = 0; i < 100; i++) await core.addRecord('temperature_check', temp(i / 10))
    await core.syncNow()

    const local = await core.listRecords()
    expect(local).toHaveLength(100)
    await expectValidChain(local)
    expect(await core.verifyChain()).toEqual({ ok: true, count: 100 })
    expect(local.every((r) => r.author_id === MANAGER.id && r.device_id === DEMO_DEVICE.device_id)).toBe(true)

    const remote = server.acceptedRecords()
    expect(remote).toHaveLength(100)
    expect((await core.getSyncStatus()).pending_count).toBe(0)
    expect(local.every((r) => typeof r.server_time === 'string')).toBe(true)
  })

  it('les appels concurrents de addRecord ne dupliquent jamais un device_seq', async () => {
    const { core } = makeHarness()
    await enrollAndUnlock(core)
    const created = await Promise.all(Array.from({ length: 40 }, (_, i) => core.addRecord('temperature_check', temp(i))))
    expect(new Set(created.map((r) => r.device_seq)).size).toBe(40)
    await expectValidChain(await core.listRecords())
  })

  it('deux instances (deux onglets) sur la même base restent cohérentes', async () => {
    const h = makeHarness()
    await enrollAndUnlock(h.core)
    const other = h.reopen()
    await other.unlock(STAFF.id, DEMO_PINS.staff)
    await Promise.all([
      ...Array.from({ length: 15 }, (_, i) => h.core.addRecord('temperature_check', temp(i))),
      ...Array.from({ length: 15 }, (_, i) => other.addRecord('temperature_check', temp(i))),
    ])
    const all = await h.core.listRecords()
    expect(all).toHaveLength(30)
    await expectValidChain(all)
    await h.core.syncNow()
    expect(h.server.acceptedRecords()).toHaveLength(30)
  })

  it('stocke exactement le payload haché (copie normalisée) et refuse les valeurs non JSON', async () => {
    const { core } = makeHarness()
    await enrollAndUnlock(core)
    const payload: Record<string, unknown> = { b: 1, a: { z: [1, 'x'] } }
    const r = await core.addRecord('system_test', payload)
    payload.b = 999 // mutation après coup par l'appelant : sans effet
    const [stored] = await core.listRecords()
    expect(stored.payload).toEqual({ a: { z: [1, 'x'] }, b: 1 })
    expect(await computeRecordHash(stored)).toBe(r.hash)
    await expect(core.addRecord('system_test', { d: new Date() })).rejects.toBeInstanceOf(CoreError)
    await expect(core.addRecord('system_test', { u: undefined })).rejects.toBeInstanceOf(CoreError)
    await expect(core.addRecord('system_test', { n: Number.NaN })).rejects.toBeInstanceOf(CoreError)
  })

  it('exige une session déverrouillée et un appareil enrôlé', async () => {
    const { core } = makeHarness()
    await expect(core.addRecord('system_test', {})).rejects.toMatchObject({ code: 'session_locked' })
    await enrollAndUnlock(core)
    core.lock()
    await expect(core.addRecord('system_test', {})).rejects.toMatchObject({ code: 'session_locked' })
  })
})

describe('aucune modification ni suppression', () => {
  it("l'API n'expose aucune fonction de modification ou de suppression", () => {
    const { core } = makeHarness()
    const names = Object.keys(core)
    expect(names.filter((n) => /update|delete|remove|edit|modify|patch|purge|replace|overwrite/i.test(n) || /^set/.test(n))).toEqual([])
    expect(names).toContain('addRecord')
  })

  it('la table locale refuse put/update/delete sur un enregistrement existant', async () => {
    const h = makeHarness()
    await enrollAndUnlock(h.core)
    const r = await h.core.addRecord('system_test', { note: 'original' })
    const db = new CoreDb(h.dbName)
    await expect(db.records.update(r.id, { payload: { note: 'falsifié' } })).rejects.toThrow()
    await expect(db.records.put({ ...r, payload: { note: 'falsifié' } })).rejects.toThrow()
    await expect(db.records.delete(r.id)).rejects.toThrow()
    db.close()
    const [stored] = await h.core.listRecords()
    expect(stored.payload).toEqual({ note: 'original' })
  })

  it('une correction est un nouvel enregistrement lié (supersedes_id), l’original est intact', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const original = await core.addRecord('temperature_check', temp(9))
    const corr = await core.addRecord('correction', { reason: 'faute de frappe', value_c: 3 }, { supersedes_id: original.id })
    expect(corr.supersedes_id).toBe(original.id)
    expect(corr.prev_hash).toBe(original.hash)
    await expect(core.addRecord('correction', { reason: 'x' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(core.addRecord('temperature_check', temp(1), { supersedes_id: original.id })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await core.syncNow()
    const remote = server.acceptedRecords()
    expect(remote.map((r) => r.id)).toEqual([original.id, corr.id])
    expect(remote[0].payload).toEqual(original.payload)
  })
})

describe('synchronisation', () => {
  it('saisie hors-ligne puis envoi automatique au retour du réseau (événement online)', async () => {
    const { core, server, clock } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    const first = await core.addRecord('temperature_check', temp(2))
    clock.advance(60_000)
    await core.addRecord('temperature_check', temp(3))
    await core.addRecord('temperature_check', temp(4))
    await core.whenSyncIdle()

    let st = await core.getSyncStatus()
    expect(st.pending_count).toBe(3)
    expect(st.oldest_pending_at).toBe(first.device_time)
    expect(st.last_error).toMatch(/Réseau/)
    expect(server.acceptedRecords()).toHaveLength(0)

    server.setOffline(false)
    window.dispatchEvent(new Event('online'))
    await core.whenSyncIdle()
    st = await core.getSyncStatus()
    expect(st.pending_count).toBe(0)
    expect(st.oldest_pending_at).toBeNull()
    expect(st.last_error).toBeNull()
    expect(st.last_success_at).not.toBeNull()
    expect(server.acceptedRecords()).toHaveLength(3)
  })

  it('le retour au premier plan déclenche une synchro', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.setOffline(true)
    await core.addRecord('system_test', {})
    await core.whenSyncIdle()
    server.setOffline(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await core.whenSyncIdle()
    expect((await core.getSyncStatus()).pending_count).toBe(0)
  })

  it('synchro périodique toutes les 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const h = makeHarness()
      await enrollAndUnlock(h.core)
      const before = h.server.calls.pull
      vi.advanceTimersByTime(60_000)
      await h.core.whenSyncIdle()
      expect(h.server.calls.pull).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('un rejet serveur est conservé localement et compté ; la chaîne continue', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core, 'staff')
    server.setOffline(true)
    const bad = await core.addRecord('temperature_check', temp(2)) // auteur qui sera désactivé
    server.deactivate('staff', STAFF.id)
    await core.whenSyncIdle()
    server.setOffline(false)
    const st = await core.syncNow()
    expect(st.rejected_count).toBe(1)
    expect(st.pending_count).toBe(0)
    expect((await core.listRecords()).map((r) => r.id)).toContain(bad.id) // jamais supprimé
    expect(server.quarantinedRecords()).toMatchObject([{ reason: 'unknown_author' }])
    // L'équipier désactivé est déconnecté et n'apparaît plus.
    expect(core.currentStaff()).toBeNull()
    expect((await core.listStaff()).map((s) => s.id)).toEqual([MANAGER.id])
    // Le gérant peut continuer : la chaîne a avancé côté serveur.
    await core.unlock(MANAGER.id, DEMO_PINS.manager)
    await core.addRecord('temperature_check', temp(3))
    await core.syncNow()
    expect(server.acceptedRecords()).toHaveLength(1)
    expect((await core.getSyncStatus()).rejected_count).toBe(1)
  })

  it('un hash altéré en transit est refusé (invalid_hash puis seq_gap), rien n’est perdu localement', async () => {
    let tamper = true
    const h = makeHarness({
      transport: (server) => ({
        push: (req: SyncPushRequest, auth) =>
          server.push(
            tamper ? { ...req, records: req.records.map((r, i) => (i === 0 ? { ...r, payload: { falsifié: true } } : r)) } : req,
            auth,
          ),
        pull: (since, auth) => server.pull(since, auth),
      }),
    })
    await enrollAndUnlock(h.core)
    h.server.setOffline(true)
    await h.core.addRecord('system_test', { n: 1 })
    await h.core.addRecord('system_test', { n: 2 })
    await h.core.whenSyncIdle()
    h.server.setOffline(false)
    const st = await h.core.syncNow()
    tamper = false
    expect(st.rejected_count).toBe(2)
    expect(await h.core.listRecords()).toHaveLength(2)
    expect(await h.core.verifyChain()).toEqual({ ok: true, count: 2 })
  })

  it('idempotence : réponse perdue en pleine requête, renvoi sans doublon', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.dropNextPushResponse()
    await core.addRecord('temperature_check', temp(1))
    await core.whenSyncIdle()
    expect(server.acceptedRecords()).toHaveLength(1) // le serveur l'a bien reçu…
    expect((await core.getSyncStatus()).pending_count).toBe(1) // …mais l'appareil ne le sait pas
    const serverTime = server.acceptedRecords()[0].server_time

    await core.addRecord('temperature_check', temp(2))
    const st = await core.syncNow()
    expect(st.pending_count).toBe(0)
    expect(st.rejected_count).toBe(0)
    const remote = server.acceptedRecords()
    expect(remote).toHaveLength(2)
    const local = sortedBySeq(await core.listRecords())
    expect(local[0].server_time).toBe(serverTime)
  })

  it('envoie par lots ordonnés de 200 au plus', async () => {
    const batches: number[][] = []
    const h = makeHarness({
      transport: (server) => ({
        push: (req, auth) => {
          batches.push(req.records.map((r) => r.device_seq))
          return server.push(req, auth)
        },
        pull: (since, auth) => server.pull(since, auth),
      }),
    })
    await enrollAndUnlock(h.core)
    h.server.setOffline(true)
    for (let i = 0; i < 250; i++) await h.core.addRecord('system_test', { i })
    await h.core.whenSyncIdle()
    h.server.setOffline(false)
    batches.length = 0
    await h.core.syncNow()
    expect(batches.map((b) => b.length)).toEqual([200, 50])
    expect(batches.flat()).toEqual(Array.from({ length: 250 }, (_, i) => i + 1))
    expect(h.server.acceptedRecords()).toHaveLength(250)
  })

  it('une seule synchro à la fois', async () => {
    let inflight = 0
    let maxInflight = 0
    const h = makeHarness({
      transport: (server) => {
        const wrap =
          <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
          async (...a: A): Promise<R> => {
            inflight++
            maxInflight = Math.max(maxInflight, inflight)
            await new Promise((r) => setTimeout(r, 5))
            try {
              return await fn(...a)
            } finally {
              inflight--
            }
          }
        return { push: wrap(server.push), pull: wrap(server.pull) }
      },
    })
    await enrollAndUnlock(h.core)
    await Promise.all([h.core.addRecord('system_test', {}), h.core.syncNow(), h.core.syncNow(), h.core.syncNow()])
    await h.core.whenSyncIdle()
    expect(maxInflight).toBe(1)
    expect((await h.core.getSyncStatus()).pending_count).toBe(0)
  })

  it('backoff exponentiel après échec, plafonné à 5 min', async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(computeBackoffMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000,
    ])
    expect(BACKOFF_MAX_MS).toBe(300_000)

    const { core, server, clock } = makeHarness()
    await enrollAndUnlock(core)
    server.failNextWithServerError()
    await core.addRecord('system_test', {})
    await core.whenSyncIdle()
    expect(server.calls.push).toBe(1)

    server.setOffline(true)
    const attempt = async () => {
      await core.triggerSync('periodic')
      await core.whenSyncIdle()
      return server.calls.push
    }
    // Après 1 échec : 5 s d'attente.
    clock.advance(4_999)
    expect(await attempt()).toBe(1)
    clock.advance(1)
    expect(await attempt()).toBe(2)
    // Après 2 échecs : 10 s.
    clock.advance(9_999)
    expect(await attempt()).toBe(2)
    clock.advance(1)
    expect(await attempt()).toBe(3)
    // Une saisie ne contourne pas le backoff…
    await core.addRecord('system_test', {})
    await core.whenSyncIdle()
    expect(server.calls.push).toBe(3)
    // …mais le retour du réseau, si.
    server.setOffline(false)
    window.dispatchEvent(new Event('online'))
    await core.whenSyncIdle()
    expect(server.calls.push).toBe(4)
    expect((await core.getSyncStatus()).pending_count).toBe(0)
  })

  it('un 401 (appareil révoqué) arrête la synchro et le signale ; un nouvel enrôlement la relance', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    server.revokeDevice(DEMO_DEVICE.device_id)
    await core.addRecord('system_test', {})
    await core.whenSyncIdle()
    let st = await core.getSyncStatus()
    expect(st.last_error).toMatch(/device_revoked/)
    expect(st.pending_count).toBe(1)

    const calls = server.calls.push + server.calls.pull
    await core.syncNow()
    window.dispatchEvent(new Event('online'))
    await core.whenSyncIdle()
    expect(server.calls.push + server.calls.pull).toBe(calls) // plus aucun appel

    const fresh = server.enrollDevice('iPad')
    await core.enrollDevice({ ...fresh, name: 'iPad' })
    st = await core.getSyncStatus()
    expect(st.last_error).toBeNull()
  })

  it('jeton invalide à l’enrôlement : erreur et appareil non enregistré', async () => {
    const { core } = makeHarness()
    await expect(core.enrollDevice({ device_id: DEMO_DEVICE.device_id, device_token: 'faux', name: 'x' })).rejects.toMatchObject({
      code: 'enroll_unauthorized',
    })
    expect(await core.getDevice()).toBeNull()
  })

  it('enrôlement hors-ligne : appareil conservé, références à la synchro suivante', async () => {
    const { core, server } = makeHarness()
    server.setOffline(true)
    await core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad' })
    expect(await core.getDevice()).toMatchObject({ device_id: DEMO_DEVICE.device_id, name: 'iPad' })
    expect(await core.listStaff()).toEqual([])
    server.setOffline(false)
    await core.syncNow()
    expect(await core.listStaff()).toHaveLength(2)
  })

  it('notifie les changements de statut', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const seen: SyncStatus[] = []
    core.onSyncStatusChange((s) => seen.push(s))
    server.setOffline(true)
    await core.addRecord('system_test', {})
    await core.whenSyncIdle()
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.some((s) => s.pending_count === 1)).toBe(true)
    server.setOffline(false)
    await core.syncNow()
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.at(-1)?.pending_count).toBe(0)
  })
})

describe('horloge de l’appareil (device_now)', () => {
  /** Transport qui garde les requêtes push et leurs réponses. */
  function spyTransport(server: MockTransport) {
    const pushes: { req: SyncPushRequest; res: SyncPushResponse }[] = []
    const transport: Transport = {
      async push(req, auth) {
        const res = await server.push(req, auth)
        pushes.push({ req, res })
        return res
      },
      pull: (since, auth) => server.pull(since, auth),
    }
    return { transport, pushes }
  }

  it('chaque lot envoie device_now = horloge de l’appareil au moment de l’envoi', async () => {
    let spy: ReturnType<typeof spyTransport> | undefined
    const h = makeHarness({ transport: (server) => (spy = spyTransport(server)).transport })
    await enrollAndUnlock(h.core)
    h.server.setOffline(true)
    await h.core.addRecord('system_test', { n: 1 })
    await h.core.whenSyncIdle()
    h.clock.advance(3 * 3_600_000) // envoyé 3 h plus tard
    h.server.setOffline(false)
    await h.core.syncNow()
    const last = spy!.pushes.at(-1)!
    expect(last.req.device_now).toBe(new Date(h.clock.t).toISOString())
    // Saisie hors réseau envoyée plus tard, horloges d'accord : pas d'horloge suspecte.
    expect(last.res.accepted).toHaveLength(1)
    expect(last.res.accepted[0].clock_suspect).toBe(false)
  })

  it('le serveur simulé marque le lot seulement si |serveur − device_now| dépasse clock_suspect_minutes', async () => {
    const deviceClock = makeClock()
    let serverOffsetMs = 0
    const server = createMockTransport({ now: () => new Date(deviceClock.t + serverOffsetMs) })
    const { transport, pushes } = spyTransport(server)
    const core = createCore({ transport, dbName: uniqueDbName(), now: deviceClock.now, background: false })
    try {
      await enrollAndUnlock(core)
      serverOffsetMs = 4 * 60_000 // 4 min d'écart : toléré (seuil 5 min)
      await core.addRecord('system_test', { n: 1 })
      await core.whenSyncIdle()
      await core.syncNow()
      expect(pushes.at(-1)!.res.accepted[0].clock_suspect).toBe(false)

      serverOffsetMs = 12 * 60_000 // horloge de l'appareil en retard de 12 min
      await core.addRecord('system_test', { n: 2 })
      await core.whenSyncIdle()
      await core.syncNow()
      const res = pushes.filter((p) => p.res.accepted.length > 0).at(-1)!.res
      expect(res.accepted.at(-1)!.clock_suspect).toBe(true)
    } finally {
      await core.dispose()
    }
  })

  it('sans device_now (ancien client), repli sur device_time de chaque saisie', async () => {
    const h = makeHarness({
      transport: (server) => ({
        push: (req, auth) => {
          const { device_now: _n, ...rest } = req
          void _n
          return server.push(rest, auth)
        },
        pull: (since, auth) => server.pull(since, auth),
      }),
    })
    await enrollAndUnlock(h.core)
    h.server.setOffline(true)
    await h.core.addRecord('system_test', { n: 1 })
    await h.core.whenSyncIdle()
    h.clock.advance(60 * 60_000)
    h.server.setOffline(false)
    await h.core.syncNow()
    const db = new CoreDb(h.dbName)
    const rows = await db.record_sync.toArray()
    db.close()
    expect(rows.find((r) => r.state === 'accepted')?.clock_suspect).toBe(true)
  })
})

describe('pull incrémental', () => {
  it('stocke server_now comme prochain since, applique les modifications et deleted', async () => {
    const sinces: (string | null)[] = []
    const h = makeHarness({
      transport: (server) => ({
        push: (req, auth) => server.push(req, auth),
        pull: (since, auth) => {
          sinces.push(since)
          return server.pull(since, auth)
        },
      }),
    })
    await enrollAndUnlock(h.core)
    expect(sinces).toEqual([null])
    expect(await h.core.getEstablishment()).toMatchObject({ timezone: 'Europe/Paris' })
    expect((await h.core.getSettings())?.retention_years).toBe(3)
    expect((await h.core.listEquipment()).map((e) => e.name).sort()).toEqual(
      ['Congélateur', 'Friteuse – bac 1', 'Friteuse – bac 2', 'Frigo 1', 'Frigo 2'].sort(),
    )
    expect(await h.core.listThresholds()).toHaveLength(DEMO_THRESHOLDS.length)

    h.clock.advance(1_000)
    const spy = vi.spyOn(h.server, 'pull')
    await h.core.syncNow()
    const second = (await spy.mock.results[0].value) as Awaited<ReturnType<Transport['pull']>>
    expect(sinces[1]).not.toBeNull()
    expect(second.staff).toEqual([]) // rien de nouveau : réponse vide
    expect(second.equipment).toEqual([])

    h.clock.advance(1_000)
    h.server.upsertEquipment({ id: 'e-new', name: 'Vitrine chaude', kind: 'hot_holding', active: true })
    h.server.deactivate('equipment', DEMO_EQUIPMENT[1].id)
    h.server.deactivate('thresholds', DEMO_THRESHOLDS[0].id)
    await h.core.syncNow()
    const names = (await h.core.listEquipment()).map((e) => e.name)
    expect(names).toContain('Vitrine chaude')
    expect(names).not.toContain('Frigo 2')
    expect((await h.core.listThresholds()).map((t) => t.id)).not.toContain(DEMO_THRESHOLDS[0].id)
    expect(sinces[2] && sinces[1] && sinces[2] > sinces[1]).toBe(true)
  })
})

describe('session PIN', () => {
  it('PIN correct, PIN incorrect, équipier inconnu', async () => {
    const { core } = makeHarness()
    await core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad' })
    const sessions: (string | null)[] = []
    core.onSessionChange((s) => sessions.push(s?.id ?? null))
    expect(await core.unlock(MANAGER.id, '000000')).toEqual({ ok: false, reason: 'wrong_pin' })
    expect(await core.unlock('inconnu', '123456')).toEqual({ ok: false, reason: 'wrong_pin' })
    const ok = await core.unlock(MANAGER.id, DEMO_PINS.manager)
    expect(ok.ok).toBe(true)
    expect(core.currentStaff()?.id).toBe(MANAGER.id)
    core.lock()
    expect(core.currentStaff()).toBeNull()
    expect(sessions).toEqual([MANAGER.id, null])
  })

  it('verrouillage 5 min après 5 échecs, persisté au rechargement, puis expiration', async () => {
    const h = makeHarness()
    await h.core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad' })
    for (let i = 0; i < 4; i++) expect((await h.core.unlock(STAFF.id, '111111')).ok).toBe(false)
    expect(await h.core.unlock(STAFF.id, '111111')).toEqual({ ok: false, reason: 'locked_out', retry_after_seconds: 300 })
    // Même le bon PIN est refusé pendant le verrouillage.
    h.clock.advance(60_000)
    expect(await h.core.unlock(STAFF.id, DEMO_PINS.staff)).toEqual({ ok: false, reason: 'locked_out', retry_after_seconds: 240 })
    // L'autre équipier n'est pas concerné.
    expect((await h.core.unlock(MANAGER.id, DEMO_PINS.manager)).ok).toBe(true)

    // Rechargement de l'app : le verrouillage survit.
    const reloaded = h.reopen()
    expect(await reloaded.unlock(STAFF.id, DEMO_PINS.staff)).toMatchObject({ ok: false, reason: 'locked_out' })

    h.clock.advance(4 * 60_000)
    expect((await reloaded.unlock(STAFF.id, DEMO_PINS.staff)).ok).toBe(true)
    // Après expiration le compteur repart de zéro.
    expect(await reloaded.unlock(STAFF.id, '111111')).toEqual({ ok: false, reason: 'wrong_pin' })
  })

  it('auto-lock après auto_lock_minutes d’inactivité ; notifyActivity repousse l’échéance', async () => {
    const { core, clock, server } = makeHarness()
    server.setSettings({ retention_years: 3, auto_lock_minutes: 2, clock_suspect_minutes: 5, email_alerts: false, daily_check_times: ['08:00', '18:00'], missed_slot_carry_over: true, thaw_dlc_days: 3, oil_polar_max: 25, oil_polar_warn: 22, thermometer_tolerance_c: 1, thermometer_check_days: 30, sensor_silent_minutes: 60, alert_repeat_minutes: 15 })
    await enrollAndUnlock(core)
    const sessions: (string | null)[] = []
    core.onSessionChange((s) => sessions.push(s?.id ?? null))

    clock.advance(90_000)
    core.notifyActivity()
    clock.advance(90_000)
    notifyActivity() // fonction module, appelée par l'interface
    clock.advance(90_000)
    expect(core.currentStaff()?.id).toBe(MANAGER.id)
    clock.advance(30_000)
    expect(core.currentStaff()).toBeNull()
    expect(sessions).toEqual([null])
    await expect(core.addRecord('system_test', {})).rejects.toMatchObject({ code: 'session_locked' })
  })

  it('auto-lock déclenché par la minuterie, sans appel de l’interface', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const { core, clock } = makeHarness()
      await enrollAndUnlock(core) // settings démo : 5 min
      const cb = vi.fn()
      core.onSessionChange(cb)
      clock.advance(5 * 60_000)
      vi.advanceTimersByTime(15_000)
      expect(cb).toHaveBeenCalledWith(null)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('stockage persistant', () => {
  it('renvoie false si navigator.storage est indisponible, true si accordé', async () => {
    const { core } = makeHarness()
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
    try {
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
      expect(await core.requestPersistentStorage()).toBe(false)
      Object.defineProperty(navigator, 'storage', {
        value: { persisted: async () => false, persist: async () => true },
        configurable: true,
      })
      expect(await core.requestPersistentStorage()).toBe(true)
      Object.defineProperty(navigator, 'storage', {
        value: {
          persist: async () => {
            throw new Error('refus')
          },
        },
        configurable: true,
      })
      expect(await core.requestPersistentStorage()).toBe(false)
    } finally {
      if (original) Object.defineProperty(navigator, 'storage', original)
      else delete (navigator as { storage?: unknown }).storage
    }
  })
})

describe('transport factice qui échoue toujours', () => {
  it('aucune donnée perdue, erreurs signalées', async () => {
    const failing: Transport = {
      push: async () => {
        throw new TransportError('network', 'hors ligne')
      },
      pull: async () => {
        throw new TransportError('timeout', 'délai')
      },
    }
    const h = makeHarness()
    await enrollAndUnlock(h.core) // références via le mock
    await h.core.dispose()
    const core = createCore({ transport: failing, dbName: h.dbName, now: h.clock.now })
    try {
      await core.unlock(MANAGER.id, DEMO_PINS.manager)
      for (let i = 0; i < 5; i++) await core.addRecord('system_test', { i })
      const st = await core.syncNow()
      expect(st.pending_count).toBe(5)
      expect(st.last_error).toBe('hors ligne')
      expect(await core.listRecords()).toHaveLength(5)
      expect(await core.verifyChain()).toEqual({ ok: true, count: 5 })
    } finally {
      await core.dispose()
    }
  })
})
