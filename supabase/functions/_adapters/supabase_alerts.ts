// Adaptateur Deno (lot 6) : capteurs, alertes, abonnements Web Push via supabase-js (service_role).
// Non couvert par Vitest (logique dans _shared/sensor_ingest.ts, alerts_engine.ts, alerts_evaluate.ts,
// push_subscribe.ts, testée avec MemoryRepo).
import type { Alert } from '../../../shared/payloads.ts'
import type {
  AlertsRepo,
  EngineRecord,
  NewAlertRow,
  PushSubscribeRepo,
  PushSubscriptionRow,
  RecordReadingResult,
  SensorAuthRow,
  SensorForAlerts,
  SensorIngestRepo,
  SensorReadingRow,
} from '../_shared/repo.ts'
import { ALERT_COLUMNS, DbError, iso, isoReq, mapAlert, mapSensor, SupabaseRepo } from './supabase_repo.ts'

/** PostgREST plafonne chaque réponse (max_rows, 1000 par défaut) : lecture par pages. */
const PAGE = 1000
const MAX_ROWS = 20_000

export class SupabaseLot6Repo extends SupabaseRepo implements SensorIngestRepo, AlertsRepo, PushSubscribeRepo {
  // ---- sensor-ingest ----
  async findSensorByTokenHash(tokenHash: string): Promise<SensorAuthRow | null> {
    const { data, error } = await this.db.from('sensors').select('id, name, equipment_id, active, last_seen_at').eq('token_hash', tokenHash).maybeSingle()
    if (error) throw new DbError('sensors.select', error)
    return data ? { id: data.id, name: data.name, equipment_id: data.equipment_id, active: Boolean(data.active), last_seen_at: iso(data.last_seen_at) } : null
  }
  async recordSensorReading(row: {
    sensor_id: string
    measured_at: string | null
    value_c: number
    battery_percent: number | null
    min_interval_seconds: number
  }): Promise<RecordReadingResult> {
    const { data, error } = await this.db.rpc('sensor_record_reading', {
      p_sensor_id: row.sensor_id,
      p_measured_at: row.measured_at,
      p_value_c: row.value_c,
      p_battery_percent: row.battery_percent,
      p_min_interval_seconds: row.min_interval_seconds,
    })
    if (error) throw new DbError('sensor_record_reading', error)
    if (data === 'stored' || data === 'rate_limited' || data === 'inactive' || data === 'unknown_sensor') return data
    throw new Error('sensor_record_reading : réponse inattendue')
  }

  // ---- alerts-evaluate ----
  async listSensorsForAlerts(): Promise<SensorForAlerts[]> {
    const { data, error } = await this.db
      .from('sensors')
      .select('id, name, equipment_id, vendor, active, last_seen_at, last_value_c, battery_percent, updated_at, created_at')
    if (error) throw new DbError('sensors.list_alerts', error)
    return (data ?? []).map((s) => ({ ...mapSensor(s), created_at: isoReq(s.created_at) }))
  }
  async listSensorReadings(sensorIds: string[], since: string): Promise<SensorReadingRow[]> {
    const out: SensorReadingRow[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await this.db
        .from('sensor_readings')
        .select('id, sensor_id, measured_at, value_c')
        .in('sensor_id', sensorIds)
        .gte('measured_at', since)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw new DbError('sensor_readings.list', error)
      for (const r of data ?? []) out.push({ sensor_id: r.sensor_id, measured_at: isoReq(r.measured_at), value_c: Number(r.value_c) })
      if ((data ?? []).length < PAGE) break
    }
    return out
  }
  async listRecentRecords(sinceServerTime: string, types: readonly string[]): Promise<EngineRecord[]> {
    const out: EngineRecord[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await this.db
        .from('records')
        .select('id, type, payload, device_time, supersedes_id')
        .is('quarantine_reason', null)
        .in('type', [...types])
        .gte('server_time', sinceServerTime)
        .order('server_time')
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw new DbError('records.list_recent', error)
      for (const r of data ?? []) out.push({ id: r.id, type: r.type, payload: r.payload ?? {}, device_time: isoReq(r.device_time), supersedes_id: r.supersedes_id })
      if ((data ?? []).length < PAGE) break
    }
    return out
  }
  async firstDeviceEnrolledAt(): Promise<string | null> {
    const { data, error } = await this.db.from('devices').select('enrolled_at').order('enrolled_at', { ascending: true }).limit(1)
    if (error) throw new DbError('devices.first_enrolled', error)
    return data && data.length > 0 && data[0].enrolled_at ? new Date(data[0].enrolled_at).toISOString() : null
  }
  async listOpenAlerts(): Promise<Alert[]> {
    return this.listAlerts(null)
  }
  async openAlert(row: NewAlertRow): Promise<Alert | null> {
    const { data, error } = await this.db.from('alerts').insert(row).select(ALERT_COLUMNS).single()
    if (error) {
      if (error.code === '23505') return null // déjà ouverte (index alerts_one_open_idx)
      throw new DbError('alerts.insert', error)
    }
    return mapAlert(data)
  }
  async resolveAlerts(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    // La valeur est remplacée par now() dans le trigger (horodatage serveur).
    const { error } = await this.db.from('alerts').update({ resolved_at: new Date().toISOString() }).in('id', ids).is('resolved_at', null)
    if (error) throw new DbError('alerts.resolve', error)
  }
  async markAlertsNotified(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const { error } = await this.db.from('alerts').update({ last_notified_at: new Date().toISOString() }).in('id', ids)
    if (error) throw new DbError('alerts.notified', error)
  }
  async listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
    const { data, error } = await this.db.from('push_subscriptions').select('id, device_id, endpoint, p256dh, auth, failures').order('created_at')
    if (error) throw new DbError('push_subscriptions.list', error)
    return (data ?? []).map((s) => ({ ...s, failures: Number(s.failures) }))
  }
  async recordPushSuccess(id: string, at: string): Promise<void> {
    const { error } = await this.db.from('push_subscriptions').update({ last_success_at: at, failures: 0 }).eq('id', id)
    if (error) throw new DbError('push_subscriptions.success', error)
  }
  async recordPushFailure(id: string): Promise<number> {
    const { data, error } = await this.db.from('push_subscriptions').select('failures').eq('id', id).maybeSingle()
    if (error) throw new DbError('push_subscriptions.select', error)
    if (!data) return 0
    const failures = Number(data.failures) + 1
    const upd = await this.db.from('push_subscriptions').update({ failures }).eq('id', id)
    if (upd.error) throw new DbError('push_subscriptions.failure', upd.error)
    return failures
  }
  async deletePushSubscriptionById(id: string): Promise<void> {
    const { error } = await this.db.from('push_subscriptions').delete().eq('id', id)
    if (error) throw new DbError('push_subscriptions.delete', error)
  }

  // ---- push-subscribe ----
  async upsertPushSubscription(row: { device_id: string; endpoint: string; p256dh: string; auth: string }): Promise<'created' | 'updated'> {
    const update = async () => {
      const { data, error } = await this.db
        .from('push_subscriptions')
        .update({ device_id: row.device_id, p256dh: row.p256dh, auth: row.auth, failures: 0 })
        .eq('endpoint', row.endpoint)
        .select('id')
      if (error) throw new DbError('push_subscriptions.update', error)
      return (data ?? []).length > 0
    }
    if (await update()) return 'updated'
    const { error } = await this.db.from('push_subscriptions').insert(row)
    if (!error) return 'created'
    if (error.code === '23505' && (await update())) return 'updated' // inscription concurrente
    throw new DbError('push_subscriptions.insert', error)
  }
  async removePushSubscription(deviceId: string, endpoint: string): Promise<boolean> {
    const { data, error } = await this.db.from('push_subscriptions').delete().eq('device_id', deviceId).eq('endpoint', endpoint).select('id')
    if (error) throw new DbError('push_subscriptions.delete', error)
    return (data ?? []).length > 0
  }
}
