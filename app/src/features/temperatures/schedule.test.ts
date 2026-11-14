import { describe, expect, it } from 'vitest'
import type { Equipment, HaccpRecord } from '../../../../shared/types.ts'
import { buildReadings } from './readings.ts'
import { currentSlot, enclosureStatuses, localDayKey, nextSlot, normalizeCheckTimes, startOfLocalDay, summarize, zonedTimeToDate } from './schedule.ts'

const TZ = 'Europe/Paris'
const iso = (d: Date | null) => d?.toISOString() ?? null

describe('créneaux (Europe/Paris)', () => {
  it('heure locale → UTC, hiver et été', () => {
    expect(iso(zonedTimeToDate({ year: 2026, month: 11, day: 14 }, 8, 0, TZ))).toBe('2026-11-14T07:00:00.000Z')
    expect(iso(zonedTimeToDate({ year: 2026, month: 7, day: 14 }, 8, 0, TZ))).toBe('2026-07-14T06:00:00.000Z')
  })

  it('passage à l’heure d’été (29/03/2026) : 08:00 = 06:00 UTC, 02:30 inexistant → 03:30', () => {
    const day = { year: 2026, month: 3, day: 29 }
    expect(iso(zonedTimeToDate(day, 8, 0, TZ))).toBe('2026-03-29T06:00:00.000Z')
    expect(iso(zonedTimeToDate({ year: 2026, month: 3, day: 28 }, 8, 0, TZ))).toBe('2026-03-28T07:00:00.000Z')
    expect(iso(zonedTimeToDate(day, 2, 30, TZ))).toBe('2026-03-29T01:30:00.000Z')
    expect(iso(zonedTimeToDate(day, 1, 30, TZ))).toBe('2026-03-29T00:30:00.000Z')
  })

  it('retour à l’heure d’hiver (25/10/2026) : 18:00 = 17:00 UTC, la veille 16:00 UTC', () => {
    expect(iso(zonedTimeToDate({ year: 2026, month: 10, day: 25 }, 18, 0, TZ))).toBe('2026-10-25T17:00:00.000Z')
    expect(iso(zonedTimeToDate({ year: 2026, month: 10, day: 24 }, 18, 0, TZ))).toBe('2026-10-24T16:00:00.000Z')
    // Le jour du changement dure 25 h.
    const start = startOfLocalDay(new Date('2026-10-25T12:00:00Z'), TZ)
    const next = startOfLocalDay(new Date('2026-10-26T12:00:00Z'), TZ)
    expect(next.getTime() - start.getTime()).toBe(25 * 3_600_000)
  })

  it('créneau en cours = le plus récent passé, sinon celui de la veille ; prochain créneau', () => {
    const times = ['18:00', '08:00']
    // 14/11 09:30 Paris (08:30 UTC)
    expect(iso(currentSlot(new Date('2026-11-14T08:30:00Z'), times, TZ))).toBe('2026-11-14T07:00:00.000Z')
    expect(iso(nextSlot(new Date('2026-11-14T08:30:00Z'), times, TZ))).toBe('2026-11-14T17:00:00.000Z')
    // 14/11 06:00 Paris : créneau de 18:00 la veille ; prochain 08:00
    expect(iso(currentSlot(new Date('2026-11-14T05:00:00Z'), times, TZ))).toBe('2026-11-13T17:00:00.000Z')
    expect(iso(nextSlot(new Date('2026-11-14T05:00:00Z'), times, TZ))).toBe('2026-11-14T07:00:00.000Z')
    // 23:30 Paris : prochain = demain 08:00
    expect(iso(nextSlot(new Date('2026-11-14T22:30:00Z'), times, TZ))).toBe('2026-11-15T07:00:00.000Z')
    // Minuit UTC ≠ minuit Paris : 00:30 Paris le 15 = 23:30 UTC le 14
    expect(localDayKey(new Date('2026-11-14T23:30:00Z'), TZ)).toBe('2026-11-15')
    expect(currentSlot(new Date(), [], TZ)).toBeNull()
  })

  it('report du créneau oublié désactivé : rien à faire avant le premier créneau du jour', () => {
    const times = ['08:00', '18:00']
    // 14/11 06:00 Paris : pas de report → aucun créneau en cours
    expect(currentSlot(new Date('2026-11-14T05:00:00Z'), times, TZ, false)).toBeNull()
    // Après 08:00, comportement identique
    expect(iso(currentSlot(new Date('2026-11-14T08:30:00Z'), times, TZ, false))).toBe('2026-11-14T07:00:00.000Z')
    const now = new Date('2026-11-14T05:00:00Z')
    const input = { equipment: [eq('F1')], readings: [], now, checkTimes: times, timeZone: TZ }
    expect(summarize(enclosureStatuses(input)).due).toBe(1)
    expect(summarize(enclosureStatuses({ ...input, carryOver: false })).due).toBe(0)
  })

  it('heures normalisées : valides, uniques, triées', () => {
    expect(normalizeCheckTimes(['18:00', '8:00', '08:00', '25:00', '08:00'])).toEqual(['08:00', '18:00'])
  })
})

const eq = (id: string, kind: Equipment['kind'] = 'fridge', active = true): Equipment => ({ id, name: id, kind, active, updated_at: '' })
let seq = 0
const rec = (type: HaccpRecord['type'], device_time: string, payload: Record<string, unknown>, supersedes_id: string | null = null): HaccpRecord => {
  seq++
  return { id: `r${seq}`, type, payload, author_id: 'a', device_id: 'd', device_seq: seq, device_time, prev_hash: '', hash: '', supersedes_id }
}

describe('statut des enceintes', () => {
  it('à faire / fait selon le créneau en cours ; hors seuil sans action = action manquante', () => {
    const now = new Date('2026-11-14T08:30:00Z') // 09:30 Paris, créneau 08:00 (07:00 UTC)
    const f1 = rec('temperature_check', '2026-11-14T07:05:00.000Z', { equipment_id: 'F1', value_c: 3, source: 'manual', in_range: true })
    const f2 = rec('temperature_check', '2026-11-14T06:55:00.000Z', { equipment_id: 'F2', value_c: 3, source: 'manual', in_range: true }) // avant le créneau
    const c1 = rec('temperature_check', '2026-11-14T07:10:00.000Z', { equipment_id: 'C', value_c: -10, source: 'manual', in_range: false })
    const readings = buildReadings([f1, f2, c1])
    const statuses = enclosureStatuses({
      equipment: [eq('F1'), eq('F2'), eq('C', 'freezer'), eq('Friteuse', 'fryer_vat'), eq('Vieux', 'fridge', false)],
      readings,
      now,
      checkTimes: ['08:00', '18:00'],
      timeZone: TZ,
    })
    expect(statuses.map((s) => [s.equipment.id, s.state])).toEqual([
      ['F1', 'done'],
      ['F2', 'due'],
      ['C', 'done'],
    ])
    expect(summarize(statuses)).toEqual({ enclosures: 3, due: 1, missingActions: 1 })

    // Action corrective faite → plus manquante.
    const action = rec('corrective_action', '2026-11-14T07:12:00.000Z', { related_record_id: c1.id, action: 'adjust_equipment', comment: '' })
    const after = enclosureStatuses({ equipment: [eq('C', 'freezer')], readings: buildReadings([c1, action]), now, checkTimes: ['08:00'], timeZone: TZ })
    expect(summarize(after).missingActions).toBe(0)
  })
})
