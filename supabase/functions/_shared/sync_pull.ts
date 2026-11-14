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
  const [establishment, settings, staff, equipment, thresholds] = await Promise.all([
    repo.getEstablishment(),
    repo.getSettings(),
    repo.listStaff(from),
    repo.listEquipment(from),
    repo.listThresholds(from),
  ])
  if (!establishment || !settings) throw new HttpError(503, 'not_configured', 'établissement ou paramètres absents')

  const deleted: SyncPullResponse['deleted'] = []
  if (since) {
    for (const s of staff) if (!s.active) deleted.push({ table: 'staff', id: s.id })
    for (const e of equipment) if (!e.active) deleted.push({ table: 'equipment', id: e.id })
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
    },
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
      deleted: res.deleted.length,
    })
    return jsonResponse(200, res)
  })
}
