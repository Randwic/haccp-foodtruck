// Aides pour les tests du core (non importées par l'application).
import { createCore, type Core } from './core.ts'
import { syntheticWebp, type PhotoEncoder } from './photoEncoder.ts'
import { createMockTransport, DEMO_DEVICE, DEMO_PINS, DEMO_STAFF, type MockTransport } from './mockTransport.ts'
import type { Transport } from './transport.ts'

export const MANAGER = DEMO_STAFF[0]
export const STAFF = DEMO_STAFF[1]

export interface Clock {
  t: number
  now: () => Date
  advance(ms: number): void
}

export function makeClock(iso = '2026-11-14T10:00:00.000Z'): Clock {
  const c: Clock = {
    t: Date.parse(iso),
    now: () => new Date(c.t),
    advance: (ms) => {
      c.t += ms
    },
  }
  return c
}

let counter = 0
export function uniqueDbName(): string {
  return `haccp-test-${++counter}-${Math.random().toString(36).slice(2)}`
}

export interface Harness {
  clock: Clock
  server: MockTransport
  core: Core
  dbName: string
  /** Ouvre une autre instance du core sur la même base (rechargement / autre onglet). */
  reopen(transport?: Transport): Core
}

const opened: Core[] = []

/**
 * Encodeur simulé (pas de canvas sous Node) : produit un WebP synthétique valide dont la taille
 * suit celle de l'image reçue (bornée), pour des tests déterministes.
 */
export const fakePhotoEncoder: PhotoEncoder = async (image) => ({
  bytes: syntheticWebp(Math.min(Math.max(image.size, 64), 300_000)),
  width: 1600,
  height: 1200,
  encoder: 'native',
  quality: 0.82,
})

export function makeHarness(opts: { transport?: (server: MockTransport) => Transport; photoEncoder?: PhotoEncoder } = {}): Harness {
  const clock = makeClock()
  const server = createMockTransport({ now: clock.now })
  const transport = opts.transport ? opts.transport(server) : server
  const dbName = uniqueDbName()
  const photoEncoder = opts.photoEncoder ?? fakePhotoEncoder
  const core = createCore({ transport, dbName, now: clock.now, photoEncoder })
  opened.push(core)
  return {
    clock,
    server,
    core,
    dbName,
    reopen(t?: Transport) {
      const c = createCore({ transport: t ?? transport, dbName, now: clock.now, photoEncoder })
      opened.push(c)
      return c
    },
  }
}

export async function disposeAll(): Promise<void> {
  await Promise.all(opened.splice(0).map((c) => c.dispose()))
}

export async function enrollAndUnlock(core: Core, who: 'manager' | 'staff' = 'manager'): Promise<void> {
  await core.enrollDevice({ ...DEMO_DEVICE, name: 'iPad cuisine' })
  const res = await core.unlock(who === 'manager' ? MANAGER.id : STAFF.id, DEMO_PINS[who])
  if (!res.ok) throw new Error('unlock a échoué : ' + res.reason)
}
