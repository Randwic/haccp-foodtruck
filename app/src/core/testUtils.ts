// Aides pour les tests du core (non importées par l'application).
import { createCore, type Core } from './core.ts'
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

export function makeHarness(opts: { transport?: (server: MockTransport) => Transport } = {}): Harness {
  const clock = makeClock()
  const server = createMockTransport({ now: clock.now })
  const transport = opts.transport ? opts.transport(server) : server
  const dbName = uniqueDbName()
  const core = createCore({ transport, dbName, now: clock.now })
  opened.push(core)
  return {
    clock,
    server,
    core,
    dbName,
    reopen(t?: Transport) {
      const c = createCore({ transport: t ?? transport, dbName, now: clock.now })
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
