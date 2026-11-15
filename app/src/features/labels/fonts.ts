// Polices des étiquettes et du tableau des allergènes : Inter (SIL OFL 1.1, voir fonts/OFL.txt), sous-ensemble
// latin / français converti en TrueType (les CFF sous-ensemblés par pdf-lib sont illisibles). Les mêmes
// fichiers servent à l'aperçu (SVG, @font-face) et au PDF (intégrés, sous-ensemble) : mesures identiques.
// Fichiers précachés par le service worker (impression hors-ligne).
import regularUrl from './fonts/Inter-Regular.ttf?url'
import boldUrl from './fonts/Inter-Bold.ttf?url'
import blackUrl from './fonts/Inter-Black.ttf?url'

export type FontWeight = 'regular' | 'bold' | 'black'
export const FONT_WEIGHTS: readonly FontWeight[] = ['regular', 'bold', 'black']
export const LABEL_FONT_URLS: Record<FontWeight, string> = { regular: regularUrl, bold: boldUrl, black: blackUrl }
export const CSS_WEIGHT: Record<FontWeight, number> = { regular: 400, bold: 700, black: 900 }
/** Famille CSS de l'aperçu (déclarée par <LabelFontFaces />). */
export const LABEL_FONT_FAMILY = 'Space Diner Label'

/** Largeur d'un texte en points pour une taille donnée (sans crénage, comme pdf-lib le dessine). */
export type Measure = (text: string, size: number, weight: FontWeight) => number

export interface LabelFonts {
  bytes: Record<FontWeight, Uint8Array>
  measure: Measure
}

export type FontBytesLoader = (weight: FontWeight) => Promise<Uint8Array>

const fetchLoader: FontBytesLoader = async (weight) => {
  const res = await fetch(LABEL_FONT_URLS[weight])
  if (!res.ok) throw new Error(`Police introuvable (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

let loader: FontBytesLoader = fetchLoader
let cache: Promise<LabelFonts> | null = null

/** Remplace le chargement des polices (tests : lecture sur disque). */
export function setFontBytesLoader(l: FontBytesLoader | null): void {
  loader = l ?? fetchLoader
  cache = null
}

interface FontkitFont {
  unitsPerEm: number
  layout(text: string): { glyphs: { advanceWidth: number }[] }
}

/** Charge (une fois) les polices et prépare la mesure des textes. */
export function loadLabelFonts(): Promise<LabelFonts> {
  cache ??= (async () => {
    const [{ default: fontkit }, ...list] = await Promise.all([import('@pdf-lib/fontkit'), ...FONT_WEIGHTS.map((w) => loader(w))])
    const bytes = Object.fromEntries(FONT_WEIGHTS.map((w, i) => [w, list[i]])) as Record<FontWeight, Uint8Array>
    const fonts = Object.fromEntries(FONT_WEIGHTS.map((w) => [w, fontkit.create(bytes[w]) as unknown as FontkitFont])) as Record<FontWeight, FontkitFont>
    const widths = new Map<string, number>()
    const measure: Measure = (text, size, weight) => {
      const key = `${weight}\u0000${text}`
      let w = widths.get(key)
      if (w === undefined) {
        const f = fonts[weight]
        w = f.layout(text).glyphs.reduce((s, g) => s + g.advanceWidth, 0) / f.unitsPerEm
        widths.set(key, w)
      }
      return w * size
    }
    return { bytes, measure }
  })().catch((e: unknown) => {
    cache = null
    throw e
  })
  return cache
}
