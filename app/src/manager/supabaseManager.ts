// Implémentation Supabase de ManagerApi : Edge Functions (bootstrap, device-enroll) + supabase-js (REST/RLS).
// Seule la clé publique « anon » est utilisée ; les droits viennent de la session du gérant (RLS is_manager()).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DeviceEnrollResponse, Equipment, Threshold } from '../../../shared/types.ts'
import { ManagerError, MESSAGES, type ManagedStaff, type ManagerApi, type ManagerSettings } from './api.ts'

export interface SupabaseManagerOptions {
  url: string
  anonKey: string
  /** Délai max d'un appel de fonction (défaut 20 s). */
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Client déjà construit (tests). */
  client?: SupabaseClient
}

const EQUIPMENT_COLS = 'id,name,kind,active,updated_at'
const THRESHOLD_COLS = 'id,equipment_id,check_type,min_c,max_c,tolerance_minutes,updated_at'
const STAFF_COLS = 'id,display_name,role,active,updated_at'

interface PgError {
  message: string
  code?: string
  status?: number
}

/** Traduit une erreur PostgREST / réseau en ManagerError lisible. */
function fromPg(e: PgError | null, status?: number): ManagerError {
  const st = e?.status ?? status ?? null
  const msg = e?.message ?? ''
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg) && !st) return new ManagerError('network', MESSAGES.network)
  if (st === 401 || e?.code === 'PGRST301' || /JWT/i.test(msg)) return new ManagerError('unauthorized', MESSAGES.unauthorized, st)
  if (st === 403 || e?.code === '42501') return new ManagerError('forbidden', MESSAGES.forbidden, st)
  if (st === 429) return new ManagerError('rate_limited', MESSAGES.rate_limited, st)
  if (e?.code === '23505') return new ManagerError('validation', 'Cette valeur existe déjà.', st)
  if (e?.code?.startsWith('23') || e?.code?.startsWith('22')) return new ManagerError('validation', 'Valeur refusée par le serveur : vérifiez la saisie.', st)
  if (st !== null && st >= 500) return new ManagerError('server', MESSAGES.server, st)
  return new ManagerError('server', msg ? `Erreur du serveur : ${msg}` : MESSAGES.server, st)
}

const VALIDATION_MESSAGES: Record<string, string> = {
  password_too_short: 'Le mot de passe doit comporter au moins 12 caractères.',
  password_too_long: 'Le mot de passe est trop long (72 octets au maximum).',
  weak_password: 'Mot de passe refusé car trop faible : choisissez-en un plus long ou moins courant.',
  invalid_email: 'Adresse email invalide.',
  email_exists: 'Un compte existe déjà avec cet email.',
  invalid_pin: 'Code PIN invalide.',
  invalid_request: 'Requête invalide : vérifiez les informations saisies.',
  invalid_json: 'Requête invalide : vérifiez les informations saisies.',
}

export function createSupabaseManagerApi(opts: SupabaseManagerOptions): ManagerApi {
  const base = opts.url.replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? 20_000
  const doFetch: typeof fetch = opts.fetchImpl ?? ((i, init) => fetch(i, init))
  const sb: SupabaseClient =
    opts.client ??
    createClient(base, opts.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'haccp-manager-auth' },
    })

  async function accessToken(): Promise<string> {
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new ManagerError('unauthorized', MESSAGES.unauthorized)
    return token
  }

  async function callFunction<T>(name: string, init: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean }): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { apikey: opts.anonKey }
    headers.Authorization = `Bearer ${init.auth ? await accessToken() : opts.anonKey}`
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}/functions/v1/${name}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      })
    } catch {
      throw new ManagerError('network', MESSAGES.network)
    } finally {
      clearTimeout(timer)
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (res.ok) return { status: res.status, data: data as T }
    const err = (data && typeof data === 'object' ? (data as { error?: string; detail?: string }) : {}) ?? {}
    if (res.status === 409) throw new ManagerError('already_bootstrapped', MESSAGES.already_bootstrapped, 409)
    if (res.status === 429) {
      const msg = err.error === 'too_many_attempts' ? 'Trop de tentatives, réessayez dans 15 minutes.' : MESSAGES.rate_limited
      throw new ManagerError('rate_limited', msg, 429)
    }
    if (res.status === 401) throw new ManagerError('unauthorized', MESSAGES.unauthorized, 401)
    if (res.status === 403) throw new ManagerError('forbidden', MESSAGES.forbidden, 403)
    if (res.status === 413) throw new ManagerError('validation', 'Données trop volumineuses.', 413)
    if (res.status === 400 || res.status === 422) {
      const known = err.error ? VALIDATION_MESSAGES[err.error] : undefined
      throw new ManagerError('validation', known ?? `Données refusées${err.detail ? ` : ${err.detail}` : err.error ? ` (${err.error})` : ''}.`, 400)
    }
    throw new ManagerError('server', MESSAGES.server, res.status)
  }

  async function run<T>(p: PromiseLike<{ data: T | null; error: PgError | null; status?: number }>): Promise<T> {
    let r: { data: T | null; error: PgError | null; status?: number }
    try {
      r = await p
    } catch {
      throw new ManagerError('network', MESSAGES.network)
    }
    if (r.error) throw fromPg({ ...r.error, status: r.status ?? r.error.status }, r.status)
    if (r.data === null) throw new ManagerError('forbidden', MESSAGES.forbidden, r.status ?? null)
    return r.data
  }

  return {
    mode: 'supabase',

    async getBootstrapStatus() {
      const { data } = await callFunction<{ needs_bootstrap: boolean; establishment_name: string }>('bootstrap-status', { method: 'GET' })
      return { needs_bootstrap: Boolean(data?.needs_bootstrap), establishment_name: data?.establishment_name ?? '' }
    },

    async bootstrap(input) {
      const { data } = await callFunction<{ ok: boolean; staff_id: string }>('bootstrap-manager', { method: 'POST', body: input })
      return { staff_id: data.staff_id }
    },

    async signIn(email, password) {
      let res
      try {
        res = await sb.auth.signInWithPassword({ email: email.trim(), password })
      } catch {
        throw new ManagerError('network', MESSAGES.network)
      }
      const e = res.error as (Error & { status?: number; code?: string; name?: string }) | null
      if (!e) return
      if (e.name === 'AuthRetryableFetchError' || (!e.status && /fetch/i.test(e.message))) throw new ManagerError('network', MESSAGES.network)
      if (e.status === 429 || e.code === 'over_request_rate_limit') throw new ManagerError('rate_limited', MESSAGES.rate_limited, 429)
      if (e.code === 'email_not_confirmed') throw new ManagerError('invalid_credentials', 'Adresse email non confirmée.', e.status ?? null)
      if (e.status === 400 || e.code === 'invalid_credentials') throw new ManagerError('invalid_credentials', MESSAGES.invalid_credentials, 400)
      if ((e.status ?? 0) >= 500) throw new ManagerError('server', MESSAGES.server, e.status ?? null)
      throw new ManagerError('server', `Connexion impossible : ${e.message}`, e.status ?? null)
    },

    async signOut() {
      try {
        await sb.auth.signOut({ scope: 'local' })
      } catch {
        /* session locale effacée quoi qu'il arrive */
      }
    },

    async sessionEmail() {
      const { data } = await sb.auth.getSession()
      const s = data.session
      if (!s) return null
      // Jeton expiré et pas renouvelable hors-ligne : la prochaine requête dira « unauthorized ».
      return s.user?.email ?? ''
    },

    async enrollDevice(name) {
      const { data } = await callFunction<DeviceEnrollResponse>('device-enroll', { method: 'POST', body: { name }, auth: true })
      if (!data?.device_id || !data?.device_token) throw new ManagerError('server', MESSAGES.server)
      return data
    },

    async listEquipment() {
      return run<Equipment[]>(sb.from('equipment').select(EQUIPMENT_COLS).order('name'))
    },
    async addEquipment({ name, kind }) {
      return run<Equipment>(sb.from('equipment').insert({ name: name.trim(), kind }).select(EQUIPMENT_COLS).single())
    },
    async updateEquipment(id, patch) {
      const p: Record<string, unknown> = {}
      if (patch.name !== undefined) p.name = patch.name.trim()
      if (patch.active !== undefined) p.active = patch.active
      return run<Equipment>(sb.from('equipment').update(p).eq('id', id).select(EQUIPMENT_COLS).single())
    },

    async listThresholds() {
      const rows = await run<Threshold[]>(sb.from('thresholds').select(THRESHOLD_COLS))
      return rows.map((t) => ({ ...t, min_c: t.min_c === null ? null : Number(t.min_c), max_c: t.max_c === null ? null : Number(t.max_c) }))
    },
    async saveThreshold(input) {
      const t = await run<Threshold>(
        sb.from('thresholds').upsert(input, { onConflict: 'equipment_id,check_type' }).select(THRESHOLD_COLS).single(),
      )
      return { ...t, min_c: t.min_c === null ? null : Number(t.min_c), max_c: t.max_c === null ? null : Number(t.max_c) }
    },

    async listStaff() {
      return run<ManagedStaff[]>(sb.from('staff').select(STAFF_COLS).order('display_name'))
    },
    async addStaff(input) {
      return run<ManagedStaff>(sb.from('staff').insert({ ...input, display_name: input.display_name.trim() }).select(STAFF_COLS).single())
    },
    async updateStaff(id, patch) {
      const p: Record<string, unknown> = { ...patch }
      if (patch.display_name !== undefined) p.display_name = patch.display_name.trim()
      return run<ManagedStaff>(sb.from('staff').update(p).eq('id', id).select(STAFF_COLS).single())
    },

    async getSettings(): Promise<ManagerSettings> {
      const [e, s] = await Promise.all([
        run<{ name: string }>(sb.from('establishment').select('name').limit(1).single()),
        run<{ auto_lock_minutes: number; daily_check_times: string[] | null; missed_slot_carry_over: boolean | null; thaw_dlc_days: number | null }>(
          sb.from('settings').select('auto_lock_minutes, daily_check_times, missed_slot_carry_over, thaw_dlc_days').eq('id', 1).single(),
        ),
      ])
      // Colonne time[] ou text[] : Postgres peut renvoyer « 08:00:00 », on garde HH:MM.
      const times = (s.daily_check_times ?? []).map((t) => String(t).slice(0, 5)).sort()
      return {
        establishment_name: e.name,
        auto_lock_minutes: s.auto_lock_minutes,
        daily_check_times: times,
        missed_slot_carry_over: s.missed_slot_carry_over ?? true,
        thaw_dlc_days: s.thaw_dlc_days ?? 3,
      }
    },
    async saveSettings(patch) {
      if (patch.establishment_name !== undefined) {
        const e = await run<{ id: string }>(sb.from('establishment').select('id').limit(1).single())
        await run(sb.from('establishment').update({ name: patch.establishment_name.trim() }).eq('id', e.id).select('id').single())
      }
      const settingsPatch: Record<string, unknown> = {}
      if (patch.auto_lock_minutes !== undefined) settingsPatch.auto_lock_minutes = patch.auto_lock_minutes
      if (patch.daily_check_times !== undefined) settingsPatch.daily_check_times = [...patch.daily_check_times].sort()
      if (patch.missed_slot_carry_over !== undefined) settingsPatch.missed_slot_carry_over = patch.missed_slot_carry_over
      if (patch.thaw_dlc_days !== undefined) settingsPatch.thaw_dlc_days = patch.thaw_dlc_days
      if (Object.keys(settingsPatch).length > 0) {
        await run(sb.from('settings').update(settingsPatch).eq('id', 1).select('id').single())
      }
      return this.getSettings()
    },
  }
}
