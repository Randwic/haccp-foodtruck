// PIN équipier : PBKDF2-SHA256 via WebCrypto, vérifiable hors-ligne.
import { PIN_PBKDF2_ITERATIONS } from '../../../shared/types.ts'

export const PIN_SALT_BYTES = 16
export const PIN_KEY_BYTES = 32
/** Nombre d'échecs consécutifs avant verrouillage temporaire. */
export const PIN_MAX_FAILURES = 5
/** Durée du verrouillage après PIN_MAX_FAILURES échecs. */
export const PIN_LOCKOUT_MS = 5 * 60 * 1000

const PIN_FORMAT = /^\d{4,6}$/

export function isValidPinFormat(pin: string): boolean {
  return PIN_FORMAT.test(pin)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    PIN_KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/** Comparaison à temps constant (ne s'arrête pas au premier octet différent). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** Calcule sel + empreinte d'un nouveau PIN (écran gérant). */
export async function hashPin(pin: string): Promise<{ pin_salt: string; pin_hash: string }> {
  if (!isValidPinFormat(pin)) throw new Error('Le PIN doit comporter 4 à 6 chiffres')
  const salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES))
  const hash = await derive(pin, salt, PIN_PBKDF2_ITERATIONS)
  return { pin_salt: bytesToBase64(salt), pin_hash: bytesToBase64(hash) }
}

/** Vérifie un PIN contre { pin_salt, pin_hash } (base64). Toute donnée invalide => false. */
export async function verifyPin(pin: string, ref: { pin_salt: string; pin_hash: string }): Promise<boolean> {
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = base64ToBytes(ref.pin_salt)
    expected = base64ToBytes(ref.pin_hash)
  } catch {
    return false
  }
  const actual = await derive(pin, salt, PIN_PBKDF2_ITERATIONS)
  return constantTimeEqual(actual, expected)
}
