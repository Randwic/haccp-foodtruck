import { describe, expect, it } from 'vitest'
import { GENESIS_HASH } from './types.ts'
import {
  CORRECTIVE_ACTIONS,
  RECORD_TYPES,
  SUPPORTED_RECORD_TYPES,
  isCanonicalIsoTime,
  validatePayload,
  validateRecordShape,
} from './validation.ts'

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function baseRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: U(1),
    type: 'system_test',
    payload: { note: 'ok' },
    author_id: U(2),
    device_id: U(3),
    device_seq: 1,
    device_time: '2026-11-14T10:00:00.000Z',
    prev_hash: GENESIS_HASH,
    supersedes_id: null,
    hash: 'a'.repeat(64),
    ...over,
  }
}

function expectFail(res: ReturnType<typeof validatePayload>, reason = 'invalid_payload', detail?: RegExp) {
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.reason).toBe(reason)
    if (detail) expect(res.detail).toMatch(detail)
  }
}

describe('validateRecordShape', () => {
  it('accepte un enregistrement bien formé', () => {
    expect(validateRecordShape(baseRecord())).toEqual({ ok: true })
  })
  it('tolère server_time (ignoré)', () => {
    expect(validateRecordShape(baseRecord({ server_time: '2026-11-14T10:00:01.000Z' })).ok).toBe(true)
  })
  it.each([null, 42, 'x', [], new Date()])('refuse un non-objet : %s', (v) => {
    expectFail(validateRecordShape(v))
  })
  it('refuse un champ inconnu', () => {
    expectFail(validateRecordShape(baseRecord({ extra: 1 })), 'invalid_payload', /extra/)
  })
  it.each([
    ['uuid non v4', '00000000-0000-1000-8000-000000000001'],
    ['majuscules', '00000000-0000-4000-8000-00000000000A'],
    ['variante invalide', '00000000-0000-4000-c000-000000000001'],
    ['pas un uuid', 'abc'],
    ['nombre', 1],
  ])('refuse un id invalide (%s)', (_l, id) => {
    expectFail(validateRecordShape(baseRecord({ id })), 'invalid_payload', /^id/)
  })
  it('refuse un type inconnu en unknown_type', () => {
    expectFail(validateRecordShape(baseRecord({ type: 'pizza' })), 'unknown_type')
    expectFail(validateRecordShape(baseRecord({ type: 3 })))
  })
  it('accepte tous les types du contrat (forme seulement)', () => {
    for (const t of RECORD_TYPES) {
      const extra = t === 'correction' ? { supersedes_id: U(9) } : {}
      expect(validateRecordShape(baseRecord({ type: t, ...extra })).ok).toBe(true)
    }
  })
  it('refuse un payload non objet', () => {
    expectFail(validateRecordShape(baseRecord({ payload: [] })))
    expectFail(validateRecordShape(baseRecord({ payload: null })))
  })
  it('accepte author_id / device_id uuid non v4 (références de la base) mais pas en majuscules', () => {
    expect(validateRecordShape(baseRecord({ author_id: '11111111-1111-1111-1111-111111111111' })).ok).toBe(true)
    expectFail(validateRecordShape(baseRecord({ author_id: '11111111-1111-1111-1111-11111111111A' })))
    expectFail(validateRecordShape(baseRecord({ device_id: 'x' })))
  })
  it.each([0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, NaN])('refuse device_seq = %s', (s) => {
    expectFail(validateRecordShape(baseRecord({ device_seq: s })), 'invalid_payload', /device_seq/)
  })
  it.each([
    '2026-11-14T10:00:00Z',
    '2026-11-14T10:00:00.000+00:00',
    '2026-11-14T11:00:00.000+01:00',
    '2026-11-14T10:00:00.000000Z',
    '2026-02-30T10:00:00.000Z',
    '2026-11-14 10:00:00.000Z',
    '',
    1731578400000,
  ])('refuse device_time non canonique : %s', (t) => {
    expectFail(validateRecordShape(baseRecord({ device_time: t })), 'invalid_payload', /device_time/)
  })
  it('isCanonicalIsoTime ⇔ toISOString()', () => {
    const iso = new Date(Date.UTC(2026, 10, 14, 10, 0, 0, 123)).toISOString()
    expect(isCanonicalIsoTime(iso)).toBe(true)
  })
  it('refuse prev_hash et hash mal formés', () => {
    expectFail(validateRecordShape(baseRecord({ prev_hash: 'A'.repeat(64) })), 'invalid_payload', /prev_hash/)
    expectFail(validateRecordShape(baseRecord({ hash: 'a'.repeat(63) })), 'invalid_hash')
    expectFail(validateRecordShape(baseRecord({ hash: 'G'.repeat(64) })), 'invalid_hash')
    expectFail(validateRecordShape(baseRecord({ hash: undefined })), 'invalid_hash')
  })
  it('exige supersedes_id pour une correction et null sinon', () => {
    expectFail(validateRecordShape(baseRecord({ type: 'correction' })), 'invalid_payload', /supersedes_id/)
    expectFail(validateRecordShape(baseRecord({ supersedes_id: U(9) })), 'invalid_payload', /supersedes_id/)
    expectFail(validateRecordShape(baseRecord({ supersedes_id: undefined })), 'invalid_payload', /supersedes_id/)
  })
  it('refuse server_time non textuel', () => {
    expectFail(validateRecordShape(baseRecord({ server_time: 5 })))
  })
})

describe('validatePayload — types', () => {
  it('refuse les types non encore définis en unknown_type', () => {
    for (const t of RECORD_TYPES) {
      if ((SUPPORTED_RECORD_TYPES as readonly string[]).includes(t)) continue
      expectFail(validatePayload(t, {}), 'unknown_type')
    }
    expectFail(validatePayload('pizza', {}), 'unknown_type')
  })
  it('refuse un payload non objet', () => {
    expectFail(validatePayload('system_test', 'x'))
    expectFail(validatePayload('system_test', null))
  })
})

describe('validatePayload — system_test', () => {
  it('accepte une note', () => {
    expect(validatePayload('system_test', { note: '' }).ok).toBe(true)
    expect(validatePayload('system_test', { note: 'é'.repeat(500) }).ok).toBe(true)
  })
  it('compte les caractères et non les unités UTF-16', () => {
    expect(validatePayload('system_test', { note: '🍟'.repeat(500) }).ok).toBe(true)
    expectFail(validatePayload('system_test', { note: '🍟'.repeat(501) }))
  })
  it('refuse note absente, trop longue, non textuelle, ou champ en trop', () => {
    expectFail(validatePayload('system_test', {}), 'invalid_payload', /obligatoire/)
    expectFail(validatePayload('system_test', { note: 'x'.repeat(501) }), 'invalid_payload', /500/)
    expectFail(validatePayload('system_test', { note: 3 }))
    expectFail(validatePayload('system_test', { note: 'x', y: 1 }), 'invalid_payload', /inconnu/)
  })
  it('refuse les caractères que jsonb ne stocke pas', () => {
    expectFail(validatePayload('system_test', { note: 'a\u0000b' }), 'invalid_payload', /nul/)
    expectFail(validatePayload('system_test', { note: 'a\ud800b' }), 'invalid_payload', /unicode/)
  })
})

describe('validatePayload — temperature_check', () => {
  const good = { equipment_id: U(10), value_c: 3.5, source: 'manual', in_range: true }
  it('accepte un relevé valide (avec ou sans action corrective)', () => {
    expect(validatePayload('temperature_check', good).ok).toBe(true)
    expect(validatePayload('temperature_check', { ...good, in_range: false, corrective_action_id: U(11) }).ok).toBe(true)
    for (const source of ['manual', 'probe', 'sensor']) {
      expect(validatePayload('temperature_check', { ...good, source }).ok).toBe(true)
    }
  })
  it.each([-50, 300, 0, -18, 63, 1.1, -0.1, 2.3])('accepte value_c = %s', (v) => {
    expect(validatePayload('temperature_check', { ...good, value_c: v }).ok).toBe(true)
  })
  it.each([-50.1, 300.1, 3.25, 1.05, NaN, Infinity, '3', null])('refuse value_c = %s', (v) => {
    expectFail(validatePayload('temperature_check', { ...good, value_c: v }), 'invalid_payload', /value_c/)
  })
  it('refuse source, in_range, equipment_id ou corrective_action_id invalides', () => {
    expectFail(validatePayload('temperature_check', { ...good, source: 'guess' }), 'invalid_payload', /source/)
    expectFail(validatePayload('temperature_check', { ...good, in_range: 'yes' }), 'invalid_payload', /in_range/)
    expectFail(validatePayload('temperature_check', { ...good, equipment_id: 'frigo1' }), 'invalid_payload', /equipment_id/)
    expectFail(validatePayload('temperature_check', { ...good, corrective_action_id: null }), 'invalid_payload', /corrective_action_id/)
  })
  it('refuse un champ manquant ou inconnu', () => {
    const { in_range: _, ...missing } = good
    expectFail(validatePayload('temperature_check', missing), 'invalid_payload', /in_range.*obligatoire/)
    expectFail(validatePayload('temperature_check', { ...good, unit: 'F' }), 'invalid_payload', /unit/)
  })
})

describe('validatePayload — corrective_action', () => {
  const good = { related_record_id: U(20), action: 'discard', comment: '' }
  it('accepte chaque action de la liste fermée', () => {
    for (const action of CORRECTIVE_ACTIONS) {
      const comment = action === 'other' ? 'précision' : ''
      expect(validatePayload('corrective_action', { ...good, action, comment }).ok).toBe(true)
    }
  })
  it('exige un commentaire pour « other »', () => {
    expectFail(validatePayload('corrective_action', { ...good, action: 'other', comment: '  ' }), 'invalid_payload', /other/)
  })
  it('refuse une action hors liste', () => {
    expectFail(validatePayload('corrective_action', { ...good, action: 'ignore' }), 'invalid_payload', /action/)
  })
  it('refuse commentaire absent ou trop long', () => {
    expectFail(validatePayload('corrective_action', { related_record_id: U(20), action: 'discard' }))
    expectFail(validatePayload('corrective_action', { ...good, comment: 'x'.repeat(1001) }))
  })
  it('valide photo_path', () => {
    expect(validatePayload('corrective_action', { ...good, photo_path: 'photos/2026/11/abc.webp' }).ok).toBe(true)
    for (const p of ['', '/etc/passwd', '../x.webp', 'a/../../b', 'a//b', 'a b.webp', 3]) {
      expectFail(validatePayload('corrective_action', { ...good, photo_path: p }), 'invalid_payload', /photo_path/)
    }
  })
  it('refuse related_record_id invalide', () => {
    expectFail(validatePayload('corrective_action', { ...good, related_record_id: 'x' }))
  })
})

describe('validatePayload — correction', () => {
  const replacement = { equipment_id: U(10), value_c: 4, source: 'manual', in_range: true }
  it('accepte une correction dont le remplacement est valide pour le type corrigé', () => {
    expect(validatePayload('correction', { reason: 'erreur de frappe', replacement }, { supersededType: 'temperature_check' }).ok).toBe(true)
  })
  it('sans contexte, vérifie seulement la structure', () => {
    expect(validatePayload('correction', { reason: 'r', replacement: { anything: 1 } }).ok).toBe(true)
    expectFail(validatePayload('correction', { reason: 'r', replacement: [] }), 'invalid_payload', /replacement/)
  })
  it('refuse un motif vide, blanc ou trop long', () => {
    expectFail(validatePayload('correction', { reason: '', replacement }), 'invalid_payload', /reason/)
    expectFail(validatePayload('correction', { reason: '   ', replacement }), 'invalid_payload', /reason/)
    expectFail(validatePayload('correction', { reason: 'x'.repeat(501), replacement }), 'invalid_payload', /reason/)
    expectFail(validatePayload('correction', { replacement }), 'invalid_payload', /reason/)
  })
  it('refuse un remplacement invalide pour le type corrigé', () => {
    const res = validatePayload('correction', { reason: 'r', replacement: { ...replacement, value_c: 999 } }, { supersededType: 'temperature_check' })
    expectFail(res, 'invalid_payload', /replacement \(temperature_check\) : replacement\.value_c/)
  })
  it('refuse de corriger vers un type non pris en charge ou « correction »', () => {
    expectFail(validatePayload('correction', { reason: 'r', replacement: {} }, { supersededType: 'cooling' }), 'unknown_type')
    expectFail(validatePayload('correction', { reason: 'r', replacement: {} }, { supersededType: 'correction' }))
  })
  it('refuse un champ en trop', () => {
    expectFail(validatePayload('correction', { reason: 'r', replacement, x: 1 }))
  })
})

describe('validatePayload — garde-fous génériques', () => {
  it('refuse une imbrication trop profonde', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 10; i++) deep = { d: deep }
    expectFail(validatePayload('correction', { reason: 'r', replacement: deep }), 'invalid_payload', /profonde/)
  })
  it('refuse un payload trop volumineux', () => {
    const big = { reason: 'r', replacement: { a: 'x'.repeat(20_000) } }
    expectFail(validatePayload('correction', big), 'invalid_payload', /volumineux/)
  })
})
