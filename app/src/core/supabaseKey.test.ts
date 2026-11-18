import { describe, expect, it } from 'vitest'
import { isLegacyJwtKey, publicKeyHeaders } from './supabaseKey.ts'

describe('clé publique Supabase', () => {
  it('ancienne clé anon (JWT) : apikey + Authorization', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abc_DEF-123'
    expect(isLegacyJwtKey(jwt)).toBe(true)
    expect(publicKeyHeaders(jwt)).toEqual({ apikey: jwt, Authorization: `Bearer ${jwt}` })
  })
  it('nouvelle clé publishable : apikey seulement', () => {
    expect(isLegacyJwtKey('sb_publishable_AbC123')).toBe(false)
    expect(publicKeyHeaders('sb_publishable_AbC123')).toEqual({ apikey: 'sb_publishable_AbC123' })
  })
})
