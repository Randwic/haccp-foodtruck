// sensor-ingest : réception des mesures des capteurs fixes (webhooks Shelly H&T Gen3, etc.).
//   GET  /functions/v1/sensor-ingest?token=<jeton>&tC=4.2[&batt=87]
//   POST /functions/v1/sensor-ingest?token=<jeton>   corps JSON (notification Shelly Gen2/Gen3,
//        { temp, battery }…) ou formulaire ; le jeton peut aussi venir de l'en-tête x-sensor-token.
// Les webhooks Shelly n'acceptent pas d'en-tête personnalisé : le jeton est dans l'URL (propre au
// capteur, renouvelable par sensor_rotate_token()). Il n'est jamais journalisé.
import { sha256Hex } from './crypto.ts'
import { HttpError, jsonResponse, readBodyBytes, withHttp, type HttpEnv } from './http.ts'
import type { SensorIngestRepo } from './repo.ts'

export const SENSOR_TOKEN_HEADER = 'x-sensor-token'
export const INGEST_LIMITS = {
  /** Au moins 30 s entre deux mesures stockées d'un même capteur. */
  minIntervalSeconds: 30,
  maxBodyBytes: 16 * 1024,
  minC: -60,
  maxC: 100,
  /** Horodatage fourni par le capteur accepté s'il est dans [now − 24 h, now + 5 min] (sinon heure du serveur). */
  maxPastMs: 24 * 3_600_000,
  maxFutureMs: 5 * 60_000,
} as const

export interface Measurement {
  value_c: number
  battery_percent: number | null
  /** ISO ; null = heure de réception. */
  measured_at: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Nombre JSON fini, ou texte numérique (« 4.2 », « 4,2 », « -18 »). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^\s*[-+]?\d+([.,]\d+)?\s*$/.test(v)) return Number(v.trim().replace(',', '.'))
  return null
}

const fToC = (f: number) => ((f - 32) * 5) / 9

/** Cherche la température (°C) dans les formats courants. */
function temperatureFrom(src: Record<string, unknown>): number | null {
  for (const k of ['tC', 'temp', 'temperature', 'temperature_c', 'value_c', 'tc', 't']) {
    const v = src[k]
    const n = toNumber(v)
    if (n !== null) return n
    if (isObj(v)) {
      const inner = toNumber(v.tC) ?? toNumber(v.value)
      if (inner !== null) return inner
      const f = toNumber(v.tF)
      if (f !== null) return fToC(f)
    }
  }
  const f = toNumber(src.tF) ?? toNumber(src.temp_f)
  return f === null ? null : fToC(f)
}

function batteryFrom(src: Record<string, unknown>): number | null {
  for (const k of ['battery_percent', 'battery', 'batt', 'bat']) {
    const v = src[k]
    const n = toNumber(v)
    if (n !== null) return n
    if (isObj(v)) {
      const inner = toNumber(v.percent)
      if (inner !== null) return inner
    }
  }
  return null
}

/** Composants Shelly (`temperature:0`, `devicepower:0`) d'un objet d'état ou de `params`. */
function shellyComponents(o: Record<string, unknown>): { t: number | null; b: number | null; ts: number | null } {
  let t: number | null = null
  let b: number | null = null
  const temp = o['temperature:0']
  if (isObj(temp)) t = toNumber(temp.tC) ?? (toNumber(temp.tF) !== null ? fToC(toNumber(temp.tF) as number) : null)
  const power = o['devicepower:0']
  if (isObj(power) && isObj(power.battery)) b = toNumber(power.battery.percent)
  // NotifyEvent : params.events[] = { component: 'temperature:0', tC, ts… }
  if (t === null && Array.isArray(o.events)) {
    for (const ev of o.events) {
      if (!isObj(ev)) continue
      if (t === null) t = toNumber(ev.tC)
      if (b === null && isObj(ev.battery)) b = toNumber(ev.battery.percent)
    }
  }
  return { t, b, ts: toNumber(o.ts) }
}

function timeFrom(v: unknown, now: Date): string | null {
  let ms: number | null = null
  const n = toNumber(v)
  if (n !== null) ms = n > 1e12 ? n : n * 1000 // secondes Unix (Shelly) ou millisecondes
  else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) ms = Date.parse(v)
  if (ms === null || !Number.isFinite(ms)) return null
  const d = now.getTime() - ms
  if (d > INGEST_LIMITS.maxPastMs || -d > INGEST_LIMITS.maxFutureMs) return null
  return new Date(ms).toISOString()
}

/**
 * Extrait la mesure de la requête (paramètres d'URL prioritaires, puis corps). Tolérant aux formats :
 *  - URL : `tC`, `temp`, `temperature`, `t` (ou `tF`), `batt` / `battery`, `ts` ;
 *  - Shelly Gen2/Gen3 : `{ method: 'NotifyFullStatus'|'NotifyStatus'|'NotifyEvent', params: { ts,
 *    'temperature:0': { tC }, 'devicepower:0': { battery: { percent } }, events: [...] } }`, ou l'objet
 *    d'état seul (`Shelly.GetStatus`) ;
 *  - simple : `{ temp | temperature | tC | value_c, battery | battery_percent, ts | measured_at }`.
 * Lève 400 `invalid_measurement` si la température est absente / illisible, 422 `out_of_range` hors −60..+100 °C.
 */
export function parseMeasurement(query: URLSearchParams, body: unknown, now: Date): Measurement {
  const q: Record<string, unknown> = {}
  for (const [k, v] of query) if (k !== 'token') q[k] = v
  let value = temperatureFrom(q)
  let battery = batteryFrom(q)
  let ts: unknown = q.ts ?? q.measured_at

  const sources: Record<string, unknown>[] = []
  if (isObj(body)) {
    if (isObj(body.params)) sources.push(body.params)
    sources.push(body)
  }
  for (const src of sources) {
    const sh = shellyComponents(src)
    value ??= sh.t ?? temperatureFrom(src)
    battery ??= sh.b ?? batteryFrom(src)
    ts ??= sh.ts ?? src.measured_at
  }
  if (value === null) {
    throw new HttpError(400, 'invalid_measurement', 'température absente ou illisible (paramètre tC / temp, ou corps JSON)')
  }
  if (value < INGEST_LIMITS.minC || value > INGEST_LIMITS.maxC) {
    throw new HttpError(422, 'out_of_range', `température hors de la plage plausible (${INGEST_LIMITS.minC}..${INGEST_LIMITS.maxC} °C)`)
  }
  const b = battery !== null && battery >= 0 && battery <= 100 ? Math.round(battery) : null
  return { value_c: Math.round(value * 10) / 10, battery_percent: b, measured_at: timeFrom(ts, now) }
}

async function readBody(req: Request): Promise<unknown> {
  if (req.method !== 'POST') return null
  const bytes = await readBodyBytes(req, INGEST_LIMITS.maxBodyBytes)
  if (bytes.byteLength === 0) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new HttpError(400, 'invalid_measurement', 'encodage UTF-8 invalide')
  }
  const ct = (req.headers.get('content-type') ?? '').toLowerCase()
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text))
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    // Corps réduit à un nombre (« 4.2 ») : la température seule.
    return typeof parsed === 'number' ? { temp: parsed } : parsed
  } catch {
    // Corps texte brut « 4.2 » (certains relais) ; sinon ignoré.
    const n = toNumber(trimmed)
    return n === null ? null : { temp: n }
  }
}

export interface SensorIngestDeps extends HttpEnv {
  repo: SensorIngestRepo
}

export function createSensorIngestHandler(deps: SensorIngestDeps): (req: Request) => Promise<Response> {
  return withHttp('sensor-ingest', ['GET', 'POST'], deps, async (req, ctx) => {
    const url = new URL(req.url)
    const token = (req.headers.get(SENSOR_TOKEN_HEADER) ?? url.searchParams.get('token') ?? '').trim()
    if (token.length < 16 || token.length > 256 || !/^[\x21-\x7e]+$/.test(token)) throw new HttpError(401, 'unauthorized')
    const sensor = await deps.repo.findSensorByTokenHash(await sha256Hex(token))
    if (!sensor) {
      ctx.logger.log('warn', 'sensor_auth_failed')
      throw new HttpError(401, 'unauthorized')
    }
    if (!sensor.active) throw new HttpError(403, 'sensor_inactive')

    const now = ctx.now()
    const m = parseMeasurement(url.searchParams, await readBody(req), now)
    const rateLimited = () =>
      jsonResponse(429, { error: 'rate_limited', detail: `une mesure au plus toutes les ${INGEST_LIMITS.minIntervalSeconds} s` }, { 'Retry-After': String(INGEST_LIMITS.minIntervalSeconds) })

    // Pré-contrôle sans écriture ; la base revérifie sous verrou (envois simultanés).
    if (sensor.last_seen_at && now.getTime() - Date.parse(sensor.last_seen_at) < INGEST_LIMITS.minIntervalSeconds * 1000) return rateLimited()
    const res = await deps.repo.recordSensorReading({
      sensor_id: sensor.id,
      measured_at: m.measured_at,
      value_c: m.value_c,
      battery_percent: m.battery_percent,
      min_interval_seconds: INGEST_LIMITS.minIntervalSeconds,
    })
    if (res === 'rate_limited') return rateLimited()
    if (res === 'inactive') throw new HttpError(403, 'sensor_inactive')
    if (res === 'unknown_sensor') throw new HttpError(401, 'unauthorized')
    ctx.logger.log('info', 'sensor_reading', { sensor_id: sensor.id, value_c: m.value_c, battery_percent: m.battery_percent, device_ts: m.measured_at !== null })
    return jsonResponse(200, { ok: true, stored: true, sensor_id: sensor.id, value_c: m.value_c, battery_percent: m.battery_percent })
  })
}
