// Adaptateur Deno : implémente les interfaces Repo avec supabase-js (clé service_role).
// Seul endroit (avec les index.ts) qui dépend de Deno / npm. Non couvert par Vitest.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Checklist, ChecklistItem, CleaningTask, Product, Recipe, Supplier } from '../../../shared/payloads.ts'
import type { Equipment, EquipmentKind, Establishment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'
import { jsonLogger, parseAllowedOrigins, type HttpEnv } from '../_shared/http.ts'
import { classifyDbError } from '../_shared/repo.ts'
import type {
  BootstrapManagerResult,
  BootstrapManagerRow,
  BootstrapRepo,
  ChainHead,
  CreateAuthUserResult,
  DeviceRow,
  EnrollRepo,
  HealthRepo,
  InsertResult,
  NewRecordRow,
  PullRepo,
  PushRepo,
  QuarantineReason,
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

/**
 * Erreur Supabase Auth sans son message (qui pourrait reprendre une donnée saisie) :
 * seuls le code et le statut HTTP partent dans les journaux.
 */
class AuthAdminError extends Error {
  constructor(op: string, err: { code?: string; status?: number }) {
    super(`${op} : ${err.status ?? '?'} ${err.code ?? ''}`.trim())
    this.name = 'AuthAdminError'
  }
}

/** Taille des paquets pour `.in('id', …)` (longueur d'URL PostgREST). */
const IN_CHUNK = 100

export class SupabaseRepo implements PushRepo, PullRepo, EnrollRepo, HealthRepo, BootstrapRepo {
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
      .select('retention_years, auto_lock_minutes, clock_suspect_minutes, email_alerts, daily_check_times, missed_slot_carry_over, thaw_dlc_days, oil_polar_max, oil_polar_warn')
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
        .select('id, type, hash, device_id, device_seq, supersedes_id, server_time, clock_suspect, quarantine_reason')
        .in('id', ids.slice(i, i + IN_CHUNK))
      if (error) throw new DbError('records.select', error)
      for (const r of data ?? []) {
        out.push({
          id: r.id,
          type: r.type,
          hash: r.hash,
          device_id: r.device_id,
          device_seq: Number(r.device_seq),
          supersedes_id: r.supersedes_id,
          server_time: isoReq(r.server_time),
          clock_suspect: Boolean(r.clock_suspect),
          quarantine_reason: (r.quarantine_reason ?? null) as QuarantineReason | null,
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
  async getEquipmentKind(equipmentId: string): Promise<EquipmentKind | null> {
    const { data, error } = await this.db.from('equipment').select('kind').eq('id', equipmentId).maybeSingle()
    if (error) throw new DbError('equipment.select', error)
    return data ? (data.kind as EquipmentKind) : null
  }
  async supplierExists(supplierId: string): Promise<boolean> {
    const { data, error } = await this.db.from('suppliers').select('id').eq('id', supplierId).maybeSingle()
    if (error) throw new DbError('suppliers.select', error)
    return data !== null
  }
  async productExists(productId: string): Promise<boolean> {
    const { data, error } = await this.db.from('products').select('id').eq('id', productId).maybeSingle()
    if (error) throw new DbError('products.select', error)
    return data !== null
  }
  async recipeExists(recipeId: string): Promise<boolean> {
    const { data, error } = await this.db.from('recipes').select('id').eq('id', recipeId).maybeSingle()
    if (error) throw new DbError('recipes.select', error)
    return data !== null
  }
  async cleaningTaskExists(taskId: string): Promise<boolean> {
    const { data, error } = await this.db.from('cleaning_tasks').select('id').eq('id', taskId).maybeSingle()
    if (error) throw new DbError('cleaning_tasks.select', error)
    return data !== null
  }
  async checklistExists(checklistId: string): Promise<boolean> {
    const { data, error } = await this.db.from('checklists').select('id').eq('id', checklistId).maybeSingle()
    if (error) throw new DbError('checklists.select', error)
    return data !== null
  }
  async getPayloadsByIds(ids: string[]): Promise<{ id: string; type: string; payload: unknown }[]> {
    const out: { id: string; type: string; payload: unknown }[] = []
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await this.db.from('records').select('id, type, payload').in('id', ids.slice(i, i + IN_CHUNK))
      if (error) throw new DbError('records.select_payload', error)
      for (const r of data ?? []) out.push({ id: r.id, type: r.type, payload: r.payload })
    }
    return out
  }
  async insertRecord(row: NewRecordRow): Promise<InsertResult> {
    // server_time : jamais envoyé, imposé par le trigger. clock_suspect : envoyé seulement à true (lot
    // suspect) ; le trigger fait un OU avec son calcul. Valeurs relues ici. Clés absentes non envoyées.
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) if (v !== undefined) body[k] = v
    const { data, error } = await this.db.from('records').insert(body).select('server_time, clock_suspect').single()
    if (!error) return { ok: true, server_time: isoReq(data.server_time), clock_suspect: Boolean(data.clock_suspect) }
    const code = error.code ?? ''
    const message = error.message ?? ''
    // Messages des triggers (`HACCP: …`), 22xxx (données invalides), 23xxx (contraintes),
    // P0001 (RAISE sans errcode) : réponses métier. Le reste (réseau, droits…) remonte en 500.
    if (message.startsWith('HACCP:') || code.startsWith('22') || code.startsWith('23') || code === 'P0001') {
      return classifyDbError(code, message)
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

  async listSuppliers(since: string | null): Promise<Supplier[]> {
    let q = this.db.from('suppliers').select('id, name, phone, email, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('suppliers.list', error)
    return (data ?? []).map((s) => ({ ...s, updated_at: isoReq(s.updated_at) }))
  }
  async listProducts(since: string | null): Promise<Product[]> {
    let q = this.db
      .from('products')
      .select('id, name, allergens, storage, shelf_life_opened_hours, shelf_life_thawed_hours, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('products.list', error)
    return (data ?? []).map((p) => ({ ...p, allergens: p.allergens ?? [], updated_at: isoReq(p.updated_at) }))
  }
  async listRecipes(since: string | null): Promise<Recipe[]> {
    let q = this.db
      .from('recipes')
      .select('id, name, ingredient_product_ids, extra_allergens, storage, shelf_life_hours, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('recipes.list', error)
    return (data ?? []).map((r) => ({
      ...r,
      ingredient_product_ids: r.ingredient_product_ids ?? [],
      extra_allergens: r.extra_allergens ?? [],
      updated_at: isoReq(r.updated_at),
    }))
  }

  async listCleaningTasks(since: string | null): Promise<CleaningTask[]> {
    let q = this.db.from('cleaning_tasks').select('id, name, frequency, product, method, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('cleaning_tasks.list', error)
    return (data ?? []).map((t) => ({ ...t, updated_at: isoReq(t.updated_at) }))
  }
  async listChecklists(since: string | null): Promise<Checklist[]> {
    let q = this.db.from('checklists').select('id, name, kind, items, active, updated_at')
    if (since) q = q.gte('updated_at', since)
    const { data, error } = await q.order('name')
    if (error) throw new DbError('checklists.list', error)
    return (data ?? []).map((c) => ({ ...c, items: (c.items ?? []) as ChecklistItem[], updated_at: isoReq(c.updated_at) }))
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

  // ---- bootstrap du gérant ----
  async countManagers(): Promise<number> {
    const { count, error } = await this.db.from('managers').select('user_id', { count: 'exact', head: true })
    if (error) throw new DbError('managers.count', error)
    return count ?? 0
  }
  async getEstablishmentName(): Promise<string | null> {
    const { data, error } = await this.db.from('establishment').select('name').limit(1).maybeSingle()
    if (error) throw new DbError('establishment.select', error)
    return data?.name ?? null
  }
  async countRecentBootstrapFailures(windowMinutes: number): Promise<number> {
    const { data, error } = await this.db.rpc('bootstrap_failure_count', { p_minutes: windowMinutes })
    if (error) throw new DbError('bootstrap_failure_count', error)
    return Number(data ?? 0)
  }
  async recordBootstrapFailure(reason: string): Promise<void> {
    const { error } = await this.db.rpc('bootstrap_record_failure', { p_reason: reason })
    if (error) throw new DbError('bootstrap_record_failure', error)
  }
  async createAuthUser(email: string, password: string): Promise<CreateAuthUserResult> {
    const { data, error } = await this.db.auth.admin.createUser({ email, password, email_confirm: true })
    if (!error && data.user) return { ok: true, user_id: data.user.id }
    const e = (error ?? {}) as { code?: string; status?: number }
    if (e.code === 'email_exists' || e.code === 'user_already_exists') return { ok: false, kind: 'email_exists' }
    if (e.code === 'weak_password') return { ok: false, kind: 'weak_password' }
    if (e.status === 400 || e.status === 422) return { ok: false, kind: 'rejected' }
    throw new AuthAdminError('auth.admin.createUser', e)
  }
  async deleteAuthUser(userId: string): Promise<void> {
    const { error } = await this.db.auth.admin.deleteUser(userId)
    if (error) throw new AuthAdminError('auth.admin.deleteUser', error as { code?: string; status?: number })
  }
  async bootstrapManager(row: BootstrapManagerRow): Promise<BootstrapManagerResult> {
    const { data, error } = await this.db.rpc('bootstrap_manager', {
      p_user_id: row.user_id,
      p_display_name: row.display_name,
      p_pin_salt: row.pin_salt,
      p_pin_hash: row.pin_hash,
      p_establishment_name: row.establishment_name,
    })
    if (error) {
      if ((error.message ?? '').startsWith('HACCP: already_bootstrapped')) return { ok: false, kind: 'already_bootstrapped' }
      throw new DbError('bootstrap_manager', error)
    }
    if (typeof data !== 'string') throw new Error('bootstrap_manager : réponse inattendue')
    return { ok: true, staff_id: data }
  }

  // ---- santé ----
  async ping(): Promise<void> {
    const { error } = await this.db.from('settings').select('id').limit(1)
    if (error) throw new DbError('ping', error)
  }
}
