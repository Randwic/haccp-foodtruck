import { describe, expect, it } from 'vitest'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { buildReceptions, buildWastes, diffReception, findByLot, isOutOfRange, summarizeReceptions } from './model.ts'

let seq = 0
const rec = (type: HaccpRecord['type'], time: string, payload: Record<string, unknown>, extra: Partial<HaccpRecord> = {}): HaccpRecord => ({
  id: extra.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  type,
  payload,
  author_id: 'a',
  device_id: 'd',
  device_seq: seq,
  device_time: time,
  prev_hash: '',
  supersedes_id: null,
  hash: '',
  ...extra,
})
const S = '6f1c2a4e-0000-4000-8000-000000000501'
const base = { supplier_id: S, vehicle_ok: true, packaging_ok: true }

describe('modèle Réception', () => {
  it('seuils par conservation : frigo ≤ 4 °C, congélateur ≤ −18 °C, ambiant sans contrôle', () => {
    expect(isOutOfRange({ storage: 'fridge', temperature_c: 4 })).toBe(false)
    expect(isOutOfRange({ storage: 'fridge', temperature_c: 4.1 })).toBe(true)
    expect(isOutOfRange({ storage: 'freezer', temperature_c: -17.9 })).toBe(true)
    expect(isOutOfRange({ storage: 'ambient', temperature_c: 30 })).toBe(false)
  })

  it('corrections en chaîne, action corrective rattachée, refus, résumé et différences', () => {
    const r = rec('reception', '2026-11-14T08:00:00.000Z', { ...base, items: [{ product: 'Poulet', lot: 'A1', storage: 'fridge', temperature_c: 7, accepted: true }] })
    const c = rec(
      'correction',
      '2026-11-14T08:10:00.000Z',
      { reason: 'Erreur', replacement: { ...base, items: [{ product: 'Poulet', lot: 'A2', storage: 'fridge', temperature_c: 7, accepted: true }, { product: 'Oeufs', storage: 'ambient', accepted: false, refusal_reason: 'Cassés' }] } },
      { supersedes_id: r.id },
    )
    let [e] = buildReceptions([r, c])
    expect(e.corrected).toBe(true)
    expect(e.missingAction).toBe(true)
    expect(e.refused.map((i) => i.product)).toEqual(['Oeufs'])
    expect(diffReception(e.versions[0].payload, e.versions[1].payload, () => 'X')).toEqual([
      { label: 'Poulet — lot', before: 'A1', after: 'A2' },
      { label: 'Produit ajouté', before: '—', after: 'Oeufs' },
    ])
    const a = rec('corrective_action', '2026-11-14T08:20:00.000Z', { related_record_id: c.id, action: 'discard', comment: '' })
    ;[e] = buildReceptions([r, c, a])
    expect(e.missingAction).toBe(false)
    const s = summarizeReceptions([e], new Date('2026-11-14T10:00:00.000Z'), 'Europe/Paris')
    expect(s).toEqual({ last: r.device_time, today: 1, refusedThisWeek: 1, missingActions: 0 })
  })

  it('point d’extension rappel : recherche d’un lot dans les réceptions et les pertes', () => {
    const r = rec('reception', '2026-11-14T08:00:00.000Z', { ...base, items: [{ product: 'Steak', lot: 'L 2311A', storage: 'fridge', temperature_c: 2, accepted: true }] })
    const w = rec('waste', '2026-11-14T09:00:00.000Z', { product: 'Steak', lot: 'l2311a', reason: 'recall' })
    const found = findByLot(buildReceptions([r]), buildWastes([w]), 'L2311A')
    expect(found.receptions).toHaveLength(1)
    expect(found.wastes).toHaveLength(1)
  })
})
