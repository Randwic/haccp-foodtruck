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
