// Produits jetés (tuile dédiée) : suggestions de produits et compteurs. Fonctions pures, testées.
import type { LabelPrintedPayload, Product, WastePayload } from '../../../../shared/payloads.ts'
import { startOfLocalDay } from '../temperatures/schedule.ts'
import { supplierProducts, type ReceptionEntry } from './model.ts'

/**
 * Suggestions, sans doublon (insensible à la casse) : étiquettes en cours (non jetées, DLC pas encore
 * vieille de plus de 2 jours) — souvent ce qu'on jette —, puis produits récemment reçus, puis catalogue.
 */
export function wasteSuggestions(input: {
  labels: readonly { payload: Pick<LabelPrintedPayload, 'name' | 'dlc_at'>; waste: unknown }[]
  receptions: readonly ReceptionEntry[]
  products: readonly Pick<Product, 'name' | 'active'>[]
  now: Date
  max?: number
}): string[] {
  const max = input.max ?? 12
  const out: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    const n = name.trim()
    const k = n.toLocaleLowerCase('fr-FR')
    if (!n || seen.has(k) || out.length >= max) return
    seen.add(k)
    out.push(n)
  }
  const recent = input.now.getTime() - 2 * 86_400_000
  for (const l of input.labels) if (!l.waste && Date.parse(l.payload.dlc_at) >= recent) add(l.payload.name)
  for (const p of supplierProducts(input.receptions, null, max)) add(p.product)
  for (const p of input.products) if (p.active) add(p.name)
  return out
}

/** Pertes depuis le début du 7ᵉ jour local précédent (« cette semaine », 7 jours glissants). */
export function wastesThisWeek<T extends { time: string; payload: Pick<WastePayload, 'reason'> }>(wastes: readonly T[], now: Date, timeZone: string): T[] {
  const from = startOfLocalDay(now, timeZone, 6).getTime()
  return wastes.filter((w) => Date.parse(w.time) >= from)
}
