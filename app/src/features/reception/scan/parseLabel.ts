// Lecture du texte d'une étiquette (sortie de l'OCR) : n° de lot, DLC / DDM, GTIN imprimé.
// Fonction pure, testée dans scan.test.ts. Les résultats restent « à vérifier » dans l'interface.
import type { LabelReading } from '../extensions.ts'
import { normalizeGtin } from './gtin.ts'

/** Majuscules sans accents, espaces simplifiés (comparaison des mots-clés). */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/[ \t]+/g, ' ')

// Mots-clés (texte replié en majuscules sans accents). Français d'abord, puis langues fréquentes chez Metro.
const DDM_KEYS = /PREFERENCE|\bDDM\b|\bDLUO\b|BEST ?BEFORE|\bBBE?\b|\bMHD\b|PREFERIBILMENTE|PREFERENTEMENTE|AVANT FIN|\bA\.?C\.?D\.?P\b/
const DLC_KEYS = /CONSOMMER JUSQU|JUSQU'?AU|\bDLC\b|USE ?BY|\bEXP\b|\bEXPIRY\b|VERBRAUCHEN|CONSUMARSI ENTRO|CONSUMIR ANTES|LIMITE DE CONSOMMATION|A CONSOMMER (?:AVANT|LE)|\bDLUC\b/
// Dates qui ne sont PAS une date limite (fabrication, emballage, abattage…).
const OTHER_KEYS = /EMBALL|FABRI|ABATT|ABBATT|DECOUP|PRODUCTION|PRODUIT LE|PREPAR|CONGELE LE|SURGELE LE|PECHE|CONDITIONN|PACKED|PACK DATE|\bPROD\b|\bDDF\b|\bD\.?F\b|NE LE|DATE DE FAB|MIS EN/
const LOT_KEYS = /(?:\bN[°O0]?\.? ?(?:DE )?LOT|\bLOT(?:E|TO)?\b(?: ?N[°O0]?\.?)?|\bBATCH\b|\bCH\.?-?B\.?|\bCHARGE\b)\s*[:.#°/-]?\s*/

// Confusions courantes de l'OCR dans les nombres.
const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9' }
const d = '[0-9OoDQIli|SsBZzg]'
const fixDigits = (s: string) => s.replace(/[^0-9]/g, (c) => DIGIT_FIX[c] ?? c)

const MONTHS: Record<string, number> = {
  JAN: 1, JANV: 1, FEV: 2, FEVR: 2, FEB: 2, MAR: 3, MARS: 3, AVR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUIN: 6, JUL: 7, JUIL: 7,
  AOU: 8, AOUT: 8, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
}

interface DateHit {
  iso: string
  index: number
  /** Mois / année seulement (DDM « fin 12/2027 ») : dernier jour du mois. */
  monthOnly: boolean
}

function isoOf(y: number, m: number, day: number | null): string | null {
  if (y < 100) y += 2000
  // Impression en points : le 0 de « 2026 » est souvent lu 8 ou 6 (« 2826 »). Siècle remis à 20.
  if (y >= 2100 && y <= 2999) y = 2000 + (y % 100)
  if (y < 2000 || y > 2099 || m < 1 || m > 12) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const dd = day ?? last
  if (dd < 1 || dd > last) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Dates d'une ligne (JJ/MM/AA[AA], JJ.MM.AA, JJ-MM-AAAA, JJ MOIS AAAA, MM/AAAA). */
function datesIn(line: string): DateHit[] {
  const out: DateHit[] = []
  const taken: [number, number][] = []
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y)
  const full = new RegExp(`(?<![0-9])(${d}{1,2}) ?[./-] ?(${d}{1,2}) ?[./-] ?(${d}{4}|${d}{2})(?![0-9])`, 'g')
  for (const m of line.matchAll(full)) {
    const iso = isoOf(Number(fixDigits(m[3])), Number(fixDigits(m[2])), Number(fixDigits(m[1])))
    if (iso) {
      out.push({ iso, index: m.index!, monthOnly: false })
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  const named = /(?<![0-9])(\d{1,2}) ?([A-Z]{3,5})\.? ?(\d{4}|\d{2})(?![0-9])/g
  for (const m of fold(line).matchAll(named)) {
    const month = MONTHS[m[2]]
    const iso = month ? isoOf(Number(m[3]), month, Number(m[1])) : null
    if (iso && free(m.index!, m.index! + m[0].length)) {
      out.push({ iso, index: m.index!, monthOnly: false })
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  // Jet d'encre : « 27 11 26 » (espaces seuls, deux chiffres par groupe).
  const spaced = new RegExp(`(?<![0-9:])(${d}{2}) {1,3}(${d}{2}) {1,3}(${d}{4}|${d}{2})(?![0-9:])`, 'g')
  for (const m of line.matchAll(spaced)) {
    const iso = isoOf(Number(fixDigits(m[3])), Number(fixDigits(m[2])), Number(fixDigits(m[1])))
    if (iso && free(m.index!, m.index! + m[0].length)) {
      out.push({ iso, index: m.index!, monthOnly: false })
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  const monthYear = new RegExp(`(?<![0-9./-])(${d}{1,2}) ?[./-] ?(${d}{4})(?![0-9./-])`, 'g')
  for (const m of line.matchAll(monthYear)) {
    const iso = isoOf(Number(fixDigits(m[2])), Number(fixDigits(m[1])), null)
    if (iso && free(m.index!, m.index! + m[0].length)) {
      out.push({ iso, index: m.index!, monthOnly: true })
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

type Kind = 'dlc' | 'ddm' | 'other' | null

/** Nature d'une date d'après le dernier mot-clé qui la précède sur la ligne (ou sur la ligne d'avant). */
function kindBefore(text: string): Kind {
  const f = fold(text)
  let best: { kind: Kind; at: number } = { kind: null, at: -1 }
  const scan = (re: RegExp, kind: Kind) => {
    for (const m of f.matchAll(new RegExp(re.source, 'g'))) if (m.index! >= best.at) best = { kind, at: m.index! }
  }
  scan(OTHER_KEYS, 'other')
  scan(DLC_KEYS, 'dlc')
  scan(DDM_KEYS, 'ddm') // « à consommer de préférence » contient aussi « consommer » : la DDM l'emporte à égalité
  return best.kind
}

const cleanLot = (s: string) => s.replace(/[.,;:/-]+$/, '').replace(/^[.,;:/-]+/, '')

function lotIn(line: string): string | null {
  const f = fold(line)
  const m = new RegExp(LOT_KEYS.source + '([A-Z0-9][A-Z0-9./-]{0,24}(?: ?[A-Z0-9]{1,6})?)').exec(f)
  if (m) {
    const lot = cleanLot(m[1].split(' ')[0].length >= 3 ? m[1].split(' ')[0] : m[1].replace(' ', ''))
    if (/\d/.test(lot) && lot.length >= 2 && lot.length <= 40) return lot
  }
  // « L2311A », « L:2311A » (lot préfixé par L, très courant)
  const l = /(?:^|[\s(])L ?[:.]? ?(\d[A-Z0-9/-]{2,20})\b/.exec(f)
  if (l) return cleanLot('L' + l[1]) // le « L » fait partie du lot tel qu'imprimé (et tel que cité dans les rappels)
  return null
}

function gtinIn(text: string): string | null {
  // 8 à 14 chiffres, éventuellement espacés comme sous un code-barres (« 3 017620 422003 »).
  for (const m of text.matchAll(/(?<![0-9])\d(?:[ ]?\d){7,13}(?![0-9])/g)) {
    const g = normalizeGtin(m[0].replace(/ /g, ''))
    if (g && g.length >= 12) return g
  }
  return null
}

/**
 * Lot sans mot-clé, imprimé à côté de la date (jet d'encre : « MG26298R99A 27/11/26 », ou la ligne
 * « 22982629304 » sous « 27 11 26 07:31 ») : le plus long code de 6 à 20 caractères contenant au moins
 * 3 chiffres, sur la ligne de la date ou juste à côté, hors date, heure et code-barres.
 */
function lotNearDates(lines: string[], dateLines: number[]): string | null {
  let best: string | null = null
  const near = new Set(dateLines.flatMap((i) => [i - 1, i, i + 1]).filter((i) => i >= 0 && i < lines.length))
  for (const i of near) {
    const f = fold(lines[i]).replace(/(?<![0-9])\d{1,2} ?[./ -] ?\d{1,2} ?[./ -] ?\d{2,4}(?![0-9])/g, ' ').replace(/\d{1,2}[:H]\d{2}/g, ' ')
    for (const tok of f.split(/[^A-Z0-9]+/)) {
      if (tok.length < 6 || tok.length > 20 || (tok.match(/\d/g) ?? []).length < 3) continue
      if (/^\d+$/.test(tok) && normalizeGtin(tok)) continue // code-barres imprimé
      if (!best || tok.length > best.length) best = tok
    }
  }
  return best
}

/** « J07/12 », « DLC 07/12 » : jour et mois sans année, la prochaine occurrence (tolérance 30 jours). */
function dayMonthDate(text: string, today: string | undefined): string | null {
  if (!today) return null
  const m = /(?:(?:^|[^A-Z])J|JUSQU'?AU|\bDLC|\bDDM)\s*[:.]?\s*(\d{2})[/.](\d{2})(?![0-9]|[/.]\d)/.exec(fold(text))
  if (!m) return null
  const y = Number(today.slice(0, 4))
  const limit = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10)
  for (const year of [y, y + 1]) {
    const iso = isoOf(year, Number(m[2]), Number(m[1]))
    if (iso && iso >= limit) return iso
  }
  return null
}

export interface ParseOptions {
  /** Date du jour (AAAA-MM-JJ) : écarte les dates invraisemblables (plus de 2 ans avant, plus de 10 ans après). */
  today?: string
}

/** Lot, DLC ou DDM et GTIN lus dans le texte d'une étiquette. null si rien d'utile. */
export function parseLabelText(text: string, opts: ParseOptions = {}): LabelReading | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const r: LabelReading = {}
  const plausible = (iso: string) => {
    if (!opts.today) return true
    const y = Number(opts.today.slice(0, 4))
    return iso >= `${y - 2}${opts.today.slice(4)}` && iso <= `${y + 10}${opts.today.slice(4)}`
  }
  const unlabeled: string[] = []
  const dateLines: number[] = []
  lines.forEach((line, i) => {
    for (const hit of datesIn(line)) {
      if (!plausible(hit.iso)) continue
      dateLines.push(i)
      let kind = kindBefore(line.slice(0, hit.index))
      // Mot-clé seul sur la ligne précédente (« À consommer jusqu'au : » puis la date à la ligne).
      if (kind === null && i > 0 && datesIn(lines[i - 1]).length === 0) kind = kindBefore(lines[i - 1])
      if (kind === 'dlc' && !r.dlc && !hit.monthOnly) r.dlc = hit.iso
      else if (kind === 'ddm' && !r.ddm) r.ddm = hit.iso
      else if (kind === null) unlabeled.push(hit.iso)
    }
    if (!r.lot) {
      const lot = lotIn(line)
      if (lot) r.lot = lot
    }
  })
  // Une seule date sans mot-clé, dans le futur : très probablement la date limite (à vérifier).
  if (!r.dlc && !r.ddm && unlabeled.length === 1 && (!opts.today || unlabeled[0] >= opts.today)) r.dlc = unlabeled[0]
  if (!r.dlc && !r.ddm) {
    const dm = dayMonthDate(text, opts.today)
    if (dm) r.dlc = dm
  }
  if (!r.lot && (r.dlc || r.ddm)) {
    const lot = lotNearDates(lines, dateLines)
    if (lot) r.lot = lot
  }
  if (r.dlc && r.ddm) delete r.ddm // une étiquette porte l'une ou l'autre ; la DLC prime (plus stricte)
  const g = gtinIn(text)
  if (g) r.gtin = g
  return Object.keys(r).length ? r : null
}
