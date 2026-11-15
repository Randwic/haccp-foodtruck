// Saisie d'un nombre positif au pavé numérique (texte intermédiaire « 23, »…) : fonctions pures.
// Utilisé par `NumberPad` (ex. composés polaires 0..50 %, une décimale).

export type NumberKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'backspace' | 'clear'

export interface NumberRules {
  min: number
  max: number
  /** Décimales autorisées (0 = entier). */
  decimals: number
}

/** Texte → valeur (null si vide). « 23, » → 23 ; arrondi aux décimales autorisées. */
export function textToNumber(text: string, decimals = 1): number | null {
  const t = text.replace(',', '.')
  if (t === '' || t === '.') return null
  const n = Number(t.endsWith('.') ? t.slice(0, -1) : t)
  if (!Number.isFinite(n)) return null
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Valeur → texte : 23.5 → « 23,5 ». */
export function numberToText(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ''
  return String(v).replace('.', ',')
}

/** Nombre au format français (« 23,5 »), décimales significatives seulement. */
export function formatNumber(v: number, decimals = 1): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(v)
}

/**
 * Applique une touche. Renvoie le nouveau texte, ou null si la touche est refusée
 * (décimale de trop, virgule interdite, valeur au-delà de `max`).
 */
export function applyNumberKey(text: string, key: NumberKey, rules: NumberRules): string | null {
  if (key === 'clear') return ''
  if (key === 'backspace') return text.slice(0, -1)
  const [intPart, decPart] = text.split(',') as [string, string | undefined]
  let next: string
  if (key === ',') {
    if (rules.decimals === 0 || decPart !== undefined) return null
    next = `${intPart === '' ? '0' : intPart},`
  } else if (decPart !== undefined) {
    if (decPart.length >= rules.decimals) return null
    next = text + key
  } else if (intPart === '0') {
    next = key
  } else {
    next = text + key
  }
  const v = textToNumber(next, rules.decimals)
  if (v !== null && v > rules.max) return null
  return next
}

/** La valeur saisie respecte-t-elle les bornes (min compris) ? */
export function isWithin(v: number | null, rules: NumberRules): v is number {
  return v !== null && v >= rules.min && v <= rules.max
}
