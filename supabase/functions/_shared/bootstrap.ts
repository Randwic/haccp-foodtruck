// bootstrap-status / bootstrap-manager : inscription du gérant depuis l'app, une seule fois.
// L'inscription libre de Supabase Auth reste désactivée ; seul ce parcours crée le premier compte.
import { isPlainObject } from '../../../shared/validation.ts'
import { HttpError, jsonResponse, readJsonBody, withHttp, type HttpEnv, type RequestContext } from './http.ts'
import type { BootstrapRepo } from './repo.ts'

export const BOOTSTRAP_MAX_FAILURES = 10
export const BOOTSTRAP_WINDOW_MINUTES = 15
export const BOOTSTRAP_BODY_MAX_BYTES = 8192
export const PASSWORD_MIN_CHARS = 12
/** Supabase Auth (bcrypt) refuse les mots de passe de plus de 72 octets. */
export const PASSWORD_MAX_BYTES = 72
export const EMAIL_MAX_CHARS = 254
export const DISPLAY_NAME_MAX = 60
export const ESTABLISHMENT_NAME_MAX = 80
/** Mêmes formats que les contraintes CHECK de `staff` (base64 de 16 / 32 octets). */
export const PIN_SALT_RE = /^[A-Za-z0-9+/]{22}==$/
export const PIN_HASH_RE = /^[A-Za-z0-9+/]{43}=$/
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export interface BootstrapStatusResponse {
  needs_bootstrap: boolean
  establishment_name: string
}

export interface BootstrapManagerRequest {
  email: string
  password: string
  display_name: string
  pin_salt: string
  pin_hash: string
  establishment_name: string
}

export interface BootstrapManagerResponse {
  ok: true
  staff_id: string
}

const invalid = (detail: string) => new HttpError(400, 'invalid_request', detail)

function cleanName(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') throw invalid(`${field} : texte attendu`)
  const s = v.trim().replace(/\s+/g, ' ')
  if (s.length === 0 || [...s].length > max) throw invalid(`${field} : 1 à ${max} caractères`)
  if (CONTROL_RE.test(s)) throw invalid(`${field} : caractères de contrôle interdits`)
  return s
}

/** Valide le corps de `bootstrap-manager`. Les messages ne reprennent jamais les valeurs reçues. */
export function parseBootstrapBody(body: unknown): BootstrapManagerRequest {
  if (!isPlainObject(body)) throw invalid('objet JSON attendu')

  if (typeof body.email !== 'string') throw invalid('email : texte attendu')
  const email = body.email.trim().toLowerCase()
  if (email.length > EMAIL_MAX_CHARS || CONTROL_RE.test(email) || !EMAIL_RE.test(email)) throw invalid('email : adresse invalide')

  if (typeof body.password !== 'string') throw invalid('password : texte attendu')
  const password = body.password
  if ([...password].length < PASSWORD_MIN_CHARS) throw invalid(`password : au moins ${PASSWORD_MIN_CHARS} caractères`)
  if (new TextEncoder().encode(password).byteLength > PASSWORD_MAX_BYTES) throw invalid(`password : au plus ${PASSWORD_MAX_BYTES} octets`)

  const display_name = cleanName(body.display_name, 'display_name', DISPLAY_NAME_MAX)
  const establishment_name = cleanName(body.establishment_name, 'establishment_name', ESTABLISHMENT_NAME_MAX)

  if (typeof body.pin_salt !== 'string' || !PIN_SALT_RE.test(body.pin_salt)) throw invalid('pin_salt : base64 de 16 octets attendu')
  if (typeof body.pin_hash !== 'string' || !PIN_HASH_RE.test(body.pin_hash)) throw invalid('pin_hash : base64 de 32 octets attendu')

  return { email, password, display_name, pin_salt: body.pin_salt, pin_hash: body.pin_hash, establishment_name }
}

export interface BootstrapDeps extends HttpEnv {
  repo: BootstrapRepo
}

export function createBootstrapStatusHandler(deps: BootstrapDeps): (req: Request) => Promise<Response> {
  return withHttp('bootstrap-status', ['GET'], deps, async () => {
    const [managers, name] = await Promise.all([deps.repo.countManagers(), deps.repo.getEstablishmentName()])
    const res: BootstrapStatusResponse = { needs_bootstrap: managers === 0, establishment_name: name ?? '' }
    return jsonResponse(200, res)
  })
}

export function createBootstrapManagerHandler(deps: BootstrapDeps): (req: Request) => Promise<Response> {
  const { repo } = deps

  /** L'échec de l'enregistrement du compteur ne doit pas masquer la réponse d'origine. */
  async function recordFailure(ctx: RequestContext, reason: string): Promise<void> {
    try {
      await repo.recordBootstrapFailure(reason)
    } catch (e) {
      ctx.logger.log('error', 'bootstrap_failure_not_recorded', { reason, error: e instanceof Error ? e.name : 'unknown' })
    }
    ctx.logger.log('warn', 'bootstrap_failed', { reason })
  }

  return withHttp('bootstrap-manager', ['POST'], deps, async (req, ctx) => {
    // 1. Déjà fait : réponse stable, sans rien créer (contrôle définitif refait en SQL sous verrou).
    if ((await repo.countManagers()) > 0) throw new HttpError(409, 'already_bootstrapped')

    // 2. Anti-abus : trop d'échecs récents (compteur global).
    if ((await repo.countRecentBootstrapFailures(BOOTSTRAP_WINDOW_MINUTES)) >= BOOTSTRAP_MAX_FAILURES) {
      ctx.logger.log('warn', 'bootstrap_rate_limited')
      throw new HttpError(429, 'too_many_attempts', `trop de tentatives, réessayer dans ${BOOTSTRAP_WINDOW_MINUTES} minutes`)
    }

    // 3. Validation.
    let input: BootstrapManagerRequest
    try {
      input = parseBootstrapBody(await readJsonBody(req, BOOTSTRAP_BODY_MAX_BYTES))
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) await recordFailure(ctx, e.code)
      throw e
    }

    // 4. Compte Supabase Auth (e-mail confirmé d'office : c'est le gérant lui-même qui s'inscrit).
    const created = await repo.createAuthUser(input.email, input.password)
    if (!created.ok) {
      await recordFailure(ctx, created.kind)
      if (created.kind === 'email_exists') throw new HttpError(422, 'email_exists', 'un compte existe déjà avec cet e-mail')
      if (created.kind === 'weak_password') throw new HttpError(422, 'weak_password', 'mot de passe refusé par le service d’authentification')
      throw invalid('compte refusé par le service d’authentification')
    }
    const userId = created.user_id

    // 5. Transaction SQL (verrou, revérification, managers + staff + établissement).
    //    Tout échec supprime l'utilisateur créé : jamais de compte orphelin.
    let outcome: Awaited<ReturnType<BootstrapRepo['bootstrapManager']>>
    try {
      outcome = await repo.bootstrapManager({
        user_id: userId,
        display_name: input.display_name,
        pin_salt: input.pin_salt,
        pin_hash: input.pin_hash,
        establishment_name: input.establishment_name,
      })
    } catch (e) {
      await deleteUserQuietly(ctx, userId)
      throw e
    }
    if (!outcome.ok) {
      await deleteUserQuietly(ctx, userId)
      await recordFailure(ctx, outcome.kind)
      throw new HttpError(409, 'already_bootstrapped')
    }

    ctx.logger.log('info', 'manager_bootstrapped', { user_id: userId, staff_id: outcome.staff_id }) // ni e-mail ni mot de passe
    const res: BootstrapManagerResponse = { ok: true, staff_id: outcome.staff_id }
    return jsonResponse(201, res)
  })

  async function deleteUserQuietly(ctx: RequestContext, userId: string): Promise<void> {
    try {
      await repo.deleteAuthUser(userId)
      ctx.logger.log('info', 'bootstrap_user_rolled_back', { user_id: userId })
    } catch (e) {
      // À supprimer à la main dans le tableau de bord Supabase (Authentication > Users).
      ctx.logger.log('error', 'bootstrap_orphan_user', { user_id: userId, error: e instanceof Error ? e.name : 'unknown' })
    }
  }
}
