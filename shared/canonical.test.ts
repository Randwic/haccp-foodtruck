import { describe, expect, it } from 'vitest'
import { canonicalJson, computeRecordHash } from './canonical.ts'
import { GENESIS_HASH, type RecordCore } from './types.ts'

describe('canonicalJson', () => {
  it('trie les clés récursivement et n’ajoute aucun espace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}')
  })
  it('refuse undefined', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow()
  })
})

describe('computeRecordHash', () => {
  const r: RecordCore = {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'system_test',
    payload: { note: 'test' },
    author_id: '00000000-0000-4000-8000-000000000002',
    device_id: '00000000-0000-4000-8000-000000000003',
    device_seq: 1,
    device_time: '2026-11-14T10:00:00.000Z',
    prev_hash: GENESIS_HASH,
    supersedes_id: null,
  }
  it('est stable et ignore les champs hors contrat', async () => {
    const h1 = await computeRecordHash(r)
    const h2 = await computeRecordHash({ ...r, hash: 'x', server_time: 'y' } as RecordCore)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h2).toBe(h1)
  })
  it('change si le contenu change', async () => {
    expect(await computeRecordHash({ ...r, payload: { note: 'autre' } })).not.toBe(await computeRecordHash(r))
  })
})
