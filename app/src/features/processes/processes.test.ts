import { describe, expect, it } from 'vitest'
import type { HaccpRecord, Threshold } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { buildSpotChecks, buildThawBatches, buildTimedBatches, recentProducts } from './entries.ts'
import { newlyOverdue } from './notifications.ts'
import { ruleForBatch, spotRule, timedRule } from './thresholds.ts'
import { MENU_PRODUCTS } from '../../core/demoMenu.ts'
import { countdown, defaultDlc, elapsedMinutes, evaluateEnd, formatMinutes, remainingLabel, summarizeTimed } from './timing.ts'

let seq = 0
const rec = (type: HaccpRecord['type'], device_time: string, payload: Record<string, unknown>, supersedes_id: string | null = null, id?: string): HaccpRecord => {
  seq++
  return { id: id ?? `r${seq}`, type, payload, author_id: 'a', device_id: 'd', device_seq: seq, device_time, prev_hash: '', hash: '', supersedes_id }
}
const th = (check_type: Threshold['check_type'], min_c: number | null, max_c: number | null, tolerance_minutes: number): Threshold => ({
  id: `t-${check_type}`,
  equipment_id: null,
  check_type,
  min_c,
  max_c,
  tolerance_minutes,
  updated_at: '',
})
// Libellés comparés avec des espaces ordinaires (les insécables évitent les coupures à l’écran).
const lbl = (c: Parameters<typeof remainingLabel>[0]) => remainingLabel(c).replace(/\u00a0/g, ' ')
const B1 = '11111111-1111-4111-8111-111111111111'

describe('seuils des procédés', () => {
  it('générique sinon défauts du contrat ; durée dans tolerance_minutes (0 = défaut)', () => {
    expect(timedRule('cooling', [])).toEqual({ kind: 'cooling', start: { min_c: 63, max_c: null }, target: { min_c: null, max_c: 10 }, maxMinutes: 120, isDefault: true })
    expect(timedRule('cooling', [th('cooling', null, 8, 90)])).toMatchObject({ target: { max_c: 8 }, maxMinutes: 90, isDefault: false })
    expect(timedRule('cooling', [th('cooling', null, 10, 0)])).toMatchObject({ maxMinutes: 120, isDefault: true })
    expect(timedRule('reheating', [th('reheating', 65, null, 45)])).toMatchObject({ start: null, target: { min_c: 65, max_c: null }, maxMinutes: 45, isDefault: false })
    // Un seuil propre à un équipement n'est pas le seuil générique.
    expect(spotRule('cooking_check', [{ ...th('cooking_check', 75, null, 0), equipment_id: 'x' }])).toEqual({ kind: 'cooking_check', threshold: { min_c: 70, max_c: null }, isDefault: true })
    expect(spotRule('hot_holding', [th('hot_holding', 65, null, 0)])).toMatchObject({ threshold: { min_c: 65 }, isDefault: false })
  })
})

describe('délais et conformité', () => {
  const rule = timedRule('cooling', [])
  it('fin : objectif ET délai, durée arrondie à la minute supérieure', () => {
    const start = '2026-11-14T10:00:00.000Z'
    expect(evaluateEnd({ startedAt: start, endedAt: '2026-11-14T11:50:00.000Z', value_c: 8, rule })).toMatchObject({ in_range: true, duration_min: 110 })
    expect(evaluateEnd({ startedAt: start, endedAt: '2026-11-14T12:00:00.000Z', value_c: 10, rule })).toMatchObject({ in_range: true, duration_min: 120 })
    expect(evaluateEnd({ startedAt: start, endedAt: '2026-11-14T12:00:01.000Z', value_c: 9, rule })).toMatchObject({ in_range: false, duration_min: 121, withinTime: false, targetReached: true })
    expect(evaluateEnd({ startedAt: start, endedAt: '2026-11-14T11:00:00.000Z', value_c: 12, rule })).toMatchObject({ in_range: false, targetReached: false, withinTime: true })
    // Lot oublié plus de 24 h : durée bornée à la limite du contrat, payload toujours valide.
    const late = evaluateEnd({ startedAt: start, endedAt: '2026-11-16T10:00:00.000Z', value_c: 4, rule })
    expect(late).toMatchObject({ in_range: false, duration_min: 1440 })
    expect(validatePayload('cooling', { batch_id: B1, step: 'end', product: 'Riz', value_c: 4, source: 'manual', in_range: late.in_range, duration_min: late.duration_min }).ok).toBe(true)
    expect(elapsedMinutes(start, '2026-11-14T09:00:00.000Z')).toBe(0)
  })

  it('chronomètre : vert, ambre dans le dernier quart (30 min sur 2 h), rouge une fois dépassé', () => {
    const start = '2026-11-14T10:00:00.000Z'
    const at = (iso: string) => countdown(start, rule, new Date(iso))
    expect(at('2026-11-14T10:48:00.000Z')).toMatchObject({ urgency: 'ok', progress: 0.4 })
    expect(lbl(at('2026-11-14T10:48:00.000Z'))).toBe('1 h 12 restante')
    expect(at('2026-11-14T11:31:00.000Z').urgency).toBe('soon')
    expect(lbl(at('2026-11-14T11:31:00.000Z'))).toBe('29 min restantes')
    expect(lbl(at('2026-11-14T10:00:00.000Z'))).toBe('2 h restantes')
    expect(at('2026-11-14T12:08:00.000Z')).toMatchObject({ urgency: 'overdue', progress: 1 })
    expect(lbl(at('2026-11-14T12:08:00.000Z'))).toBe('dépassé de 8 min')
    expect(formatMinutes(90 * 60_000)).toBe('1\u00a0h\u00a030')
    // Écoulé + restant = délai, avec les minutes arrondies au-dessus (comme duration_min).
    const mid = at('2026-11-14T10:47:30.000Z')
    expect([mid.elapsedMin, lbl(mid)]).toEqual([48, '1 h 12 restante'])
    expect(at('2026-11-14T12:00:00.000Z').urgency).toBe('soon') // échéance incluse
    expect(lbl(at('2026-11-14T12:00:00.000Z'))).toBe('moins d’1 min restante')
    expect(lbl(at('2026-11-14T12:00:20.000Z'))).toBe('dépassé de 1 min')
  })

  it('DLC par défaut : date locale de fin + N jours', () => {
    // 23:30 à Paris le 14 = 22:30 UTC : la DLC part du 14 (jour local), pas du 15.
    expect(defaultDlc(new Date('2026-11-14T22:30:00Z'), 'Europe/Paris', 3)).toBe('2026-11-17')
    expect(defaultDlc(new Date('2026-11-14T23:30:00Z'), 'Europe/Paris', 3)).toBe('2026-11-18')
    expect(defaultDlc(new Date('2026-11-14T10:00:00Z'), 'Europe/Paris', 0)).toBe('2026-11-14')
  })
})

describe('reconstruction des lots', () => {
  const start = rec('cooling', '2026-11-14T10:00:00.000Z', { batch_id: B1, step: 'start', product: 'Chili', value_c: 75, source: 'manual' })
  const check = rec('cooling', '2026-11-14T11:00:00.000Z', { batch_id: B1, step: 'check', product: 'Chili', value_c: 25, source: 'manual' })
  const end = rec('cooling', '2026-11-14T12:30:00.000Z', { batch_id: B1, step: 'end', product: 'Chili', value_c: 12, source: 'manual', in_range: false, duration_min: 150 })

  it('lot en cours puis clos ; action corrective manquante tant qu’elle n’est pas faite', () => {
    const [running] = buildTimedBatches([check, start], 'cooling')
    expect(running).toMatchObject({ batchId: B1, product: 'Chili', running: true, inRange: null, missingAction: false })
    expect(running.steps.map((s) => s.payload.step)).toEqual(['start', 'check'])

    const [closed] = buildTimedBatches([start, check, end], 'cooling')
    expect(closed).toMatchObject({ running: false, inRange: false, durationMin: 150, missingAction: true })
    const action = rec('corrective_action', '2026-11-14T12:31:00.000Z', { related_record_id: end.id, action: 'discard', comment: '' })
    expect(buildTimedBatches([start, check, end, action], 'cooling')[0].missingAction).toBe(false)
    // Un autre type de procédé n'est pas mélangé.
    expect(buildTimedBatches([start, check, end], 'reheating')).toEqual([])
  })

  it('correction d’une étape (en chaîne) ; action liée à la correction', () => {
    const c1 = rec('correction', '2026-11-14T12:40:00.000Z', { reason: 'Erreur', replacement: { ...end.payload, value_c: 11 } }, end.id)
    const c2 = rec('correction', '2026-11-14T12:41:00.000Z', { reason: 'Mal lu', replacement: { ...end.payload, value_c: 9, in_range: false } }, c1.id)
    const action = rec('corrective_action', '2026-11-14T12:42:00.000Z', { related_record_id: c2.id, action: 'discard', comment: '' })
    const [b] = buildTimedBatches([start, end, c1, c2, action], 'cooling')
    expect(b.end!.versions.map((v) => v.payload.value_c)).toEqual([12, 11, 9])
    expect(b.end!.latest.id).toBe(c2.id)
    expect(b.end!.payload.value_c).toBe(9)
    expect(b.missingAction).toBe(false)
  })

  it('décongélation : en cours, puis DLC (corrigée)', () => {
    const s = rec('thawing', '2026-11-13T18:00:00.000Z', { batch_id: B1, step: 'start', product: 'Steaks', equipment_id: 'F1' })
    expect(buildThawBatches([s])[0]).toMatchObject({ running: true, dlc: null, equipmentId: 'F1' })
    const e = rec('thawing', '2026-11-14T08:00:00.000Z', { batch_id: B1, step: 'end', product: 'Steaks', equipment_id: 'F1', dlc: '2026-11-17' })
    const c = rec('correction', '2026-11-14T08:05:00.000Z', { reason: 'Erreur de date', replacement: { ...e.payload, dlc: '2026-11-16' } }, e.id)
    expect(buildThawBatches([s, e, c])[0]).toMatchObject({ running: false, dlc: '2026-11-16' })
  })

  it('mesures ponctuelles : hors seuil sans action = action manquante', () => {
    const h = rec('hot_holding', '2026-11-14T12:00:00.000Z', { product: 'Chili', value_c: 58, source: 'manual', in_range: false })
    const k = rec('cooking_check', '2026-11-14T12:05:00.000Z', { product: 'Steak haché', value_c: 72, source: 'manual', in_range: true })
    const list = buildSpotChecks([h, k])
    expect(list.map((e) => [e.kind, e.missingAction])).toEqual([
      ['cooking_check', false],
      ['hot_holding', true],
    ])
  })

  it('produits récents : plus récents d’abord, sans doublon, complétés par les défauts', () => {
    expect(
      recentProducts(
        [
          { product: 'Riz', time: '2026-11-13' },
          { product: 'chili ', time: '2026-11-14' },
          { product: 'Chili', time: '2026-11-12' },
        ],
        ['Riz', 'Soupe'],
      ),
    ).toEqual(['chili', 'Riz', 'Soupe'])
  })

  it('compteurs et échéances signalées une seule fois', () => {
    const rule = timedRule('cooling', [])
    const batches = buildTimedBatches([start, check], 'cooling')
    const now = new Date('2026-11-14T12:05:00.000Z')
    expect(summarizeTimed(batches, rule, now)).toMatchObject({ running: 1, overdue: 1, missingActions: 0 })
    expect(newlyOverdue(batches, rule, now, new Set()).map((b) => b.batchId)).toEqual([B1])
    expect(newlyOverdue(batches, rule, now, new Set([B1]))).toEqual([])
    expect(newlyOverdue(batches, rule, new Date('2026-11-14T11:00:00.000Z'), new Set())).toEqual([])
  })
})

describe('remise en température : cuisson à cœur du produit', () => {
  const generic = timedRule('reheating', [])
  it('objectif relevé à 74 °C pour le poulet (catalogue), 63 °C sinon ; refroidissement inchangé', () => {
    expect(generic.target.min_c).toBe(63)
    const chicken = ruleForBatch(generic, 'nuggets de poulet', MENU_PRODUCTS)
    expect(chicken.target).toEqual({ min_c: 74, max_c: null })
    expect(chicken.product?.name).toBe('Nuggets de poulet')
    expect(ruleForBatch(generic, 'Porc effiloché BBQ', MENU_PRODUCTS)).toMatchObject({ target: { min_c: 63 }, product: null })
    expect(ruleForBatch(generic, 'Chili maison', MENU_PRODUCTS).product).toBeNull()
    expect(ruleForBatch(timedRule('cooling', []), 'Nuggets de poulet', MENU_PRODUCTS).target).toEqual(timedRule('cooling', []).target)
  })
  it('fin à 70 °C : conforme au seuil général, non conforme pour le poulet', () => {
    const start = new Date('2026-11-14T10:00:00.000Z')
    const end = new Date('2026-11-14T10:30:00.000Z')
    expect(evaluateEnd({ startedAt: start.toISOString(), endedAt: end, value_c: 70, rule: generic }).targetReached).toBe(true)
    expect(evaluateEnd({ startedAt: start.toISOString(), endedAt: end, value_c: 70, rule: ruleForBatch(generic, 'Nuggets de poulet', MENU_PRODUCTS) }).targetReached).toBe(false)
  })
})
