// device-enroll : un gérant connecté enrôle un appareil et reçoit (une seule fois) son jeton.
import type { DeviceEnrollResponse } from '../../../shared/types.ts'
import { isPlainObject } from '../../../shared/validation.ts'
import { bearerToken } from './auth.ts'
import { base64Url, DEVICE_TOKEN_BYTES, randomBytes as defaultRandomBytes, sha256Hex } from './crypto.ts'
import { HttpError, jsonResponse, readJsonBody, withHttp, type HttpEnv } from './http.ts'
import type { EnrollRepo } from './repo.ts'

export const DEVICE_NAME_MAX = 60

export function parseEnrollBody(body: unknown): { name: string } {
  if (!isPlainObject(body) || typeof body.name !== 'string') throw new HttpError(400, 'invalid_request', 'name : texte attendu')
  const name = body.name.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || [...name].length > DEVICE_NAME_MAX) {
    throw new HttpError(400, 'invalid_request', `name : 1 à ${DEVICE_NAME_MAX} caractères`)
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, 'invalid_request', 'name : caractères de contrôle interdits')
  return { name }
}

export interface DeviceEnrollDeps extends HttpEnv {
  repo: EnrollRepo
  randomBytes?: (n: number) => Uint8Array
}

export function createDeviceEnrollHandler(deps: DeviceEnrollDeps): (req: Request) => Promise<Response> {
  const rand = deps.randomBytes ?? defaultRandomBytes
  return withHttp('device-enroll', ['POST'], deps, async (req, ctx) => {
    const jwt = bearerToken(req)
    if (!jwt) throw new HttpError(401, 'unauthorized')
    const userId = await deps.repo.getUserIdFromJwt(jwt)
    if (!userId) throw new HttpError(401, 'unauthorized')
    if (!(await deps.repo.isManager(userId))) {
      ctx.logger.log('warn', 'enroll_forbidden', { user_id: userId })
      throw new HttpError(403, 'forbidden', 'réservé au gérant')
    }
    const { name } = parseEnrollBody(await readJsonBody(req, 4096))

    const token = base64Url(rand(DEVICE_TOKEN_BYTES))
    const { id } = await deps.repo.insertDevice({ name, token_hash: await sha256Hex(token), enrolled_by: userId })
    ctx.logger.log('info', 'device_enrolled', { device_id: id, enrolled_by: userId }) // jamais le jeton
    const res: DeviceEnrollResponse = { device_id: id, device_token: token }
    return jsonResponse(201, res)
  })
}
