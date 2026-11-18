import { describe, expect, it } from 'vitest'
import { canForget, noticeSections, recordSummary, registerTreatments, staffHistory } from './model.ts'

const ctx = { establishmentName: 'Space Diner', managerName: 'Cédric', managerEmail: null, retentionYears: 3 }

describe('RGPD', () => {
  it('note et registre reprennent l’établissement et la durée', () => {
    expect(noticeSections(ctx)[0].paragraphs?.[0]).toContain('Space Diner, représenté par Cédric')
    expect(noticeSections(ctx).flatMap((s) => s.bullets ?? []).join(' ')).toContain('gardées 3 ans')
    expect(registerTreatments(ctx)).toHaveLength(3)
  })
  it('historique lisible sans secret', () => {
    const h = staffHistory([
      { at: '2026-01-01T10:00:00Z', action: 'INSERT', old: null, new: { display_name: 'A', active: true } },
      { at: '2026-02-01T10:00:00Z', action: 'UPDATE', old: { active: true }, new: { active: true, _secrets_changed: ['pin_hash'] } },
      { at: '2026-03-01T10:00:00Z', action: 'UPDATE', old: { active: true }, new: { active: false } },
      { at: '2026-04-01T10:00:00Z', action: 'RGPD_FORGET', old: null, new: { display_name: 'Ancien équipier n° 1' } },
    ]).map((e) => e.label)
    expect(h).toEqual(['Compte créé', 'Code PIN changé', 'Compte désactivé (départ)', 'Données personnelles effacées (RGPD)'])
  })
  it('effacement : équipier parti seulement', () => {
    expect(canForget({ role: 'staff', active: false, forgotten_at: null })).toBe(true)
    expect(canForget({ role: 'staff', active: true, forgotten_at: null })).toBe(false)
    expect(canForget({ role: 'manager', active: false, forgotten_at: null })).toBe(false)
  })
  it('résumé d’une saisie', () => {
    expect(recordSummary({ payload: { product: 'Frigo', value_c: 3.5, comment: 'ok' } })).toBe('Frigo · 3,5 °C · ok')
  })
})
