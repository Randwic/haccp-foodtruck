// Températures : bornes du contrat, conformité à un seuil et formats d'affichage (fonctions pures).
// Réutilisé par TemperatureInput, le module Températures et les procédés (refroidissement…).

/** Plage acceptée par le contrat (shared/payloads.ts) : −50..300 °C, 1 décimale max. */
export const TEMPERATURE_MIN_C = -50
export const TEMPERATURE_MAX_C = 300

/** Seuil d'un contrôle : borne basse et/ou haute (null = pas de borne). */
export interface TemperatureThreshold {
  min_c: number | null
  max_c: number | null
}

/** Conforme si min_c ≤ v ≤ max_c (bornes incluses ; une borne null est ignorée). */
export function isInRange(value: number, threshold: TemperatureThreshold): boolean {
  if (threshold.min_c !== null && value < threshold.min_c) return false
  if (threshold.max_c !== null && value > threshold.max_c) return false
  return true
}

/** Arrondi à 1 décimale, sans −0. */
export function roundTemperature(v: number): number {
  const r = Math.round(v * 10) / 10
  return Object.is(r, -0) ? 0 : r
}

const NUMBER = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

/** « 3,5 », « −18 » (vrai signe moins typographique). */
export function formatTemperatureNumber(v: number): string {
  return NUMBER.format(roundTemperature(v)).replace('-', '−')
}

/** « 3,5 °C », « −18 °C ». Espace insécable avant l'unité. */
export function formatTemperature(v: number): string {
  return `${formatTemperatureNumber(v)} °C`
}

/** « ≤ 4 °C », « ≥ 63 °C », « entre 0 et 4 °C », « aucun seuil ». */
export function describeThreshold(t: TemperatureThreshold): string {
  if (t.min_c !== null && t.max_c !== null) return `entre ${formatTemperature(t.min_c)} et ${formatTemperature(t.max_c)}`
  if (t.max_c !== null) return `≤ ${formatTemperature(t.max_c)}`
  if (t.min_c !== null) return `≥ ${formatTemperature(t.min_c)}`
  return 'aucun seuil'
}

// ---------- Saisie au pavé numérique (texte intermédiaire : « - », « 3, »…) ----------

export type TemperatureKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | '-' | 'backspace' | 'clear'

/** Texte de saisie → valeur (null si vide ou incomplet : « », « - »). « 3, » → 3. */
export function textToTemperature(text: string): number | null {
  const t = text.replace(',', '.')
  if (t === '' || t === '-' || t === '.' || t === '-.') return null
  const n = Number(t.endsWith('.') ? t.slice(0, -1) : t)
  return Number.isFinite(n) ? roundTemperature(n) : null
}

/** Valeur → texte de saisie : 3.5 → « 3,5 », −18 → « -18 ». */
export function temperatureToText(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ''
  return String(roundTemperature(v)).replace('.', ',')
}

/**
 * Applique une touche au texte saisi. Renvoie le nouveau texte, ou null si la touche est refusée
 * (2ᵉ décimale, plus de 3 chiffres, valeur hors de −50..300 °C).
 */
export function applyTemperatureKey(text: string, key: TemperatureKey): string | null {
  if (key === 'clear') return ''
  if (key === 'backspace') return text.slice(0, -1)
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [intPart, decPart] = body.split(',') as [string, string | undefined]
  let next: string
  if (key === '-') {
    next = negative ? body : `-${body}`
  } else if (key === ',') {
    if (decPart !== undefined) return null
    next = `${negative ? '-' : ''}${intPart === '' ? '0' : intPart},`
  } else if (decPart !== undefined) {
    if (decPart.length >= 1) return null
    next = text + key
  } else if (intPart === '0') {
    next = `${negative ? '-' : ''}${key}`
  } else {
    if (intPart.length >= 3) return null
    next = text + key
  }
  const v = textToTemperature(next)
  if (v !== null && (v < TEMPERATURE_MIN_C || v > TEMPERATURE_MAX_C)) return null
  return next
}
