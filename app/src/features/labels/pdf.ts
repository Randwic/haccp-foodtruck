// Génération des PDF avec pdf-lib (MIT) : étiquettes 62 mm (une page par copie, format exact) et tableau
// des allergènes A4 paysage. Polices Inter intégrées (sous-ensemble). pdf-lib est chargé à la demande.
import { ALLERGENS, type Allergen } from '../../../../shared/payloads.ts'
import { ALLERGEN_CALLOUT, ALLERGEN_NOTICE, ALLERGEN_TABLE_SUBTITLE, ALLERGEN_TABLE_TITLE, LEGEND_PRESENT, LEGEND_TRACES, type AllergenTableGroup } from './allergenTable.ts'
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
// Affiche clientèle au style du tableau du propriétaire : fond bleu nuit, cadre rose néon, logo, titre cyan en
// Bowlby One, sous-titre jaune ; plats du menu groupés par rubrique ; ● rose = présent, ○ jaune = peut en contenir.

export type { AllergenTableGroup, AllergenTableRow } from './allergenTable.ts'

export interface AllergenTableInput {
  groups: AllergenTableGroup[]
  /** « Mis à jour le 15/11/2026 ». */
  updatedLabel: string
}

export const A4_LANDSCAPE: [number, number] = [841.89, 595.28]

/** Couleurs de la charte (docs/marque). */
export const POSTER = { navy: '#0A0E1F', band: '#121833', rule: '#2B3358', pink: '#FF2E97', cyan: '#22E6F2', yellow: '#FFD84A', white: '#F4F1EC', chrome: '#C9C9CF' } as const

const hex = (lib: PdfLib, h: string) => lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

/** Coupe un texte simple en lignes. */
function lines(text: string, size: number, maxW: number, weight: FontWeight, measure: Measure): string[] {
  return wrapRuns([{ text, weight }], size, maxW, measure).map((l) => l.map((p) => p.text).join(''))
}

/** Libellés des colonnes (comme le tableau du propriétaire : noms courts). */
export const POSTER_HEADERS: Record<Allergen, string> = {
  gluten: 'Gluten', crustaces: 'Crustacés', oeufs: 'Œufs', poissons: 'Poissons', arachides: 'Arachides', soja: 'Soja', lait: 'Lait',
  fruits_a_coque: 'Fruits à coque', celeri: 'Céleri', moutarde: 'Moutarde', sesame: 'Sésame', sulfites: 'Sulfites', lupin: 'Lupin', mollusques: 'Mollusques',
}

/** Tableau des allergènes pour la clientèle : A4 paysage, une ligne par plat, une colonne par allergène. */
export async function buildAllergenTablePdf(input: AllergenTableInput, fonts: LabelFonts, displayBytes: Uint8Array): Promise<Uint8Array> {
  const { lib, doc, font } = await newDocument(fonts, 'Space Diner – Allergènes')
  const display = await doc.embedFont(displayBytes, { subset: true })
  const { measure } = fonts
  const [W, H] = A4_LANDSCAPE
  const c = Object.fromEntries(Object.entries(POSTER).map(([k, v]) => [k, hex(lib, v)])) as Record<keyof typeof POSTER, ReturnType<PdfLib['rgb']>>
  const m = 34 // marge intérieure (le cadre rose est à 11 pt du bord)
  const nameW = 262
  const colW = (W - 2 * m - nameW) / ALLERGENS.length
  const top = (yy: number) => H - yy
  const headH = 64
  const groupH = 24
  const footerH = 74
  const tableTop = 104

  // Hauteur des lignes : 21 pt, réduite jusqu'à 15 pt si besoin ; au-delà, pages suivantes.
  const nameLines = input.groups.map((g) => g.rows.map((r) => lines(r.name, 10, nameW - 16, 'bold', measure).slice(0, 2)))
  const avail = H - tableTop - headH - footerH - 14
  const need = (rh: number) => input.groups.reduce((s, g, gi) => s + groupH + g.rows.reduce((t, _r, ri) => t + Math.max(rh, nameLines[gi][ri].length * 11.5 + 6), 0), 0)
  let rowH = 21
  while (rowH > 15 && need(rowH) > avail) rowH -= 0.5

  const pages: import('pdf-lib').PDFPage[] = []
  let page = doc.addPage(A4_LANDSCAPE)
  let y = 0

  const logo = (ox: number, oy: number, size: number) => {
    const s = size / 200
    const at = { x: ox, y: top(oy), scale: s }
    const circle = (cx: number, cy: number, r: number) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
    const sparkle = (x: number, y0: number, r: number) => {
      const k = r * 0.28
      return `M${x} ${y0 - r}Q${x + k} ${y0 - k} ${x + r} ${y0}Q${x + k} ${y0 + k} ${x} ${y0 + r}Q${x - k} ${y0 + k} ${x - r} ${y0}Q${x - k} ${y0 - k} ${x} ${y0 - r}Z`
    }
    page.drawSvgPath(circle(100, 100, 97), { ...at, color: c.navy })
    page.drawSvgPath(circle(100, 100, 91), { ...at, borderColor: c.pink, borderWidth: 7 * s })
    page.drawSvgPath(sparkle(52, 60, 5), { ...at, color: c.white })
    page.drawSvgPath(sparkle(151, 56, 3.6), { ...at, color: c.cyan })
    page.drawSvgPath(sparkle(148, 150, 4.4), { ...at, color: c.white })
    page.drawSvgPath(sparkle(56, 146, 3.2), { ...at, color: c.pink })
    page.drawEllipse({ x: ox + 100 * s, y: top(oy + 114 * s), xScale: 78 * s, yScale: 21 * s, rotate: lib.degrees(9), borderColor: c.cyan, borderWidth: 4.5 * s })
    page.drawSvgPath('M77 64 H123 A11 11 0 0 1 123 86 H77 A11 11 0 0 1 77 64 Z', { ...at, color: c.pink })
    const sp = 13 * s
    const spaceW = display.widthOfTextAtSize('SPACE', sp)
    page.drawText('SPACE', { x: ox + 100 * s - spaceW / 2, y: top(oy + 80.2 * s), size: sp, font: display, color: c.white })
    const dn = Math.min(41 * s, (138 * s) / display.widthOfTextAtSize('DINER', 1))
    const dinerW = display.widthOfTextAtSize('DINER', dn)
    page.drawText('DINER', { x: ox + 100 * s - dinerW / 2, y: top(oy + 129 * s), size: dn, font: display, color: c.white })
  }

  const dot = (cx: number, cy: number, kind: 'present' | 'trace') => {
    if (kind === 'present') page.drawCircle({ x: cx, y: top(cy), size: 3.3, color: c.pink })
    else page.drawCircle({ x: cx, y: top(cy), size: 2.9, borderColor: c.yellow, borderWidth: 0.95 })
  }

  const newPage = (first: boolean) => {
    if (!first) page = doc.addPage(A4_LANDSCAPE)
    pages.push(page)
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: c.navy })
    page.drawRectangle({ x: 11, y: 11, width: W - 22, height: H - 22, borderColor: c.pink, borderWidth: 3.2 })
    logo(m + 4, 22, 74)
    const tx = m + 96
    page.drawText(ALLERGEN_TABLE_TITLE.toUpperCase(), { x: tx, y: top(58), size: 28, font: display, color: c.cyan })
    page.drawText(first ? ALLERGEN_TABLE_SUBTITLE : `${ALLERGEN_TABLE_SUBTITLE} (suite)`, { x: tx + 1, y: top(78), size: 11.5, font: font.bold, color: c.yellow })
    if (input.updatedLabel) {
      const uw = measure(input.updatedLabel, 8.5, 'regular')
      page.drawText(input.updatedLabel, { x: W - m - uw, y: top(42), size: 8.5, font: font.regular, color: c.chrome })
    }
    // Bandes verticales une colonne sur deux (lisibilité), de l'en-tête au bas du tableau.
    const bodyBottom = H - footerH - 10
    ALLERGENS.forEach((_, i) => {
      if (i % 2 === 1) page.drawRectangle({ x: m + nameW + i * colW, y: top(bodyBottom), width: colW, height: bodyBottom - tableTop - headH, color: c.band })
    })
    // En-têtes verticaux (lecture de bas en haut).
    ALLERGENS.forEach((a, i) => {
      const label = POSTER_HEADERS[a]
      const size = Math.min(8.6, (headH - 6) / measure(label, 1, 'bold'))
      page.drawText(label, { x: m + nameW + i * colW + colW / 2 + size * 0.36, y: top(tableTop + headH - 4), size, font: font.bold, color: c.white, rotate: lib.degrees(90) })
    })
    y = tableTop + headH
  }

  newPage(true)
  input.groups.forEach((g, gi) => {
    if (!g.rows.length) return
    if (y + groupH + rowH > H - footerH - 10) newPage(false)
    page.drawText(g.title.toUpperCase(), { x: m + 2, y: top(y + 15), size: 10.5, font: display, color: c.cyan })
    page.drawRectangle({ x: m, y: top(y + groupH - 1), width: W - 2 * m, height: 1.1, color: c.cyan })
    y += groupH
    g.rows.forEach((r, ri) => {
      const nl = nameLines[gi][ri]
      const h = Math.max(rowH, nl.length * 11.5 + 6)
      if (y + h > H - footerH - 10) newPage(false)
      nl.forEach((t, k) => page.drawText(t, { x: m + 8, y: top(y + (h - nl.length * 11.5) / 2 + 8.6 + k * 11.5), size: 10, font: font.bold, color: c.white }))
      ALLERGENS.forEach((a, i) => {
        const cx = m + nameW + i * colW + colW / 2
        if (r.allergens.includes(a)) dot(cx, y + h / 2, 'present')
        else if (r.traces.includes(a)) dot(cx, y + h / 2, 'trace')
      })
      page.drawRectangle({ x: m, y: top(y + h), width: W - 2 * m, height: 0.7, color: c.rule })
      y += h
    })
    y += 6
  })

  // Pied : légende, mention, appel à parler de ses allergies.
  pages.forEach((p, i) => {
    page = p
    let fy = H - footerH + 6
    dot(m + 4, fy - 3, 'present')
    let x = m + 11
    p.drawText(LEGEND_PRESENT, { x, y: top(fy), size: 8.5, font: font.regular, color: c.white })
    x += measure(LEGEND_PRESENT, 8.5, 'regular') + 14
    dot(x, fy - 3, 'trace')
    p.drawText(LEGEND_TRACES, { x: x + 7, y: top(fy), size: 8.5, font: font.regular, color: c.white })
    const noticeW = W - 2 * m - 230
    for (const para of ALLERGEN_NOTICE) {
      for (const t of lines(para, 8.5, noticeW, 'regular', measure)) {
        fy += 12.5
        p.drawText(t, { x: m, y: top(fy), size: 8.5, font: font.regular, color: c.white })
      }
    }
    ALLERGEN_CALLOUT.forEach((t, k) => {
      const size = 12.5
      const w = display.widthOfTextAtSize(t, size)
      p.drawText(t, { x: W - m - w, y: top(H - footerH + 14 + k * 18), size, font: display, color: c.yellow })
    })
    if (pages.length > 1) {
      const n = `Page ${i + 1} / ${pages.length}`
      p.drawText(n, { x: W - m - measure(n, 8, 'regular'), y: top(H - 20), size: 8, font: font.regular, color: c.chrome })
    }
  })
  return doc.save()
}
