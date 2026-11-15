// Primitives cryptographiques (WebCrypto : Deno, navigateur, Node 20+).

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

/** Jeton d'appareil : 32 octets aléatoires → 43 caractères base64url. */
export const DEVICE_TOKEN_BYTES = 32
export const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** Décode du base64url (ou base64 standard, avec ou sans « = ») ; null si invalide. */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_+/-]*={0,2}$/.test(s)) return null
  const std = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (std.length % 4 === 1) return null
  let bin: string
  try {
    bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  } catch {
    return null
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Concatène des tableaux d'octets. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

/** Comparaison de secrets à durée indépendante du contenu (comparaison des empreintes SHA-256). */
export async function secretsEqual(given: string, expected: string): Promise<boolean> {
  if (given.length === 0) return false
  return (await sha256Hex(given)) === (await sha256Hex(expected))
}
