// sync-pull : téléchargement incrémental des données de référence par un appareil.
import type { SyncPullResponse } from '../../../shared/types.ts'
import { authenticateDevice } from './auth.ts'
import { HttpError, jsonResponse, withHttp, type HttpEnv } from './http.ts'
import type { PullRepo } from './repo.ts'

/**
 * Recouvrement appliqué à `since` : une ligne modifiée par une transaction commencée avant le
 * `server_now` précédent mais validée après aurait un updated_at < since et serait perdue.
 * On renvoie donc un peu plus (les doublons sont sans effet côté app : remplacement par id).
 */
export const PULL_OVERLAP_MS = 5 * 60_000

export function parseSince(raw: string | null): Date | null {
  if (raw === null || raw.trim() === '') return null
  const d = new Date(raw.trim())
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid_request', 'since : date ISO 8601 attendue')
  return d
}

export async function processPull(since: Date | null, repo: PullRepo, now: Date): Promise<SyncPullResponse> {
  const serverNow = now.toISOString() // capturé AVANT les lectures
  const from = since ? new Date(since.getTime() - PULL_OVERLAP_MS).toISOString() : null
  const [establishment, settings, staff, equipment, thresholds, suppliers, products, recipes] = await Promise.all([
    repo.getEstablishment(),
    repo.getSettings(),
    repo.listStaff(from),
    repo.listEquipment(from),
    repo.listThresholds(from),
    repo.listSuppliers(from),
    repo.listProducts(from),
    repo.listRecipes(from),
  ])
  if (!establishment || !settings) throw new HttpError(503, 'not_configured', 'établissement ou paramètres absents')

  const deleted: SyncPullResponse['deleted'] = []
  if (since) {
    for (const s of staff) if (!s.active) deleted.push({ table: 'staff', id: s.id })
    for (const e of equipment) if (!e.active) deleted.push({ table: 'equipment', id: e.id })
    for (const s of suppliers) if (!s.active) deleted.push({ table: 'suppliers', id: s.id })
    for (const p of products) if (!p.active) deleted.push({ table: 'products', id: p.id })
    for (const r of recipes) if (!r.active) deleted.push({ table: 'recipes', id: r.id })
  }
  return {
    server_now: serverNow,
    establishment: { id: establishment.id, name: establishment.name, timezone: establishment.timezone },
    staff: staff
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        display_name: s.display_name,
        role: s.role,
        active: s.active,
        pin_salt: s.pin_salt,
        pin_hash: s.pin_hash,
        updated_at: s.updated_at,
      })),
    equipment: equipment
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, name: e.name, kind: e.kind, active: e.active, updated_at: e.updated_at })),
    thresholds: thresholds.map((t) => ({
      id: t.id,
      equipment_id: t.equipment_id,
      check_type: t.check_type,
      min_c: t.min_c,
      max_c: t.max_c,
      tolerance_minutes: t.tolerance_minutes,
      updated_at: t.updated_at,
    })),
    settings: {
      retention_years: settings.retention_years,
      auto_lock_minutes: settings.auto_lock_minutes,
      clock_suspect_minutes: settings.clock_suspect_minutes,
      email_alerts: settings.email_alerts,
      daily_check_times: [...settings.daily_check_times],
      missed_slot_carry_over: settings.missed_slot_carry_over ?? true,
      thaw_dlc_days: settings.thaw_dlc_days ?? 3,
    },
    suppliers: suppliers
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? null, email: s.email ?? null, active: s.active, updated_at: s.updated_at })),
    products: products
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        allergens: [...p.allergens],
        storage: p.storage,
        shelf_life_opened_hours: p.shelf_life_opened_hours ?? null,
        shelf_life_thawed_hours: p.shelf_life_thawed_hours ?? null,
        active: p.active,
        updated_at: p.updated_at,
      })),
    recipes: recipes
      .filter((r) => r.active)
      .map((r) => ({
        id: r.id,
        name: r.name,
        ingredient_product_ids: [...r.ingredient_product_ids],
        extra_allergens: [...r.extra_allergens],
        storage: r.storage,
        shelf_life_hours: r.shelf_life_hours,
        active: r.active,
        updated_at: r.updated_at,
      })),
    deleted,
  }
}

export interface SyncPullDeps extends HttpEnv {
  repo: PullRepo
}

export function createSyncPullHandler(deps: SyncPullDeps): (req: Request) => Promise<Response> {
  return withHttp('sync-pull', ['GET'], deps, async (req, ctx) => {
    const device = await authenticateDevice(req, deps.repo, ctx.logger)
    const since = parseSince(new URL(req.url).searchParams.get('since'))
    const res = await processPull(since, deps.repo, ctx.now())
    await deps.repo.touchDevice(device.id, ctx.now().toISOString())
    ctx.logger.log('info', 'sync_pull', {
      device_id: device.id,
      since: since?.toISOString() ?? null,
      staff: res.staff.length,
      equipment: res.equipment.length,
      thresholds: res.thresholds.length,
      suppliers: res.suppliers.length,
      products: res.products.length,
      recipes: res.recipes.length,
      deleted: res.deleted.length,
    })
    return jsonResponse(200, res)
  })
}
