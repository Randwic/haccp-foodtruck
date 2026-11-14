// Aides pures de l'espace gérant (testables sans DOM).
import type { EquipmentKind, RecordType } from '../../../shared/types.ts'

/** Nom proposé pour l'appareil : « iPad », « iPhone »… (modifiable par l'utilisateur). */
export function guessDeviceName(
  nav: { userAgent: string; maxTouchPoints?: number } | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): string {
  if (!nav) return 'Appareil'
  const ua = nav.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android'
  return 'Ordinateur'
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** Indicateur simple : longueur d'abord (≥ 12 obligatoire), puis variété des caractères. */
export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return { score: 0, label: '' }
  if (pw.length < 12) return { score: 1, label: `Trop court (${pw.length}/12)` }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (new Set(pw).size < 5) return { score: 1, label: 'Trop simple' }
  let score: 2 | 3 | 4 = 2
  if (pw.length >= 16 || classes >= 3) score = 3
  if (pw.length >= 20 || (pw.length >= 14 && classes >= 3)) score = 4
  return { score, label: score === 2 ? 'Correct' : score === 3 ? 'Bon' : 'Excellent' }
}

export const EQUIPMENT_KINDS: { kind: EquipmentKind; label: string }[] = [
  { kind: 'fridge', label: 'Frigo' },
  { kind: 'freezer', label: 'Congélateur' },
  { kind: 'fryer_vat', label: 'Bac de friteuse' },
  { kind: 'hot_holding', label: 'Maintien au chaud' },
  { kind: 'other', label: 'Autre' },
]

export function kindLabel(kind: EquipmentKind): string {
  return EQUIPMENT_KINDS.find((k) => k.kind === kind)?.label ?? kind
}

/** Type de contrôle auquel s'applique le seuil principal d'un équipement. */
export function checkTypeFor(kind: EquipmentKind): RecordType {
  return kind === 'hot_holding' ? 'hot_holding' : 'temperature_check'
}

/** Seuils proposés par défaut (GBPH / arrêté du 21/12/2009) — à confirmer selon le PMS. */
export function defaultThreshold(kind: EquipmentKind): { min_c: number | null; max_c: number | null; tolerance_minutes: number } | null {
  switch (kind) {
    case 'fridge':
      return { min_c: null, max_c: 4, tolerance_minutes: 20 }
    case 'freezer':
      return { min_c: null, max_c: -18, tolerance_minutes: 30 }
    case 'hot_holding':
      return { min_c: 63, max_c: null, tolerance_minutes: 0 }
    default:
      return null
  }
}

/** Lit une température saisie (« -18 », « 3,5 », « −18 »). null si vide ; NaN si illisible. */
export function parseTemperature(s: string): number | null {
  const v = s.trim().replace(',', '.').replace(/[−–]/g, '-').replace(/\s/g, '')
  if (v === '') return null
  if (!/^[-+]?\d+(\.\d)?$/.test(v)) return Number.NaN
  return Number(v)
}

export function formatTemperature(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace('-', '−')} °C`
}

const EMAIL_KEY = 'haccp.manager.email'
/** Mémorise l'email du gérant pour préremplir la reconnexion (jamais le mot de passe). */
export function rememberManagerEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase())
  } catch {
    /* stockage indisponible */
  }
}
export function lastManagerEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function thresholdSummary(t: { min_c: number | null; max_c: number | null; tolerance_minutes: number } | undefined): string {
  if (!t) return 'Aucun seuil'
  const parts: string[] = []
  if (t.min_c !== null && t.max_c !== null) parts.push(`${formatTemperature(t.min_c)} à ${formatTemperature(t.max_c)}`)
  else if (t.max_c !== null) parts.push(`max ${formatTemperature(t.max_c)}`)
  else if (t.min_c !== null) parts.push(`min ${formatTemperature(t.min_c)}`)
  if (t.tolerance_minutes > 0) parts.push(`tolérance ${t.tolerance_minutes} min`)
  return parts.join(' · ')
}
