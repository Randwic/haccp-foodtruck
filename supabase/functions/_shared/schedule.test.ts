// @vitest-environment node
// La copie serveur des créneaux doit rester identique à celle de l'app (règle de report comprise).
import { describe, expect, it } from 'vitest'
import { currentSlot as appCurrentSlot } from '../../../app/src/features/temperatures/schedule.ts'
import { currentSlot, formatLocalMoment, safeTimeZone } from './schedule.ts'

describe('schedule (serveur) ≡ schedule (app)', () => {
  it('currentSlot identique sur 3 jours autour des changements d’heure, avec et sans report', () => {
    const times = ['07:30', '12:00', '18:00', '02:30']
    for (const start of ['2026-03-28T00:00:00.000Z', '2026-10-24T00:00:00.000Z', '2026-11-14T00:00:00.000Z']) {
      for (let m = 0; m < 3 * 24 * 60; m += 17) {
        const now = new Date(Date.parse(start) + m * 60_000)
        for (const carry of [true, false]) {
          expect(currentSlot(now, times, 'Europe/Paris', carry)?.toISOString() ?? null).toBe(appCurrentSlot(now, times, 'Europe/Paris', carry)?.toISOString() ?? null)
        }
      }
    }
  })
  it('formatLocalMoment, fuseau invalide → Europe/Paris', () => {
    const now = new Date('2026-11-14T10:00:00.000Z')
    expect(formatLocalMoment(new Date('2026-11-14T07:00:00.000Z'), now, 'Europe/Paris')).toBe('08:00')
    expect(formatLocalMoment(new Date('2026-11-13T17:00:00.000Z'), now, 'Europe/Paris')).toBe('hier 18:00')
    expect(formatLocalMoment(new Date('2026-11-10T17:00:00.000Z'), now, 'Europe/Paris')).toBe('10/11 18:00')
    expect(safeTimeZone('Mars/Olympus')).toBe('Europe/Paris')
    expect(safeTimeZone('America/Montreal')).toBe('America/Montreal')
  })
})
