// Huiles de friture (lot 5) : composés polaires (décret n° 2008-184 : 25 % maximum), changements d'huile.
// Fonctions pures, testées dans oil.test.ts. Les contrôles sont reconstruits depuis le registre comme
// les autres modules : corrections en chaîne (original barré), actions correctives liées.
import { DEFAULT_OIL_SETTINGS, type OilChangePayload, type OilCheckPayload } from '../../../../shared/payloads.ts'
import type { Equipment, HaccpRecord, Settings } from '../../../../shared/types.ts'
import { OIL_METHODS } from '../../../../shared/validation.ts'
import { formatNumber, type NumberRules } from '../../ui/numberPad.ts'
import { buildEntries, type Entry } from '../processes/entries.ts'
import { startOfLocalDay } from '../temperatures/schedule.ts'

export const OIL_HISTORY_DAYS = 30
export const OIL_RECORD_TYPES = ['oil_check', 'oil_change', 'correction', 'corrective_action'] as const
/** Saisie du contrat : 0..50 %, une décimale. */
export const POLAR_RULES: NumberRules = { min: 0, max: 50, decimals: 1 }

export type OilMethod = OilCheckPayload['method']
export const METHOD_LABELS: Record<OilMethod, string> = { tester: 'Testeur électronique', strip: 'Bandelette' }
export const METHOD_ORDER: readonly OilMethod[] = OIL_METHODS

export interface OilLimits {
  /** Limite (%), au-delà : hors limite (rouge), action corrective obligatoire. */
  max: number
  /** Alerte préventive (%) : à partir de cette valeur, « à surveiller » (ambre). */
  warn: number
}

export function oilLimits(settings: Pick<Settings, 'oil_polar_max' | 'oil_polar_warn'> | null | undefined): OilLimits {
  const max = Number.isFinite(settings?.oil_polar_max) ? settings!.oil_polar_max : DEFAULT_OIL_SETTINGS.oil_polar_max
  const warn = Number.isFinite(settings?.oil_polar_warn) && settings!.oil_polar_warn < max ? settings!.oil_polar_warn : Math.min(DEFAULT_OIL_SETTINGS.oil_polar_warn, max - 1)
  return { max, warn }
}

export type OilLevel = 'ok' | 'warn' | 'out'

/** Vert < alerte ≤ ambre ≤ limite < rouge. */
export function oilLevel(percent: number, limits: OilLimits): OilLevel {
  if (percent > limits.max) return 'out'
  if (percent >= limits.warn) return 'warn'
  return 'ok'
}

/** `in_range` du contrat : valeur ≤ limite en vigueur au moment de la saisie. */
export function isOilInRange(percent: number, limits: OilLimits): boolean {
  return percent <= limits.max
}

export const LEVEL_LABELS: Record<OilLevel, string> = { ok: 'Conforme', warn: 'À surveiller', out: 'Hors limite' }

export const formatPercent = (v: number) => `${formatNumber(v)} %`

// ---------- Lecture des payloads ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function asOilCheck(p: unknown): OilCheckPayload | null {
  if (!isObj(p) || typeof p.equipment_id !== 'string' || typeof p.polar_percent !== 'number' || !Number.isFinite(p.polar_percent)) return null
  if (!(OIL_METHODS as readonly unknown[]).includes(p.method) || typeof p.in_range !== 'boolean') return null
  return { equipment_id: p.equipment_id, polar_percent: p.polar_percent, method: p.method as OilMethod, in_range: p.in_range }
}

export function asOilChange(p: unknown): OilChangePayload | null {
  if (!isObj(p) || typeof p.equipment_id !== 'string') return null
  return typeof p.comment === 'string' && p.comment.trim() ? { equipment_id: p.equipment_id, comment: p.comment } : { equipment_id: p.equipment_id }
}

export type OilCheckEntry = Entry<OilCheckPayload> & { missingAction: boolean }
export type OilChangeEntry = Entry<OilChangePayload>

const newestFirst = <T extends { time: string }>(a: T, b: T) => b.time.localeCompare(a.time)

export function buildOilChecks(records: readonly HaccpRecord[]): OilCheckEntry[] {
  return buildEntries(records, ['oil_check'], asOilCheck)
    .map((e) => ({ ...e, missingAction: !e.payload.in_range && e.correctiveActions.length === 0 }))
    .sort(newestFirst)
}

export function buildOilChanges(records: readonly HaccpRecord[]): OilChangeEntry[] {
  return buildEntries(records, ['oil_change'], asOilChange).sort(newestFirst)
}

// ---------- Par bac ----------

export interface VatStatus {
  vat: Equipment
  lastCheck: OilCheckEntry | null
  lastChange: OilChangeEntry | null
  /** Niveau du dernier contrôle (limites actuelles), null sans contrôle depuis le dernier changement. */
  level: OilLevel | null
  /** Contrôles depuis le dernier changement d'huile, du plus ancien au plus récent (graphe). */
  sinceChange: OilCheckEntry[]
  missingActions: OilCheckEntry[]
  checkedToday: boolean
}

export function vatStatuses(input: { vats: readonly Equipment[]; checks: readonly OilCheckEntry[]; changes: readonly OilChangeEntry[]; limits: OilLimits; now: Date; timeZone: string }): VatStatus[] {
  const today = startOfLocalDay(input.now, input.timeZone).getTime()
  return input.vats
    .filter((v) => v.kind === 'fryer_vat' && v.active)
    .map((vat) => {
      const checks = input.checks.filter((c) => c.payload.equipment_id === vat.id)
      const lastChange = input.changes.find((c) => c.payload.equipment_id === vat.id) ?? null
      const sinceChange = checks.filter((c) => !lastChange || c.time > lastChange.time).reverse()
      const lastCheck = checks[0] ?? null
      const current = lastCheck && (!lastChange || lastCheck.time > lastChange.time) ? lastCheck : null
      return {
        vat,
        lastCheck,
        lastChange,
        level: current ? oilLevel(current.payload.polar_percent, input.limits) : null,
        sinceChange,
        missingActions: checks.filter((c) => c.missingAction),
        checkedToday: checks.some((c) => Date.parse(c.time) >= today),
      }
    })
}

export interface OilSummary {
  vats: number
  missingActions: number
  /** Bacs dont le dernier contrôle (depuis le changement) est hors limite / à surveiller. */
  out: number
  warn: number
  /** Bacs sans contrôle aujourd'hui. */
  notCheckedToday: number
}

export function summarizeOil(statuses: readonly VatStatus[]): OilSummary {
  return {
    vats: statuses.length,
    missingActions: statuses.reduce((n, s) => n + s.missingActions.length, 0),
    out: statuses.filter((s) => s.level === 'out').length,
    warn: statuses.filter((s) => s.level === 'warn').length,
    notCheckedToday: statuses.filter((s) => !s.checkedToday).length,
  }
}

export interface Change {
  label: string
  before: string
  after: string
}

export function diffOilCheck(prev: OilCheckPayload, next: OilCheckPayload): Change[] {
  const out: Change[] = []
  if (prev.polar_percent !== next.polar_percent) out.push({ label: 'Composés polaires', before: formatPercent(prev.polar_percent), after: formatPercent(next.polar_percent) })
  if (prev.method !== next.method) out.push({ label: 'Méthode', before: METHOD_LABELS[prev.method], after: METHOD_LABELS[next.method] })
  return out
}

export function diffOilChange(prev: OilChangePayload, next: OilChangePayload): Change[] {
  return (prev.comment ?? '—') === (next.comment ?? '—') ? [] : [{ label: 'Commentaire', before: prev.comment ?? '—', after: next.comment ?? '—' }]
}
