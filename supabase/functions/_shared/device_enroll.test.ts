// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { DeviceEnrollResponse } from '../../../shared/types.ts'
import { authenticateDevice } from './auth.ts'
import { sha256Hex } from './crypto.ts'
import { createDeviceEnrollHandler } from './device_enroll.ts'
import { MemoryRepo } from './memory_repo.ts'
import { memoryLogger } from './test_helpers.ts'

const MANAGER = '00000000-0000-4000-8000-00000000aaaa'
const EMPLOYEE = '00000000-0000-4000-8000-00000000bbbb'
let repo: MemoryRepo
let logger: ReturnType<typeof memoryLogger>
let handler: (req: Request) => Promise<Response>

beforeEach(() => {
  repo = new MemoryRepo()
  repo.managers.add(MANAGER)
  repo.jwts.set('jwt-manager', MANAGER)
  repo.jwts.set('jwt-employee', EMPLOYEE)
  logger = memoryLogger()
  handler = createDeviceEnrollHandler({ repo, logger, allowedOrigins: [] })
})

function enrollReq(body: unknown, jwt: string | null = 'jwt-manager'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (jwt) headers.authorization = `Bearer ${jwt}`
  return new Request('https://fn.example/device-enroll', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('device-enroll', () => {
  it('enrôle un appareil : jeton 32 octets base64url, seul son SHA-256 est stocké', async () => {
    const res = await handler(enrollReq({ name: '  Tablette   cuisine ' }))
    expect(res.status).toBe(201)
    const out = (await res.json()) as DeviceEnrollResponse
    expect(out.device_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(repo.devices).toHaveLength(1)
    const d = repo.devices[0]
    expect(d).toMatchObject({ id: out.device_id, name: 'Tablette cuisine', enrolled_by: MANAGER, revoked_at: null })
    expect(d.token_hash).toBe(await sha256Hex(out.device_token))
    expect(JSON.stringify(repo.devices)).not.toContain(out.device_token)
    expect(JSON.stringify(logger.lines)).not.toContain(out.device_token)
    // Le jeton émis permet ensuite l'authentification appareil.
    const req = new Request('https://x', { headers: { 'x-device-token': out.device_token } })
    expect((await authenticateDevice(req, repo, logger)).id).toBe(out.device_id)
  })
  it('jetons distincts à chaque enrôlement', async () => {
    const a = (await (await handler(enrollReq({ name: 'A' }))).json()) as DeviceEnrollResponse
    const b = (await (await handler(enrollReq({ name: 'B' }))).json()) as DeviceEnrollResponse
    expect(a.device_token).not.toBe(b.device_token)
  })
  it('401 sans JWT ou JWT invalide', async () => {
    expect((await handler(enrollReq({ name: 'A' }, null))).status).toBe(401)
    expect((await handler(enrollReq({ name: 'A' }, 'jwt-faux'))).status).toBe(401)
    expect(repo.devices).toHaveLength(0)
  })
  it('403 si l’utilisateur n’est pas gérant', async () => {
    const res = await handler(enrollReq({ name: 'A' }, 'jwt-employee'))
    expect(res.status).toBe(403)
    expect(repo.devices).toHaveLength(0)
  })
  it.each([{}, { name: '' }, { name: '   ' }, { name: 3 }, { name: 'x'.repeat(61) }, { name: 'a\u0007b' }, null])('400 sur nom invalide : %j', async (body) => {
    const res = await handler(enrollReq(body))
    expect(res.status).toBe(400)
    expect(repo.devices).toHaveLength(0)
  })
})
