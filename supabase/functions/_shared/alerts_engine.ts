// Moteur d'alertes (lot 6) — logique PURE : à partir de l'état (références, mesures des capteurs,
// registre récent, alertes ouvertes) et d'une horloge injectée, décide quelles alertes ouvrir et
// lesquelles résoudre. Aucune entrée/sortie ici (voir alerts_evaluate.ts).
import { DEFAULT_PROCESS_THRESHOLDS, type Alert, type AlertKind } from '../../../shared/payloads.ts'
import type { Equipment, EquipmentKind, Settings, Threshold } from '../../../shared/types.ts'
import type { EngineRecord, NewAlertRow, SensorForAlerts, SensorReadingRow } from './repo.ts'
import { currentSlot, formatLocalMoment } from './schedule.ts'

export const ALERT_RULES = {
  /** Un créneau de relevé est « en retard » 1 h après son heure. */
  checkOverdueGraceMinutes: 60,
  /** Saisie hors seuil sans action corrective : alerte après 30 min. */
  correctiveActionGraceMinutes: 30,
  /** Pile faible : ouverture sous 20 %, résolution à partir de 25 % (hystérésis contre le va-et-vient 19/20 %). */
  batteryLowPercent: 20,
  batteryResolvePercent: 25,
  /** Registre relu : enregistrements reçus depuis 8 jours (corrections et actions correctives comprises). */
  recordsLookbackDays: 8,
  /** Mesures relues : tolérance + 24 h. */
  readingsLookbackHours: 24,
  /** Rappel : marge pour l'irrégularité de la planification (toutes les 5 min). */
  repeatSlackMs: 60_000,
} as const

/** Types du registre lus par le moteur. */
export const ENGINE_RECORD_TYPES = ['temperature_check', 'correction', 'corrective_action', 'cooling', 'reheating', 'hot_holding', 'cooking_check'] as const

/**
 * Seuil d'enceinte par défaut quand aucun n'est saisi (mêmes valeurs que l'app :
 * useTemperatureData.DEFAULT_ENCLOSURE_THRESHOLDS et manager/helpers.defaultThreshold) — à confirmer selon le PMS.
 */
export const DEFAULT_ENCLOSURE_THRESHOLDS: Partial<Record<EquipmentKind, { min_c: number | null; max_c: number | null; tolerance_minutes: number }>> = {
  fridge: { min_c: null, max_c: 4, tolerance_minutes: 20 },
  freezer: { min_c: null, max_c: -18, tolerance_minutes: 30 },
}

export interface EngineInput {
  now: Date
  timeZone: string
  settings: Pick<Settings, 'daily_check_times' | 'missed_slot_carry_over' | 'sensor_silent_minutes'>
  equipment: Equipment[]
  thresholds: Threshold[]
  sensors: SensorForAlerts[]
  readings: SensorReadingRow[]
  records: EngineRecord[]
  openAlerts: Alert[]
  /**
   * Début de la surveillance des relevés : premier enrôlement d'un appareil. `null` = aucun appareil
   * (aucune alerte « relevé non fait ») ; absent = pas de restriction. Les créneaux antérieurs sont ignorés.
   */
  monitoringStart?: Date | null
}

export interface EngineResult {
  open: NewAlertRow[]
  /** id des alertes ouvertes à résoudre (condition disparue). */
  resolve: string[]
}

type State = { state: 'open'; alert: NewAlertRow } | { state: 'clear' }

/** Sujet d'une alerte : une seule alerte ouverte par sujet. */
export function subjectKey(a: Pick<NewAlertRow, 'kind' | 'equipment_id' | 'sensor_id' | 'related_record_id'>): string {
  if (a.kind === 'sensor_out_of_range' || a.kind === 'sensor_silent' || a.kind === 'sensor_battery_low') return `${a.kind}|${a.sensor_id}`
  if (a.kind === 'check_overdue') return `${a.kind}|${a.equipment_id}`
  return `${a.kind}|${a.related_record_id}`
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** « 3,5 °C », « −18 °C ». */
export function formatC(v: number): string {
  const r = Math.round(v * 10) / 10
  return `${String(r).replace('.', ',').replace('-', '−')} °C`
}

function boundText(t: { min_c: number | null; max_c: number | null }): string {
  if (t.min_c !== null && t.max_c !== null) return `${formatC(t.min_c)} à ${formatC(t.max_c)}`
  if (t.max_c !== null) return `≤ ${formatC(t.max_c)}`
  return `≥ ${formatC(t.min_c as number)}`
}

function clip(s: string): string {
  return [...s].length <= 300 ? s : [...s].slice(0, 299).join('') + '…'
}

/** Seuil d'enceinte en vigueur : le sien, sinon le générique, sinon le défaut du type (comme l'app). */
export function enclosureThreshold(
  equipment: Equipment,
  thresholds: readonly Threshold[],
): { min_c: number | null; max_c: number | null; tolerance_minutes: number } | null {
  const own = thresholds.find((t) => t.equipment_id === equipment.id && t.check_type === 'temperature_check')
  const generic = thresholds.find((t) => t.equipment_id === null && t.check_type === 'temperature_check')
  const t = own ?? generic
  if (t && (t.min_c !== null || t.max_c !== null)) return { min_c: t.min_c, max_c: t.max_c, tolerance_minutes: t.tolerance_minutes }
  return DEFAULT_ENCLOSURE_THRESHOLDS[equipment.kind] ?? null
}

function inRange(v: number, t: { min_c: number | null; max_c: number | null }): boolean {
  return (t.min_c === null || v >= t.min_c) && (t.max_c === null || v <= t.max_c)
}

/** Enregistrement « en vigueur » : original + dernière correction appliquée. */
export interface EffectiveRecord {
  id: string // id de l'original
  type: string // type de l'original
  payload: Record<string, unknown> // payload en vigueur
  time: number // device_time de l'original (ms)
  chain: string[] // original puis corrections
}

/** Applique les corrections (éventuellement successives) à leur original, comme l'app. */
export function buildEffectiveRecords(records: readonly EngineRecord[]): Map<string, EffectiveRecord> {
  const sorted = [...records].sort((a, b) => a.device_time.localeCompare(b.device_time) || a.id.localeCompare(b.id))
  const out = new Map<string, EffectiveRecord>()
  const rootOf = new Map<string, string>()
  for (const r of sorted) {
    if (r.type === 'correction' || !isObj(r.payload)) continue
    out.set(r.id, { id: r.id, type: r.type, payload: r.payload, time: Date.parse(r.device_time), chain: [r.id] })
    rootOf.set(r.id, r.id)
  }
  let pending = sorted.filter((r) => r.type === 'correction' && r.supersedes_id !== null)
  // Plusieurs passes : une correction de correction peut arriver avant sa cible dans l'ordre des heures.
  for (let pass = 0; pass < 20 && pending.length > 0; pass++) {
    const next: EngineRecord[] = []
    for (const c of pending) {
      const root = rootOf.get(c.supersedes_id as string)
      if (!root) {
        next.push(c)
        continue
      }
      const eff = out.get(root)!
      rootOf.set(c.id, root)
      eff.chain.push(c.id)
      if (isObj(c.payload) && isObj(c.payload.replacement)) eff.payload = c.payload.replacement
    }
    if (next.length === pending.length) break
    pending = next
  }
  return out
}

const KIND_LABEL: Record<AlertKind, string> = {
  sensor_out_of_range: 'Température hors seuil',
  sensor_silent: 'Capteur muet',
  sensor_battery_low: 'Pile faible',
  check_overdue: 'Relevé en retard',
  process_overdue: 'Procédé non clôturé',
  corrective_action_missing: 'Action corrective manquante',
}
export function alertTitle(kind: AlertKind): string {
  return KIND_LABEL[kind]
}

/** Décide les alertes à ouvrir / résoudre. */
export function evaluateAlerts(input: EngineInput): EngineResult {
  const { now, timeZone: tz } = input
  const nowMs = now.getTime()
  const states = new Map<string, State>()
  const set = (alert: NewAlertRow) => states.set(subjectKey(alert), { state: 'open', alert: { ...alert, message: clip(alert.message) } })
  const clear = (k: Pick<NewAlertRow, 'kind' | 'equipment_id' | 'sensor_id' | 'related_record_id'>) => states.set(subjectKey(k), { state: 'clear' })
  const eqById = new Map(input.equipment.map((e) => [e.id, e]))
  const at = (ms: number) => formatLocalMoment(new Date(ms), now, tz)

  // ── Capteurs ──────────────────────────────────────────────────────────────
  const readingsBySensor = new Map<string, SensorReadingRow[]>()
  for (const r of input.readings) {
    const list = readingsBySensor.get(r.sensor_id) ?? []
    list.push(r)
    readingsBySensor.set(r.sensor_id, list)
  }
  for (const s of input.sensors) {
    const eq = eqById.get(s.equipment_id)
    const base = { equipment_id: s.equipment_id, sensor_id: s.id, related_record_id: null }
    if (!s.active || !eq || !eq.active) {
      // Capteur ou enceinte désactivés : plus surveillés, leurs alertes sont résolues.
      for (const kind of ['sensor_out_of_range', 'sensor_silent', 'sensor_battery_low'] as const) clear({ kind, ...base })
      continue
    }
    const label = `${eq.name} (${s.name})`

    // Muet
    const lastSeen = Date.parse(s.last_seen_at ?? s.created_at)
    const silentMin = input.settings.sensor_silent_minutes ?? 60
    if (nowMs - lastSeen > silentMin * 60_000) {
      set({ kind: 'sensor_silent', ...base, message: s.last_seen_at ? `${label} : aucune mesure depuis ${at(lastSeen)}` : `${label} : aucune mesure reçue depuis sa création` })
    } else clear({ kind: 'sensor_silent', ...base })

    // Pile
    if (s.battery_percent !== null && s.battery_percent < ALERT_RULES.batteryLowPercent) {
      set({ kind: 'sensor_battery_low', ...base, message: `${label} : pile faible (${s.battery_percent} %), à remplacer` })
    } else if (s.battery_percent === null || s.battery_percent >= ALERT_RULES.batteryResolvePercent) {
      clear({ kind: 'sensor_battery_low', ...base })
    }

    // Hors seuil au-delà de la tolérance
    const thr = enclosureThreshold(eq, input.thresholds)
    if (!thr) {
      clear({ kind: 'sensor_out_of_range', ...base })
      continue
    }
    const rs = (readingsBySensor.get(s.id) ?? []).slice().sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    if (rs.length === 0) continue // aucune information : l'alerte éventuelle reste en l'état
    const last = rs[rs.length - 1]
    if (inRange(last.value_c, thr)) {
      clear({ kind: 'sensor_out_of_range', ...base })
      continue
    }
    let firstOut = 0
    for (let i = rs.length - 1; i >= 0; i--) {
      if (inRange(rs[i].value_c, thr)) {
        firstOut = i + 1
        break
      }
    }
    const outSince = Date.parse(rs[firstOut].measured_at)
    if (nowMs - outSince >= thr.tolerance_minutes * 60_000) {
      set({
        kind: 'sensor_out_of_range',
        ...base,
        message: `${label} : ${formatC(last.value_c)} (seuil ${boundText(thr)}) depuis ${at(outSince)}`,
      })
    }
  }

  // ── Registre : enregistrements en vigueur ─────────────────────────────────
  const effective = buildEffectiveRecords(input.records)
  const all = [...effective.values()]

  // Relevés manquants (check_overdue)
  const slot = currentSlot(new Date(nowMs - ALERT_RULES.checkOverdueGraceMinutes * 60_000), input.settings.daily_check_times, tz, input.settings.missed_slot_carry_over ?? true)
  const checks = all.filter((e) => e.type === 'temperature_check' && typeof e.payload.equipment_id === 'string')
  for (const eq of input.equipment) {
    const base = { kind: 'check_overdue' as const, equipment_id: eq.id, sensor_id: null, related_record_id: null }
    const beforeMonitoring =
      input.monitoringStart === null || (input.monitoringStart !== undefined && slot !== null && slot.getTime() < input.monitoringStart.getTime())
    if (!eq.active || (eq.kind !== 'fridge' && eq.kind !== 'freezer') || slot === null || beforeMonitoring) {
      clear(base)
      continue
    }
    const done = checks.some((c) => c.payload.equipment_id === eq.id && c.time >= slot.getTime())
    if (done) clear(base)
    else set({ ...base, message: `${eq.name} : relevé de ${at(slot.getTime())} non fait` })
  }

  // Procédés non clôturés (process_overdue) : cooling / reheating, start sans end au-delà de la durée max.
  const batches = new Map<string, { start: EffectiveRecord | null; ended: boolean }>()
  for (const e of all) {
    if (e.type !== 'cooling' && e.type !== 'reheating') continue
    const batch = str(e.payload.batch_id)
    if (!batch) continue
    const k = `${e.type}|${batch}`
    const b = batches.get(k) ?? { start: null, ended: false }
    if (e.payload.step === 'end') b.ended = true
    if (e.payload.step === 'start' && (!b.start || e.time < b.start.time)) b.start = e
    batches.set(k, b)
  }
  for (const b of batches.values()) {
    if (!b.start) continue
    const type = b.start.type as 'cooling' | 'reheating'
    const base = { kind: 'process_overdue' as const, equipment_id: null, sensor_id: null, related_record_id: b.start.id }
    if (b.ended) {
      clear(base)
      continue
    }
    const generic = input.thresholds.find((t) => t.equipment_id === null && t.check_type === type)
    const maxMin = generic && generic.tolerance_minutes > 0 ? generic.tolerance_minutes : DEFAULT_PROCESS_THRESHOLDS[type].max_minutes
    if (nowMs - b.start.time > maxMin * 60_000) {
      const what = type === 'cooling' ? 'Refroidissement' : 'Remise en température'
      const product = str(b.start.payload.product) ?? '?'
      set({ ...base, message: `${what} « ${product} » non clôturé : démarré ${at(b.start.time)}, durée max ${maxMin} min` })
    }
  }

  // Actions correctives manquantes (corrective_action_missing)
  const actioned = new Set<string>()
  for (const e of all) if (e.type === 'corrective_action' && typeof e.payload.related_record_id === 'string') actioned.add(e.payload.related_record_id)
  for (const e of all) {
    const p = e.payload
    let subject: string | null = null
    if (e.type === 'temperature_check') subject = eqById.get(str(p.equipment_id) ?? '')?.name ?? 'Enceinte'
    else if (e.type === 'hot_holding') subject = `Maintien au chaud « ${str(p.product) ?? '?'} »`
    else if (e.type === 'cooking_check') subject = `Cuisson « ${str(p.product) ?? '?'} »`
    else if ((e.type === 'cooling' || e.type === 'reheating') && p.step === 'end') {
      subject = `${e.type === 'cooling' ? 'Refroidissement' : 'Remise en température'} « ${str(p.product) ?? '?'} »`
    }
    if (subject === null) continue
    const base = { kind: 'corrective_action_missing' as const, equipment_id: str(p.equipment_id) !== null && eqById.has(p.equipment_id as string) ? (p.equipment_id as string) : null, sensor_id: null, related_record_id: e.id }
    const out = p.in_range === false
    const hasAction = e.chain.some((id) => actioned.has(id))
    if (!out || hasAction) {
      clear(base)
      continue
    }
    if (nowMs - e.time >= ALERT_RULES.correctiveActionGraceMinutes * 60_000) {
      const v = num(p.value_c)
      set({ ...base, message: `${subject} : ${v === null ? 'hors seuil' : `${formatC(v)} hors seuil`} à ${at(e.time)}, sans action corrective` })
    }
  }

  // ── Confrontation avec les alertes ouvertes ───────────────────────────────
  const result: EngineResult = { open: [], resolve: [] }
  const openByKey = new Map<string, Alert>()
  for (const a of input.openAlerts) {
    if (a.resolved_at !== null) continue
    const k = subjectKey(a)
    const st = states.get(k)
    const recordKind = a.kind === 'process_overdue' || a.kind === 'corrective_action_missing'
    if (!st) {
      // Sujet non évalué. Capteurs et enceintes : toujours tous évalués, donc sujet disparu → résolue.
      // Enregistrements hors de la fenêtre relue : laissés en l'état (prise en compte manuelle).
      if (!recordKind && !(a.kind.startsWith('sensor_') && input.sensors.some((s) => s.id === a.sensor_id && s.active && eqById.get(s.equipment_id)?.active))) {
        result.resolve.push(a.id)
      } else if (a.kind.startsWith('sensor_')) {
        // Capteur surveillé mais sans information nouvelle (ex. aucune mesure) : l'alerte reste ouverte.
        openByKey.set(k, a)
      }
      continue
    }
    if (st.state === 'clear') {
      result.resolve.push(a.id)
      continue
    }
    // Même sujet mais rattachement changé (ex. capteur déplacé sur une autre enceinte) : on remplace.
    if (st.alert.equipment_id !== a.equipment_id || st.alert.sensor_id !== a.sensor_id || st.alert.related_record_id !== a.related_record_id) {
      result.resolve.push(a.id)
      continue
    }
    openByKey.set(k, a)
  }
  for (const [k, st] of states) {
    if (st.state === 'open' && !openByKey.has(k)) result.open.push(st.alert)
  }
  return result
}

/** Alertes ouvertes, non prises en compte, jamais notifiées ou notifiées il y a au moins `repeatMinutes`. */
export function alertsDueForNotification(open: readonly Alert[], now: Date, repeatMinutes: number): Alert[] {
  const nowMs = now.getTime()
  return open.filter(
    (a) =>
      a.resolved_at === null &&
      a.acknowledged_at === null &&
      (a.last_notified_at === null || nowMs - Date.parse(a.last_notified_at) >= repeatMinutes * 60_000 - ALERT_RULES.repeatSlackMs),
  )
}
