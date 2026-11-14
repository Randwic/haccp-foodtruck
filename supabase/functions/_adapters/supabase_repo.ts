// Adaptateur Deno : implémente les interfaces Repo avec supabase-js (clé service_role).
// Seul endroit (avec les index.ts) qui dépend de Deno / npm. Non couvert par Vitest.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Equipment, Establishment, RecordType, Settings, StaffMember, Threshold } from '../../../shared/types.ts'
import { jsonLogger, parseAllowedOrigins, type HttpEnv } from '../_shared/http.ts'
import type {
  ChainHead,
  DeviceRow,
  EnrollRepo,
  HealthRepo,
  InsertResult,
  NewRecordRow,
  PullRepo,
  PushRepo,
  StoredRecord,
} from '../_shared/repo.ts'

/** Lecture de l'environnement commune à toutes les fonctions. */
export function httpEnvFromDeno(): HttpEnv {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGIN'))
  const logger = jsonLogger({ app: 'haccp' })
  if (allowedOrigins.length === 0) logger.log('warn', 'cors_not_configured', { hint: 'définir ALLOWED_ORIGIN' })
  return { allowedOrigins, logger }
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

/** Erreur base sans détail exploitable côté client (le message part seulement dans les logs). */
class DbError extends Error {
  constructor(op: string, err: { code?: string; message?: string }) {
    super(`${op} : ${err.code ?? '?'} ${err.message ?? ''}`.trim())
    this.name = 'DbError'
  }
}

const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString())
const isoReq = (v: string): string => new Date(v).toISOString()

/** Taille des paquets pour `.in('id', …)` (longueur d'URL PostgREST). */
const IN_CHUNK = 100

export class SupabaseRepo implements PushRepo, PullRepo, EnrollRepo, HealthRepo {
  constructor(private readonly db: SupabaseClient) {}

  // ---- appareils ----
  async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    const { data, error } = await this.db.from('devices').select('id, name, revoked_at').eq('token_hash', tokenHash).maybeSingle()
    if (error) throw new DbError('devices.select', error)
    return data ? { id: data.id, name: data.name, revoked_at: iso(data.revoked_at) } : null
  }
  async touchDevice(deviceId: string, at: string): Promise<void> {
    const { error } = await this.db.from('devices').update({ last_seen_at: at }).eq('id', deviceId)
    if (error) throw new DbError('devices.update', error)
  }

  // ---- registre ----
  async getSettings(): Promise<Settings | null> {
    const { data, error } = await this.db
      .from('settings')
      .select('retention_years, auto_lock_minutes, clock_suspect_minutes, email_alerts')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new DbError('settings.select', error)
    return data
  }
  async getChainHead(deviceId: string): Promise<ChainHead | null> {
    const { data, error } = await this.db.rpc('device_chain_head', { p_device_id: deviceId })
    if (error) throw new DbError('device_chain_head', error)
    const row = Array.isArray(data) ? data[0] : data
    if (!row || row.device_seq === null) return null
    return { device_seq: Number(row.device_seq), hash: row.hash }
  }
  async getRecordsByIds(ids: string[]): Promise<StoredRecord[]> {
    const out: StoredRecord[] = []
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await this.db
        .from('records')
        .select('id, type, hash, device_id, device_seq, supersedes_id, server_time, clock_suspect')
        .in('id', ids.slice(i, i + IN_CHUNK))
      if (error) throw new DbError('records.select', error)
      for (const r of data ?? []) {
        out.push({
          id: r.id,
          type: r.type as RecordType,
          hash: r.hash,
          device_id: r.device_id,
          device_seq: Number(r.device_seq),
          supersedes_id: r.supersedes_id,
          server_time: isoReq(r.server_time),
          clock_suspect: Boolean(r.clock_suspect),
        })
      }
    }
    return out
  }
  async getStaffStatus(staffId: string) {
    const { data, error } = await this.db.from('staff').select('id, active').eq('id', staffId).maybeSingle()
    if (error) throw new DbError('staff.select', error)
    return data
  }
  async equipmentExists(equipmentId: string): Promise<boolean> {
    const { data, error } = await this.db.from('equipment').select('id').eq('id', equipmentId).maybeSingle()
    if (error) throw new DbError('equipment.select', error)
    return data !== null
  }
  async insertRecord(row: NewRecordRow): Promise<InsertResult> {
    const { data, error } = await this.db.from('records').insert(row).select('server_time').single()
    if (!error) return { ok: true, server_time: isoReq(data.server_time) }
    const code = error.code ?? ''
    if (code === '23505') return { ok: false, kind: 'unique_violation' }
    // 22xxx (données invalides), 23xxx (contraintes), P0001 (RAISE dans un trigger) : refus définitif.
    if (code.startsWith('22') || code.startsWith('23') || code === 'P0001') {
      return { ok: false, kind: 'rejected', detail: `${code} ${error.message}` }
    }
    throw new DbError('records.insert', error)
  }

  // ---- références ----
  async getEstablishment(): Promise<Establishment | null> {
    const { data, error } = await this.db.from('establishment').select('id, name, timezone').limit(1).maybeSingle()
    if (error) throw new DbError('establishment.select', error)
    return data
  }
  async listStaff(since: string | null): Promise<StaffMember[]> {
    let q = this.db.from('staff').select('id, display_name, role, active, pin_salt, pin_hash, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('display_name')
    if (error) throw new DbError('staff.list', error)
    return (data ?? []).map((s) => ({ ...s, updated_at: isoReq(s.updated_at) }))
  }
  async listEquipment(since: string | null): Promise<Equipment[]> {
    let q = this.db.from('equipment').select('id, name, kind, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('equipment.list', error)
    return (data ?? []).map((e) => ({ ...e, updated_at: isoReq(e.updated_at) }))
  }
  async listThresholds(since: string | null): Promise<Threshold[]> {
    let q = this.db.from('thresholds').select('id, equipment_id, check_type, min_c, max_c, tolerance_minutes, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q
    if (error) throw new DbError('thresholds.list', error)
    return (data ?? []).map((t) => ({
      ...t,
      min_c: t.min_c === null ? null : Number(t.min_c),
      max_c: t.max_c === null ? null : Number(t.max_c),
      updated_at: isoReq(t.updated_at),
    }))
  }

  // ---- enrôlement ----
  async getUserIdFromJwt(jwt: string): Promise<string | null> {
    const { data, error } = await this.db.auth.getUser(jwt)
    if (error || !data.user) return null
    return data.user.id
  }
  async isManager(userId: string): Promise<boolean> {
    const { data, error } = await this.db.from('managers').select('user_id').eq('user_id', userId).maybeSingle()
    if (error) throw new DbError('managers.select', error)
    return data !== null
  }
  async insertDevice(row: { name: string; token_hash: string; enrolled_by: string }): Promise<{ id: string }> {
    const { data, error } = await this.db.from('devices').insert(row).select('id').single()
    if (error) throw new DbError('devices.insert', error)
    return { id: data.id }
  }

  // ---- santé ----
  async ping(): Promise<void> {
    const { error } = await this.db.from('settings').select('id').limit(1)
    if (error) throw new DbError('ping', error)
  }
}
