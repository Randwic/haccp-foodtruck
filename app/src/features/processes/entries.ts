// Procédés reconstruits à partir du registre (append-only) : fonctions pures.
// - Chaque enregistrement d'origine (étape de lot, mesure ponctuelle) devient une `Entry`, avec ses
//   corrections en chaîne (une correction peut viser l'origine ou une correction précédente) et les
//   actions correctives liées à l'origine ou à l'une de ses corrections.
// - Les étapes d'un même `batch_id` forment un lot (refroidissement, remise en température, décongélation).
import type { CookingCheckPayload, CoolingPayload, HotHoldingPayload, MeasureSource, ProcessStep, ThawingPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord, RecordType } from '../../../../shared/types.ts'
import { asCorrectiveAction } from '../temperatures/readings.ts'
import type { SpotKind, TimedKind } from './thresholds.ts'

export interface EntryVersion<P> {
  record: HaccpRecord
  payload: P
  /** Motif de la correction (absent pour l'enregistrement d'origine). */
  reason?: string
}

export interface Entry<P> {
  /** id de l'enregistrement d'origine. */
  id: string
  type: RecordType
  original: HaccpRecord
  /** Heure de l'enregistrement d'origine (device_time ISO). */
  time: string
  authorId: string
  /** Payload en vigueur (dernière correction appliquée). */
  payload: P
  versions: EntryVersion<P>[]
  /** Dernier enregistrement de la chaîne (à viser par une nouvelle correction). */
  latest: HaccpRecord
  corrected: boolean
  correctiveActions: HaccpRecord[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const source = (v: unknown): MeasureSource => (v === 'probe' || v === 'sensor' ? v : 'manual')

/** Étape de refroidissement / remise en température exploitable, ou null. */
export function asTimedStep(p: unknown): CoolingPayload | null {
  if (!isObj(p) || !str(p.batch_id) || !str(p.product) || !num(p.value_c)) return null
  if (p.step !== 'start' && p.step !== 'check' && p.step !== 'end') return null
  const out: CoolingPayload = { batch_id: p.batch_id, step: p.step, product: p.product, value_c: p.value_c, source: source(p.source) }
  if (typeof p.in_range === 'boolean') out.in_range = p.in_range
  if (num(p.duration_min)) out.duration_min = p.duration_min
  return out
}

export function asThawingStep(p: unknown): ThawingPayload | null {
  if (!isObj(p) || !str(p.batch_id) || !str(p.product) || !str(p.equipment_id)) return null
  if (p.step !== 'start' && p.step !== 'end') return null
  const out: ThawingPayload = { batch_id: p.batch_id, step: p.step, product: p.product, equipment_id: p.equipment_id }
  if (str(p.dlc)) out.dlc = p.dlc
  return out
}

export function asSpotCheck(p: unknown): (HotHoldingPayload & CookingCheckPayload) | null {
  if (!isObj(p) || !str(p.product) || !num(p.value_c) || typeof p.in_range !== 'boolean') return null
  const out: HotHoldingPayload = { product: p.product, value_c: p.value_c, source: source(p.source), in_range: p.in_range }
  if (str(p.equipment_id)) out.equipment_id = p.equipment_id
  return out
}

const chronological = (a: HaccpRecord, b: HaccpRecord) => a.device_time.localeCompare(b.device_time) || a.device_seq - b.device_seq

/**
 * Entrées (corrections et actions correctives rattachées) des types demandés, triées chronologiquement.
 * `parse` rejette les payloads inexploitables (ignorés, jamais affichés à moitié).
 */
export function buildEntries<P>(records: readonly HaccpRecord[], types: readonly RecordType[], parse: (p: unknown) => P | null): Entry<P>[] {
  const sorted = [...records].sort(chronological)
  const entries = new Map<string, Entry<P>>()
  const rootOf = new Map<string, string>()

  for (const r of sorted) {
    if (!types.includes(r.type)) continue
    const p = parse(r.payload)
    if (!p) continue
    rootOf.set(r.id, r.id)
    entries.set(r.id, {
      id: r.id,
      type: r.type,
      original: r,
      time: r.device_time,
      authorId: r.author_id,
      payload: p,
      versions: [{ record: r, payload: p }],
      latest: r,
      corrected: false,
      correctiveActions: [],
    })
  }
  for (const r of sorted) {
    if (r.type !== 'correction' || !r.supersedes_id || !isObj(r.payload)) continue
    const root = rootOf.get(r.supersedes_id)
    const entry = root ? entries.get(root) : undefined
    if (!entry) continue
    const p = parse(r.payload.replacement)
    if (!p) continue
    rootOf.set(r.id, entry.id)
    entry.versions.push({ record: r, payload: p, reason: str(r.payload.reason) ? r.payload.reason : '' })
    entry.payload = p
    entry.latest = r
    entry.corrected = true
  }
  for (const r of sorted) {
    if (r.type !== 'corrective_action') continue
    const p = asCorrectiveAction(r.payload)
    const root = p ? rootOf.get(p.related_record_id) : undefined
    if (root) entries.get(root)!.correctiveActions.push(r)
  }
  return [...entries.values()]
}

// ---------- Lots à durée limitée (refroidissement, remise en température) ----------

export interface TimedBatch {
  kind: TimedKind
  batchId: string
  product: string
  start: Entry<CoolingPayload>
  checks: Entry<CoolingPayload>[]
  end: Entry<CoolingPayload> | null
  /** start, checks puis end, dans l'ordre chronologique. */
  steps: Entry<CoolingPayload>[]
  startedAt: string
  endedAt: string | null
  running: boolean
  /** Lot clos : objectif atteint dans le délai (valeur en vigueur de l'étape `end`). */
  inRange: boolean | null
  durationMin: number | null
  /** Lot clos hors objectif sans action corrective. */
  missingAction: boolean
}

function groupSteps<P extends { batch_id: string; step: string }>(entries: Entry<P>[]) {
  const byBatch = new Map<string, Entry<P>[]>()
  for (const e of entries) byBatch.set(e.payload.batch_id, [...(byBatch.get(e.payload.batch_id) ?? []), e])
  return byBatch
}

/**
 * Lots de refroidissement / remise en température. Un lot sans étape `start` (hors de la fenêtre
 * chargée) est ignoré. Si plusieurs `end` existent, le premier clôt le lot. Plus récents d'abord.
 */
export function buildTimedBatches(records: readonly HaccpRecord[], kind: TimedKind): TimedBatch[] {
  const entries = buildEntries(records, [kind], asTimedStep)
  const batches: TimedBatch[] = []
  for (const [batchId, steps] of groupSteps(entries)) {
    const start = steps.find((s) => s.payload.step === 'start')
    if (!start) continue
    const end = steps.find((s) => s.payload.step === 'end') ?? null
    const checks = steps.filter((s) => s.payload.step === 'check' && (!end || s.time <= end.time))
    const ordered = [start, ...checks, ...(end ? [end] : [])]
    const inRange = end ? end.payload.in_range === true : null
    batches.push({
      kind,
      batchId,
      product: start.payload.product,
      start,
      checks,
      end,
      steps: ordered,
      startedAt: start.time,
      endedAt: end?.time ?? null,
      running: end === null,
      inRange,
      durationMin: end?.payload.duration_min ?? null,
      missingAction: end !== null && inRange === false && end.correctiveActions.length === 0,
    })
  }
  return batches.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** Dernière température connue d'un lot (dernière étape, corrections appliquées). */
export function lastValue(batch: TimedBatch): { value_c: number; time: string; step: ProcessStep } {
  const s = batch.steps[batch.steps.length - 1]
  return { value_c: s.payload.value_c, time: s.time, step: s.payload.step }
}

// ---------- Décongélation ----------

export interface ThawBatch {
  batchId: string
  product: string
  equipmentId: string
  start: Entry<ThawingPayload>
  end: Entry<ThawingPayload> | null
  steps: Entry<ThawingPayload>[]
  startedAt: string
  endedAt: string | null
  running: boolean
  /** DLC en vigueur (étape `end`, corrections appliquées). */
  dlc: string | null
}

export function buildThawBatches(records: readonly HaccpRecord[]): ThawBatch[] {
  const entries = buildEntries(records, ['thawing'], asThawingStep)
  const batches: ThawBatch[] = []
  for (const [batchId, steps] of groupSteps(entries)) {
    const start = steps.find((s) => s.payload.step === 'start')
    if (!start) continue
    const end = steps.find((s) => s.payload.step === 'end') ?? null
    batches.push({
      batchId,
      product: start.payload.product,
      equipmentId: start.payload.equipment_id,
      start,
      end,
      steps: end ? [start, end] : [start],
      startedAt: start.time,
      endedAt: end?.time ?? null,
      running: end === null,
      dlc: end?.payload.dlc ?? null,
    })
  }
  return batches.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// ---------- Mesures ponctuelles (maintien au chaud, cuisson à cœur) ----------

export type SpotEntry = Entry<HotHoldingPayload> & { kind: SpotKind; missingAction: boolean }

export function buildSpotChecks(records: readonly HaccpRecord[]): SpotEntry[] {
  return buildEntries(records, ['hot_holding', 'cooking_check'], asSpotCheck)
    .map((e) => ({ ...e, kind: e.type as SpotKind, missingAction: !e.payload.in_range && e.correctiveActions.length === 0 }))
    .sort((a, b) => b.time.localeCompare(a.time))
}

// ---------- Suggestions de produits ----------

/** Produits récents (plus récent d'abord, sans doublon à la casse près), complétés par `defaults`. */
export function recentProducts(products: readonly { product: string; time: string }[], defaults: readonly string[] = [], max = 6): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (p: string) => {
    const name = p.trim()
    const key = name.toLocaleLowerCase('fr-FR')
    if (!name || seen.has(key) || out.length >= max) return
    seen.add(key)
    out.push(name)
  }
  for (const p of [...products].sort((a, b) => b.time.localeCompare(a.time))) push(p.product)
  for (const d of defaults) push(d)
  return out
}

/** Types d'enregistrement à charger pour reconstruire les procédés. */
export const PROCESS_RECORD_TYPES = ['cooling', 'reheating', 'thawing', 'hot_holding', 'cooking_check', 'correction', 'corrective_action'] as const
