import { describe, expect, it } from 'vitest'
import { appVersionLabel } from './appVersion.ts'

describe('version de l’application', () => {
  it('date et heure en français, rien si inconnue', () => {
    // Heure de l'appareil : le résultat attendu est calculé dans le même fuseau que celui des tests.
    const d = new Date('2026-11-27T16:50:00.000Z')
    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    expect(appVersionLabel(d.toISOString())).toBe(`${date} à ${time}`)
    expect(date).toMatch(/^\d{2}\/\d{2}\/2026$/)
    expect(appVersionLabel(null)).toBeNull()
    expect(appVersionLabel('n’importe quoi')).toBeNull()
  })
})
