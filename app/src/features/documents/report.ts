// Mise en page de documents A4 (portrait) avec pdf-lib : titres, paragraphes, listes, tableaux avec en-têtes
// répétés, encadrés, photos. Utilisé par le PMS et le dossier « contrôle sanitaire ». Polices Inter (OFL)
// intégrées en sous-ensemble ; les caractères absents de la police sont remplacés (≤ → « au plus »…).
import type { LabelFonts } from '../labels/fonts.ts'

type PdfLib = typeof import('pdf-lib')
type PDFFont = import('pdf-lib').PDFFont
type PDFPage = import('pdf-lib').PDFPage
type PDFDocument = import('pdf-lib').PDFDocument
type RGB = ReturnType<PdfLib['rgb']>

export const A4_PORTRAIT: [number, number] = [595.28, 841.89]
const MARGIN_X = 42
const TOP = 58
const BOTTOM = 52

export type Tone = 'normal' | 'muted' | 'danger' | 'ok' | 'warn' | 'accent'
export type Weight = 'regular' | 'bold' | 'black'

/** Cellule de tableau : texte simple ou texte mis en forme. */
export type Cell = string | { text: string; tone?: Tone; bold?: boolean; strike?: boolean }

export interface Column {
  title: string
  /** Largeur relative. */
  width: number
  align?: 'left' | 'right' | 'center'
}

export interface ReportOptions {
  /** Titre du document (métadonnées PDF). */
  title: string
  /** En-tête de chaque page (à gauche), ex. « Space Diner — Plan de maîtrise sanitaire ». */
  header: string
  /** En-tête de chaque page (à droite), ex. « Édité le 17/11/2026 à 19:30 ». */
  headerRight?: string
  /** Pied de page (à gauche). */
  footer?: string
}

const COLORS: Record<Tone | 'rule' | 'band' | 'zebra' | 'head', string> = {
  normal: '#151A30',
  muted: '#5B6178',
  danger: '#B3261E',
  ok: '#1E6B34',
  warn: '#8A5300',
  accent: '#C2186B',
  rule: '#D5D8E3',
  band: '#0A0E1F',
  zebra: '#F3F4F8',
  head: '#E7E9F1',
}

const hex = (lib: PdfLib, h: string): RGB => lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

/** Remplacements des caractères absents de la police (sous-ensemble latin / français d'Inter). */
const REPLACEMENTS: [RegExp, string][] = [
  [/≤\s?/g, 'au plus '],
  [/≥\s?/g, 'au moins '],
  [/[●•]/g, '•'],
  [/○/g, '◦'],
  [/[    ]/g, ' '],
  [/‑/g, '-'],
  [/[\t]/g, ' '],
]

export class Report {
  private page!: PDFPage
  private y = 0
  private readonly pages: PDFPage[] = []
  private readonly charset: Set<number>
  readonly lib: PdfLib
  readonly doc: PDFDocument
  private readonly font: Record<Weight, PDFFont>
  private readonly opts: ReportOptions
  /** Première page = page de titre (sans en-tête). */
  private hasCover = false
  readonly width = A4_PORTRAIT[0] - 2 * MARGIN_X

  private constructor(lib: PdfLib, doc: PDFDocument, font: Record<Weight, PDFFont>, opts: ReportOptions) {
    this.lib = lib
    this.doc = doc
    this.font = font
    this.opts = opts
    this.charset = new Set(font.regular.getCharacterSet())
    this.newPage()
  }

  static async create(fonts: LabelFonts, opts: ReportOptions): Promise<Report> {
    const [lib, { default: fontkit }] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')])
    const doc = await lib.PDFDocument.create()
    doc.registerFontkit(fontkit)
    const [regular, bold, black] = await Promise.all((['regular', 'bold', 'black'] as const).map((w) => doc.embedFont(fonts.bytes[w], { subset: true })))
    doc.setTitle(opts.title)
    doc.setCreator('Space Diner – HACCP')
    doc.setProducer('Space Diner – HACCP (pdf-lib)')
    doc.setLanguage('fr-FR')
    return new Report(lib, doc, { regular, bold, black }, opts)
  }

  // ---------- texte ----------

  /** Texte affichable avec la police intégrée. */
  clean(text: string): string {
    let t = text
    for (const [re, by] of REPLACEMENTS) t = t.replace(re, by)
    let out = ''
    for (const ch of t) {
      const cp = ch.codePointAt(0)!
      if (ch === '\n' || this.charset.has(cp)) out += ch
      else if (ch === '◦') out += 'o'
      else if (/\s/.test(ch)) out += ' '
      else {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
        out += [...base].every((c) => this.charset.has(c.codePointAt(0)!)) ? base : ''
      }
    }
    return out
  }

  private widthOf(text: string, size: number, weight: Weight): number {
    return this.font[weight].widthOfTextAtSize(text, size)
  }

  /** Découpe en lignes de largeur ≤ maxWidth (mots, puis caractères pour un mot trop long). */
  wrap(text: string, size: number, maxWidth: number, weight: Weight = 'regular'): string[] {
    const lines: string[] = []
    for (const para of this.clean(text).split('\n')) {
      const words = para.split(/ +/)
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (this.widthOf(candidate, size, weight) <= maxWidth) {
          line = candidate
          continue
        }
        if (line) lines.push(line)
        if (this.widthOf(word, size, weight) <= maxWidth) {
          line = word
          continue
        }
        // Mot plus large que la colonne : coupé au caractère.
        let part = ''
        for (const ch of word) {
          if (this.widthOf(part + ch, size, weight) > maxWidth && part) {
            lines.push(part)
            part = ch
          } else part += ch
        }
        line = part
      }
      lines.push(line)
    }
    return lines
  }

  // ---------- pages ----------

  private newPage(): void {
    this.page = this.doc.addPage(A4_PORTRAIT)
    this.pages.push(this.page)
    this.y = TOP
  }

  /** Espace restant sur la page courante (points). */
  remaining(): number {
    return A4_PORTRAIT[1] - BOTTOM - this.y
  }

  /** Nouvelle page si moins de `h` points restent. */
  ensure(h: number): void {
    if (this.remaining() < h) this.newPage()
  }

  pageBreak(): void {
    if (this.y > TOP) this.newPage()
  }

  space(h: number): void {
    this.y += h
  }

  private drawText(text: string, x: number, yTop: number, size: number, weight: Weight, tone: Tone | string = 'normal', strike = false): void {
    const color = hex(this.lib, tone.startsWith('#') ? tone : COLORS[tone as Tone])
    const baseline = A4_PORTRAIT[1] - yTop - size * 0.82
    this.page.drawText(text, { x, y: baseline, size, font: this.font[weight], color })
    if (strike && text) {
      const w = this.widthOf(text, size, weight)
      this.page.drawLine({ start: { x, y: baseline + size * 0.3 }, end: { x: x + w, y: baseline + size * 0.3 }, thickness: 0.7, color })
    }
  }

  private rect(x: number, yTop: number, w: number, h: number, fill: string, border?: string): void {
    this.page.drawRectangle({
      x,
      y: A4_PORTRAIT[1] - yTop - h,
      width: w,
      height: h,
      color: hex(this.lib, fill),
      ...(border ? { borderColor: hex(this.lib, border), borderWidth: 0.8 } : {}),
    })
  }

  // ---------- blocs ----------

  /** Page de titre : bandeau de marque, titre, sous-titre et lignes d'information. */
  cover(title: string, subtitle: string, lines: [string, string][]): void {
    if (this.pages.length === 1) this.hasCover = true
    this.rect(0, 0, A4_PORTRAIT[0], 210, COLORS.band)
    this.page.drawRectangle({ x: 0, y: A4_PORTRAIT[1] - 214, width: A4_PORTRAIT[0], height: 4, color: hex(this.lib, '#FF2E97') })
    this.page.drawRectangle({ x: 0, y: A4_PORTRAIT[1] - 218, width: A4_PORTRAIT[0], height: 3, color: hex(this.lib, '#22E6F2') })
    let y = 70
    for (const l of this.wrap(title, 30, this.width, 'black')) {
      this.drawText(l, MARGIN_X, y, 30, 'black', '#F4F1EC')
      y += 36
    }
    for (const l of this.wrap(subtitle, 13, this.width, 'regular')) {
      this.drawText(l, MARGIN_X, y + 4, 13, 'regular', '#22E6F2')
      y += 18
    }
    this.y = 250
    this.keyValues(lines, { size: 11 })
    this.space(10)
  }

  /** Titre de partie (nouvelle page si moins de 120 pt restent). */
  h1(text: string): void {
    this.ensure(120)
    if (this.y > TOP) this.space(8)
    const lines = this.wrap(text, 17, this.width, 'black')
    for (const l of lines) {
      this.drawText(l, MARGIN_X, this.y, 17, 'black')
      this.y += 22
    }
    this.page.drawRectangle({ x: MARGIN_X, y: A4_PORTRAIT[1] - this.y - 2.5, width: 46, height: 2.5, color: hex(this.lib, COLORS.accent) })
    this.y += 12
  }

  h2(text: string): void {
    this.ensure(60)
    this.space(6)
    for (const l of this.wrap(text, 12.5, this.width, 'bold')) {
      this.drawText(l, MARGIN_X, this.y, 12.5, 'bold')
      this.y += 16
    }
    this.y += 3
  }

  h3(text: string, tone: Tone = 'muted'): void {
    this.ensure(40)
    this.space(2)
    for (const l of this.wrap(text.toUpperCase(), 8.5, this.width, 'bold')) {
      this.drawText(l, MARGIN_X, this.y, 8.5, 'bold', tone)
      this.y += 12
    }
    this.y += 2
  }

  paragraph(text: string, o: { size?: number; tone?: Tone; weight?: Weight; indent?: number } = {}): void {
    const size = o.size ?? 10
    const lh = size * 1.38
    const x = MARGIN_X + (o.indent ?? 0)
    for (const l of this.wrap(text, size, this.width - (o.indent ?? 0), o.weight ?? 'regular')) {
      this.ensure(lh)
      this.drawText(l, x, this.y, size, o.weight ?? 'regular', o.tone ?? 'normal')
      this.y += lh
    }
    this.y += size * 0.45
  }

  bullets(items: readonly string[], o: { size?: number; tone?: Tone } = {}): void {
    const size = o.size ?? 10
    const lh = size * 1.38
    for (const item of items) {
      const lines = this.wrap(item, size, this.width - 14)
      lines.forEach((l, i) => {
        this.ensure(lh)
        if (i === 0) this.drawText('•', MARGIN_X + 3, this.y, size, 'bold', 'accent')
        this.drawText(l, MARGIN_X + 14, this.y, size, 'regular', o.tone ?? 'normal')
        this.y += lh
      })
      this.y += 1.5
    }
    this.y += size * 0.35
  }

  /** Lignes « libellé : valeur » sur deux colonnes. */
  keyValues(rows: readonly [string, string][], o: { size?: number; labelWidth?: number } = {}): void {
    const size = o.size ?? 10
    const lh = size * 1.38
    const lw = o.labelWidth ?? Math.min(170, this.width * 0.34)
    for (const [k, v] of rows) {
      const kl = this.wrap(k, size, lw - 8, 'bold')
      const vl = this.wrap(v || '—', size, this.width - lw)
      const h = Math.max(kl.length, vl.length) * lh
      this.ensure(Math.min(h, lh * 3))
      const n = Math.max(kl.length, vl.length)
      for (let i = 0; i < n; i++) {
        if (this.remaining() < lh) this.newPage()
        if (kl[i]) this.drawText(kl[i], MARGIN_X, this.y, size, 'bold', 'muted')
        if (vl[i]) this.drawText(vl[i], MARGIN_X + lw, this.y, size, 'regular')
        this.y += lh
      }
      this.y += 3
    }
    this.y += 4
  }

  /** Encadré coloré (avertissement, information). */
  callout(text: string, tone: 'info' | 'warn' | 'danger' | 'ok' = 'info', size = 9.5): void {
    const fill = { info: '#EEF0F7', warn: '#FFF4DD', danger: '#FDE8E7', ok: '#E6F4EA' }[tone]
    const bar = { info: '#5B6178', warn: '#C27C00', danger: '#B3261E', ok: '#1E6B34' }[tone]
    const lh = size * 1.38
    const lines = this.wrap(text, size, this.width - 22)
    const h = lines.length * lh + 14
    this.ensure(Math.min(h, 200))
    if (h > this.remaining()) {
      // Encadré trop long pour la page : rendu en paragraphe simple.
      this.paragraph(text, { size })
      return
    }
    this.rect(MARGIN_X, this.y, this.width, h, fill)
    this.rect(MARGIN_X, this.y, 3, h, bar)
    let y = this.y + 7
    for (const l of lines) {
      this.drawText(l, MARGIN_X + 13, y, size, 'regular')
      y += lh
    }
    this.y += h + 8
  }

  /** Tableau : en-tête répété sur chaque page, lignes jamais coupées, fond alterné. */
  table(columns: readonly Column[], rows: readonly (readonly Cell[])[], o: { size?: number; empty?: string } = {}): void {
    const size = o.size ?? 8.5
    const lh = size * 1.32
    const pad = 4
    const total = columns.reduce((s, c) => s + c.width, 0)
    const widths = columns.map((c) => (c.width / total) * this.width)
    const xs = widths.map((_, i) => MARGIN_X + widths.slice(0, i).reduce((s, w) => s + w, 0))
    const header = () => {
      const lines = columns.map((c, i) => this.wrap(c.title, size, widths[i] - 2 * pad, 'bold'))
      const h = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad
      this.rect(MARGIN_X, this.y, this.width, h, COLORS.head)
      lines.forEach((ls, i) => ls.forEach((l, j) => this.drawText(l, this.alignX(l, xs[i], widths[i], pad, size, 'bold', columns[i].align), this.y + pad + j * lh, size, 'bold')))
      this.y += h
    }
    if (rows.length === 0) {
      this.ensure(40)
      header()
      this.drawText(this.clean(o.empty ?? 'Aucune donnée.'), MARGIN_X + pad, this.y + pad, size, 'regular', 'muted')
      this.y += lh + 2 * pad + 8
      return
    }
    this.ensure(70)
    header()
    rows.forEach((row, r) => {
      const cells = row.map((c) => (typeof c === 'string' ? { text: c } : c))
      const lines = cells.map((c, i) => this.wrap(c.text, size, widths[i] - 2 * pad, c.bold ? 'bold' : 'regular'))
      const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * pad
      if (this.remaining() < h) {
        this.newPage()
        header()
      }
      if (r % 2 === 1) this.rect(MARGIN_X, this.y, this.width, h, COLORS.zebra)
      cells.forEach((c, i) => {
        const w: Weight = c.bold ? 'bold' : 'regular'
        lines[i].forEach((l, j) => this.drawText(l, this.alignX(l, xs[i], widths[i], pad, size, w, columns[i].align), this.y + pad + j * lh, size, w, c.tone ?? 'normal', c.strike))
      })
      this.y += h
      this.page.drawLine({
        start: { x: MARGIN_X, y: A4_PORTRAIT[1] - this.y },
        end: { x: MARGIN_X + this.width, y: A4_PORTRAIT[1] - this.y },
        thickness: 0.4,
        color: hex(this.lib, COLORS.rule),
      })
    })
    this.y += 10
  }

  private alignX(text: string, x: number, w: number, pad: number, size: number, weight: Weight, align: Column['align']): number {
    if (align === 'right') return x + w - pad - this.widthOf(text, size, weight)
    if (align === 'center') return x + (w - this.widthOf(text, size, weight)) / 2
    return x + pad
  }

  /** Grille de photos (JPEG ou PNG) avec légende, `perRow` par ligne. */
  async photos(items: readonly { bytes: Uint8Array; kind: 'jpg' | 'png'; caption: string }[], perRow = 3): Promise<void> {
    const gap = 10
    const w = (this.width - gap * (perRow - 1)) / perRow
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow)
      const embedded = await Promise.all(row.map((p) => (p.kind === 'png' ? this.doc.embedPng(p.bytes) : this.doc.embedJpg(p.bytes))))
      const heights = embedded.map((img) => Math.min(w * 0.85, (img.height / img.width) * w))
      const captions = row.map((p) => this.wrap(p.caption, 7.5, w))
      const h = Math.max(...heights) + Math.max(...captions.map((c) => c.length)) * 10 + 8
      this.ensure(h)
      embedded.forEach((img, k) => {
        const ih = heights[k]
        const iw = Math.min(w, (img.width / img.height) * ih)
        const x = MARGIN_X + k * (w + gap)
        this.page.drawImage(img, { x, y: A4_PORTRAIT[1] - this.y - ih, width: iw, height: ih })
        captions[k].forEach((l, j) => this.drawText(l, x, this.y + ih + 3 + j * 10, 7.5, 'regular', 'muted'))
      })
      this.y += h + 4
    }
  }

  /** Métadonnée personnalisée du PDF (dictionnaire Info), relue par `readInfoEntry`. */
  setInfoEntry(key: string, value: string): void {
    infoDict(this.doc).set(this.lib.PDFName.of(key), this.lib.PDFHexString.fromText(value))
  }

  /** En-têtes, pieds de page (« Page 2 / 9 ») puis octets du PDF. */
  async save(): Promise<Uint8Array> {
    const n = this.pages.length
    const header = this.clean(this.opts.header)
    const right = this.clean(this.opts.headerRight ?? '')
    const footer = this.clean(this.opts.footer ?? '')
    this.pages.forEach((p, i) => {
      this.page = p
      if (i > 0 || !this.hasCover) {
        this.drawText(header, MARGIN_X, 24, 8, 'bold', 'muted')
        if (right) this.drawText(right, MARGIN_X + this.width - this.widthOf(right, 8, 'regular'), 24, 8, 'regular', 'muted')
        p.drawLine({ start: { x: MARGIN_X, y: A4_PORTRAIT[1] - 38 }, end: { x: MARGIN_X + this.width, y: A4_PORTRAIT[1] - 38 }, thickness: 0.5, color: hex(this.lib, COLORS.rule) })
      }
      const label = `Page ${i + 1} / ${n}`
      if (footer) this.drawText(footer, MARGIN_X, A4_PORTRAIT[1] - 32, 7.5, 'regular', 'muted')
      this.drawText(label, MARGIN_X + this.width - this.widthOf(label, 7.5, 'regular'), A4_PORTRAIT[1] - 32, 7.5, 'regular', 'muted')
    })
    return this.doc.save()
  }
}

/** Lit une métadonnée personnalisée écrite par `Report.setInfoEntry` (null si absente ou illisible). */
export async function readInfoEntry(pdf: Uint8Array | ArrayBuffer, key: string): Promise<string | null> {
  const lib = await import('pdf-lib')
  try {
    const doc = await lib.PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true })
    const v = infoDict(doc).lookup(lib.PDFName.of(key))
    if (v instanceof lib.PDFHexString || v instanceof lib.PDFString) return v.decodeText()
    return null
  } catch {
    return null
  }
}

/** Dictionnaire Info du PDF (méthode non publique dans les types de pdf-lib, mais stable). */
function infoDict(doc: PDFDocument): import('pdf-lib').PDFDict {
  return (doc as unknown as { getInfoDict(): import('pdf-lib').PDFDict }).getInfoDict()
}
