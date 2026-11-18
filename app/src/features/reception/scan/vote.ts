// Plusieurs lectures de la même photo (versions nettoyées différemment, rotations) donnent chacune
// un résultat, parfois avec une erreur de lecture (« L231154 » au lieu de « L23115A »). On garde,
// champ par champ, la valeur lue le plus souvent ; à égalité, la première trouvée (passes rangées
// de la plus fiable à la moins fiable). Fonction pure, testée dans scan.test.ts.
import type { LabelReading } from '../extensions.ts'

type Field = 'lot' | 'dlc' | 'ddm' | 'gtin'
const FIELDS: Field[] = ['lot', 'dlc', 'ddm', 'gtin']

export class ReadingVote {
  private counts: Record<Field, Map<string, number>> = { lot: new Map(), dlc: new Map(), ddm: new Map(), gtin: new Map() }

  add(r: LabelReading | null): void {
    if (!r) return
    for (const f of FIELDS) {
      const v = r[f]
      if (v) this.counts[f].set(v, (this.counts[f].get(v) ?? 0) + 1)
    }
  }

  private best(f: Field): [string, number] | null {
    let out: [string, number] | null = null
    for (const [v, n] of this.counts[f]) if (!out || n > out[1]) out = [v, n] // Map : ordre d'arrivée
    return out
  }

  private total(f: Field): number {
    let n = 0
    for (const c of this.counts[f].values()) n += c
    return n
  }

  /** Lot et date lus de façon concordante au moins `n` fois : inutile de chercher plus loin. */
  confirmed(n = 2): boolean {
    const lot = this.best('lot')
    const date = [this.best('dlc'), this.best('ddm')].sort((a, b) => (b?.[1] ?? 0) - (a?.[1] ?? 0))[0]
    return !!lot && lot[1] >= n && !!date && date[1] >= n
  }

  /** Au moins une date trouvée (sinon, on essaie la photo tournée). */
  hasDate(): boolean {
    return this.total('dlc') + this.total('ddm') > 0
  }

  result(): LabelReading | null {
    const r: LabelReading = {}
    for (const f of FIELDS) {
      const b = this.best(f)
      if (b) r[f] = b[0]
    }
    // Une étiquette porte une DLC ou une DDM : on garde le type lu le plus souvent (la DLC à égalité).
    if (r.dlc && r.ddm) {
      if (this.total('ddm') > this.total('dlc')) delete r.dlc
      else delete r.ddm
    }
    return Object.keys(r).length ? r : null
  }
}
