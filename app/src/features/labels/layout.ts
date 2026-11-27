// Mise en page de l'étiquette (fonction pure) : une liste d'éléments positionnés en points (1 pt = 1/72 po),
// origine en haut à gauche. L'aperçu (SVG) et le PDF dessinent EXACTEMENT ces éléments : l'aperçu est fidèle.
import type { FontWeight, Measure } from './fonts.ts'
import { ALLERGEN_SHORT, formatLabelDate, formatLabelDateTime, KIND_MADE_LABEL, STORAGE_PRINT, weekdayOf, type LabelContent } from './model.ts'

export const MM = 72 / 25.4
/** Rouleau Brother DK 62 mm (continu, amovible ou soluble). */
export const LABEL_WIDTH_MM = 62
export const DEFAULT_LABEL_HEIGHT_MM = 50
export const MIN_LABEL_HEIGHT_MM = 29
export const MAX_LABEL_HEIGHT_MM = 100

export const mmToPt = (mm: number) => mm * MM

export type LabelOp =
  /** `w` : largeur mesurée (l'aperçu SVG l'impose, pour un rendu identique au PDF). */
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: FontWeight; w?: number }
  /** Cadre (contour) : x, y = coin haut gauche. */
  | { kind: 'frame'; x: number; y: number; w: number; h: number; line: number }
  /** Filet plein. */
  | { kind: 'rule'; x: number; y: number; w: number; h: number }
  /** Cercle (contour) : centre et rayon. */
  | { kind: 'circle'; cx: number; cy: number; r: number; line: number }

export interface LabelLayout {
  width: number
  height: number
  ops: LabelOp[]
  /** Le contenu ne tient pas, même réduit : augmenter la hauteur de l'étiquette. */
  overflow: boolean
  scale: number
}

interface Run {
  text: string
  weight: FontWeight
}
interface Placed {
  text: string
  weight: FontWeight
  x: number
}

/** Coupe des segments (gras / normal mêlés) en lignes de largeur ≤ maxW, aux espaces ordinaires. */
export function wrapRuns(runs: readonly Run[], size: number, maxW: number, measure: Measure): Placed[][] {
  const tokens: { text: string; weight: FontWeight; space: boolean }[] = []
  for (const r of runs) {
    for (const part of r.text.split(/( )/)) if (part) tokens.push({ text: part, weight: r.weight, space: part === ' ' })
  }
  const lines: Placed[][] = []
  let line: Placed[] = []
  let x = 0
  for (const t of tokens) {
    if (t.space) {
      if (line.length) {
        line.push({ text: ' ', weight: t.weight, x })
        x += measure(' ', size, t.weight)
      }
      continue
    }
    const w = measure(t.text, size, t.weight)
    if (x + w > maxW && line.length) {
      while (line.length && line[line.length - 1].text === ' ') line.pop()
      lines.push(line)
      line = []
      x = 0
    }
    line.push({ text: t.text, weight: t.weight, x })
    x += w
  }
  while (line.length && line[line.length - 1].text === ' ') line.pop()
  if (line.length) lines.push(line)
  return lines
}

const lineWidth = (l: Placed[], size: number, measure: Measure) => (l.length ? l[l.length - 1].x + measure(l[l.length - 1].text, size, l[l.length - 1].weight) : 0)

/** Fusionne les segments contigus de même graisse (moins d'éléments à dessiner). */
function merge(line: Placed[]): Placed[] {
  const out: Placed[] = []
  for (const p of line) {
    const last = out[out.length - 1]
    if (last && last.weight === p.weight) last.text += p.text
    else out.push({ ...p })
  }
  return out
}

function ellipsize(text: string, size: number, weight: FontWeight, maxW: number, measure: Measure): string {
  if (measure(text, size, weight) <= maxW) return text
  let t = text
  while (t.length > 1 && measure(`${t}…`, size, weight) > maxW) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Allergènes imprimés : noms courts, insécables (« Fruits à coque » ne se coupe pas). */
export function allergenText(content: Pick<LabelContent, 'allergens'>): string {
  return content.allergens.map((a) => ALLERGEN_SHORT[a].replace(/ /g, ' ')).join(', ')
}

/** Petit logo Space Diner monochrome (impression thermique noir seul) : anneau, « SPACE », « DINER ». */
export function logoOps(x: number, y: number, size: number, measure: Measure): LabelOp[] {
  const line = size * 0.07
  const cx = x + size / 2
  const cy = y + size / 2
  const top = 'SPACE'
  const bottom = 'DINER'
  const topSize = Math.min(size * 0.17, (size * 0.5) / measure(top, 1, 'black'))
  const bottomSize = Math.min(size * 0.3, (size * 0.64) / measure(bottom, 1, 'black'))
  return [
    { kind: 'circle', cx, cy, r: size / 2 - line / 2, line },
    { kind: 'text', x: cx - measure(top, topSize, 'black') / 2, y: cy - size * 0.06, text: top, size: topSize, weight: 'black' },
    { kind: 'rule', x: cx - size * 0.3, y: cy + size * 0.005, w: size * 0.6, h: line * 0.55 },
    { kind: 'text', x: cx - measure(bottom, bottomSize, 'black') / 2, y: cy + size * 0.06 + bottomSize * 0.72, text: bottom, size: bottomSize, weight: 'black' },
  ]
}

function layoutAt(content: LabelContent, W: number, H: number, s: number, measure: Measure): { ops: LabelOp[]; bottom: number; footerTop: number } {
  const ops: LabelOp[] = []
  const mx = 3 * MM // marges latérales (zone imprimable du rouleau 62 mm ≈ 58 mm)
  const my = 2.4 * MM
  const cw = W - 2 * mx
  const tz = content.timeZone

  // En-tête : nom (2 lignes au plus) + logo.
  const logo = Math.round(24 * s * 10) / 10
  const nameW = cw - logo - 4 * s
  let nameSize = 13.5 * s
  let nameLines: Placed[][] = []
  for (; nameSize >= 8 * s; nameSize -= 0.5 * s) {
    nameLines = wrapRuns([{ text: content.name, weight: 'black' }], nameSize, nameW, measure)
    if (nameLines.length <= 2 && nameLines.every((l) => lineWidth(l, nameSize, measure) <= nameW)) break
  }
  if (nameSize < 8 * s) {
    nameSize = 8 * s
    nameLines = wrapRuns([{ text: content.name, weight: 'black' }], nameSize, nameW, measure).slice(0, 2)
    const rest = nameLines[1] ? nameLines[1].map((p) => p.text).join('') : ''
    if (nameLines[1]) nameLines[1] = [{ text: ellipsize(rest, nameSize, 'black', nameW, measure), weight: 'black', x: 0 }]
    nameLines[0] = [{ text: ellipsize(nameLines[0].map((p) => p.text).join(''), nameSize, 'black', nameW, measure), weight: 'black', x: 0 }]
  }
  let y = my
  const nameLead = nameSize * 1.12
  nameLines.forEach((l, i) => {
    for (const p of merge(l)) ops.push({ kind: 'text', x: mx + p.x, y: y + nameSize * 0.82 + i * nameLead, text: p.text, size: nameSize, weight: p.weight })
  })
  ops.push(...logoOps(W - mx - logo, my - 1 * s, logo, measure))
  y += Math.max(nameLines.length * nameLead - (nameLead - nameSize), logo - 2 * s)

  // Date d'ouverture / préparation / décongélation.
  const small = 7.6 * s
  y += 3.2 * s
  const made = wrapRuns(
    [
      { text: `${KIND_MADE_LABEL[content.kind]} `, weight: 'regular' },
      { text: formatLabelDateTime(content.madeAt, tz).replace(' ', ' à '), weight: 'bold' },
    ],
    small,
    cw,
    measure,
  )
  for (const p of merge(made[0] ?? [])) ops.push({ kind: 'text', x: mx + p.x, y: y + small * 0.8, text: p.text, size: small, weight: p.weight })
  y += small

  // DLC : cadre épais, mention + date-heure en très gros.
  y += 3 * s
  const pad = 3 * s
  const line = 1.6 * s
  const caption = 6.4 * s
  // DDM du fabricant : mention « de préférence » et date seule (pas d'heure).
  const ddm = content.dateKind === 'ddm'
  const capText = ddm ? `DDM · DE PRÉFÉRENCE AVANT LE ${weekdayOf(content.dlcAt, tz).toUpperCase()}` : `À CONSOMMER JUSQU’AU ${weekdayOf(content.dlcAt, tz).toUpperCase()}`
  const capSize = Math.min(caption, (cw - 2 * pad) / measure(capText, 1, 'bold'))
  const dlcText = ddm ? formatLabelDate(content.dlcAt, tz) : formatLabelDateTime(content.dlcAt, tz)
  const dlcSize = Math.min(21 * s, (cw - 2 * pad) / measure(dlcText, 1, 'black'))
  const frameH = pad + capSize * 1.05 + 2 * s + dlcSize * 0.78 + pad + line / 2
  ops.push({ kind: 'frame', x: mx + line / 2, y: y + line / 2, w: cw - line, h: frameH - line, line })
  ops.push({ kind: 'text', x: mx + pad, y: y + pad + capSize * 0.82, text: capText, size: capSize, weight: 'bold' })
  ops.push({ kind: 'text', x: mx + pad, y: y + pad + capSize * 1.05 + 2 * s + dlcSize * 0.76, text: dlcText, size: dlcSize, weight: 'black' })
  y += frameH

  // Conservation.
  y += 3.4 * s
  const cons = merge(
    wrapRuns(
      [
        { text: 'Conservation : ', weight: 'regular' },
        { text: STORAGE_PRINT[content.storage].toLowerCase().replace(/^à /, 'à '), weight: 'bold' },
      ],
      small,
      cw,
      measure,
    )[0] ?? [],
  )
  for (const p of cons) ops.push({ kind: 'text', x: mx + p.x, y: y + small * 0.8, text: p.text, size: small, weight: p.weight })
  y += small

  // Allergènes (en gras) — jamais tronqués.
  y += 2.6 * s
  const runs: Run[] = content.allergens.length
    ? [
        { text: 'Allergènes : ', weight: 'regular' },
        { text: allergenText(content), weight: 'black' },
      ]
    : [{ text: 'Aucun allergène déclaré', weight: 'bold' }]
  const lead = small * 1.22
  const al = wrapRuns(runs, small, cw, measure)
  al.forEach((l, i) => {
    for (const p of merge(l)) ops.push({ kind: 'text', x: mx + p.x, y: y + small * 0.8 + i * lead, text: p.text, size: small, weight: p.weight })
  })
  y += small + (al.length - 1) * lead

  // Traces possibles (peut en contenir), sous les allergènes, en normal — jamais tronquées.
  const traces = (content.traces ?? []).filter((a) => !content.allergens.includes(a))
  if (traces.length) {
    y += 1.6 * s
    const tl = wrapRuns(
      [
        { text: 'Traces possibles : ', weight: 'regular' },
        { text: allergenText({ allergens: traces }), weight: 'regular' },
      ],
      small,
      cw,
      measure,
    )
    tl.forEach((l, i) => {
      for (const p of merge(l)) ops.push({ kind: 'text', x: mx + p.x, y: y + small * 0.8 + i * lead, text: p.text, size: small, weight: p.weight })
    })
    y += small + (tl.length - 1) * lead
  }

  // Pied : lot et opérateur, collés au bas de l'étiquette.
  const foot = 7 * s
  const footerTop = H - my - foot
  ops.push({ kind: 'rule', x: mx, y: footerTop - 2.6 * s, w: cw, h: 0.6 * s })
  const lotRuns = merge(
    wrapRuns(
      [
        { text: 'Lot ', weight: 'regular' },
        { text: content.lot ? content.lot.replace(/ /g, ' ') : '—', weight: 'bold' },
      ],
      foot,
      cw * 0.68,
      measure,
    )[0] ?? [],
  )
  const lotLine = lotRuns.map((p) => ({ ...p, text: p === lotRuns[lotRuns.length - 1] ? ellipsize(p.text, foot, p.weight, cw * 0.68 - p.x, measure) : p.text }))
  for (const p of lotLine) ops.push({ kind: 'text', x: mx + p.x, y: footerTop + foot * 0.8, text: p.text, size: foot, weight: p.weight })
  const opText = content.operator
  const opW = measure(opText, foot, 'bold')
  const opLabel = 'Op. '
  const opLabelW = measure(opLabel, foot, 'regular')
  ops.push({ kind: 'text', x: W - mx - opW - opLabelW, y: footerTop + foot * 0.8, text: opLabel, size: foot, weight: 'regular' })
  ops.push({ kind: 'text', x: W - mx - opW, y: footerTop + foot * 0.8, text: opText, size: foot, weight: 'bold' })

  return { ops, bottom: y, footerTop: footerTop - 2.6 * s }
}

/**
 * Étiquette de `widthMm` × `heightMm`. Le contenu est réduit (jusqu'à 60 %) s'il ne tient pas ;
 * au-delà, `overflow` est vrai (l'interface demande une étiquette plus haute).
 */
export function layoutLabel(content: LabelContent, measure: Measure, heightMm = DEFAULT_LABEL_HEIGHT_MM, widthMm = LABEL_WIDTH_MM): LabelLayout {
  const l = layoutFit(content, measure, heightMm, widthMm)
  return { ...l, ops: l.ops.map((o) => (o.kind === 'text' ? { ...o, w: measure(o.text, o.size, o.weight) } : o)) }
}

function layoutFit(content: LabelContent, measure: Measure, heightMm: number, widthMm: number): LabelLayout {
  const W = mmToPt(widthMm)
  const H = mmToPt(heightMm)
  let last: ReturnType<typeof layoutAt> | null = null
  let s = 1
  for (; s >= 0.6 - 1e-9; s = Math.round((s - 0.05) * 100) / 100) {
    last = layoutAt(content, W, H, s, measure)
    if (last.bottom + 2 * s <= last.footerTop) return { width: W, height: H, ops: last.ops, overflow: false, scale: s }
  }
  return { width: W, height: H, ops: last!.ops, overflow: true, scale: 0.6 }
}
