// Rappel produit : retrouver où est passé un lot (ou un code-barres) dans le registre. Fonctions pures.
// Même logique que la fonction serveur trace_lot() (supabase/migrations/…1100_lot4_produits.sql), calculée
// sur l'appareil à partir du registre (serveur si connecté, sinon cet appareil) pour marcher aussi hors-ligne,
// et étendue au code-barres (GTIN) :
//   - réceptions dont une ligne porte ce lot / ce GTIN, dans n'importe quelle version (corrections comprises) ;
//   - étiquettes portant ce lot, ou faites à partir d'une de ces réceptions (source_record_ids),
//     ou d'une de ces étiquettes (un niveau de plus : préparation faite avec une préparation) ;
//   - produits jetés portant ce lot, ou liés (related_record_id) à une de ces réceptions / étiquettes.
// Les saisies en quarantaine sont comprises et signalées : pour un rappel, mieux vaut trop que pas assez.
import type { LabelPrintedPayload, ReceptionItem, WastePayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { asLabel } from '../labels/model.ts'
import { buildEntries, type Entry } from '../processes/entries.ts'
import { buildReceptions, buildWastes, type ReceptionEntry, type WasteEntry } from '../reception/model.ts'
import { normalizeGtin } from '../reception/scan/gtin.ts'

export type RecallRecord = HaccpRecord & { quarantine_reason?: string | null }

/** Lot comparé sans casse ni espaces (comme haccp_norm_lot côté serveur). */
export const normLot = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, '').toLocaleUpperCase('fr-FR')

/** Recherche saisie : un lot, et si c'est un code-barres valide, aussi ce GTIN. */
export interface RecallQuery {
  lot: string | null
  gtin: string | null
}

export function parseRecallQuery(text: string): RecallQuery {
  const t = text.trim()
  const digits = t.replace(/[\s-]/g, '')
  const gtin = /^\d{8,14}$/.test(digits) ? normalizeGtin(digits) : null
  return { lot: t ? t.slice(0, 100) : null, gtin }
}

export interface ReceptionHit {
  entry: ReceptionEntry
  /** Lignes concernées (version en vigueur ; à défaut, version d'origine si la correction a changé le lot). */
  items: ReceptionItem[]
  /** Trouvé par le lot ou seulement par le code-barres. */
  matchedBy: 'lot' | 'gtin'
  /** Produits jetés pour rappel déjà notés pour cette réception. */
  withdrawn: WasteEntry[]
  quarantine: string | null
}

export interface LabelHit {
  entry: Entry<LabelPrintedPayload>
  matchedBy: 'lot' | 'source_record'
  quarantine: string | null
}

export interface WasteHit {
  entry: WasteEntry
  matchedBy: 'lot' | 'related_record'
  quarantine: string | null
}

export interface RecallResult {
  query: RecallQuery
  receptions: ReceptionHit[]
  labels: LabelHit[]
  wastes: WasteHit[]
  /** Lots trouvés sur les réceptions de ce code-barres (recherche par GTIN). */
  lotsFound: string[]
  /** Réceptions de ce code-barres sans n° de lot noté : à vérifier à la main. */
  withoutLot: number
}

const sameGtin = (a: string | undefined, gtin: string) => !!a && normalizeGtin(a) === gtin

export function traceRecall(records: readonly RecallRecord[], query: RecallQuery): RecallResult {
  const empty: RecallResult = { query, receptions: [], labels: [], wastes: [], lotsFound: [], withoutLot: 0 }
  if (!query.lot && !query.gtin) return empty
  const quarantine = new Map(records.filter((r) => r.quarantine_reason).map((r) => [r.id, r.quarantine_reason!]))
  const chainQuarantine = (e: Entry<unknown>) => e.versions.map((v) => quarantine.get(v.record.id)).find(Boolean) ?? null
  const wastes = buildWastes(records as HaccpRecord[])
  const receptions = buildReceptions(records as HaccpRecord[])
  const labels = buildEntries(records as HaccpRecord[], ['label_printed'], asLabel)

  // 1. Lots recherchés : celui saisi, plus ceux des réceptions de ce code-barres.
  const lots = new Set<string>()
  if (query.lot) lots.add(normLot(query.lot))
  const lotsFound = new Set<string>()
  let withoutLot = 0
  if (query.gtin) {
    for (const e of receptions)
      for (const it of e.payload.items)
        if (sameGtin(it.gtin, query.gtin)) {
          if (it.lot) {
            lots.add(normLot(it.lot))
            lotsFound.add(it.lot.trim())
          } else withoutLot++
        }
  }
  const lotMatch = (l: string | undefined) => !!l && lots.has(normLot(l))

  // 2. Réceptions (toutes versions : une correction qui change le lot ne fait pas disparaître la réception).
  const receptionHits: ReceptionHit[] = []
  for (const e of receptions) {
    const byLot = (items: readonly ReceptionItem[]) => items.filter((i) => lotMatch(i.lot))
    const byGtin = (items: readonly ReceptionItem[]) => (query.gtin ? items.filter((i) => sameGtin(i.gtin, query.gtin!)) : [])
    let items = byLot(e.payload.items)
    let matchedBy: ReceptionHit['matchedBy'] = 'lot'
    if (!items.length) items = e.versions.map((v) => byLot(v.payload.items)).find((x) => x.length) ?? []
    if (!items.length) {
      items = byGtin(e.payload.items)
      matchedBy = 'gtin'
    }
    if (!items.length) continue
    const ids = new Set(e.versions.map((v) => v.record.id))
    receptionHits.push({
      entry: e,
      items,
      matchedBy,
      withdrawn: wastes.filter((w) => w.payload.reason === 'recall' && w.payload.related_record_id && ids.has(w.payload.related_record_id)),
      quarantine: chainQuarantine(e),
    })
  }
  const receptionIds = new Set(receptionHits.flatMap((h) => h.entry.versions.map((v) => v.record.id)))

  // 3. Étiquettes : lot, ou faites à partir d'une réception trouvée ; puis celles faites à partir de ces étiquettes.
  const labelHits: LabelHit[] = []
  const labelIds = new Set<string>()
  const cites = (e: Entry<LabelPrintedPayload>, ids: Set<string>) => e.versions.some((v) => (v.payload.source_record_ids ?? []).some((id) => ids.has(id)))
  for (const pass of [0, 1]) {
    for (const e of labels) {
      if (labelHits.some((h) => h.entry.id === e.id)) continue
      const byLot = pass === 0 && e.versions.some((v) => lotMatch(v.payload.lot))
      const bySource = cites(e, pass === 0 ? receptionIds : labelIds)
      if (!byLot && !bySource) continue
      labelHits.push({ entry: e, matchedBy: byLot ? 'lot' : 'source_record', quarantine: chainQuarantine(e) })
    }
    for (const h of labelHits) for (const v of h.entry.versions) labelIds.add(v.record.id)
  }

  // 4. Produits jetés : lot, ou liés à une réception / étiquette trouvée.
  const linked = new Set([...receptionIds, ...labelIds])
  const wasteHits: WasteHit[] = []
  for (const w of wastes) {
    const byLot = w.versions.some((v) => lotMatch(v.payload.lot))
    const byLink = w.versions.some((v) => !!v.payload.related_record_id && linked.has(v.payload.related_record_id))
    if (byLot || byLink) wasteHits.push({ entry: w, matchedBy: byLot ? 'lot' : 'related_record', quarantine: chainQuarantine(w) })
  }

  const byTime = <T extends { entry: { time: string } }>(a: T, b: T) => b.entry.time.localeCompare(a.entry.time)
  return {
    query,
    receptions: receptionHits.sort(byTime),
    labels: labelHits.sort(byTime),
    wastes: wasteHits.sort(byTime),
    lotsFound: [...lotsFound],
    withoutLot,
  }
}

/** Ligne de réception encore à retirer : acceptée et sans retrait « rappel » noté pour ce produit. */
export function toWithdraw(hit: ReceptionHit): ReceptionItem[] {
  const done = new Set(hit.withdrawn.map((w) => w.payload.product.trim().toLocaleLowerCase('fr-FR')))
  return hit.items.filter((i) => i.accepted && !done.has(i.product.trim().toLocaleLowerCase('fr-FR')))
}

/** Payload du retrait d'une ligne reçue (produit jeté, motif « Rappel produit », lié à la réception). */
export function withdrawalPayload(hit: ReceptionHit, item: ReceptionItem, quantity: string, comment: string): WastePayload {
  const p: WastePayload = { product: item.product.slice(0, 80), reason: 'recall', related_record_id: hit.entry.id }
  if (item.lot) p.lot = item.lot
  if (quantity.trim()) p.quantity = quantity.trim()
  if (comment.trim()) p.comment = comment.trim()
  return p
}
