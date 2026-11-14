// Outils communs aux tests des Edge Functions (non déployé : importé seulement par *.test.ts).
import { computeRecordHash } from '../../../shared/canonical.ts'
import { GENESIS_HASH, type HaccpRecord, type RecordType } from '../../../shared/types.ts'
import { sha256Hex } from './crypto.ts'
import type { Logger } from './http.ts'
import { MemoryRepo } from './memory_repo.ts'

export const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1'
export const OTHER_DEVICE_ID = '00000000-0000-4000-8000-0000000000d2'
export const STAFF_ID = '00000000-0000-4000-8000-0000000000a1'
export const INACTIVE_STAFF_ID = '00000000-0000-4000-8000-0000000000a2'
export const FRIDGE_ID = '00000000-0000-4000-8000-0000000000e1'
export const TOKEN = 'tok_' + 'A'.repeat(39)
export const OTHER_TOKEN = 'tok_' + 'B'.repeat(39)
export const NOW = new Date('2026-11-14T10:00:00.000Z')

export function memoryLogger(): Logger & { lines: { level: string; event: string; fields: Record<string, unknown> }[] } {
  const lines: { level: string; event: string; fields: Record<string, unknown> }[] = []
  return { lines, log: (level, event, fields = {}) => lines.push({ level, event, fields }) }
}

export async function seededRepo(): Promise<MemoryRepo> {
  const repo = new MemoryRepo()
  repo.serverClock = () => NOW
  repo.devices.push(
    { id: DEVICE_ID, name: 'Tablette', token_hash: await sha256Hex(TOKEN), revoked_at: null, last_seen_at: null },
    { id: OTHER_DEVICE_ID, name: 'iPhone', token_hash: await sha256Hex(OTHER_TOKEN), revoked_at: null, last_seen_at: null },
  )
  repo.staff.push(
    { id: STAFF_ID, display_name: 'Alex', role: 'manager', active: true, pin_salt: 'c2Fs', pin_hash: 'aGFzaA==', updated_at: '2026-11-01T00:00:00.000Z' },
    { id: INACTIVE_STAFF_ID, display_name: 'Ancien', role: 'staff', active: false, pin_salt: 'c2Fs', pin_hash: 'aGFzaA==', updated_at: '2026-11-10T00:00:00.000Z' },
  )
  repo.equipment.push({ id: FRIDGE_ID, name: 'Frigo 1', kind: 'fridge', active: true, updated_at: '2026-11-01T00:00:00.000Z' })
  repo.establishment = { id: '00000000-0000-4000-8000-0000000000f1', name: 'Le Camion', timezone: 'Europe/Paris' }
  repo.settings = { retention_years: 3, auto_lock_minutes: 2, clock_suspect_minutes: 5, email_alerts: true }
  return repo
}

let idCounter = 0
export function newId(): string {
  idCounter++
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, '0')}`
}

export interface RecordInput {
  type?: RecordType
  payload?: Record<string, unknown>
  author_id?: string
  device_time?: string
  supersedes_id?: string | null
  id?: string
}

/** Construit une chaîne valide d'enregistrements pour un appareil, à partir d'une tête donnée. */
export class ChainBuilder {
  seq: number
  prev: string
  readonly deviceId: string
  constructor(deviceId = DEVICE_ID, head: { device_seq: number; hash: string } = { device_seq: 0, hash: GENESIS_HASH }) {
    this.deviceId = deviceId
    this.seq = head.device_seq
    this.prev = head.hash
  }
  async next(input: RecordInput = {}): Promise<HaccpRecord> {
    const core = {
      id: input.id ?? newId(),
      type: input.type ?? ('system_test' as RecordType),
      payload: input.payload ?? { note: `test ${this.seq + 1}` },
      author_id: input.author_id ?? STAFF_ID,
      device_id: this.deviceId,
      device_seq: this.seq + 1,
      device_time: input.device_time ?? NOW.toISOString(),
      prev_hash: this.prev,
      supersedes_id: input.supersedes_id ?? null,
    }
    const hash = await computeRecordHash(core)
    this.seq++
    this.prev = hash
    return { ...core, hash }
  }
  async many(n: number, input: RecordInput = {}): Promise<HaccpRecord[]> {
    const out: HaccpRecord[] = []
    for (let i = 0; i < n; i++) out.push(await this.next(input))
    return out
  }
}

/** Recalcule le hash après modification (pour fabriquer un enregistrement « cohérent mais faux »). */
export async function rehash(r: HaccpRecord): Promise<HaccpRecord> {
  return { ...r, hash: await computeRecordHash(r) }
}
