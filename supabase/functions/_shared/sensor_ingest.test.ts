// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from './crypto.ts'
import type { MemoryRepo } from './memory_repo.ts'
import { createSensorIngestHandler, INGEST_LIMITS, parseMeasurement, SENSOR_TOKEN_HEADER } from './sensor_ingest.ts'
import { FRIDGE_ID, memoryLogger, NOW, seededRepo } from './test_helpers.ts'

const SENSOR_ID = '00000000-0000-4000-8000-0000000005e1'
const SENSOR_TOKEN = 'S'.repeat(43)
const BASE = 'https://ref.supabase.co/functions/v1/sensor-ingest'

let repo: MemoryRepo
let clock: Date
let logger: ReturnType<typeof memoryLogger>
let handler: (req: Request) => Promise<Response>

beforeEach(async () => {
  repo = await seededRepo()
  clock = NOW
  repo.serverClock = () => clock
  repo.sensors.push({
    id: SENSOR_ID,
    name: 'Shelly frigo 1',
    equipment_id: FRIDGE_ID,
    vendor: 'shelly_ht',
    active: true,
    last_seen_at: null,
    last_value_c: null,
    battery_percent: null,
    updated_at: '2026-11-01T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z',
    token_hash: await sha256Hex(SENSOR_TOKEN),
  })
  logger = memoryLogger()
  handler = createSensorIngestHandler({ repo, logger, allowedOrigins: [], now: () => clock })
})

const get = (query: string, headers: Record<string, string> = {}) => handler(new Request(`${BASE}?${query}`, { headers }))
const post = (query: string, body: unknown, contentType = 'application/json') =>
  handler(new Request(`${BASE}?${query}`, { method: 'POST', headers: { 'content-type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('sensor-ingest : authentification', () => {
  it('jeton absent, inconnu ou mal formé → 401 (sans distinguer) ; rien n’est stocké', async () => {
    for (const q of ['tC=4', `token=${'X'.repeat(43)}&tC=4`, 'token=court&tC=4']) {
      const res = await get(q)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
    expect(repo.sensorReadings).toHaveLength(0)
  })
  it('jeton par l’en-tête x-sensor-token aussi accepté', async () => {
    const res = await get('tC=3.2', { [SENSOR_TOKEN_HEADER]: SENSOR_TOKEN })
    expect(res.status).toBe(200)
  })
  it('capteur désactivé → 403 sensor_inactive', async () => {
    repo.sensors[0].active = false
    const res = await get(`token=${SENSOR_TOKEN}&tC=4`)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'sensor_inactive' })
  })
  it('jamais de jeton dans le journal', async () => {
    await get(`token=${SENSOR_TOKEN}&tC=4`)
    await get(`token=${'X'.repeat(43)}&tC=4`)
    expect(JSON.stringify(logger.lines)).not.toContain(SENSOR_TOKEN)
    expect(JSON.stringify(logger.lines)).not.toContain('X'.repeat(43))
  })
  it('méthodes : GET et POST seulement', async () => {
    const res = await handler(new Request(`${BASE}?token=${SENSOR_TOKEN}&tC=4`, { method: 'PUT' }))
    expect(res.status).toBe(405)
  })
})

describe('sensor-ingest : formats Shelly et simples', () => {
  it('webhook Shelly H&T Gen3 en GET : ?token=…&tC=${ev.tC} substitué', async () => {
    const res = await get(`token=${SENSOR_TOKEN}&tC=4.26`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stored: true, sensor_id: SENSOR_ID, value_c: 4.3, battery_percent: null })
    expect(repo.sensorReadings).toEqual([
      { id: 1, sensor_id: SENSOR_ID, measured_at: NOW.toISOString(), value_c: 4.3, battery_percent: null, received_at: NOW.toISOString() },
    ])
    expect(repo.sensors[0]).toMatchObject({ last_seen_at: NOW.toISOString(), last_value_c: 4.3, battery_percent: null })
  })
  it('alias temp / temperature / batt / battery, virgule décimale, négatif', async () => {
    expect((await get(`token=${SENSOR_TOKEN}&temp=-18,4&batt=76`)).status).toBe(200)
    expect(repo.sensors[0]).toMatchObject({ last_value_c: -18.4, battery_percent: 76 })
  })
  it('substitution non faite (« ${ev.tC} » littéral) → 400 invalid_measurement', async () => {
    const res = await get(`token=${SENSOR_TOKEN}&tC=${encodeURIComponent('${ev.tC}')}`)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_measurement')
    expect(repo.sensorReadings).toHaveLength(0)
  })
  it('POST notification Shelly Gen2/Gen3 (NotifyFullStatus) : temperature:0.tC, devicepower:0.battery.percent, ts', async () => {
    const ts = NOW.getTime() / 1000 - 20
    const body = {
      src: 'shellyhtg3-84fce63ad204',
      dst: 'ws',
      method: 'NotifyFullStatus',
      params: {
        ts,
        'temperature:0': { id: 0, tC: 3.7, tF: 38.7 },
        'humidity:0': { id: 0, rh: 61.2 },
        'devicepower:0': { id: 0, battery: { V: 5.6, percent: 92 }, external: { present: false } },
      },
    }
    const res = await post(`token=${SENSOR_TOKEN}`, body)
    expect(res.status).toBe(200)
    expect(repo.sensorReadings[0]).toMatchObject({ value_c: 3.7, battery_percent: 92, measured_at: new Date(ts * 1000).toISOString() })
  })
  it('POST NotifyEvent (params.events[].tC) et objet d’état seul (Shelly.GetStatus)', async () => {
    expect((await post(`token=${SENSOR_TOKEN}`, { method: 'NotifyEvent', params: { events: [{ component: 'temperature:0', event: 'temperature.change', tC: 5.1 }] } })).status).toBe(200)
    clock = new Date(NOW.getTime() + 31_000)
    expect((await post(`token=${SENSOR_TOKEN}`, { 'temperature:0': { tC: 5.4 }, 'devicepower:0': { battery: { percent: 15 } } })).status).toBe(200)
    expect(repo.sensorReadings.map((r) => [r.value_c, r.battery_percent])).toEqual([[5.1, null], [5.4, 15]])
  })
  it('POST JSON simple { temp, battery }, { temperature: { tC } }, formulaire, texte brut, °F', async () => {
    const step = async (fn: () => Promise<Response>) => {
      const res = await fn()
      expect(res.status).toBe(200)
      clock = new Date(clock.getTime() + 31_000)
    }
    await step(() => post(`token=${SENSOR_TOKEN}`, { temp: '2.5', battery: 88 }))
    await step(() => post(`token=${SENSOR_TOKEN}`, { temperature: { tC: 2.6 }, battery: { percent: 87 } }))
    await step(() => post(`token=${SENSOR_TOKEN}`, 'tC=2.7&battery=86', 'application/x-www-form-urlencoded'))
    await step(() => post(`token=${SENSOR_TOKEN}`, '2.8', 'text/plain'))
    await step(() => post(`token=${SENSOR_TOKEN}`, { tF: 0 }))
    expect(repo.sensorReadings.map((r) => r.value_c)).toEqual([2.5, 2.6, 2.7, 2.8, -17.8])
  })
  it('les paramètres d’URL priment sur le corps', async () => {
    await post(`token=${SENSOR_TOKEN}&tC=1.0`, { temp: 9 })
    expect(repo.sensorReadings[0].value_c).toBe(1)
  })
  it('valeurs absurdes refusées (−60..+100 °C) → 422, rien n’est stocké', async () => {
    for (const v of ['-60.1', '100.1', '850', '-273']) {
      const res = await get(`token=${SENSOR_TOKEN}&tC=${v}`)
      expect(res.status).toBe(422)
      expect((await res.json()).error).toBe('out_of_range')
    }
    expect((await get(`token=${SENSOR_TOKEN}&tC=-60`)).status).toBe(200)
    expect(repo.sensorReadings).toHaveLength(1)
  })
  it('pile hors 0..100 ignorée ; horodatage hors [−24 h, +5 min] remplacé par l’heure du serveur', () => {
    const m = parseMeasurement(new URLSearchParams('tC=4&batt=140&ts=' + (NOW.getTime() / 1000 - 2 * 86400)), null, NOW)
    expect(m).toEqual({ value_c: 4, battery_percent: null, measured_at: null })
    const f = parseMeasurement(new URLSearchParams('tC=4&ts=' + (NOW.getTime() / 1000 + 3600)), null, NOW)
    expect(f.measured_at).toBeNull()
    const ok = parseMeasurement(new URLSearchParams('tC=4&ts=' + (NOW.getTime() / 1000 - 60)), null, NOW)
    expect(ok.measured_at).toBe(new Date(NOW.getTime() - 60_000).toISOString())
  })
  it('corps trop volumineux → 413', async () => {
    const res = await post(`token=${SENSOR_TOKEN}`, { temp: 4, pad: 'x'.repeat(INGEST_LIMITS.maxBodyBytes) })
    expect(res.status).toBe(413)
  })
})

describe('sensor-ingest : limite de débit (≥ 30 s entre deux mesures stockées)', () => {
  it('deuxième mesure à 10 s → 429 Retry-After ; à 30 s → stockée', async () => {
    expect((await get(`token=${SENSOR_TOKEN}&tC=4`)).status).toBe(200)
    clock = new Date(NOW.getTime() + 10_000)
    const res = await get(`token=${SENSOR_TOKEN}&tC=4.1`)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(repo.calls.recordSensorReading).toBe(1) // pré-contrôle : aucune écriture
    clock = new Date(NOW.getTime() + 30_000)
    expect((await get(`token=${SENSOR_TOKEN}&tC=4.2`)).status).toBe(200)
    expect(repo.sensorReadings.map((r) => r.value_c)).toEqual([4, 4.2])
  })
  it('course entre deux envois : la base tranche (rate_limited) → 429', async () => {
    const original = repo.recordSensorReading.bind(repo)
    repo.recordSensorReading = async () => 'rate_limited'
    const res = await get(`token=${SENSOR_TOKEN}&tC=4`)
    expect(res.status).toBe(429)
    repo.recordSensorReading = original
  })
})
