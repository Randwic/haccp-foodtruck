// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_MAX_FAILURES,
  createBootstrapManagerHandler,
  createBootstrapStatusHandler,
  parseBootstrapBody,
  type BootstrapManagerRequest,
} from './bootstrap.ts'
import { MemoryRepo } from './memory_repo.ts'
import { NOW, memoryLogger } from './test_helpers.ts'

const SALT = btoa(String.fromCharCode(...new Uint8Array(16).fill(7))) // 24 car., finit par ==
const HASH = btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) // 44 car., finit par =
const PASSWORD = 'correct horse battery'

function validBody(over: Partial<Record<keyof BootstrapManagerRequest, unknown>> = {}): Record<string, unknown> {
  return {
    email: 'Gerant@Example.fr',
    password: PASSWORD,
    display_name: '  Paul   Martin ',
    pin_salt: SALT,
    pin_hash: HASH,
    establishment_name: ' Chez  Paul ',
    ...over,
  }
}

let repo: MemoryRepo
let logger: ReturnType<typeof memoryLogger>
let status: (req: Request) => Promise<Response>
let boot: (req: Request) => Promise<Response>

beforeEach(() => {
  repo = new MemoryRepo()
  repo.serverClock = () => NOW
  repo.establishment = { id: '00000000-0000-4000-8000-000000000001', name: 'Mon Food Truck', timezone: 'Europe/Paris' }
  logger = memoryLogger()
  status = createBootstrapStatusHandler({ repo, logger, allowedOrigins: ['https://app.example'] })
  boot = createBootstrapManagerHandler({ repo, logger, allowedOrigins: ['https://app.example'] })
})

const bootReq = (body: unknown, raw?: string) =>
  new Request('https://fn.example/bootstrap-manager', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example' },
    body: raw ?? JSON.stringify(body),
  })

describe('bootstrap-status', () => {
  it('needs_bootstrap vrai sans gérant, avec le nom de l’établissement', async () => {
    const res = await status(new Request('https://fn.example/bootstrap-status'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ needs_bootstrap: true, establishment_name: 'Mon Food Truck' })
  })
  it('needs_bootstrap faux dès qu’un gérant existe ; nom vide si pas d’établissement', async () => {
    repo.managers.add('00000000-0000-4000-8000-00000000aaaa')
    repo.establishment = null
    expect(await (await status(new Request('https://fn.example/bootstrap-status'))).json()).toEqual({
      needs_bootstrap: false,
      establishment_name: '',
    })
  })
  it('GET seulement (POST → 405) et CORS', async () => {
    expect((await status(new Request('https://fn.example/x', { method: 'POST' }))).status).toBe(405)
    const res = await status(new Request('https://fn.example/x', { headers: { origin: 'https://app.example' } }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example')
  })
})

describe('bootstrap-manager', () => {
  it('201 : crée le compte, le gérant, sa fiche staff et renomme l’établissement', async () => {
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(201)
    const out = (await res.json()) as { ok: true; staff_id: string }
    expect(out.ok).toBe(true)
    expect(repo.authUsers.size).toBe(1)
    const [userId, user] = [...repo.authUsers.entries()][0]
    expect(user.email).toBe('gerant@example.fr')
    expect(repo.receivedPasswords).toEqual([PASSWORD])
    expect([...repo.managers]).toEqual([userId])
    const staff = repo.staff.find((s) => s.id === out.staff_id)
    expect(staff).toMatchObject({ display_name: 'Paul Martin', role: 'manager', active: true, pin_salt: SALT, pin_hash: HASH })
    expect(repo.staffUserIds.get(out.staff_id)).toBe(userId)
    expect(repo.establishment?.name).toBe('Chez Paul')
    expect(repo.bootstrapFailures).toHaveLength(0)
    // Statut ensuite : plus besoin de bootstrap.
    expect(await (await status(new Request('https://fn.example/s'))).json()).toEqual({ needs_bootstrap: false, establishment_name: 'Chez Paul' })
  })

  it('ne journalise jamais le mot de passe, ni l’e-mail, ni le PIN', async () => {
    await boot(bootReq(validBody()))
    await boot(bootReq(validBody())) // 409
    await boot(bootReq(validBody({ password: 'court' })))
    const logs = JSON.stringify(logger.lines)
    expect(logs).not.toContain(PASSWORD)
    expect(logs.toLowerCase()).not.toContain('gerant@example.fr')
    expect(logs).not.toContain(HASH)
    expect(logs).not.toContain(SALT)
  })

  it('409 already_bootstrapped si un gérant existe : aucun compte créé', async () => {
    repo.managers.add('00000000-0000-4000-8000-00000000aaaa')
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_bootstrapped' })
    expect(repo.calls.createAuthUser ?? 0).toBe(0)
    expect(repo.establishment?.name).toBe('Mon Food Truck')
  })

  it('second appel après succès → 409', async () => {
    expect((await boot(bootReq(validBody()))).status).toBe(201)
    const res = await boot(bootReq(validBody({ email: 'autre@example.fr' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_bootstrapped' })
    expect(repo.authUsers.size).toBe(1)
    expect(repo.managers.size).toBe(1)
  })

  it('concurrence : deux appels simultanés, un seul réussit, l’autre ne laisse pas de compte orphelin', async () => {
    const results = await Promise.all([
      boot(bootReq(validBody({ email: 'a@example.fr' }))),
      boot(bootReq(validBody({ email: 'b@example.fr' }))),
    ])
    const codes = results.map((r) => r.status).sort()
    expect(codes).toEqual([201, 409])
    // Les deux ont bien passé le pré-contrôle et créé un compte : c'est la transaction SQL qui tranche.
    expect(repo.calls.createAuthUser).toBe(2)
    expect(repo.calls.deleteAuthUser).toBe(1)
    expect(repo.managers.size).toBe(1)
    expect(repo.authUsers.size).toBe(1)
    expect([...repo.authUsers.keys()]).toEqual([...repo.managers])
    const loser = results.find((r) => r.status === 409)!
    expect(await loser.json()).toEqual({ error: 'already_bootstrapped' })
    expect(repo.bootstrapFailures.map((f) => f.reason)).toEqual(['already_bootstrapped'])
  })

  it('gérant inscrit entre le pré-contrôle et la transaction → 409 et utilisateur supprimé', async () => {
    repo.beforeBootstrap = () => repo.managers.add('00000000-0000-4000-8000-00000000cccc')
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(409)
    expect(repo.authUsers.size).toBe(0)
    expect(repo.staff).toHaveLength(0)
  })

  it('échec inattendu de l’étape SQL → 500 générique et utilisateur supprimé', async () => {
    repo.bootstrapThrows = true
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain('57P01')
    expect(repo.authUsers.size).toBe(0)
    expect(repo.managers.size).toBe(0)
  })

  it('suppression impossible : erreur journalisée (bootstrap_orphan_user), réponse inchangée', async () => {
    repo.bootstrapThrows = true
    repo.deleteUserThrows = true
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(500)
    expect(logger.lines.some((l) => l.event === 'bootstrap_orphan_user' && typeof l.fields.user_id === 'string')).toBe(true)
  })

  it.each([
    ['email_exists', 422],
    ['weak_password', 422],
    ['rejected', 400],
  ] as const)('refus de Supabase Auth (%s) → %i, compté comme échec', async (kind, code) => {
    repo.createUserRefusal = { ok: false, kind }
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(code)
    expect(((await res.json()) as { error: string }).error).toBe(kind === 'rejected' ? 'invalid_request' : kind)
    expect(repo.calls.bootstrapManager ?? 0).toBe(0)
    expect(repo.bootstrapFailures.map((f) => f.reason)).toEqual([kind])
  })

  it.each<[string, Record<string, unknown> | null]>([
    ['corps non objet', null],
    ['email absent', validBody({ email: undefined })],
    ['email sans @', validBody({ email: 'gerant.example.fr' })],
    ['email sans domaine', validBody({ email: 'gerant@localhost' })],
    ['email avec espace', validBody({ email: 'ge rant@example.fr' })],
    ['email trop long', validBody({ email: `${'a'.repeat(250)}@example.fr` })],
    ['mot de passe de 11 caractères', validBody({ password: 'a'.repeat(11) })],
    ['mot de passe > 72 octets', validBody({ password: 'é'.repeat(37) })],
    ['mot de passe non texte', validBody({ password: 123456789012 })],
    ['display_name vide', validBody({ display_name: '   ' })],
    ['display_name 61 caractères', validBody({ display_name: 'x'.repeat(61) })],
    ['display_name caractère de contrôle', validBody({ display_name: 'a\u0007b' })],
    ['establishment_name vide', validBody({ establishment_name: '' })],
    ['establishment_name 81 caractères', validBody({ establishment_name: 'x'.repeat(81) })],
    ['pin_salt trop court', validBody({ pin_salt: 'c2Fs' })],
    ['pin_salt de 32 octets', validBody({ pin_salt: HASH })],
    ['pin_hash de 16 octets', validBody({ pin_hash: SALT })],
    ['pin_hash base64url', validBody({ pin_hash: '-_' + 'A'.repeat(41) + '=' })],
    ['pin_hash absent', validBody({ pin_hash: undefined })],
  ])('400 invalid_request : %s (aucun compte créé, échec compté)', async (_label, body) => {
    const res = await boot(bootReq(body))
    expect(res.status).toBe(400)
    const out = (await res.json()) as { error: string; detail: string }
    expect(out.error).toBe('invalid_request')
    expect(out.detail).not.toContain(PASSWORD)
    expect(repo.calls.createAuthUser ?? 0).toBe(0)
    expect(repo.bootstrapFailures).toHaveLength(1)
  })

  it('JSON invalide → 400, corps trop gros → 413 (comptés comme échecs)', async () => {
    expect((await boot(bootReq(null, '{pas du json'))).status).toBe(400)
    expect((await boot(bootReq(null, JSON.stringify(validBody({ display_name: 'x'.repeat(9000) }))))).status).toBe(413)
    expect(repo.bootstrapFailures.map((f) => f.reason)).toEqual(['invalid_json', 'payload_too_large'])
  })

  it('accepte exactement les bornes : 12 caractères, 60 / 80 caractères', () => {
    const out = parseBootstrapBody(validBody({ password: 'a'.repeat(12), display_name: 'é'.repeat(60), establishment_name: 'x'.repeat(80) }))
    expect(out.password).toBe('a'.repeat(12))
    expect([...out.display_name]).toHaveLength(60)
    // Le mot de passe n'est jamais modifié (pas de trim).
    expect(parseBootstrapBody(validBody({ password: '  espaces autour  ' })).password).toBe('  espaces autour  ')
  })

  it(`429 au-delà de ${BOOTSTRAP_MAX_FAILURES} échecs en 15 minutes, puis de nouveau possible`, async () => {
    for (let i = 0; i < BOOTSTRAP_MAX_FAILURES; i++) {
      expect((await boot(bootReq(validBody({ password: 'court' })))).status).toBe(400)
    }
    const res = await boot(bootReq(validBody()))
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toBe('too_many_attempts')
    expect(repo.calls.createAuthUser ?? 0).toBe(0)
    // 16 minutes plus tard : la fenêtre est passée.
    repo.serverClock = () => new Date(NOW.getTime() + 16 * 60_000)
    expect((await boot(bootReq(validBody()))).status).toBe(201)
  })

  it('les échecs de plus de 15 minutes ne comptent pas', async () => {
    for (let i = 0; i < 20; i++) repo.bootstrapFailures.push({ at: new Date(NOW.getTime() - 16 * 60_000), reason: 'invalid_request' })
    for (let i = 0; i < BOOTSTRAP_MAX_FAILURES - 1; i++) repo.bootstrapFailures.push({ at: NOW, reason: 'invalid_request' })
    expect((await boot(bootReq(validBody()))).status).toBe(201)
  })

  it('POST seulement ; OPTIONS → 204 avec CORS', async () => {
    expect((await boot(new Request('https://fn.example/x'))).status).toBe(405)
    const pre = await boot(new Request('https://fn.example/x', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
