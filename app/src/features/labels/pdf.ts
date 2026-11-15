// Génération des PDF avec pdf-lib (MIT) : étiquettes 62 mm (une page par copie, format exact) et tableau
// des allergènes A4 paysage. Polices Inter intégrées (sous-ensemble). pdf-lib est chargé à la demande.
import { ALLERGEN_LABELS, ALLERGENS, type Allergen } from '../../../../shared/payloads.ts'
import { FONT_WEIGHTS, type FontWeight, type LabelFonts, type Measure } from './fonts.ts'
import { wrapRuns, type LabelLayout } from './layout.ts'

type PdfLib = typeof import('pdf-lib')
type PDFFont = import('pdf-lib').PDFFont
type PDFDocument = import('pdf-lib').PDFDocument

async function newDocument(fonts: LabelFonts, title: string): Promise<{ lib: PdfLib; doc: PDFDocument; font: Record<FontWeight, PDFFont> }> {
  const [lib, { default: fontkit }] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')])
  const doc = await lib.PDFDocument.create()
  doc.registerFontkit(fontkit)
  const embedded = await Promise.all(FONT_WEIGHTS.map((w) => doc.embedFont(fonts.bytes[w], { subset: true })))
  const font = Object.fromEntries(FONT_WEIGHTS.map((w, i) => [w, embedded[i]])) as Record<FontWeight, PDFFont>
  doc.setTitle(title)
  doc.setCreator('Space Diner – HACCP')
  doc.setProducer('Space Diner – HACCP (pdf-lib)')
  doc.setLanguage('fr-FR')
  return { lib, doc, font }
}

/** PDF d'étiquette : `copies` pages identiques au format exact de la mise en page (62 mm × hauteur). */
export async function buildLabelPdf(layout: LabelLayout, copies: number, fonts: LabelFonts, title = 'Étiquette DLC'): Promise<Uint8Array> {
  const { lib, doc, font } = await newDocument(fonts, title)
  const black = lib.rgb(0, 0, 0)
  const H = layout.height
  for (let c = 0; c < Math.max(1, copies); c++) {
    const page = doc.addPage([layout.width, layout.height])
    for (const op of layout.ops) {
      if (op.kind === 'text') page.drawText(op.text, { x: op.x, y: H - op.y, size: op.size, font: font[op.weight], color: black })
      else if (op.kind === 'rule') page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, color: black })
      else if (op.kind === 'frame') page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, borderColor: black, borderWidth: op.line })
      else if (op.kind === 'circle') page.drawCircle({ x: op.cx, y: H - op.cy, size: op.r, borderColor: black, borderWidth: op.line })
    }
  }
  return doc.save()
}

// ---------- Tableau des allergènes (A4) ----------

export interface AllergenTableRow {
  name: string
  allergens: readonly Allergen[]
}
export interface AllergenTableGroup {
  title: string
  rows: AllergenTableRow[]
}
export interface AllergenTableInput {
  title: string
  groups: AllergenTableGroup[]
  /** « Mis à jour le 15/11/2026 ». */
  updatedLabel: string
  legal: string
}

export const A4_LANDSCAPE: [number, number] = [841.89, 595.28]

/** Coupe un texte simple en lignes. */
function lines(text: string, size: number, maxW: number, weight: FontWeight, measure: Measure): string[] {
  return wrapRuns([{ text, weight }], size, maxW, measure).map((l) => l.map((p) => p.text).join(''))
}

/** Tableau des allergènes pour la clientèle : A4 paysage, une ligne par plat, une colonne par allergène. */
export async function buildAllergenTablePdf(input: AllergenTableInput, fonts: LabelFonts): Promise<Uint8Array> {
  const { lib, doc, font } = await newDocument(fonts, input.title)
  const { measure } = fonts
  const [W, H] = A4_LANDSCAPE
  const m = 34
  const black = lib.rgb(0, 0, 0)
  const grey = lib.rgb(0.35, 0.35, 0.38)
  const rule = lib.rgb(0.72, 0.72, 0.75)
  const zebra = lib.rgb(0.95, 0.95, 0.96)
  const nameW = 196
  const colW = (W - 2 * m - nameW) / ALLERGENS.length
  const headSize = 7.4
  // Taille par colonne : le mot le plus long tient dans la colonne (« Mollusques »).
  const headSizes = ALLERGENS.map((a) => Math.min(headSize, ...ALLERGEN_LABELS[a].split(' ').map((w) => (colW - 5) / measure(w, 1, 'bold'))))
  const headLines = ALLERGENS.map((a, i) => lines(ALLERGEN_LABELS[a], headSizes[i], colW - 5, 'bold', measure))
  const headH = Math.max(...headLines.map((l) => l.length)) * headSize * 1.18 + 14
  const legalLines = lines(input.legal, 8.2, W - 2 * m, 'regular', measure)
  const footerH = legalLines.length * 8.2 * 1.3 + 22

  let page = doc.addPage(A4_LANDSCAPE)
  let pageNo = 1
  const pages = [page]
  let y = 0

  const top = (yy: number) => H - yy
  const header = (first: boolean) => {
    y = m
    page.drawText(input.title, { x: m, y: top(y + 22), size: 24, font: font.black, color: black })
    const upd = input.updatedLabel
    page.drawText(upd, { x: W - m - measure(upd, 10, 'bold'), y: top(y + 20), size: 10, font: font.bold, color: black })
    y += 32
    const sub = first ? 'Les 14 allergènes à déclaration obligatoire présents dans nos préparations' : 'Suite du tableau'
    page.drawText(sub, { x: m, y: top(y + 10), size: 10.5, font: font.regular, color: grey })
    y += 22
    // En-tête de colonnes
    page.drawRectangle({ x: m, y: top(y + headH), width: W - 2 * m, height: headH, color: black })
    page.drawText('Plat / préparation', { x: m + 8, y: top(y + headH - 9), size: 9.5, font: font.bold, color: lib.rgb(1, 1, 1) })
    ALLERGENS.forEach((_, i) => {
      const x0 = m + nameW + i * colW
      const hl = headLines[i]
      const blockH = hl.length * headSize * 1.18
      const hs = headSizes[i]
      hl.forEach((t, k) => {
        const tw = measure(t, hs, 'bold')
        page.drawText(t, { x: x0 + (colW - tw) / 2, y: top(y + headH - 7 - blockH + (k + 1) * headSize * 1.18 - 2), size: hs, font: font.bold, color: lib.rgb(1, 1, 1) })
      })
      if (i > 0) page.drawLine({ start: { x: x0, y: top(y + 4) }, end: { x: x0, y: top(y + headH - 4) }, thickness: 0.5, color: lib.rgb(0.5, 0.5, 0.5) })
    })
    y += headH
  }
  const newPage = () => {
    page = doc.addPage(A4_LANDSCAPE)
    pages.push(page)
    pageNo++
    header(false)
  }
  const check = (cx: number, cy: number) => {
    // Coche nette dans un disque noir (lisible en noir et blanc).
    page.drawCircle({ x: cx, y: top(cy), size: 8.2, color: black })
    page.drawSvgPath('M -4.2 0.2 L -1.3 3.1 L 4.4 -3', { x: cx, y: top(cy), borderColor: lib.rgb(1, 1, 1), borderWidth: 1.9, borderLineCap: lib.LineCapStyle.Round })
  }

  header(true)
  let zebraOn = false
  for (const g of input.groups) {
    if (!g.rows.length) continue
    if (y + 22 + 26 > H - m - footerH) newPage()
    page.drawText(g.title.toUpperCase(), { x: m + 2, y: top(y + 16), size: 8.5, font: font.bold, color: grey })
    y += 22
    zebraOn = false
    for (const r of g.rows) {
      const nl = lines(r.name, 10.5, nameW - 14, 'bold', measure).slice(0, 3)
      const rowH = Math.max(26, nl.length * 12.5 + 10)
      if (y + rowH > H - m - footerH) newPage()
      if (zebraOn) page.drawRectangle({ x: m, y: top(y + rowH), width: W - 2 * m, height: rowH, color: zebra })
      zebraOn = !zebraOn
      nl.forEach((t, k) => page.drawText(t, { x: m + 8, y: top(y + (rowH - nl.length * 12.5) / 2 + 9.5 + k * 12.5), size: 10.5, font: font.bold, color: black }))
      ALLERGENS.forEach((a, i) => {
        const x0 = m + nameW + i * colW
        page.drawLine({ start: { x: x0, y: top(y) }, end: { x: x0, y: top(y + rowH) }, thickness: 0.5, color: rule })
        if (r.allergens.includes(a)) check(x0 + colW / 2, y + rowH / 2)
      })
      page.drawLine({ start: { x: W - m, y: top(y) }, end: { x: W - m, y: top(y + rowH) }, thickness: 0.5, color: rule })
      page.drawLine({ start: { x: m, y: top(y + rowH) }, end: { x: W - m, y: top(y + rowH) }, thickness: 0.5, color: rule })
      y += rowH
    }
    y += 6
  }

  // Pied de page : mention légale, pagination.
  pages.forEach((p, i) => {
    let fy = H - m - footerH + 14
    p.drawLine({ start: { x: m, y: top(fy - 8) }, end: { x: W - m, y: top(fy - 8) }, thickness: 0.6, color: rule })
    for (const t of legalLines) {
      p.drawText(t, { x: m, y: top(fy + 6), size: 8.2, font: font.regular, color: grey })
      fy += 8.2 * 1.3
    }
    const legend = 'Coche = allergène présent dans le plat.'
    p.drawText(legend, { x: m, y: top(H - m + 2), size: 8.2, font: font.bold, color: black })
    if (pageNo > 1) {
      const n = `Page ${i + 1} / ${pageNo}`
      p.drawText(n, { x: W - m - measure(n, 8.2, 'regular'), y: top(H - m + 2), size: 8.2, font: font.regular, color: grey })
    }
  })
  return doc.save()
}
