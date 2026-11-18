// Codes-barres GTIN (EAN-13, EAN-8, UPC-A, GTIN-14) et chaînes GS1 (GS1-128, DataMatrix, QR « Digital Link »).
// Fonctions pures, testées dans scan.test.ts.
import type { LabelReading } from '../extensions.ts'

/** Clé de contrôle GS1 (modulo 10) valide pour une suite de 8, 12, 13 ou 14 chiffres. */
export function isValidGtin(digits: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(digits)) return false
  let sum = 0
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

/**
 * Forme unique d'un GTIN pour comparer deux lectures : UPC-A (12) → EAN-13 avec un 0 devant,
 * GTIN-14 commençant par 0 → EAN-13. EAN-8 reste sur 8 chiffres. null si la clé est fausse.
 */
export function normalizeGtin(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (!isValidGtin(d)) return null
  if (d.length === 12) return '0' + d
  if (d.length === 14 && d.startsWith('0')) return d.slice(1)
  return d
}

/** AAMMJJ (GS1) → AAAA-MM-JJ. Jour 00 = dernier jour du mois. Siècle : 2000 à 2099 (règle simplifiée). */
export function gs1Date(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined
  const y = 2000 + Number(yymmdd.slice(0, 2))
  const m = Number(yymmdd.slice(2, 4))
  let d = Number(yymmdd.slice(4, 6))
  if (m < 1 || m > 12) return undefined
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d === 0) d = last
  if (d > last) return undefined
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const GS = '\u001d'
/** Longueur fixe des identifiants d'application (AI) prédéfinis par GS1 (préfixe de 2 chiffres). */
const FIXED_BY_PREFIX: Record<string, number> = {
  '00': 18, '01': 14, '02': 14, '03': 14, '11': 6, '12': 6, '13': 6, '14': 6, '15': 6, '16': 6, '17': 6, '18': 6, '19': 6, '20': 2,
  '31': 6, '32': 6, '33': 6, '34': 6, '35': 6, '36': 6, '41': 13,
}
/** Longueur de l'AI lui-même (2, 3 ou 4 chiffres) d'après ses 2 premiers chiffres (règles GS1). */
function aiLength(s: string): number {
  const p = s.slice(0, 2)
  const n = Number(p)
  if (n <= 22 || p === '30' || p === '37' || n >= 90) return 2
  if (['23', '24', '25', '40', '41', '42', '71'].includes(p)) return 3
  return 4
}

/** Éléments d'une chaîne GS1 (« ]C1010301234…\x1d10LOT », « (01)0301…(10)LOT », ou URL Digital Link). */
export function parseGs1(raw: string): Map<string, string> | null {
  const out = new Map<string, string>()
  let s = raw.trim()
  // URL GS1 Digital Link : https://exemple/01/<gtin>/10/<lot>?17=AAMMJJ
  if (/^https?:\/\//i.test(s)) {
    let u: URL
    try {
      u = new URL(s)
    } catch {
      return null
    }
    const parts = u.pathname.split('/').filter(Boolean)
    const i = parts.findIndex((p, k) => /^(01|gtin)$/.test(p) && /^\d{8,14}$/.test(parts[k + 1] ?? ''))
    if (i < 0) return null
    for (let k = i; k + 1 < parts.length; k += 2) out.set(parts[k] === 'gtin' ? '01' : parts[k], decodeURIComponent(parts[k + 1]))
    for (const [k, v] of u.searchParams) if (/^\d{2,4}$/.test(k)) out.set(k, v)
    return out
  }
  // Forme lisible avec parenthèses.
  if (s.startsWith('(')) {
    const re = /\((\d{2,4})\)([^(]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) out.set(m[1], m[2].trim())
    return out.size ? out : null
  }
  s = s.replace(/^\][A-Za-z]\d/, '') // identifiant de symbologie (]C1, ]d2, ]Q3…)
  if (!/^\d{2}/.test(s)) return null
  while (s.length) {
    if (s[0] === GS) {
      s = s.slice(1)
      continue
    }
    const n = aiLength(s)
    const ai = s.slice(0, n)
    if (!/^\d+$/.test(ai) || ai.length < n) return out.size ? out : null
    const fixed = FIXED_BY_PREFIX[ai.slice(0, 2)]
    let value: string
    if (fixed !== undefined) {
      value = s.slice(n, n + fixed)
      s = s.slice(n + fixed)
    } else {
      const end = s.indexOf(GS, n)
      value = end < 0 ? s.slice(n) : s.slice(n, end)
      s = end < 0 ? '' : s.slice(end + 1)
    }
    out.set(ai, value)
  }
  return out.size ? out : null
}

/** Ce qu'un code-barres apprend sur le produit : GTIN, et pour un code GS1 le lot et la date limite. */
export function readingFromBarcode(text: string): LabelReading | null {
  const t = text.trim()
  if (/^\d{8,14}$/.test(t)) {
    const g = normalizeGtin(t)
    return g ? { gtin: g } : null
  }
  const ai = parseGs1(t)
  if (!ai) return null
  const r: LabelReading = {}
  const g = normalizeGtin(ai.get('01') ?? ai.get('02') ?? '')
  if (g) r.gtin = g
  const lot = ai.get('10')?.trim()
  if (lot && lot.length <= 40) r.lot = lot
  const dlc = gs1Date(ai.get('17') ?? '') // date d'expiration (« à consommer jusqu'au »)
  const ddm = gs1Date(ai.get('15') ?? '') // « à consommer de préférence avant »
  if (dlc) r.dlc = dlc
  else if (ddm) r.ddm = ddm
  return Object.keys(r).length ? r : null
}
