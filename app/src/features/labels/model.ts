// Étiquettes DLC (lot 4) : fonctions pures, testées dans labels.test.ts.
// - DLC = date-heure de fabrication / ouverture / décongélation + durée de vie (heures) du produit ou de la recette.
// - Les dates affichées et les échéances (« aujourd'hui », « demain ») suivent le fuseau de l'établissement
//   (Europe/Paris), changements d'heure compris : une durée de 24 h reste 24 h réelles.
// - Les étiquettes sont reconstruites depuis le registre (append-only) : corrections en chaîne, pertes liées.
import { ALLERGEN_LABELS, ALLERGENS, type Allergen, type LabelPrintedPayload, type Product, type Recipe, type StorageMode } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS, STORAGE_KINDS } from '../../../../shared/validation.ts'
import { buildEntries, type Entry, type ThawBatch } from '../processes/entries.ts'
import type { ReceptionEntry, WasteEntry } from '../reception/model.ts'
import { addDays, localDateOf, zonedParts, zonedTimeToDate, type LocalDate } from '../temperatures/schedule.ts'

export type LabelKind = LabelPrintedPayload['kind']

export const KIND_TITLES: Record<LabelKind, string> = {
  opened: 'Ouverture d’un produit',
  prepared: 'Préparation maison',
  thawed: 'Décongélation',
}
/** Mention imprimée devant la date de fabrication. */
export const KIND_MADE_LABEL: Record<LabelKind, string> = { opened: 'Ouvert le', prepared: 'Préparé le', thawed: 'Décongelé le' }

export const STORAGE_LABELS: Record<StorageMode, string> = { fridge: 'Frigo', freezer: 'Congélateur', ambient: 'Ambiant' }
/** Conservation imprimée sur l'étiquette. */
export const STORAGE_PRINT: Record<StorageMode, string> = {
  fridge: 'Au réfrigérateur',
  freezer: 'Au congélateur',
  ambient: 'À température ambiante',
}

/** Libellés courts des allergènes pour l'étiquette (cuisine) ; le tableau clientèle garde ALLERGEN_LABELS. */
export const ALLERGEN_SHORT: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaces: 'Crustacés',
  oeufs: 'Œufs',
  poissons: 'Poissons',
  arachides: 'Arachides',
  soja: 'Soja',
  lait: 'Lait',
  fruits_a_coque: 'Fruits à coque',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
}
export { ALLERGEN_LABELS, ALLERGENS }

// ---------- Allergènes ----------

/** Allergènes connus, sans doublon, dans l'ordre de l'annexe II. */
export function orderAllergens(list: Iterable<string>): Allergen[] {
  const set = new Set(list)
  return ALLERGENS.filter((a) => set.has(a))
}

/** Allergènes d'une recette = union de ceux de ses ingrédients + allergènes supplémentaires. */
export function recipeAllergens(recipe: Pick<Recipe, 'ingredient_product_ids' | 'extra_allergens'>, products: readonly Product[]): Allergen[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  return orderAllergens([...recipe.ingredient_product_ids.flatMap((id) => byId.get(id)?.allergens ?? []), ...recipe.extra_allergens])
}

/** Pour chaque allergène de la recette : d'où il vient (noms des ingrédients, « ajouté » pour un extra). */
export function allergenSources(recipe: Pick<Recipe, 'ingredient_product_ids' | 'extra_allergens'>, products: readonly Product[]): { allergen: Allergen; from: string[] }[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  return recipeAllergens(recipe, products).map((allergen) => ({
    allergen,
    from: [
      ...recipe.ingredient_product_ids.map((id) => byId.get(id)).filter((p): p is Product => !!p && p.allergens.includes(allergen)).map((p) => p.name),
      ...(recipe.extra_allergens.includes(allergen) ? ['ajouté à la recette'] : []),
    ],
  }))
}

// ---------- Durées de vie ----------

const HOUR = 3_600_000

/** « 24 h », « 36 h », « 3 jours », « 7 jours », « 3 jours 12 h » (heures seules sous 3 jours non entiers). */
export function formatShelfLife(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'Non applicable'
  if (hours <= 24 || (hours < 72 && hours % 24 !== 0)) return `${hours} h`
  const d = Math.floor(hours / 24)
  const h = hours % 24
  const days = `${d} jour${d > 1 ? 's' : ''}`
  return h ? `${days} ${h} h` : days
}

/** Saisie conviviale : nombre + unité. */
export type ShelfUnit = 'hours' | 'days'
export function splitShelfLife(hours: number | null): { value: string; unit: ShelfUnit } {
  if (hours === null) return { value: '', unit: 'days' }
  return hours % 24 === 0 ? { value: String(hours / 24), unit: 'days' } : { value: String(hours), unit: 'hours' }
}
/** Heures saisies, ou null si vide ; NaN si illisible. */
export function shelfLifeHours(value: string, unit: ShelfUnit): number | null {
  const v = value.trim().replace(',', '.')
  if (v === '') return null
  if (!/^\d+(\.5)?$/.test(v)) return Number.NaN
  const n = Number(v) * (unit === 'days' ? 24 : 1)
  return Number.isInteger(n) ? n : Number.NaN
}

// ---------- Dates ----------

/** Date à la minute (les secondes n'apparaissent pas sur l'étiquette). */
export function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000)
}

/** DLC = début + durée de vie (heures réelles, indépendantes des changements d'heure). */
export function computeDlc(madeAt: Date, hours: number): Date {
  return new Date(madeAt.getTime() + hours * HOUR)
}

/** DLC d'une décongélation du module Procédés (date AAAA-MM-JJ) : fin de cette journée locale (23:59). */
export function dlcFromDate(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return zonedTimeToDate({ year: y, month: m, day: d }, 23, 59, timeZone)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Valeurs des champs date / heure (type=date, type=time) pour un instant, dans le fuseau. */
export function toLocalInputs(d: Date, timeZone: string): { date: string; time: string } {
  const p = zonedParts(d, timeZone)
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` }
}

/** Instant saisi dans les champs date / heure (heure locale de l'établissement), ou null si invalide. */
export function fromLocalInputs(date: string, time: string, timeZone: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!dm || !tm) return null
  const day: LocalDate = { year: Number(dm[1]), month: Number(dm[2]), day: Number(dm[3]) }
  const check = new Date(Date.UTC(day.year, day.month - 1, day.day))
  if (check.getUTCMonth() !== day.month - 1) return null
  return zonedTimeToDate(day, Number(tm[1]), Number(tm[2]), timeZone)
}

/** « 15/11/2026 14:30 » (étiquette). */
export function formatLabelDateTime(d: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(d), timeZone)
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`
}
export function formatLabelDate(d: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(d), timeZone)
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`
}
export function formatLabelTime(d: Date | string, timeZone: string): string {
  const p = zonedParts(new Date(d), timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}
/** « mardi » */
export function weekdayOf(d: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone }).format(new Date(d))
}

/** Règles du contrat : DLC strictement après la fabrication, au plus 90 jours après. */
export function dlcProblem(madeAt: Date, dlc: Date | null): string | null {
  if (!dlc) return 'Date ou heure invalide.'
  if (dlc.getTime() <= madeAt.getTime()) return 'La DLC doit être postérieure à la date d’ouverture / de fabrication.'
  if (dlc.getTime() - madeAt.getTime() > LIMITS.labelMaxShelfLifeMs) return 'La DLC ne peut pas dépasser 90 jours.'
  return null
}

// ---------- Échéances ----------

export type DueState = 'expired' | 'today' | 'tomorrow' | 'later'

/** Échéance d'une DLC par rapport à maintenant : dépassée, aujourd'hui (jour local), demain, plus tard. */
export function dueState(dlc: Date | string, now: Date, timeZone: string): DueState {
  const t = new Date(dlc)
  if (t.getTime() <= now.getTime()) return 'expired'
  const today = localDateOf(now, timeZone)
  const day = localDateOf(t, timeZone)
  const key = (d: LocalDate) => d.year * 10_000 + d.month * 100 + d.day
  if (key(day) === key(today)) return 'today'
  if (key(day) === key(addDays(today, 1))) return 'tomorrow'
  return 'later'
}

// ---------- Registre ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'

/** Étiquette exploitable, ou null (payload illisible : ignoré). */
export function asLabel(p: unknown): LabelPrintedPayload | null {
  if (!isObj(p) || !str(p.name) || !str(p.made_at) || !str(p.dlc_at)) return null
  if (p.kind !== 'opened' && p.kind !== 'prepared' && p.kind !== 'thawed') return null
  if (!(STORAGE_KINDS as readonly unknown[]).includes(p.storage)) return null
  if (Number.isNaN(Date.parse(p.made_at)) || Number.isNaN(Date.parse(p.dlc_at))) return null
  const out: LabelPrintedPayload = {
    kind: p.kind,
    name: p.name,
    made_at: p.made_at,
    dlc_at: p.dlc_at,
    allergens: orderAllergens(Array.isArray(p.allergens) ? p.allergens.filter(str) : []),
    storage: p.storage as StorageMode,
    copies: typeof p.copies === 'number' ? p.copies : 1,
  }
  if (str(p.product_id)) out.product_id = p.product_id
  if (str(p.recipe_id)) out.recipe_id = p.recipe_id
  if (str(p.lot)) out.lot = p.lot
  if (Array.isArray(p.source_record_ids)) out.source_record_ids = p.source_record_ids.filter(str)
  return out
}

export type LabelEntry = Entry<LabelPrintedPayload> & {
  /** Perte enregistrée pour cette étiquette (bouton « Jeté »), la plus récente. */
  waste: WasteEntry | null
}

/** Étiquettes (corrections appliquées), plus récentes d'abord, avec la perte liée éventuelle. */
export function buildLabels(records: readonly HaccpRecord[], wastes: readonly WasteEntry[] = []): LabelEntry[] {
  return buildEntries(records, ['label_printed'], asLabel)
    .map((e) => {
      const ids = new Set(e.versions.map((v) => v.record.id))
      const waste = wastes.find((w) => w.payload.related_record_id !== undefined && ids.has(w.payload.related_record_id)) ?? null
      return { ...e, waste }
    })
    .sort((a, b) => b.time.localeCompare(a.time))
}

export const LABEL_RECORD_TYPES = ['label_printed', 'waste', 'correction', 'reception', 'thawing'] as const

export interface DueItem {
  entry: LabelEntry
  state: Exclude<DueState, 'later'>
  dlc: Date
}

/**
 * Étiquettes à surveiller : DLC dépassée (non jetées, non marquées épuisées), aujourd'hui, demain.
 * Ordre : dépassées d'abord, puis par DLC croissante.
 */
export function dueItems(entries: readonly LabelEntry[], now: Date, timeZone: string, dismissed: ReadonlySet<string> = new Set()): DueItem[] {
  const order = { expired: 0, today: 1, tomorrow: 2 } as const
  const out: DueItem[] = []
  for (const entry of entries) {
    if (entry.waste || dismissed.has(entry.id)) continue
    const state = dueState(entry.payload.dlc_at, now, timeZone)
    if (state === 'later') continue
    out.push({ entry, state, dlc: new Date(entry.payload.dlc_at) })
  }
  return out.sort((a, b) => order[a.state] - order[b.state] || a.dlc.getTime() - b.dlc.getTime())
}

export interface DueSummary {
  expired: number
  today: number
  tomorrow: number
}
export function summarizeDue(items: readonly DueItem[]): DueSummary {
  return {
    expired: items.filter((i) => i.state === 'expired').length,
    today: items.filter((i) => i.state === 'today').length,
    tomorrow: items.filter((i) => i.state === 'tomorrow').length,
  }
}

// ---------- Lots reçus (traçabilité amont) ----------

const STOP = new Set(['de', 'du', 'des', 'en', 'la', 'le', 'les', 'au', 'aux', 'a', 'et'])
/** Mots significatifs d'un nom de produit (minuscules, sans accents, singulier grossier). */
export function productTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
}

/** Deux libellés désignent le même produit si les mots de l'un sont tous dans l'autre (« Pain burger » ~ « Pain burger brioché »). */
export function sameProduct(a: string, b: string): boolean {
  const ta = productTokens(a)
  const tb = productTokens(b)
  if (!ta.length || !tb.length) return false
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)]
  return short.every((w) => long.has(w))
}

export interface LotSuggestion {
  lot: string
  /** Réception (enregistrement d'origine) à mettre dans source_record_ids. */
  receptionId: string
  receivedAt: string
  product: string
  dlc?: string
}

/** Lots acceptés récemment pour ce produit (plus récents d'abord, sans doublon de lot). */
export function recentLots(receptions: readonly ReceptionEntry[], productName: string, max = 6): LotSuggestion[] {
  const out: LotSuggestion[] = []
  const seen = new Set<string>()
  for (const e of [...receptions].sort((a, b) => b.time.localeCompare(a.time))) {
    for (const it of e.payload.items) {
      if (!it.accepted || !it.lot || !sameProduct(it.product, productName)) continue
      const key = it.lot.replace(/\s+/g, '').toLowerCase()
      if (seen.has(key) || out.length >= max) continue
      seen.add(key)
      out.push({ lot: it.lot, receptionId: e.id, receivedAt: e.time, product: it.product, dlc: it.dlc })
    }
  }
  return out
}

/** Décongélations terminées récemment (avec DLC) — reprises pour une étiquette. */
export function finishedThaws(batches: readonly ThawBatch[], now: Date, maxAgeDays = 3): ThawBatch[] {
  const from = now.getTime() - maxAgeDays * 86_400_000
  return batches.filter((b) => !b.running && b.end && b.dlc && Date.parse(b.endedAt!) >= from).sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))
}

/** Produit du catalogue correspondant au libellé libre d'une décongélation. */
export function productForName(products: readonly Product[], name: string): Product | null {
  return products.find((p) => p.active && sameProduct(p.name, name)) ?? null
}

/** N° de lot interne proposé pour une préparation : « P1511-1430 » (jour, mois, heure locale). */
export function internalLot(madeAt: Date, timeZone: string): string {
  const p = zonedParts(madeAt, timeZone)
  return `P${pad(p.day)}${pad(p.month)}-${pad(p.hour)}${pad(p.minute)}`
}

// ---------- Contenu de l'étiquette ----------

/** Ce qui est imprimé (aperçu et PDF partagent ce contenu). */
export interface LabelContent {
  kind: LabelKind
  name: string
  madeAt: string
  dlcAt: string
  storage: StorageMode
  allergens: Allergen[]
  lot?: string
  operator: string
  timeZone: string
}

export function contentFromPayload(p: LabelPrintedPayload, operator: string, timeZone: string): LabelContent {
  return { kind: p.kind, name: p.name, madeAt: p.made_at, dlcAt: p.dlc_at, storage: p.storage, allergens: p.allergens, lot: p.lot, operator, timeZone }
}
