import { describe, expect, it } from 'vitest'
import { appVersionLabel } from './appVersion.ts'

describe('version de l’application', () => {
  it('date et heure en français, rien si inconnue', () => {
    expect(appVersionLabel('2026-11-27T16:50:00.000Z')).toMatch(/^27\/11\/2026 à \d{2}:50$/)
    expect(appVersionLabel(null)).toBeNull()
    expect(appVersionLabel('n’importe quoi')).toBeNull()
  })
})
