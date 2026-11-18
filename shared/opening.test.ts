import { describe, expect, it } from 'vitest'
import { formatOpeningDate, isBeforeOpening, isValidOpeningDate, localDayKey } from './opening.ts'

describe('date d’ouverture', () => {
  it('format AAAA-MM-JJ et date réelle', () => {
    expect(isValidOpeningDate('2027-03-01')).toBe(true)
    expect(isValidOpeningDate('2027-02-30')).toBe(false)
    expect(isValidOpeningDate('01/03/2027')).toBe(false)
    expect(isValidOpeningDate(null)).toBe(false)
  })

  it('pause jusqu’à la veille de l’ouverture, heure de Paris', () => {
    const tz = 'Europe/Paris'
    expect(isBeforeOpening('2027-03-01', new Date('2026-11-18T17:00:00Z'), tz)).toBe(true)
    // 28 février 23:30 à Paris = 22:30 UTC : encore en pause
    expect(isBeforeOpening('2027-03-01', new Date('2027-02-28T22:30:00Z'), tz)).toBe(true)
    // 1er mars 00:30 à Paris = 23:30 UTC la veille : ouvert
    expect(isBeforeOpening('2027-03-01', new Date('2027-02-28T23:30:00Z'), tz)).toBe(false)
    expect(isBeforeOpening(null, new Date('2026-11-18T17:00:00Z'), tz)).toBe(false)
    expect(localDayKey(new Date('2027-02-28T23:30:00Z'), tz)).toBe('2027-03-01')
  })

  it('affichage en français', () => {
    expect(formatOpeningDate('2027-03-01')).toBe('1er mars 2027')
    expect(formatOpeningDate('2027-03-15')).toBe('15 mars 2027')
  })
})
