import { describe, expect, it } from 'vitest'
import type { CookingCheckPayload, CoolingPayload, HotHoldingPayload, ReceptionPayload, ThawingPayload, WastePayload } from './payloads.ts'
import { GENESIS_HASH } from './types.ts'
import {
  CORRECTIVE_ACTIONS,
  RECORD_TYPES,
  SUPPORTED_RECORD_TYPES,
  LIMITS,
  isCanonicalIsoTime,
  referencedPhotoPaths,
  referencedSupplierId,
  referencedEquipmentId,
  validatePayload,
  validateRecordSemantics,
  validateRecordShape,
  validateRecordStructure,
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
    expectFail(validateRecordShape(v), 'invalid_record')
  })
  it('refuse un champ inconnu', () => {
    expectFail(validateRecordShape(baseRecord({ extra: 1 })), 'invalid_record', /extra/)
  })
  it.each([
    ['uuid non v4', '00000000-0000-1000-8000-000000000001'],
    ['majuscules', '00000000-0000-4000-8000-00000000000A'],
    ['variante invalide', '00000000-0000-4000-c000-000000000001'],
    ['pas un uuid', 'abc'],
    ['nombre', 1],
  ])('refuse un id invalide (%s)', (_l, id) => {
    expectFail(validateRecordShape(baseRecord({ id })), 'invalid_record', /^id/)
  })
  it('refuse un type inconnu en unknown_type', () => {
    expectFail(validateRecordShape(baseRecord({ type: 'pizza' })), 'unknown_type')
    expectFail(validateRecordShape(baseRecord({ type: 3 })), 'invalid_record')
  })
  it('accepte tous les types du contrat (forme seulement)', () => {
    for (const t of RECORD_TYPES) {
      const extra = t === 'correction' ? { supersedes_id: U(9) } : {}
      expect(validateRecordShape(baseRecord({ type: t, ...extra })).ok).toBe(true)
    }
  })
  it('refuse un payload non objet', () => {
    expectFail(validateRecordShape(baseRecord({ payload: [] })), 'invalid_record')
    expectFail(validateRecordShape(baseRecord({ payload: null })), 'invalid_record')
  })
  it('accepte author_id / device_id uuid non v4 (références de la base) mais pas en majuscules', () => {
    expect(validateRecordShape(baseRecord({ author_id: '11111111-1111-1111-1111-111111111111' })).ok).toBe(true)
    expectFail(validateRecordShape(baseRecord({ author_id: '11111111-1111-1111-1111-11111111111A' })), 'invalid_record')
    expectFail(validateRecordShape(baseRecord({ device_id: 'x' })), 'invalid_record')
  })
  it.each([0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, NaN])('refuse device_seq = %s', (s) => {
    expectFail(validateRecordShape(baseRecord({ device_seq: s })), 'invalid_record', /device_seq/)
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
    expectFail(validateRecordShape(baseRecord({ device_time: t })), 'invalid_record', /device_time/)
  })
  it('isCanonicalIsoTime ⇔ toISOString()', () => {
    const iso = new Date(Date.UTC(2026, 10, 14, 10, 0, 0, 123)).toISOString()
    expect(isCanonicalIsoTime(iso)).toBe(true)
  })
  it('refuse prev_hash et hash mal formés', () => {
    expectFail(validateRecordShape(baseRecord({ prev_hash: 'A'.repeat(64) })), 'invalid_record', /prev_hash/)
    expectFail(validateRecordShape(baseRecord({ hash: 'a'.repeat(63) })), 'invalid_hash')
    expectFail(validateRecordShape(baseRecord({ hash: 'G'.repeat(64) })), 'invalid_hash')
    expectFail(validateRecordShape(baseRecord({ hash: undefined })), 'invalid_hash')
  })
  it('exige supersedes_id pour une correction et null sinon', () => {
    expectFail(validateRecordShape(baseRecord({ type: 'correction' })), 'invalid_payload', /supersedes_id/)
    expectFail(validateRecordShape(baseRecord({ supersedes_id: U(9) })), 'invalid_payload', /supersedes_id/)
    expectFail(validateRecordShape(baseRecord({ supersedes_id: undefined })), 'invalid_record', /supersedes_id/)
  })
  it('refuse server_time non textuel', () => {
    expectFail(validateRecordShape(baseRecord({ server_time: 5 })), 'invalid_record')
  })
})

describe('validateRecordStructure / validateRecordSemantics (serveur : quarantaine)', () => {
  it('un type hors contrat reste stockable (structure ok) mais refusé en sémantique', () => {
    const r = baseRecord({ type: 'pizza' })
    expect(validateRecordStructure(r)).toEqual({ ok: true })
    expectFail(validateRecordSemantics(r as { type: string; supersedes_id: null }), 'unknown_type')
  })
  it('un type non identifiant n’est pas stockable', () => {
    expectFail(validateRecordStructure(baseRecord({ type: 'Pizza !' })), 'invalid_record', /^type/)
    expectFail(validateRecordStructure(baseRecord({ type: 'x'.repeat(41) })), 'invalid_record', /^type/)
  })
  it('supersedes_id incohérent avec le type : stockable, refusé en sémantique', () => {
    const r = baseRecord({ supersedes_id: U(9) })
    expect(validateRecordStructure(r).ok).toBe(true)
    expectFail(validateRecordSemantics(r as { type: string; supersedes_id: string }), 'invalid_payload', /supersedes_id/)
    expectFail(validateRecordSemantics({ type: 'correction', supersedes_id: null }), 'invalid_payload', /supersedes_id/)
  })
  it('un payload que jsonb ne peut pas stocker n’est pas stockable', () => {
    expectFail(validateRecordStructure(baseRecord({ payload: { note: 'a\u0000' } })), 'invalid_record', /nul/)
    expectFail(validateRecordStructure(baseRecord({ payload: { a: 'x'.repeat(20_000) } })), 'invalid_record', /volumineux/)
  })
  it('les champs de chaîne restent absolus', () => {
    expectFail(validateRecordStructure(baseRecord({ hash: 'x' })), 'invalid_hash')
    expectFail(validateRecordStructure(baseRecord({ device_seq: 0 })), 'invalid_record')
    expectFail(validateRecordStructure(baseRecord({ supersedes_id: 'abc' })), 'invalid_record')
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
    expectFail(validatePayload('correction', { reason: 'r', replacement: {} }, { supersededType: 'oil_check' }), 'unknown_type')
    expectFail(validatePayload('correction', { reason: 'r', replacement: {} }, { supersededType: 'correction' }))
  })
  it('refuse un champ en trop', () => {
    expectFail(validatePayload('correction', { reason: 'r', replacement, x: 1 }))
  })
})

describe('validatePayload — lot 2 : types pris en charge', () => {
  it('cooling, reheating, thawing, hot_holding, cooking_check sont pris en charge', () => {
    for (const t of ['cooling', 'reheating', 'thawing', 'hot_holding', 'cooking_check']) {
      expect(SUPPORTED_RECORD_TYPES as readonly string[]).toContain(t)
    }
  })
})

describe.each(['cooling', 'reheating'] as const)('validatePayload — %s', (type) => {
  const start: CoolingPayload = { batch_id: U(30), step: 'start', product: 'Chili', value_c: 70, source: 'probe' }
  const end: CoolingPayload = { ...start, step: 'end', value_c: 8.5, in_range: true, duration_min: 95 }
  it('accepte start, check et end', () => {
    expect(validatePayload(type, start).ok).toBe(true)
    expect(validatePayload(type, { ...start, step: 'check', value_c: 30 }).ok).toBe(true)
    expect(validatePayload(type, end).ok).toBe(true)
    expect(validatePayload(type, { ...end, in_range: false, duration_min: 0 }).ok).toBe(true)
    expect(validatePayload(type, { ...end, duration_min: 1440 }).ok).toBe(true)
  })
  it('in_range / duration_min facultatifs hors « end »', () => {
    expect(validatePayload(type, { ...start, in_range: true }).ok).toBe(true)
    expect(validatePayload(type, { ...start, step: 'check', duration_min: 40, in_range: false }).ok).toBe(true)
  })
  it('à « end » : in_range et duration_min obligatoires', () => {
    const { in_range: _a, ...noRange } = end
    const { duration_min: _b, ...noDuration } = end
    expectFail(validatePayload(type, noRange), 'invalid_payload', /in_range.*obligatoire/)
    expectFail(validatePayload(type, noDuration), 'invalid_payload', /duration_min.*obligatoire/)
  })
  it.each([-1, 1441, 1.5, '30', null, NaN])('refuse duration_min = %s', (d) => {
    expectFail(validatePayload(type, { ...end, duration_min: d }), 'invalid_payload', /duration_min/)
  })
  it('refuse step, batch_id, source, in_range invalides', () => {
    expectFail(validatePayload(type, { ...start, step: 'middle' }), 'invalid_payload', /step/)
    expectFail(validatePayload(type, { ...start, batch_id: 'lot-1' }), 'invalid_payload', /batch_id/)
    expectFail(validatePayload(type, { ...start, batch_id: U(30).replace('-4000-', '-4AB0-') }), 'invalid_payload', /batch_id/)
    expectFail(validatePayload(type, { ...start, source: 'eye' }), 'invalid_payload', /source/)
    expectFail(validatePayload(type, { ...end, in_range: 1 }), 'invalid_payload', /in_range/)
  })
  it.each([-50.1, 300.1, 63.25, '63'])('refuse value_c = %s', (v) => {
    expectFail(validatePayload(type, { ...start, value_c: v }), 'invalid_payload', /value_c/)
  })
  it('product : 1 à 80 caractères, non blanc', () => {
    expect(validatePayload(type, { ...start, product: 'é'.repeat(80) }).ok).toBe(true)
    expect(validatePayload(type, { ...start, product: '🍲'.repeat(80) }).ok).toBe(true)
    expectFail(validatePayload(type, { ...start, product: 'x'.repeat(81) }), 'invalid_payload', /product.*80/)
    expectFail(validatePayload(type, { ...start, product: '' }), 'invalid_payload', /product/)
    expectFail(validatePayload(type, { ...start, product: '   ' }), 'invalid_payload', /product/)
    expectFail(validatePayload(type, { ...start, product: 3 }), 'invalid_payload', /product/)
  })
  it('refuse un champ manquant ou inconnu', () => {
    const { product: _, ...noProduct } = start
    expectFail(validatePayload(type, noProduct), 'invalid_payload', /product.*obligatoire/)
    expectFail(validatePayload(type, { ...start, equipment_id: U(10) }), 'invalid_payload', /equipment_id.*inconnu/)
  })
})

describe('validatePayload — thawing', () => {
  const start: ThawingPayload = { batch_id: U(40), step: 'start', product: 'Steaks hachés', equipment_id: U(10) }
  const end: ThawingPayload = { ...start, step: 'end', dlc: '2026-11-17' }
  it('accepte start et end (avec DLC)', () => {
    expect(validatePayload('thawing', start).ok).toBe(true)
    expect(validatePayload('thawing', end).ok).toBe(true)
    expect(validatePayload('thawing', { ...end, dlc: '2028-02-29' }).ok).toBe(true)
  })
  it('à « end » : dlc obligatoire', () => {
    expectFail(validatePayload('thawing', { ...start, step: 'end' }), 'invalid_payload', /dlc.*obligatoire/)
  })
  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-05', '17/11/2026', '2026-11-17T00:00:00Z', '', 20261117])(
    'refuse dlc = %s',
    (dlc) => {
      expectFail(validatePayload('thawing', { ...end, dlc }), 'invalid_payload', /dlc/)
    },
  )
  it('refuse step « check », equipment_id manquant ou invalide, champ inconnu', () => {
    expectFail(validatePayload('thawing', { ...start, step: 'check' }), 'invalid_payload', /step/)
    const { equipment_id: _, ...noEq } = start
    expectFail(validatePayload('thawing', noEq), 'invalid_payload', /equipment_id.*obligatoire/)
    expectFail(validatePayload('thawing', { ...start, equipment_id: 'frigo' }), 'invalid_payload', /equipment_id/)
    expectFail(validatePayload('thawing', { ...start, value_c: 3 }), 'invalid_payload', /value_c.*inconnu/)
  })
})

describe('validatePayload — hot_holding', () => {
  const good: HotHoldingPayload = { product: 'Frites', value_c: 65, source: 'probe', in_range: true }
  it('accepte avec ou sans equipment_id', () => {
    expect(validatePayload('hot_holding', good).ok).toBe(true)
    expect(validatePayload('hot_holding', { ...good, equipment_id: U(10), in_range: false, value_c: 55.5 }).ok).toBe(true)
  })
  it('refuse in_range absent, equipment_id invalide, valeur hors plage, champ inconnu', () => {
    const { in_range: _, ...noRange } = good
    expectFail(validatePayload('hot_holding', noRange), 'invalid_payload', /in_range.*obligatoire/)
    expectFail(validatePayload('hot_holding', { ...good, equipment_id: null }), 'invalid_payload', /equipment_id/)
    expectFail(validatePayload('hot_holding', { ...good, value_c: 301 }), 'invalid_payload', /value_c/)
    expectFail(validatePayload('hot_holding', { ...good, batch_id: U(1) }), 'invalid_payload', /batch_id.*inconnu/)
  })
})

describe('validatePayload — cooking_check', () => {
  const good: CookingCheckPayload = { product: 'Steak haché', value_c: 72.5, source: 'probe', in_range: true }
  it('accepte un contrôle valide', () => {
    expect(validatePayload('cooking_check', good).ok).toBe(true)
    expect(validatePayload('cooking_check', { ...good, value_c: 60, in_range: false, source: 'manual' }).ok).toBe(true)
  })
  it('refuse les champs manquants, invalides ou inconnus', () => {
    const { product: _, ...noProduct } = good
    expectFail(validatePayload('cooking_check', noProduct), 'invalid_payload', /product.*obligatoire/)
    expectFail(validatePayload('cooking_check', { ...good, product: ' ' }), 'invalid_payload', /product/)
    expectFail(validatePayload('cooking_check', { ...good, value_c: 70.05 }), 'invalid_payload', /value_c/)
    expectFail(validatePayload('cooking_check', { ...good, equipment_id: U(10) }), 'invalid_payload', /equipment_id.*inconnu/)
  })
  it('n’évalue pas in_range par rapport aux seuils (choix : seuils variables hors réseau)', () => {
    expect(validatePayload('cooking_check', { ...good, value_c: 40, in_range: true }).ok).toBe(true)
  })
})

describe('validatePayload — correction des types du lot 2', () => {
  it('accepte un remplacement valide et refuse un remplacement invalide', () => {
    const cooling = { batch_id: U(30), step: 'end', product: 'Chili', value_c: 9, source: 'probe', in_range: true, duration_min: 100 }
    expect(validatePayload('correction', { reason: 'mauvaise durée', replacement: cooling }, { supersededType: 'cooling' }).ok).toBe(true)
    const { duration_min: _, ...noDuration } = cooling
    expectFail(
      validatePayload('correction', { reason: 'r', replacement: noDuration }, { supersededType: 'cooling' }),
      'invalid_payload',
      /replacement \(cooling\) : replacement\.duration_min.*obligatoire/,
    )
    const thaw = { batch_id: U(40), step: 'end', product: 'Pain', equipment_id: U(10), dlc: '2026-11-20' }
    expect(validatePayload('correction', { reason: 'DLC', replacement: thaw }, { supersededType: 'thawing' }).ok).toBe(true)
    expectFail(validatePayload('correction', { reason: 'r', replacement: { ...thaw, dlc: '2026-11-31' } }, { supersededType: 'thawing' }), 'invalid_payload', /dlc/)
    for (const [t, rep] of [
      ['reheating', { ...cooling, value_c: 70 }],
      ['hot_holding', { product: 'Frites', value_c: 66, source: 'probe', in_range: true }],
      ['cooking_check', { product: 'Steak', value_c: 71, source: 'probe', in_range: true }],
    ] as const) {
      expect(validatePayload('correction', { reason: 'r', replacement: rep }, { supersededType: t }).ok).toBe(true)
      expectFail(validatePayload('correction', { reason: 'r', replacement: { ...rep, product: '' } }, { supersededType: t }), 'invalid_payload', /product/)
    }
  })
})

describe('referencedEquipmentId', () => {
  it('renvoie l’équipement des types qui en portent un', () => {
    expect(referencedEquipmentId('temperature_check', { equipment_id: U(10) })).toBe(U(10))
    expect(referencedEquipmentId('thawing', { equipment_id: U(11) })).toBe(U(11))
    expect(referencedEquipmentId('hot_holding', { equipment_id: U(12) })).toBe(U(12))
    expect(referencedEquipmentId('hot_holding', {})).toBeNull()
    expect(referencedEquipmentId('cooking_check', { product: 'x' })).toBeNull()
    expect(referencedEquipmentId('corrective_action', { related_record_id: U(1) })).toBeNull()
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

// ───────────────────────────── Lot 3 : réception & pertes ─────────────────────────────

const DEV = '0a1b2c3d-0000-4000-8000-00000000d001'
const photo = (n: number) => `${DEV}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`

describe('validatePayload — reception', () => {
  const item = (over: Record<string, unknown> = {}) => ({ product: 'Steak haché', storage: 'fridge', accepted: true, ...over })
  const rec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    supplier_id: U(20),
    vehicle_ok: true,
    packaging_ok: true,
    items: [item()],
    ...over,
  })
  it('accepte une réception minimale et une réception complète', () => {
    expect(validatePayload('reception', rec())).toEqual({ ok: true })
    const full: ReceptionPayload = {
      supplier_id: U(20),
      delivery_note: 'BL-2026-118',
      vehicle_ok: false,
      packaging_ok: true,
      items: [
        {
          product: 'Steak haché 15 %',
          lot: 'L2611A',
          dlc: '2026-11-20',
          ddm: '2027-02-28',
          gtin: '3245678901234',
          temperature_c: 2.5,
          storage: 'fridge',
          accepted: true,
          photo_paths: [photo(1), photo(2)],
        },
        { product: 'Glace vanille', storage: 'freezer', accepted: false, refusal_reason: 'produit décongelé', temperature_c: -8 },
      ],
      photo_paths: [photo(3)],
      comment: '',
    }
    expect(validatePayload('reception', full as unknown as Record<string, unknown>)).toEqual({ ok: true })
  })
  it('items : 1 à 50 lignes', () => {
    expectFail(validatePayload('reception', rec({ items: [] })), 'invalid_payload', /items : 1/)
    expect(validatePayload('reception', rec({ items: Array.from({ length: LIMITS.receptionItemsMax }, () => item()) })).ok).toBe(true)
    expectFail(validatePayload('reception', rec({ items: Array.from({ length: 51 }, () => item()) })), 'invalid_payload', /50/)
    expectFail(validatePayload('reception', rec({ items: 'x' })), 'invalid_payload', /tableau/)
    expectFail(validatePayload('reception', rec({ items: [null] })), 'invalid_payload', /items\[0\] : objet/)
  })
  it('refusal_reason obligatoire (1..200, non blanc) si le produit est refusé', () => {
    expectFail(validatePayload('reception', rec({ items: [item({ accepted: false })] })), 'invalid_payload', /items\[0\]\.refusal_reason/)
    expectFail(validatePayload('reception', rec({ items: [item({ accepted: false, refusal_reason: '  ' })] })), 'invalid_payload', /refusal_reason/)
    expectFail(validatePayload('reception', rec({ items: [item({ accepted: false, refusal_reason: 'x'.repeat(201) })] })), 'invalid_payload', /200/)
    expect(validatePayload('reception', rec({ items: [item({ accepted: false, refusal_reason: 'x'.repeat(200) })] })).ok).toBe(true)
  })
  it('dates AAAA-MM-JJ réelles (dlc, ddm)', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '26-11-20', '2026-11-20T00:00:00Z', 20261120]) {
      expectFail(validatePayload('reception', rec({ items: [item({ dlc: bad })] })), 'invalid_payload', /dlc/)
      expectFail(validatePayload('reception', rec({ items: [item({ ddm: bad })] })), 'invalid_payload', /ddm/)
    }
    expect(validatePayload('reception', rec({ items: [item({ dlc: '2028-02-29' })] })).ok).toBe(true)
  })
  it('gtin : 8 à 14 chiffres (texte)', () => {
    for (const ok of ['12345678', '12345678901234']) expect(validatePayload('reception', rec({ items: [item({ gtin: ok })] })).ok).toBe(true)
    for (const bad of ['1234567', '123456789012345', '1234567a', 12345678, ' 12345678']) {
      expectFail(validatePayload('reception', rec({ items: [item({ gtin: bad })] })), 'invalid_payload', /gtin/)
    }
  })
  it('temperature_c : −50..300, une décimale', () => {
    for (const ok of [-50, 300, 3.5, 0]) expect(validatePayload('reception', rec({ items: [item({ temperature_c: ok })] })).ok).toBe(true)
    for (const bad of [-50.1, 300.5, 3.55, '3', null]) {
      expectFail(validatePayload('reception', rec({ items: [item({ temperature_c: bad })] })), 'invalid_payload', /temperature_c/)
    }
  })
  it('bornes de longueur : product, lot, delivery_note, comment', () => {
    expectFail(validatePayload('reception', rec({ items: [item({ product: '' })] })), 'invalid_payload', /product/)
    expectFail(validatePayload('reception', rec({ items: [item({ product: 'x'.repeat(81) })] })), 'invalid_payload', /product/)
    expectFail(validatePayload('reception', rec({ items: [item({ lot: '' })] })), 'invalid_payload', /lot/)
    expectFail(validatePayload('reception', rec({ items: [item({ lot: 'x'.repeat(41) })] })), 'invalid_payload', /lot/)
    expect(validatePayload('reception', rec({ items: [item({ lot: 'x'.repeat(40) })] })).ok).toBe(true)
    expectFail(validatePayload('reception', rec({ delivery_note: '' })), 'invalid_payload', /delivery_note/)
    expectFail(validatePayload('reception', rec({ delivery_note: 'x'.repeat(41) })), 'invalid_payload', /delivery_note/)
    expect(validatePayload('reception', rec({ comment: 'x'.repeat(500) })).ok).toBe(true)
    expectFail(validatePayload('reception', rec({ comment: 'x'.repeat(501) })), 'invalid_payload', /comment/)
  })
  it('storage, accepted, vehicle_ok, packaging_ok, supplier_id', () => {
    expectFail(validatePayload('reception', rec({ items: [item({ storage: 'cave' })] })), 'invalid_payload', /storage/)
    expectFail(validatePayload('reception', rec({ items: [item({ accepted: 'oui' })] })), 'invalid_payload', /accepted/)
    expectFail(validatePayload('reception', rec({ vehicle_ok: 1 })), 'invalid_payload', /vehicle_ok/)
    expectFail(validatePayload('reception', rec({ packaging_ok: undefined })), 'invalid_payload')
    expectFail(validatePayload('reception', rec({ supplier_id: 'ABC' })), 'invalid_payload', /supplier_id/)
    const noSupplier = rec()
    delete noSupplier.supplier_id
    expectFail(validatePayload('reception', noSupplier), 'invalid_payload', /supplier_id : obligatoire/)
  })
  it('photo_paths : format PHOTO_PATH_RE, 5 maximum (réception et lignes)', () => {
    expect(validatePayload('reception', rec({ photo_paths: [] })).ok).toBe(true)
    expect(validatePayload('reception', rec({ photo_paths: [1, 2, 3, 4, 5].map(photo) })).ok).toBe(true)
    expectFail(validatePayload('reception', rec({ photo_paths: [1, 2, 3, 4, 5, 6].map(photo) })), 'invalid_payload', /photo_paths/)
    for (const bad of [`${DEV}/x.webp`, `${DEV}/${U(1)}.jpg`, `../${U(1)}.webp`, `${DEV.toUpperCase()}/${U(1)}.webp`, `${DEV}/${U(1)}.webp/`, 42]) {
      expectFail(validatePayload('reception', rec({ photo_paths: [bad] })), 'invalid_payload', /photo_paths\[0\]/)
      expectFail(validatePayload('reception', rec({ items: [item({ photo_paths: [bad] })] })), 'invalid_payload', /items\[0\]\.photo_paths\[0\]/)
    }
    expectFail(validatePayload('reception', rec({ photo_paths: photo(1) })), 'invalid_payload', /tableau/)
  })
  it('refuse les champs inconnus (réception et lignes)', () => {
    expectFail(validatePayload('reception', rec({ total: 3 })), 'invalid_payload', /total : champ inconnu/)
    expectFail(validatePayload('reception', rec({ items: [item({ price: 3 })] })), 'invalid_payload', /items\[0\]\.price : champ inconnu/)
  })
  it('referencedSupplierId / referencedPhotoPaths', () => {
    const p = rec({ photo_paths: [photo(1)], items: [item({ photo_paths: [photo(2), photo(1)] }), item()] })
    expect(referencedSupplierId('reception', p)).toBe(U(20))
    expect(referencedSupplierId('waste', p)).toBeNull()
    expect(referencedPhotoPaths('reception', p)).toEqual([photo(1), photo(2)])
    expect(referencedPhotoPaths('waste', { photo_paths: [photo(4)] })).toEqual([photo(4)])
    expect(referencedPhotoPaths('corrective_action', { photo_path: photo(4) })).toEqual([])
  })
  it('correction d’une réception : remplacement validé selon le type réception', () => {
    expect(validatePayload('correction', { reason: 'lot mal saisi', replacement: rec() }, { supersededType: 'reception' }).ok).toBe(true)
    expectFail(
      validatePayload('correction', { reason: 'r', replacement: rec({ items: [] }) }, { supersededType: 'reception' }),
      'invalid_payload',
      /replacement \(reception\) : replacement\.items/,
    )
  })
})

describe('validatePayload — waste', () => {
  const w = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ product: 'Crème', reason: 'expired', ...over })
  it('accepte une perte minimale et complète', () => {
    expect(validatePayload('waste', w())).toEqual({ ok: true })
    const full: WastePayload = {
      product: 'Crème fraîche',
      lot: 'L42',
      quantity: '2 kg',
      reason: 'other',
      comment: 'pot gonflé',
      related_record_id: U(30),
      photo_paths: [photo(5)],
    }
    expect(validatePayload('waste', full as unknown as Record<string, unknown>)).toEqual({ ok: true })
  })
  it('comment obligatoire (non blanc) si reason = other', () => {
    expectFail(validatePayload('waste', w({ reason: 'other' })), 'invalid_payload', /comment/)
    expectFail(validatePayload('waste', w({ reason: 'other', comment: '  ' })), 'invalid_payload', /comment/)
    expect(validatePayload('waste', w({ reason: 'recall', comment: '' })).ok).toBe(true)
    expectFail(validatePayload('waste', w({ comment: 'x'.repeat(501) })), 'invalid_payload', /comment/)
  })
  it('reason hors liste, bornes product / lot / quantity, related_record_id, photo_paths', () => {
    expectFail(validatePayload('waste', w({ reason: 'stolen' })), 'invalid_payload', /reason/)
    expectFail(validatePayload('waste', w({ product: ' ' })), 'invalid_payload', /product/)
    expectFail(validatePayload('waste', w({ lot: 'x'.repeat(41) })), 'invalid_payload', /lot/)
    expectFail(validatePayload('waste', w({ quantity: '' })), 'invalid_payload', /quantity/)
    expectFail(validatePayload('waste', w({ quantity: 'x'.repeat(41) })), 'invalid_payload', /quantity/)
    expectFail(validatePayload('waste', w({ related_record_id: 'abc' })), 'invalid_payload', /related_record_id/)
    expectFail(validatePayload('waste', w({ photo_paths: ['photo.webp'] })), 'invalid_payload', /photo_paths/)
    expectFail(validatePayload('waste', w({ photo_paths: [1, 2, 3, 4, 5, 6].map(photo) })), 'invalid_payload', /photo_paths/)
  })
  it('refuse un champ inconnu', () => {
    expectFail(validatePayload('waste', w({ cost: 3 })), 'invalid_payload', /cost/)
  })
  it('correction d’une perte', () => {
    expect(validatePayload('correction', { reason: 'r', replacement: w() }, { supersededType: 'waste' }).ok).toBe(true)
    expectFail(validatePayload('correction', { reason: 'r', replacement: w({ reason: 'other' }) }, { supersededType: 'waste' }), 'invalid_payload', /replacement\.comment/)
  })
})
