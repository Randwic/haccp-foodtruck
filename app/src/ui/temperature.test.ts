import { describe, expect, it } from 'vitest'
import { applyTemperatureKey, describeThreshold, formatTemperature, isInRange, textToTemperature, type TemperatureKey } from './temperature.ts'

const typeKeys = (keys: string) => {
  let text = ''
  for (const k of keys) {
    const next = applyTemperatureKey(text, k as TemperatureKey)
    if (next !== null) text = next
  }
  return text
}

describe('saisie au pavé numérique', () => {
  it('chiffres, virgule et signe', () => {
    expect(typeKeys('35')).toBe('35')
    expect(typeKeys('3,5')).toBe('3,5')
    expect(typeKeys('-18')).toBe('-18')
    expect(typeKeys('18-')).toBe('-18') // le signe se bascule à tout moment
    expect(typeKeys(',5')).toBe('0,5')
    expect(typeKeys('05')).toBe('5')
  })
  it('une décimale au plus, une seule virgule', () => {
    expect(typeKeys('3,55')).toBe('3,5')
    expect(typeKeys('3,,5')).toBe('3,5')
  })
  it('bornes −50..300', () => {
    expect(typeKeys('300')).toBe('300')
    expect(typeKeys('300,5')).toBe('300,')
    expect(typeKeys('3000')).toBe('300')
    expect(typeKeys('-51')).toBe('-5')
    expect(typeKeys('60-')).toBe('60') // −60 refusé
    expect(applyTemperatureKey('-50', ',')).toBe('-50,')
    expect(applyTemperatureKey('-50,', '1')).toBeNull()
  })
  it('valeur : vide ou incomplet = null', () => {
    expect(textToTemperature('')).toBeNull()
    expect(textToTemperature('-')).toBeNull()
    expect(textToTemperature('3,')).toBe(3)
    expect(textToTemperature('-0,5')).toBe(-0.5)
    expect(Object.is(textToTemperature('-0'), -0)).toBe(false)
  })
})

describe('seuils et formats', () => {
  it('conformité bornes incluses', () => {
    expect(isInRange(4, { min_c: null, max_c: 4 })).toBe(true)
    expect(isInRange(4.1, { min_c: null, max_c: 4 })).toBe(false)
    expect(isInRange(63, { min_c: 63, max_c: null })).toBe(true)
    expect(isInRange(-1, { min_c: 0, max_c: 4 })).toBe(false)
  })
  it('formats français avec vrai signe moins', () => {
    expect(formatTemperature(3.5)).toBe('3,5 °C')
    expect(formatTemperature(-18)).toBe('−18 °C')
    expect(describeThreshold({ min_c: null, max_c: 4 })).toBe('≤ 4 °C')
    expect(describeThreshold({ min_c: 0, max_c: 4 })).toBe('entre 0 °C et 4 °C')
  })
})
