import { describe, expect, it } from 'vitest'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { buildReadings } from './readings.ts'

let seq = 0
const rec = (type: HaccpRecord['type'], minute: number, payload: Record<string, unknown>, supersedes_id: string | null = null): HaccpRecord => {
  seq++
  return {
    id: `r${seq}`,
    type,
    payload,
    author_id: 'a',
    device_id: 'd',
    device_seq: seq,
    device_time: new Date(Date.UTC(2026, 10, 14, 8, minute)).toISOString(),
    prev_hash: '',
    hash: '',
    supersedes_id,
  }
}
const tc = (v: number, inRange: boolean) => ({ equipment_id: 'F1', value_c: v, source: 'manual', in_range: inRange })

describe('reconstruction des relevés', () => {
  it('corrections en chaîne rattachées à l’original, valeur en vigueur = dernière', () => {
    const orig = rec('temperature_check', 0, tc(35, false))
    const c1 = rec('correction', 1, { reason: 'Erreur de frappe', replacement: tc(5, false) }, orig.id)
    const c2 = rec('correction', 2, { reason: 'Mal lu', replacement: tc(3.5, true) }, c1.id)
    const [r] = buildReadings([c2, orig, c1])
    expect(r.id).toBe(orig.id)
    expect(r.versions.map((v) => v.value_c)).toEqual([35, 5, 3.5])
    expect(r.value_c).toBe(3.5)
    expect(r.latest.id).toBe(c2.id)
    expect(r.corrected).toBe(true)
    expect(r.missingAction).toBe(false)
  })

  it('action corrective liée à une correction : compte pour le relevé', () => {
    const orig = rec('temperature_check', 0, tc(3, true))
    const c1 = rec('correction', 1, { reason: 'x', replacement: tc(8, false) }, orig.id)
    expect(buildReadings([orig, c1])[0].missingAction).toBe(true)
    const a = rec('corrective_action', 2, { related_record_id: c1.id, action: 'discard', comment: '' })
    const [r] = buildReadings([orig, c1, a])
    expect(r.missingAction).toBe(false)
    expect(r.correctiveActions.map((x) => x.id)).toEqual([a.id])
  })

  it('ignore les payloads illisibles et les corrections orphelines', () => {
    const bad = rec('temperature_check', 0, { foo: 1 })
    const orphan = rec('correction', 1, { reason: 'x', replacement: tc(2, true) }, 'inconnu')
    expect(buildReadings([bad, orphan])).toEqual([])
  })
})
