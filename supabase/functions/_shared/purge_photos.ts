// purge-photos : suppression des photos arrivées en fin de conservation (bucket `photos`).
// POST /functions/v1/purge-photos   en-tête x-purge-secret: <PURGE_PHOTOS_SECRET>
//
// Pourquoi une Edge Function et pas purge_expired_records() : sur Supabase, un DELETE direct dans
// storage.objects est bloqué (trigger storage.protect_delete) et ne supprimerait de toute façon
// pas le fichier lui-même. La suppression passe donc par l'API Storage ; la base ne fait que
// désigner les objets à supprimer (`photos_to_purge()`) et journaliser (`record_photo_purge()`).
import { sha256Hex } from './crypto.ts'
import { HttpError, jsonResponse, withHttp, type HttpEnv } from './http.ts'

export const PURGE_SECRET_HEADER = 'x-purge-secret'
export const PURGE_LIMITS = {
  /** Objets par appel à photos_to_purge() / à l'API Storage. */
  batch: 100,
  /** Lots par exécution (au-delà, l'exécution suivante continue). */
  maxBatches: 20,
  minSecretLength: 32,
} as const

export interface PurgePhotosRepo {
  /**
   * `photos_to_purge(limit)` : objets du bucket `photos` plus vieux que la durée de conservation
   * ET référencés par aucun enregistrement encore conservé.
   */
  listPurgeablePhotos(limit: number): Promise<string[]>
  /** `record_photo_purge(deleted, failed)` : résumé dans audit_log. */
  recordPhotoPurge(deleted: number, failed: number): Promise<void>
}

export interface PhotoRemover {
  /** Supprime via l'API Storage ; renvoie les chemins effectivement supprimés. */
  remove(paths: string[]): Promise<string[]>
}

export interface PurgePhotosResult {
  ok: true
  deleted: number
  failed: number
  /** true : il reste peut-être des photos à purger (limite atteinte ou échecs). */
  more: boolean
}

export async function processPhotoPurge(repo: PurgePhotosRepo, store: PhotoRemover): Promise<PurgePhotosResult> {
  let deleted = 0
  let failed = 0
  let more = false
  for (let i = 0; i < PURGE_LIMITS.maxBatches; i++) {
    const paths = await repo.listPurgeablePhotos(PURGE_LIMITS.batch)
    if (paths.length === 0) break
    const removed = new Set(await store.remove(paths))
    const ok = paths.filter((p) => removed.has(p)).length
    deleted += ok
    failed += paths.length - ok
    // Échec partiel : on s'arrête pour ne pas reboucler sur les mêmes objets.
    if (ok < paths.length) {
      more = true
      break
    }
    if (paths.length < PURGE_LIMITS.batch) break
    if (i === PURGE_LIMITS.maxBatches - 1) more = true
  }
  await repo.recordPhotoPurge(deleted, failed)
  return { ok: true, deleted, failed, more }
}

export interface PurgePhotosDeps extends HttpEnv {
  repo: PurgePhotosRepo
  store: PhotoRemover
  /** PURGE_PHOTOS_SECRET (≥ 32 caractères) ; absent → 503 not_configured. */
  secret: string | undefined
}

export function createPurgePhotosHandler(deps: PurgePhotosDeps): (req: Request) => Promise<Response> {
  return withHttp('purge-photos', ['POST'], deps, async (req, ctx) => {
    const secret = deps.secret ?? ''
    if (secret.length < PURGE_LIMITS.minSecretLength) throw new HttpError(503, 'not_configured', 'PURGE_PHOTOS_SECRET absent')
    const given = req.headers.get(PURGE_SECRET_HEADER) ?? ''
    // Comparaison des empreintes : durée indépendante du contenu du secret.
    if (given.length === 0 || (await sha256Hex(given)) !== (await sha256Hex(secret))) {
      ctx.logger.log('warn', 'purge_photos_auth_failed')
      throw new HttpError(401, 'unauthorized')
    }
    const res = await processPhotoPurge(deps.repo, deps.store)
    ctx.logger.log(res.failed > 0 ? 'warn' : 'info', 'purge_photos', { deleted: res.deleted, failed: res.failed, more: res.more })
    return jsonResponse(200, res)
  })
}
