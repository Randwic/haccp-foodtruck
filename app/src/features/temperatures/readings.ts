// Relevés d'enceintes reconstruits à partir du registre (append-only) : corrections appliquées,
// actions correctives rattachées. Fonctions pures, réutilisables (historique, accueil, export).
import type { CorrectiveActionPayload, MeasureSource, TemperatureCheckPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { withoutTestMarked } from '../../../../shared/testMarks.ts'

export interface ReadingVersion {
  record: HaccpRecord
  value_c: number
  in_range: boolean
  /** Motif de la correction (absent pour le relevé d'origine). */
  reason?: string
}

export interface Reading {
  /** id du relevé d'origine. */
  id: string
  original: HaccpRecord
  equipmentId: string
  /** Heure du relevé d'origine (device_time ISO). */
  time: string
  authorId: string
  source: MeasureSource
  /** Valeur en vigueur (dernière correction appliquée). */
  value_c: number
  in_range: boolean
  /** Relevé d'origine puis corrections, dans l'ordre. */
  versions: ReadingVersion[]
  /** Dernier enregistrement de la chaîne (à viser par une nouvelle correction). */
  latest: HaccpRecord
  corrected: boolean
  /** Actions correctives liées au relevé ou à l'une de ses corrections. */
  correctiveActions: HaccpRecord[]
  /** Hors seuil (valeur en vigueur) et aucune action corrective enregistrée. */
  missingAction: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Payload de relevé exploitable, ou null. */
export function asTemperatureCheck(p: unknown): TemperatureCheckPayload | null {
  if (!isObj(p)) return null
  if (typeof p.equipment_id !== 'string' || typeof p.value_c !== 'number' || typeof p.in_range !== 'boolean') return null
  const source = p.source === 'probe' || p.source === 'sensor' ? p.source : 'manual'
  return { equipment_id: p.equipment_id, value_c: p.value_c, source, in_range: p.in_range }
}

export function asCorrectiveAction(p: unknown): CorrectiveActionPayload | null {
  if (!isObj(p) || typeof p.related_record_id !== 'string' || typeof p.action !== 'string') return null
  return p as unknown as CorrectiveActionPayload
}

const chronological = (a: HaccpRecord, b: HaccpRecord) => a.device_time.localeCompare(b.device_time) || a.device_seq - b.device_seq

/**
 * Reconstitue les relevés (`temperature_check`) à partir d'enregistrements de tous types.
 * Une correction peut viser le relevé d'origine ou une correction précédente : elle est rattachée à l'origine.
 * Triés du plus récent au plus ancien.
 */
export function buildReadings(records: readonly HaccpRecord[]): Reading[] {
  const sorted = withoutTestMarked(records).sort(chronological)
  const readings = new Map<string, Reading>()
  const rootOf = new Map<string, string>()

  for (const r of sorted) {
    if (r.type !== 'temperature_check') continue
    const p = asTemperatureCheck(r.payload)
    if (!p) continue
    rootOf.set(r.id, r.id)
    readings.set(r.id, {
      id: r.id,
      original: r,
      equipmentId: p.equipment_id,
      time: r.device_time,
      authorId: r.author_id,
      source: p.source,
      value_c: p.value_c,
      in_range: p.in_range,
      versions: [{ record: r, value_c: p.value_c, in_range: p.in_range }],
      latest: r,
      corrected: false,
      correctiveActions: [],
      missingAction: false,
    })
  }

  for (const r of sorted) {
    if (r.type !== 'correction' || !r.supersedes_id) continue
    const root = rootOf.get(r.supersedes_id)
    const reading = root ? readings.get(root) : undefined
    if (!reading || !isObj(r.payload)) continue
    const p = asTemperatureCheck(r.payload.replacement)
    if (!p) continue
    rootOf.set(r.id, reading.id)
    reading.versions.push({ record: r, value_c: p.value_c, in_range: p.in_range, reason: typeof r.payload.reason === 'string' ? r.payload.reason : '' })
    reading.value_c = p.value_c
    reading.in_range = p.in_range
    reading.source = p.source
    reading.latest = r
    reading.corrected = true
  }

  for (const r of sorted) {
    if (r.type !== 'corrective_action') continue
    const p = asCorrectiveAction(r.payload)
    const root = p ? rootOf.get(p.related_record_id) : undefined
    if (root) readings.get(root)!.correctiveActions.push(r)
  }

  const list = [...readings.values()]
  for (const reading of list) reading.missingAction = !reading.in_range && reading.correctiveActions.length === 0
  return list.sort((a, b) => b.time.localeCompare(a.time))
}

/** Types d'enregistrement à charger pour reconstruire les relevés. */
export const READING_RECORD_TYPES = ['temperature_check', 'correction', 'corrective_action'] as const
