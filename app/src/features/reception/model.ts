// Réception & traçabilité (lot 3) : fonctions pures, testées dans reception.test.ts.
// Les réceptions sont reconstruites depuis le registre (append-only) comme les procédés :
// corrections en chaîne (original barré) et actions correctives rattachées.
import type { ReceptionItem, ReceptionPayload, Supplier, WastePayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { RECEPTION_MAX_PHOTOS, STORAGE_KINDS, WASTE_REASONS } from '../../../../shared/validation.ts'
import { formatTemperature, isInRange, type TemperatureThreshold } from '../../ui/temperature.ts'
import { buildEntries, type Entry } from '../processes/entries.ts'
import { isoDate } from '../processes/timing.ts'
import { localDateOf, startOfLocalDay } from '../temperatures/schedule.ts'

export { RECEPTION_MAX_PHOTOS }
/** Photos par ligne, par bon de livraison, par perte (contrat : 0..5 par tableau). */
export const PHOTOS_PER_FIELD = 5
/** Historique affiché (jours) et fenêtre de chargement. */
export const RECEPTION_HISTORY_DAYS = 30

export type Storage = ReceptionItem['storage']
export type WasteReason = WastePayload['reason']

export const STORAGE_LABELS: Record<Storage, string> = { fridge: 'Frigo', freezer: 'Congélateur', ambient: 'Ambiant' }
export const STORAGE_ORDER: readonly Storage[] = STORAGE_KINDS

/**
 * Températures maximales à réception selon la conservation exigée (GBPH, arrêté du 21/12/2009) :
 * produits réfrigérés ≤ +4 °C, surgelés ≤ −18 °C. Valeurs proposées, à confirmer selon votre PMS.
 * (Pas de seuil configurable dans le contrat pour l'instant — voir docs/ui.md.)
 */
export const RECEPTION_THRESHOLDS: Record<Exclude<Storage, 'ambient'>, TemperatureThreshold> = {
  fridge: { min_c: null, max_c: 4 },
  freezer: { min_c: null, max_c: -18 },
}

export function storageThreshold(storage: Storage): TemperatureThreshold | null {
  return storage === 'ambient' ? null : RECEPTION_THRESHOLDS[storage]
}

/** Ligne acceptée dont la température dépasse le seuil de sa conservation. */
export function isOutOfRange(item: Pick<ReceptionItem, 'storage' | 'temperature_c'>): boolean {
  const t = storageThreshold(item.storage)
  return t !== null && typeof item.temperature_c === 'number' && !isInRange(item.temperature_c, t)
}

export const WASTE_REASON_LABELS: Record<WasteReason, string> = {
  expired: 'Date dépassée',
  non_compliant: 'Non conforme',
  temperature: 'Température',
  damaged: 'Abîmé',
  recall: 'Rappel produit',
  other: 'Autre',
}
export const WASTE_REASON_ORDER: readonly WasteReason[] = WASTE_REASONS

/** Motifs de refus fréquents (pastilles). */
export const REFUSAL_QUICK_REASONS = ['Température non conforme', 'DLC dépassée ou trop courte', 'Emballage abîmé', 'Produit non commandé'] as const

// ---------- Lecture des payloads ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : [])

function asItem(v: unknown): ReceptionItem | null {
  if (!isObj(v) || !str(v.product) || typeof v.accepted !== 'boolean') return null
  if (!(STORAGE_KINDS as readonly unknown[]).includes(v.storage)) return null
  const it: ReceptionItem = { product: v.product, storage: v.storage as Storage, accepted: v.accepted }
  if (str(v.lot)) it.lot = v.lot
  if (str(v.dlc)) it.dlc = v.dlc
  if (str(v.ddm)) it.ddm = v.ddm
  if (str(v.gtin)) it.gtin = v.gtin
  if (typeof v.temperature_c === 'number' && Number.isFinite(v.temperature_c)) it.temperature_c = v.temperature_c
  if (str(v.refusal_reason)) it.refusal_reason = v.refusal_reason
  const photos = strings(v.photo_paths)
  if (photos.length) it.photo_paths = photos
  return it
}

/** Réception exploitable, ou null (payload illisible : ignoré, jamais affiché à moitié). */
export function asReception(p: unknown): ReceptionPayload | null {
  if (!isObj(p) || !str(p.supplier_id) || !Array.isArray(p.items)) return null
  const items = p.items.map(asItem)
  if (items.length === 0 || items.some((i) => i === null)) return null
  const r: ReceptionPayload = {
    supplier_id: p.supplier_id,
    vehicle_ok: p.vehicle_ok === true,
    packaging_ok: p.packaging_ok === true,
    items: items as ReceptionItem[],
  }
  if (str(p.delivery_note)) r.delivery_note = p.delivery_note
  if (str(p.comment)) r.comment = p.comment
  const photos = strings(p.photo_paths)
  if (photos.length) r.photo_paths = photos
  return r
}

export function asWaste(p: unknown): WastePayload | null {
  if (!isObj(p) || !str(p.product) || !(WASTE_REASONS as readonly unknown[]).includes(p.reason)) return null
  const w: WastePayload = { product: p.product, reason: p.reason as WasteReason }
  if (str(p.lot)) w.lot = p.lot
  if (str(p.quantity)) w.quantity = p.quantity
  if (str(p.comment)) w.comment = p.comment
  if (str(p.related_record_id)) w.related_record_id = p.related_record_id
  const photos = strings(p.photo_paths)
  if (photos.length) w.photo_paths = photos
  return w
}

/** Toutes les photos d'une réception (bon de livraison puis lignes), sans doublon. */
export function receptionPhotoPaths(r: Pick<ReceptionPayload, 'photo_paths' | 'items'>): string[] {
  return [...new Set([...(r.photo_paths ?? []), ...r.items.flatMap((i) => i.photo_paths ?? [])])]
}

// ---------- Entrées reconstruites ----------

export type ReceptionEntry = Entry<ReceptionPayload> & {
  refused: ReceptionItem[]
  /** Lignes acceptées hors température (version en vigueur). */
  outOfRange: ReceptionItem[]
  missingAction: boolean
  /** Toutes les photos de toutes les versions (une correction peut en ajouter). */
  photos: string[]
}
export type WasteEntry = Entry<WastePayload>

export function buildReceptions(records: readonly HaccpRecord[]): ReceptionEntry[] {
  return buildEntries(records, ['reception'], asReception)
    .map((e) => {
      const outOfRange = e.payload.items.filter((i) => i.accepted && isOutOfRange(i))
      return {
        ...e,
        refused: e.payload.items.filter((i) => !i.accepted),
        outOfRange,
        missingAction: outOfRange.length > 0 && e.correctiveActions.length === 0,
        photos: [...new Set(e.versions.flatMap((v) => receptionPhotoPaths(v.payload)))],
      }
    })
    .sort((a, b) => b.time.localeCompare(a.time))
}

export function buildWastes(records: readonly HaccpRecord[]): WasteEntry[] {
  return buildEntries(records, ['waste'], asWaste).sort((a, b) => b.time.localeCompare(a.time))
}

/** Types d'enregistrement à charger pour le module. */
export const RECEPTION_RECORD_TYPES = ['reception', 'waste', 'correction', 'corrective_action'] as const

// ---------- Suggestions ----------

/** Produits déjà reçus de ce fournisseur (plus récents d'abord), avec la dernière conservation utilisée. */
export function supplierProducts(entries: readonly ReceptionEntry[], supplierId: string | null, max = 8): { product: string; storage: Storage }[] {
  const out: { product: string; storage: Storage }[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (supplierId && e.payload.supplier_id !== supplierId) continue
    for (const it of e.payload.items) {
      const key = it.product.trim().toLocaleLowerCase('fr-FR')
      if (!key || seen.has(key) || out.length >= max) continue
      seen.add(key)
      out.push({ product: it.product.trim(), storage: it.storage })
    }
  }
  return out
}

/** Lignes reçues correspondant à un produit (et éventuellement un lot) : pour lier une perte à sa réception. */
export function matchingReceptions(entries: readonly ReceptionEntry[], product: string, lot?: string): ReceptionEntry[] {
  const p = product.trim().toLocaleLowerCase('fr-FR')
  const l = lot?.trim().toLocaleLowerCase('fr-FR')
  if (!p && !l) return []
  return entries.filter((e) =>
    e.payload.items.some(
      (i) => (!p || i.product.trim().toLocaleLowerCase('fr-FR') === p) && (!l || (i.lot ?? '').trim().toLocaleLowerCase('fr-FR') === l),
    ),
  )
}

/**
 * Point d'extension « recherche de lot / rappel » (hors périmètre du lot 3a) : réceptions et pertes
 * dont une ligne porte ce numéro de lot (insensible à la casse et aux espaces).
 */
export function findByLot(receptions: readonly ReceptionEntry[], wastes: readonly WasteEntry[], lot: string) {
  const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, '').toLocaleLowerCase('fr-FR')
  const l = norm(lot)
  if (!l) return { receptions: [], wastes: [] }
  return {
    receptions: receptions.filter((e) => e.payload.items.some((i) => norm(i.lot) === l)),
    wastes: wastes.filter((w) => norm(w.payload.lot) === l),
  }
}

// ---------- Corrections : ce qui a changé ----------

export interface Change {
  label: string
  before: string
  after: string
}

const yesNo = (b: boolean) => (b ? 'conforme' : 'non conforme')
const dateLabel = (iso: string | undefined) => (iso ? frenchDate(iso) : '—')

function itemSummary(i: ReceptionItem): string {
  const parts = [i.product]
  if (i.lot) parts.push(`lot ${i.lot}`)
  return parts.join(', ')
}

/** Différences lisibles entre deux versions d'une réception (correction). */
export function diffReception(prev: ReceptionPayload, next: ReceptionPayload, supplierName: (id: string) => string): Change[] {
  const out: Change[] = []
  const push = (label: string, a: string, b: string) => {
    if (a !== b) out.push({ label, before: a, after: b })
  }
  push('Fournisseur', supplierName(prev.supplier_id), supplierName(next.supplier_id))
  push('Bon de livraison', prev.delivery_note ?? '—', next.delivery_note ?? '—')
  push('Véhicule', yesNo(prev.vehicle_ok), yesNo(next.vehicle_ok))
  push('Emballages', yesNo(prev.packaging_ok), yesNo(next.packaging_ok))
  const n = Math.max(prev.items.length, next.items.length)
  for (let k = 0; k < n; k++) {
    const a = prev.items[k]
    const b = next.items[k]
    if (!a) {
      out.push({ label: 'Produit ajouté', before: '—', after: itemSummary(b) })
      continue
    }
    if (!b) {
      out.push({ label: 'Produit retiré', before: itemSummary(a), after: '—' })
      continue
    }
    const name = b.product
    push(`${name} — produit`, a.product, b.product)
    push(`${name} — lot`, a.lot ?? '—', b.lot ?? '—')
    push(`${name} — DLC`, dateLabel(a.dlc), dateLabel(b.dlc))
    push(`${name} — DDM`, dateLabel(a.ddm), dateLabel(b.ddm))
    push(`${name} — conservation`, STORAGE_LABELS[a.storage], STORAGE_LABELS[b.storage])
    push(
      `${name} — température`,
      a.temperature_c === undefined ? '—' : formatTemperature(a.temperature_c),
      b.temperature_c === undefined ? '—' : formatTemperature(b.temperature_c),
    )
    push(`${name} — décision`, a.accepted ? 'accepté' : `refusé (${a.refusal_reason ?? ''})`, b.accepted ? 'accepté' : `refusé (${b.refusal_reason ?? ''})`)
    push(`${name} — photos`, String(a.photo_paths?.length ?? 0), String(b.photo_paths?.length ?? 0))
  }
  push('Photos du bon', String(prev.photo_paths?.length ?? 0), String(next.photo_paths?.length ?? 0))
  push('Commentaire', prev.comment ?? '—', next.comment ?? '—')
  return out
}

// ---------- Dates ----------

/** « 18/11/2026 » pour AAAA-MM-JJ. */
export function frenchDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

/** Date locale du jour (AAAA-MM-JJ) dans le fuseau de l'établissement. */
export function todayIso(now: Date, timeZone: string): string {
  return isoDate(localDateOf(now, timeZone))
}

// ---------- Compteurs (accueil, écran du module) ----------

export interface ReceptionSummary {
  /** Heure de la dernière réception (ISO) ou null. */
  last: string | null
  today: number
  /** Lignes refusées depuis 7 jours. */
  refusedThisWeek: number
  missingActions: number
}

export function summarizeReceptions(entries: readonly ReceptionEntry[], now: Date, timeZone: string): ReceptionSummary {
  const today = startOfLocalDay(now, timeZone).getTime()
  const week = startOfLocalDay(now, timeZone, 6).getTime()
  return {
    last: entries[0]?.time ?? null,
    today: entries.filter((e) => Date.parse(e.time) >= today).length,
    refusedThisWeek: entries.filter((e) => Date.parse(e.time) >= week).reduce((n, e) => n + e.refused.length, 0),
    missingActions: entries.filter((e) => e.missingAction).length,
  }
}

export function supplierNameOf(suppliers: readonly Supplier[]): (id: string) => string {
  return (id) => suppliers.find((s) => s.id === id)?.name ?? 'Fournisseur inconnu'
}
