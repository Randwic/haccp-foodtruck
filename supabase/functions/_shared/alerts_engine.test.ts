// @vitest-environment node
// Moteur d'alertes : horloge injectée, fuseau Europe/Paris (UTC+1 en hiver, UTC+2 en été).
import { describe, expect, it } from 'vitest'
import type { Alert, AlertKind } from '../../../shared/payloads.ts'
import type { Equipment, Threshold } from '../../../shared/types.ts'
import { alertsDueForNotification, buildEffectiveRecords, evaluateAlerts, formatC, type EngineInput } from './alerts_engine.ts'
import type { EngineRecord, NewAlertRow, SensorForAlerts, SensorReadingRow } from './repo.ts'

const TZ = 'Europe/Paris'
const FRIGO = '00000000-0000-4000-8000-000000000101'
const CONGEL = '00000000-0000-4000-8000-000000000103'
const FRITEUSE = '00000000-0000-4000-8000-000000000104'
const SENSOR = '00000000-0000-4000-8000-0000000005e1'
const T0 = '2026-11-01T00:00:00.000Z'

const equipment: Equipment[] = [
  { id: FRIGO, name: 'Frigo 1', kind: 'fridge', active: true, updated_at: T0 },
  { id: CONGEL, name: 'Congélateur', kind: 'freezer', active: true, updated_at: T0 },
  { id: FRITEUSE, name: 'Friteuse', kind: 'fryer_vat', active: true, updated_at: T0 },
]
const thresholds: Threshold[] = [
  { id: 't1', equipment_id: FRIGO, check_type: 'temperature_check', min_c: null, max_c: 4, tolerance_minutes: 20, updated_at: T0 },
  { id: 't2', equipment_id: null, check_type: 'cooling', min_c: null, max_c: 10, tolerance_minutes: 120, updated_at: T0 },
]

let seq = 0
const id = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`
const rec = (type: string, payload: Record<string, unknown>, device_time: string, supersedes_id: string | null = null, rid = id()): EngineRecord => ({
  id: rid,
  type,
  payload,
  device_time,
  supersedes_id,
})
const check = (equipment_id: string, at: string, value_c = 3, in_range = true) => rec('temperature_check', { equipment_id, value_c, source: 'manual', in_range }, at)
const sensor = (over: Partial<SensorForAlerts> = {}): SensorForAlerts => ({
  id: SENSOR,
  name: 'Shelly',
  equipment_id: FRIGO,
  vendor: 'shelly_ht',
  active: true,
  last_seen_at: null,
  last_value_c: null,
  battery_percent: null,
  updated_at: T0,
  created_at: T0,
  ...over,
})
const openAlert = (row: Partial<Alert> & { kind: AlertKind }): Alert => ({
  id: id(),
  equipment_id: null,
  sensor_id: null,
  related_record_id: null,
  message: 'm',
  opened_at: T0,
  resolved_at: null,
  acknowledged_at: null,
  last_notified_at: null,
  ...row,
})

function input(now: string, over: Partial<EngineInput> = {}): EngineInput {
  return {
    now: new Date(now),
    timeZone: TZ,
    settings: { daily_check_times: ['08:00', '18:00'], missed_slot_carry_over: true, sensor_silent_minutes: 60 },
    equipment,
    thresholds,
    sensors: [],
    readings: [],
    records: [],
    openAlerts: [],
    ...over,
  }
}
const kinds = (rows: NewAlertRow[], kind: AlertKind) => rows.filter((r) => r.kind === kind)

// Hier soir (13/11, 18:10 Paris = 17:10Z) : les deux enceintes relevées.
const yesterdayDone = () => [check(FRIGO, '2026-11-13T17:10:00.000Z'), check(CONGEL, '2026-11-13T17:11:00.000Z', -20)]

describe('check_overdue — créneaux en heure de Paris, 1 h de grâce', () => {
  it('aucun appareil enrôlé (monitoringStart null) : aucune alerte de relevé', () => {
    const res = evaluateAlerts(input('2026-11-14T08:00:00.000Z', { records: yesterdayDone(), monitoringStart: null }))
    expect(kinds(res.open, 'check_overdue')).toEqual([])
  })
  it('créneau antérieur au premier enrôlement : ignoré ; créneau suivant : surveillé', () => {
    const start = new Date('2026-11-14T07:30:00.000Z') // enrôlé après le créneau de 08:00 Paris (07:00Z)
    expect(kinds(evaluateAlerts(input('2026-11-14T08:00:00.000Z', { records: [], monitoringStart: start })).open, 'check_overdue')).toEqual([])
    const later = evaluateAlerts(input('2026-11-14T18:00:00.000Z', { records: [], monitoringStart: start }))
    expect(kinds(later.open, 'check_overdue').length).toBe(2)
  })
  it('créneau de 08:00 : rien à 08:59, alerte à 09:00 pour chaque enceinte froide active', () => {
    const records = yesterdayDone()
    expect(kinds(evaluateAlerts(input('2026-11-14T07:59:00.000Z', { records })).open, 'check_overdue')).toEqual([])
    const res = evaluateAlerts(input('2026-11-14T08:00:00.000Z', { records }))
    expect(kinds(res.open, 'check_overdue')).toEqual([
      { kind: 'check_overdue', equipment_id: FRIGO, sensor_id: null, related_record_id: null, message: 'Frigo 1 : relevé de 08:00 non fait' },
      { kind: 'check_overdue', equipment_id: CONGEL, sensor_id: null, related_record_id: null, message: 'Congélateur : relevé de 08:00 non fait' },
    ])
  })
  it('un relevé fait après le créneau (heure appareil ≥ créneau) le satisfait ; un relevé d’avant non', () => {
    const records = [...yesterdayDone(), check(FRIGO, '2026-11-14T07:20:00.000Z'), check(CONGEL, '2026-11-14T06:55:00.000Z', -19)]
    const res = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { records }))
    expect(kinds(res.open, 'check_overdue').map((r) => r.equipment_id)).toEqual([CONGEL])
  })
  it('enceinte inactive, friteuse : jamais d’alerte ; alerte ouverte d’une enceinte désactivée → résolue', () => {
    const eq = equipment.map((e) => (e.id === CONGEL ? { ...e, active: false } : e))
    const old = openAlert({ kind: 'check_overdue', equipment_id: CONGEL })
    const res = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { equipment: eq, records: yesterdayDone(), openAlerts: [old] }))
    expect(kinds(res.open, 'check_overdue').map((r) => r.equipment_id)).toEqual([FRIGO])
    expect(res.resolve).toEqual([old.id])
  })
  it('report du créneau oublié (missed_slot_carry_over = true) : 18:00 manqué reste dû le lendemain matin', () => {
    // Rien depuis hier 08:00 ; il est 07:30 à Paris.
    const records = [check(FRIGO, '2026-11-13T07:05:00.000Z'), check(CONGEL, '2026-11-13T07:06:00.000Z', -20)]
    const res = evaluateAlerts(input('2026-11-14T06:30:00.000Z', { records }))
    expect(kinds(res.open, 'check_overdue').map((r) => r.message)).toEqual(['Frigo 1 : relevé de hier 18:00 non fait', 'Congélateur : relevé de hier 18:00 non fait'])
  })
  it('sans report (missed_slot_carry_over = false) : l’alerte de la veille est résolue après minuit + 1 h', () => {
    const records = [check(FRIGO, '2026-11-13T07:05:00.000Z')]
    const old = openAlert({ kind: 'check_overdue', equipment_id: FRIGO })
    const settings = { daily_check_times: ['08:00', '18:00'], missed_slot_carry_over: false, sensor_silent_minutes: 60 }
    // 00:30 Paris : le créneau courant (00:30 − 1 h = hier 23:30) est encore hier 18:00 → toujours dû.
    expect(evaluateAlerts(input('2026-11-13T23:30:00.000Z', { settings, records, openAlerts: [old] })).resolve).toEqual([])
    // 06:30 Paris : aucun créneau passé aujourd'hui, pas de report → résolue, aucune nouvelle alerte.
    const res = evaluateAlerts(input('2026-11-14T05:30:00.000Z', { settings, records, openAlerts: [old] }))
    expect(res.resolve).toEqual([old.id])
    expect(kinds(res.open, 'check_overdue')).toEqual([])
  })
  it('alerte ouverte puis relevé reçu → résolue ; pas de doublon tant qu’elle est ouverte', () => {
    const open = openAlert({ kind: 'check_overdue', equipment_id: FRIGO })
    const still = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { records: [...yesterdayDone(), check(CONGEL, '2026-11-14T07:30:00.000Z', -20)], openAlerts: [open] }))
    expect(still.open).toEqual([])
    expect(still.resolve).toEqual([])
    const done = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { records: [...yesterdayDone(), check(FRIGO, '2026-11-14T09:20:00.000Z'), check(CONGEL, '2026-11-14T07:30:00.000Z', -20)], openAlerts: [open] }))
    expect(done.resolve).toEqual([open.id])
  })
  it('corrections : un relevé réattribué à une autre enceinte ne compte plus pour la première', () => {
    const orig = check(FRIGO, '2026-11-14T07:20:00.000Z')
    const corr = rec('correction', { reason: 'mauvaise enceinte', replacement: { equipment_id: CONGEL, value_c: -19, source: 'manual', in_range: true } }, '2026-11-14T07:40:00.000Z', orig.id)
    const res = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { records: [...yesterdayDone(), orig, corr] }))
    expect(kinds(res.open, 'check_overdue').map((r) => r.equipment_id)).toEqual([FRIGO])
  })
  it('heure d’été : 08:00 Paris = 06:00Z, alerte à 07:00Z', () => {
    const records = [check(FRIGO, '2026-06-30T16:10:00.000Z'), check(CONGEL, '2026-06-30T16:10:00.000Z', -20)]
    expect(kinds(evaluateAlerts(input('2026-07-01T06:59:00.000Z', { records })).open, 'check_overdue')).toEqual([])
    expect(kinds(evaluateAlerts(input('2026-07-01T07:00:00.000Z', { records })).open, 'check_overdue')).toHaveLength(2)
  })
  it('aucune heure de relevé : aucune alerte, les alertes ouvertes sont résolues', () => {
    const old = openAlert({ kind: 'check_overdue', equipment_id: FRIGO })
    const res = evaluateAlerts(input('2026-11-14T09:30:00.000Z', { settings: { daily_check_times: [], missed_slot_carry_over: true, sensor_silent_minutes: 60 }, openAlerts: [old] }))
    expect(kinds(res.open, 'check_overdue')).toEqual([])
    expect(res.resolve).toEqual([old.id])
  })
})

describe('process_overdue — refroidissement / remise en température non clôturés', () => {
  const at = (iso: string, over: Partial<EngineInput> = {}) =>
    kinds(evaluateAlerts(input(iso, { ...over, records: [...yesterdayDone(), ...(over.records ?? [])] })).open, 'process_overdue')
  it('cooling : durée max du seuil générique (120 min), alerte au-delà', () => {
    const start = rec('cooling', { batch_id: id(), step: 'start', product: 'Chili', value_c: 70, source: 'probe' }, '2026-11-14T09:00:00.000Z')
    expect(at('2026-11-14T11:00:00.000Z', { records: [start] })).toEqual([])
    expect(at('2026-11-14T11:01:00.000Z', { records: [start] })).toEqual([
      { kind: 'process_overdue', equipment_id: null, sensor_id: null, related_record_id: start.id, message: 'Refroidissement « Chili » non clôturé : démarré 10:00, durée max 120 min' },
    ])
  })
  it('reheating : défaut DEFAULT_PROCESS_THRESHOLDS (60 min) sans seuil ; seuil générique s’il existe', () => {
    const start = rec('reheating', { batch_id: id(), step: 'start', product: 'Sauce', value_c: 4, source: 'probe' }, '2026-11-14T09:00:00.000Z')
    expect(at('2026-11-14T10:01:00.000Z', { records: [start] })).toHaveLength(1)
    const thr = [...thresholds, { id: 't3', equipment_id: null, check_type: 'reheating' as const, min_c: 63, max_c: null, tolerance_minutes: 90, updated_at: T0 }]
    expect(at('2026-11-14T10:01:00.000Z', { records: [start], thresholds: thr })).toEqual([])
    expect(at('2026-11-14T10:31:00.000Z', { records: [start], thresholds: thr })).toHaveLength(1)
  })
  it('étape end (même batch) → résolue ; une étape check ne clôt pas', () => {
    const batch = id()
    const start = rec('cooling', { batch_id: batch, step: 'start', product: 'Chili', value_c: 70, source: 'probe' }, '2026-11-14T09:00:00.000Z')
    const chk = rec('cooling', { batch_id: batch, step: 'check', product: 'Chili', value_c: 30, source: 'probe' }, '2026-11-14T10:00:00.000Z')
    const open = openAlert({ kind: 'process_overdue', related_record_id: start.id })
    expect(evaluateAlerts(input('2026-11-14T12:00:00.000Z', { records: [start, chk], openAlerts: [open] })).resolve).toEqual([])
    const end = rec('cooling', { batch_id: batch, step: 'end', product: 'Chili', value_c: 8, source: 'probe', in_range: true, duration_min: 190 }, '2026-11-14T12:10:00.000Z')
    expect(evaluateAlerts(input('2026-11-14T12:15:00.000Z', { records: [start, chk, end], openAlerts: [open] })).resolve).toEqual([open.id])
  })
  it('départ hors de la fenêtre relue : alerte ouverte laissée en l’état (prise en compte manuelle)', () => {
    const open = openAlert({ kind: 'process_overdue', related_record_id: id() })
    expect(evaluateAlerts(input('2026-11-14T12:15:00.000Z', { openAlerts: [open] })).resolve).toEqual([])
  })
})

describe('corrective_action_missing — saisie hors seuil sans action corrective après 30 min', () => {
  const bad = () => check(FRIGO, '2026-11-14T09:00:00.000Z', 7.5, false)
  it('relevé hors seuil : rien à 29 min, alerte à 30 min', () => {
    const r = bad()
    expect(kinds(evaluateAlerts(input('2026-11-14T09:29:00.000Z', { records: [r] })).open, 'corrective_action_missing')).toEqual([])
    expect(kinds(evaluateAlerts(input('2026-11-14T09:30:00.000Z', { records: [r] })).open, 'corrective_action_missing')).toEqual([
      { kind: 'corrective_action_missing', equipment_id: FRIGO, sensor_id: null, related_record_id: r.id, message: 'Frigo 1 : 7,5 °C hors seuil à 10:00, sans action corrective' },
    ])
  })
  it('action corrective qui vise le relevé ou une de ses corrections → résolue', () => {
    const r = bad()
    const corr = rec('correction', { reason: 'r', replacement: { equipment_id: FRIGO, value_c: 7.8, source: 'manual', in_range: false } }, '2026-11-14T09:05:00.000Z', r.id)
    const ca = rec('corrective_action', { related_record_id: corr.id, action: 'move_product', comment: '' }, '2026-11-14T09:40:00.000Z')
    const open = openAlert({ kind: 'corrective_action_missing', equipment_id: FRIGO, related_record_id: r.id })
    expect(evaluateAlerts(input('2026-11-14T09:45:00.000Z', { records: [r, corr], openAlerts: [open] })).resolve).toEqual([])
    expect(evaluateAlerts(input('2026-11-14T09:45:00.000Z', { records: [r, corr, ca], openAlerts: [open] })).resolve).toEqual([open.id])
  })
  it('correction qui remet le relevé dans le seuil → résolue', () => {
    const r = bad()
    const corr = rec('correction', { reason: 'erreur de saisie', replacement: { equipment_id: FRIGO, value_c: 3.5, source: 'manual', in_range: true } }, '2026-11-14T09:35:00.000Z', r.id)
    const open = openAlert({ kind: 'corrective_action_missing', equipment_id: FRIGO, related_record_id: r.id })
    expect(evaluateAlerts(input('2026-11-14T09:45:00.000Z', { records: [r, corr], openAlerts: [open] })).resolve).toEqual([open.id])
  })
  it('hot_holding, cooking_check, fin de refroidissement hors objectif ; pas les étapes start / check', () => {
    const recs = [
      rec('hot_holding', { product: 'Frites', value_c: 55, source: 'probe', in_range: false }, '2026-11-14T09:00:00.000Z'),
      rec('cooking_check', { product: 'Steak haché', value_c: 62, source: 'probe', in_range: false }, '2026-11-14T09:00:00.000Z'),
      rec('cooling', { batch_id: id(), step: 'end', product: 'Chili', value_c: 14, source: 'probe', in_range: false, duration_min: 130 }, '2026-11-14T09:00:00.000Z'),
      rec('cooling', { batch_id: id(), step: 'check', product: 'Riz', value_c: 40, source: 'probe', in_range: false }, '2026-11-14T09:00:00.000Z'),
    ]
    const msgs = kinds(evaluateAlerts(input('2026-11-14T10:00:00.000Z', { records: recs })).open, 'corrective_action_missing').map((r) => r.message)
    expect(msgs).toEqual([
      'Maintien au chaud « Frites » : 55 °C hors seuil à 10:00, sans action corrective',
      'Cuisson « Steak haché » : 62 °C hors seuil à 10:00, sans action corrective',
      'Refroidissement « Chili » : 14 °C hors seuil à 10:00, sans action corrective',
    ])
  })
})

describe('capteurs — muet, pile, hors seuil au-delà de la tolérance', () => {
  const now = '2026-11-14T10:30:00.000Z'
  const reading = (at: string, value_c: number): SensorReadingRow => ({ sensor_id: SENSOR, measured_at: at, value_c })
  const ok = () => [reading('2026-11-14T10:29:00.000Z', 3.5)]
  it('muet : > sensor_silent_minutes depuis la dernière mesure (ou la création)', () => {
    const at = (last: string | null, created = T0) => kinds(evaluateAlerts(input(now, { sensors: [sensor({ last_seen_at: last, created_at: created })], readings: ok() })).open, 'sensor_silent')
    expect(at('2026-11-14T09:31:00.000Z')).toEqual([])
    expect(at('2026-11-14T09:29:00.000Z')).toEqual([
      { kind: 'sensor_silent', equipment_id: FRIGO, sensor_id: SENSOR, related_record_id: null, message: 'Frigo 1 (Shelly) : aucune mesure depuis 10:29' },
    ])
    expect(at(null)[0].message).toBe('Frigo 1 (Shelly) : aucune mesure reçue depuis sa création')
    expect(at(null, '2026-11-14T10:00:00.000Z')).toEqual([])
  })
  it('pile : < 20 % ouvre ; 20..24 % laisse en l’état ; ≥ 25 % résout', () => {
    const s = (battery_percent: number) => [sensor({ last_seen_at: now, battery_percent })]
    expect(kinds(evaluateAlerts(input(now, { sensors: s(19), readings: ok() })).open, 'sensor_battery_low')[0].message).toBe('Frigo 1 (Shelly) : pile faible (19 %), à remplacer')
    const open = openAlert({ kind: 'sensor_battery_low', sensor_id: SENSOR, equipment_id: FRIGO })
    expect(evaluateAlerts(input(now, { sensors: s(22), readings: ok(), openAlerts: [open] })).resolve).toEqual([])
    expect(evaluateAlerts(input(now, { sensors: s(25), readings: ok(), openAlerts: [open] })).resolve).toEqual([open.id])
  })
  it('hors seuil : alerte quand toutes les mesures depuis la dernière bonne dépassent depuis ≥ tolerance_minutes (20)', () => {
    const readings = [reading('2026-11-14T09:55:00.000Z', 3.8), reading('2026-11-14T10:05:00.000Z', 5.2), reading('2026-11-14T10:15:00.000Z', 6.4), reading('2026-11-14T10:24:00.000Z', 7.1)]
    const s = [sensor({ last_seen_at: '2026-11-14T10:24:00.000Z' })]
    expect(kinds(evaluateAlerts(input('2026-11-14T10:24:00.000Z', { sensors: s, readings })).open, 'sensor_out_of_range')).toEqual([])
    expect(kinds(evaluateAlerts(input('2026-11-14T10:25:00.000Z', { sensors: s, readings })).open, 'sensor_out_of_range')).toEqual([
      { kind: 'sensor_out_of_range', equipment_id: FRIGO, sensor_id: SENSOR, related_record_id: null, message: 'Frigo 1 (Shelly) : 7,1 °C (seuil ≤ 4 °C) depuis 11:05' },
    ])
  })
  it('retour dans le seuil (dernière mesure) → résolue ; aucune mesure récente → laissée en l’état', () => {
    const open = openAlert({ kind: 'sensor_out_of_range', sensor_id: SENSOR, equipment_id: FRIGO })
    const s = [sensor({ last_seen_at: now })]
    expect(evaluateAlerts(input(now, { sensors: s, readings: [reading('2026-11-14T10:00:00.000Z', 8), reading('2026-11-14T10:29:00.000Z', 3.9)], openAlerts: [open] })).resolve).toEqual([open.id])
    const none = evaluateAlerts(input(now, { sensors: s, readings: [], openAlerts: [open] }))
    expect(none.resolve).toEqual([])
    expect(kinds(none.open, 'sensor_out_of_range')).toEqual([])
  })
  it('seuil par défaut du type sans seuil saisi (congélateur ≤ −18 °C, tolérance 30 min)', () => {
    const s = [sensor({ equipment_id: CONGEL, last_seen_at: now })]
    const readings = [reading('2026-11-14T09:55:00.000Z', -12), reading('2026-11-14T10:29:00.000Z', -11.5)]
    expect(kinds(evaluateAlerts(input(now, { sensors: s, readings })).open, 'sensor_out_of_range')[0].message).toBe('Congélateur (Shelly) : −11,5 °C (seuil ≤ −18 °C) depuis 10:55')
  })
  it('capteur désactivé : toutes ses alertes sont résolues, aucune ouverte', () => {
    const opens = (['sensor_silent', 'sensor_battery_low', 'sensor_out_of_range'] as const).map((kind) => openAlert({ kind, sensor_id: SENSOR, equipment_id: FRIGO }))
    const res = evaluateAlerts(input(now, { sensors: [sensor({ active: false, battery_percent: 5 })], openAlerts: opens }))
    expect(res.open.filter((r) => r.kind.startsWith('sensor_'))).toEqual([])
    expect(res.resolve.sort()).toEqual(opens.map((a) => a.id).sort())
  })
  it('capteur déplacé sur une autre enceinte : ancienne alerte résolue, nouvelle ouverte', () => {
    const old = openAlert({ kind: 'sensor_silent', sensor_id: SENSOR, equipment_id: FRIGO })
    const res = evaluateAlerts(input(now, { sensors: [sensor({ equipment_id: CONGEL, last_seen_at: '2026-11-14T08:00:00.000Z' })], openAlerts: [old] }))
    expect(res.resolve).toEqual([old.id])
    expect(kinds(res.open, 'sensor_silent').map((r) => r.equipment_id)).toEqual([CONGEL])
  })
})

describe('outils', () => {
  it('corrections successives rattachées à l’original (même dans le désordre)', () => {
    const o = check(FRIGO, '2026-11-14T09:00:00.000Z', 5, false)
    const c1 = rec('correction', { reason: 'a', replacement: { equipment_id: FRIGO, value_c: 6, source: 'manual', in_range: false } }, '2026-11-14T09:10:00.000Z', o.id)
    const c2 = rec('correction', { reason: 'b', replacement: { equipment_id: FRIGO, value_c: 3, source: 'manual', in_range: true } }, '2026-11-14T09:05:00.000Z', c1.id)
    const eff = buildEffectiveRecords([c2, c1, o]).get(o.id)!
    expect(eff.chain).toEqual([o.id, c1.id, c2.id])
    expect(eff.payload.value_c).toBe(3)
  })
  it('formatC', () => {
    expect(formatC(3.46)).toBe('3,5 °C')
    expect(formatC(-18)).toBe('−18 °C')
  })
  it('alertsDueForNotification : non prises en compte, au plus toutes les N minutes (marge 1 min)', () => {
    const now = new Date('2026-11-14T10:15:00.000Z')
    const never = openAlert({ kind: 'check_overdue', equipment_id: FRIGO })
    const recent = openAlert({ kind: 'check_overdue', equipment_id: CONGEL, last_notified_at: '2026-11-14T10:05:00.000Z' })
    const old = openAlert({ kind: 'sensor_silent', sensor_id: SENSOR, last_notified_at: '2026-11-14T10:00:30.000Z' })
    const acked = openAlert({ kind: 'sensor_battery_low', sensor_id: SENSOR, acknowledged_at: '2026-11-14T10:01:00.000Z' })
    expect(alertsDueForNotification([never, recent, old, acked], now, 15).map((a) => a.id)).toEqual([never.id, old.id])
  })
})
