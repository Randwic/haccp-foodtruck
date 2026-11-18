import { describe, expect, it } from 'vitest'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { normLot, parseRecallQuery, toWithdraw, traceRecall, withdrawalPayload, type RecallRecord } from './model.ts'

let seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const rec = (type: HaccpRecord['type'], time: string, payload: Record<string, unknown>, extra: Partial<RecallRecord> = {}): RecallRecord => ({
  id: extra.id ?? id(),
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
const GTIN = '3017620422003'
const reception = (items: Record<string, unknown>[], time = '2026-11-10T08:00:00.000Z', extra: Partial<RecallRecord> = {}) =>
  rec('reception', time, { supplier_id: S, vehicle_ok: true, packaging_ok: true, items }, extra)
const label = (p: Record<string, unknown>, time = '2026-11-11T08:00:00.000Z') =>
  rec('label_printed', time, { kind: 'prepared', name: 'Effiloché', made_at: time, dlc_at: '2026-11-14T08:00:00.000Z', allergens: [], storage: 'fridge', copies: 1, ...p })

describe('rappel produit', () => {
  it('recherche : lot, et code-barres si la clé est valide', () => {
    expect(parseRecallQuery(' l 2311a ')).toEqual({ lot: 'l 2311a', gtin: null })
    expect(parseRecallQuery('3 017620 422003')).toEqual({ lot: '3 017620 422003', gtin: GTIN })
    expect(normLot(' l 2311 a')).toBe('L2311A')
  })

  it('lot : réception, étiquettes faites avec (2 niveaux), pertes liées ; sans casse ni espaces', () => {
    const r1 = reception([
      { product: 'Porc', lot: 'L2311A', storage: 'fridge', accepted: true, temperature_c: 2 },
      { product: 'Salade', lot: 'X1', storage: 'fridge', accepted: true, temperature_c: 3 },
    ])
    const other = reception([{ product: 'Bœuf', lot: 'Z9', storage: 'fridge', accepted: true, temperature_c: 2 }])
    const l1 = label({ source_record_ids: [r1.id] })
    const l2 = label({ name: 'Burger porc', source_record_ids: [l1.id] }, '2026-11-12T08:00:00.000Z')
    const l3 = label({ name: 'Ouvert', kind: 'opened', lot: 'l2311a' })
    const unrelated = label({ name: 'Autre', source_record_ids: [other.id] })
    const w1 = rec('waste', '2026-11-13T08:00:00.000Z', { product: 'Effiloché', reason: 'expired', related_record_id: l1.id })
    const w2 = rec('waste', '2026-11-13T09:00:00.000Z', { product: 'Porc', reason: 'other', lot: 'L 2311A', comment: 'x' })
    const res = traceRecall([r1, other, l1, l2, l3, unrelated, w1, w2], parseRecallQuery('l2311a'))
    expect(res.receptions.map((h) => [h.entry.id, h.items.map((i) => i.product)])).toEqual([[r1.id, ['Porc']]])
    expect(res.labels.map((h) => [h.entry.payload.name, h.matchedBy]).sort()).toEqual([
      ['Burger porc', 'source_record'],
      ['Effiloché', 'source_record'],
      ['Ouvert', 'lot'],
    ])
    expect(res.wastes.map((h) => h.matchedBy).sort()).toEqual(['lot', 'related_record'])
    expect(toWithdraw(res.receptions[0]).map((i) => i.product)).toEqual(['Porc'])
  })

  it('correction qui change le lot : la réception reste trouvée ; quarantaine signalée', () => {
    const r1 = reception([{ product: 'Porc', lot: 'L2311A', storage: 'fridge', accepted: true, temperature_c: 2 }], undefined, { quarantine_reason: 'invalid_payload' })
    const c = rec('correction', '2026-11-10T09:00:00.000Z', { reason: 'faute de frappe', replacement: { ...r1.payload, items: [{ product: 'Porc', lot: 'L2311B', storage: 'fridge', accepted: true, temperature_c: 2 }] } }, { supersedes_id: r1.id })
    const res = traceRecall([r1, c], parseRecallQuery('L2311A'))
    expect(res.receptions).toHaveLength(1)
    expect(res.receptions[0].items[0].lot).toBe('L2311A')
    expect(res.receptions[0].quarantine).toBe('invalid_payload')
  })

  it('code-barres : lots reçus, lignes sans lot comptées, retrait noté ; refus jamais « à retirer »', () => {
    const r1 = reception([{ product: 'Nuggets', gtin: GTIN, lot: 'N1', storage: 'freezer', accepted: true, temperature_c: -19 }])
    const r2 = reception([{ product: 'Nuggets', gtin: '0' + GTIN, storage: 'freezer', accepted: true, temperature_c: -19 }], '2026-11-12T08:00:00.000Z')
    const r3 = reception([{ product: 'Nuggets', gtin: GTIN, lot: 'N2', storage: 'freezer', accepted: false, refusal_reason: 'Température' }], '2026-11-13T08:00:00.000Z')
    const l = label({ kind: 'opened', name: 'Nuggets', lot: 'N1' })
    const res0 = traceRecall([r1, r2, r3, l], parseRecallQuery(GTIN))
    expect(res0.lotsFound.sort()).toEqual(['N1', 'N2'])
    expect(res0.withoutLot).toBe(1)
    expect(res0.receptions.map((h) => h.matchedBy)).toEqual(['lot', 'gtin', 'lot'])
    expect(res0.labels).toHaveLength(1)
    const hit = res0.receptions.find((h) => h.entry.id === r1.id)!
    const payload = withdrawalPayload(hit, hit.items[0], '2 sachets', 'Rendu à Metro')
    expect(payload).toEqual({ product: 'Nuggets', reason: 'recall', related_record_id: r1.id, lot: 'N1', quantity: '2 sachets', comment: 'Rendu à Metro' })
    expect(validatePayload('waste', payload)).toEqual({ ok: true })
    const w = rec('waste', '2026-11-14T08:00:00.000Z', payload as unknown as Record<string, unknown>)
    const res = traceRecall([r1, r2, r3, l, w], parseRecallQuery(GTIN))
    expect(toWithdraw(res.receptions.find((h) => h.entry.id === r1.id)!)).toEqual([])
    expect(toWithdraw(res.receptions.find((h) => h.entry.id === r3.id)!)).toEqual([])
  })

  it('rien trouvé', () => {
    expect(traceRecall([], parseRecallQuery('ZZZ'))).toMatchObject({ receptions: [], labels: [], wastes: [] })
    expect(traceRecall([], parseRecallQuery('  '))).toMatchObject({ receptions: [] })
  })
})
