// health : sonde de disponibilité. Fait une requête minimale en base pour que l'appel (ex. tâche
// planifiée quotidienne) compte comme activité et évite la mise en pause du projet gratuit.
import { jsonResponse, withHttp, type HttpEnv } from './http.ts'
import type { HealthRepo } from './repo.ts'

export interface HealthDeps extends HttpEnv {
  repo: HealthRepo
}

export function createHealthHandler(deps: HealthDeps): (req: Request) => Promise<Response> {
  return withHttp('health', ['GET', 'HEAD'], deps, async (_req, ctx) => {
    const time = ctx.now().toISOString()
    try {
      await deps.repo.ping()
    } catch (e) {
      ctx.logger.log('error', 'health_db_unreachable', { error: e instanceof Error ? e.message : String(e) })
      return jsonResponse(503, { ok: false, time, error: 'db_unavailable' })
    }
    return jsonResponse(200, { ok: true, time })
  })
}
