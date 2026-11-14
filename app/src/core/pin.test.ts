import { describe, expect, it } from 'vitest'
import { DEMO_PINS, DEMO_STAFF } from './mockTransport.ts'
import { base64ToBytes, constantTimeEqual, hashPin, isValidPinFormat, verifyPin } from './pin.ts'

describe('PIN PBKDF2', () => {
  it('les PIN de démonstration correspondent aux vrais hash', async () => {
    expect(await verifyPin(DEMO_PINS.manager, DEMO_STAFF[0])).toBe(true)
    expect(await verifyPin(DEMO_PINS.staff, DEMO_STAFF[1])).toBe(true)
    expect(await verifyPin(DEMO_PINS.staff, DEMO_STAFF[0])).toBe(false)
  })

  it('hashPin produit un sel de 16 octets et une clé de 32 octets vérifiables', async () => {
    const h = await hashPin('4821')
    expect(base64ToBytes(h.pin_salt)).toHaveLength(16)
    expect(base64ToBytes(h.pin_hash)).toHaveLength(32)
    expect(await verifyPin('4821', h)).toBe(true)
    expect(await verifyPin('4822', h)).toBe(false)
    const h2 = await hashPin('4821')
    expect(h2.pin_salt).not.toBe(h.pin_salt) // sel aléatoire
  })

  it('refuse un format de PIN invalide et des données corrompues', async () => {
    expect(isValidPinFormat('123')).toBe(false)
    expect(isValidPinFormat('1234567')).toBe(false)
    expect(isValidPinFormat('12a4')).toBe(false)
    await expect(hashPin('12')).rejects.toThrow()
    expect(await verifyPin('1234', { pin_salt: '%%%', pin_hash: '%%%' })).toBe(false)
  })

  it('comparaison à temps constant', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false)
  })
})
