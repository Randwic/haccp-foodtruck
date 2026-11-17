// Mode Contrôle (lot 7) : synthèse du registre sur une période, prête à être montrée à un inspecteur
// (écran, PDF, CSV). Fonctions pures, testées dans control.test.ts.
// Chaque saisie d'origine devient une ligne : valeur en vigueur (corrections appliquées, motif conservé),
// conformité, actions correctives rattachées, photos. Les lots (refroidissement, remise en température,
// décongélation) sont regroupés en une ligne.
import type { Checklist, CorrectiveActionPayload, ReceptionPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord, RecordType } from '../../../../shared/types.ts'
import { formatTemperature } from '../../ui/temperature.ts'
import { CHECKLIST_KIND_LABELS, asChecklistDone, asCleaningDone, itemLabel } from '../cleaning/model.ts'
import { correctiveActionLabel } from '../corrective-action/actions.ts'
import { KIND_TITLES, asLabel } from '../labels/model.ts'
import { asOilChange, asOilCheck, formatPercent } from '../oil/model.ts'
import { buildEntries, buildSpotChecks, buildThawBatches, buildTimedBatches, type Entry } from '../processes/entries.ts'
import { STORAGE_LABELS, WASTE_REASON_LABELS, asReception, asWaste, isOutOfRange, receptionPhotoPaths } from '../reception/model.ts'
import { asCorrectiveAction, asTemperatureCheck } from '../temperatures/readings.ts'
import { localDayKey, startOfLocalDay, zonedTimeToDate } from '../temperatures/schedule.ts'

export type ControlModule =
  | 'temperatures'
  | 'cooling'
  | 'reheating'
  | 'cooking'
  | 'thawing'
  | 'reception'
  | 'waste'
  | 'labels'
  | 'cleaning'
  | 'checklists'
  | 'oil'
  | 'alerts'

export const MODULES: readonly { id: ControlModule; title: string; short: string }[] = [
  { id: 'temperatures', title: 'Températures des enceintes', short: 'Températures' },
  { id: 'reception', title: 'Achats et réception des marchandises', short: 'Réception' },
  { id: 'cooking', title: 'Cuisson à cœur et maintien au chaud', short: 'Cuisson & maintien' },
  { id: 'cooling', title: 'Refroidissement rapide', short: 'Refroidissement' },
  { id: 'reheating', title: 'Remise en température', short: 'Remise en T°' },
  { id: 'thawing', title: 'Décongélation', short: 'Décongélation' },
  { id: 'labels', title: 'Étiquetage et traçabilité interne (DLC)', short: 'Étiquettes' },
  { id: 'waste', title: 'Produits jetés et retirés', short: 'Produits jetés' },
  { id: 'cleaning', title: 'Plan de nettoyage et désinfection', short: 'Nettoyage' },
  { id: 'checklists', title: 'Checklists (ouverture, fermeture, nuisibles)', short: 'Checklists' },
  { id: 'oil', title: 'Huiles de friture', short: 'Huiles' },
  { id: 'alerts', title: 'Alertes prises en compte', short: 'Alertes' },
]

export type RowStatus = 'ok' | 'ko' | 'info' | 'running'

export interface RowCorrection {
  time: string
  author: string
  reason: string
  /** Valeur d'avant la correction (barrée). */
  before: string
}

export interface ControlRow {
  /** id de l'enregistrement d'origine. */
  id: string
  module: ControlModule
  time: string
  author: string
  device: string
  /** Enceinte, produit, tâche, fournisseur… */
  subject: string
  /** Valeur en vigueur (corrections appliquées). */
  detail: string
  status: RowStatus
  /** « Hors seuil », « Refus », « Point non conforme »… (status ko). */
  statusLabel: string
  /** Actions correctives : « Équipement réglé — porte mal fermée (Cédric, 17/11 19:42) ». */
  actions: string[]
  /** Non conforme sans action corrective. */
  missingAction: boolean
  corrections: RowCorrection[]
  photos: string[]
  /** Saisie présente sur cet appareil mais pas encore reçue par le serveur. */
  pending: boolean
  /** Horloge de l'appareil jugée déréglée par le serveur à la réception. */
  clockSuspect: boolean
}

export interface ModuleSummary {
  module: ControlModule
  title: string
  short: string
  rows: ControlRow[]
  total: number
  nonConform: number
  missingActions: number
  corrected: number
}

export interface ControlReport {
  from: string
  to: string
  modules: ModuleSummary[]
  /** Écarts (non conformes), du plus récent au plus ancien. */
  nonConformities: ControlRow[]
  totals: { entries: number; nonConform: number; withAction: number; missingActions: number; corrected: number; pending: number; clockSuspect: number; photos: number }
  /** Saisies refusées par le serveur (quarantaine) sur la période. */
  quarantined: number
  /** Saisies d'essai (« Test d'enregistrement ») sur la période, non reprises dans le dossier. */
  tests: number
}

export interface ControlRefs {
  timeZone: string
  staffName: (id: string) => string
  deviceName: (id: string) => string
  equipmentName: (id: string) => string
  supplierName: (id: string) => string
  cleaningTaskName: (id: string) => string
  checklist: (id: string) => Checklist | undefined
}

export interface ControlInput {
  /** Registre (serveur + appareil, sans doublon). */
  records: readonly (HaccpRecord & { clock_suspect?: boolean; quarantine_reason?: string | null })[]
  /** ids des saisies pas encore reçues par le serveur. */
  pendingIds?: ReadonlySet<string>
  from: Date
  to: Date
  refs: ControlRefs
}

// ---------- Période ----------

export type PeriodPreset = '7d' | '30d' | '90d' | 'month' | 'last_month' | 'custom'

export const PERIOD_LABELS: Record<Exclude<PeriodPreset, 'custom'>, string> = {
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '3 derniers mois',
  month: 'Ce mois-ci',
  last_month: 'Le mois dernier',
}

/** Bornes d'une période en jours locaux : [début du premier jour, fin du dernier jour]. */
export function periodRange(preset: Exclude<PeriodPreset, 'custom'>, now: Date, timeZone: string): { from: Date; to: Date } {
  const endOfToday = new Date(startOfLocalDay(now, timeZone, -1).getTime() - 1)
  if (preset === '7d') return { from: startOfLocalDay(now, timeZone, 6), to: endOfToday }
  if (preset === '30d') return { from: startOfLocalDay(now, timeZone, 29), to: endOfToday }
  if (preset === '90d') return { from: startOfLocalDay(now, timeZone, 89), to: endOfToday }
  const [y, m] = localDayKey(now, timeZone).split('-').map(Number)
  if (preset === 'month') return { from: zonedTimeToDate({ year: y, month: m, day: 1 }, 0, 0, timeZone), to: endOfToday }
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return {
    from: zonedTimeToDate({ year: py, month: pm, day: 1 }, 0, 0, timeZone),
    to: new Date(zonedTimeToDate({ year: y, month: m, day: 1 }, 0, 0, timeZone).getTime() - 1),
  }
}

/** Période libre « AAAA-MM-JJ » → bornes (jours locaux inclus), ou null si invalide. */
export function customRange(fromDay: string, toDay: string, timeZone: string): { from: Date; to: Date } | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null
  }
  const a = parse(fromDay)
  const b = parse(toDay)
  if (!a || !b || fromDay > toDay) return null
  const next = new Date(Date.UTC(b.year, b.month - 1, b.day + 1))
  return {
    from: zonedTimeToDate(a, 0, 0, timeZone),
    to: new Date(zonedTimeToDate({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, 0, 0, timeZone).getTime() - 1),
  }
}

// ---------- Formats ----------

export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(new Date(iso))
}
export function formatDayTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone })
    .format(new Date(iso))
    .replace(',', '')
}
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso))
}
/** « 2026-11-20 » → « 20/11/2026 ». */
export function isoDay(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}
const SOURCE: Record<string, string> = { manual: 'saisie', probe: 'sonde', sensor: 'capteur' }
const t = (v: number) => formatTemperature(v).replace(/ /g, ' ')

// ---------- Construction ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function buildControlReport(input: ControlInput): ControlReport {
  const { refs } = input
  const from = input.from.toISOString()
  const to = input.to.toISOString()
  const inPeriod = (iso: string) => iso >= from && iso <= to
  const meta = new Map(input.records.map((r) => [r.id, r]))
  const records = input.records.filter((r) => !r.quarantine_reason)
  const pending = input.pendingIds ?? new Set<string>()
  const tz = refs.timeZone

  const actionsOf = (list: readonly HaccpRecord[]): string[] =>
    list.map((r) => {
      const p = asCorrectiveAction(r.payload) as CorrectiveActionPayload | null
      const comment = p?.comment?.trim() ? ` — ${p.comment.trim()}` : ''
      return `${correctiveActionLabel(p?.action)}${comment} (${refs.staffName(r.author_id)}, ${formatDayTime(r.device_time, tz)})`
    })
  const photosOfActions = (list: readonly HaccpRecord[]) =>
    list.flatMap((r) => {
      const p = asCorrectiveAction(r.payload)
      return p?.photo_path ? [p.photo_path] : []
    })

  /** Ligne commune à partir d'une entrée (corrections, actions, photos). */
  const rowOf = <P,>(
    module: ControlModule,
    e: Entry<P>,
    describe: (p: P) => { subject: string; detail: string; status: RowStatus; statusLabel?: string; photos?: string[] },
  ): ControlRow => {
    const now = describe(e.payload)
    const corrections: RowCorrection[] = e.versions.slice(1).map((v, i) => ({
      time: v.record.device_time,
      author: refs.staffName(v.record.author_id),
      reason: v.reason ?? '',
      before: describe(e.versions[i].payload).detail,
    }))
    const chain = [e.original, ...e.versions.slice(1).map((v) => v.record)]
    return {
      id: e.id,
      module,
      time: e.time,
      author: refs.staffName(e.authorId),
      device: refs.deviceName(e.original.device_id),
      subject: now.subject,
      detail: now.detail,
      status: now.status,
      statusLabel: now.statusLabel ?? (now.status === 'ko' ? 'Non conforme' : ''),
      actions: actionsOf(e.correctiveActions),
      missingAction: now.status === 'ko' && e.correctiveActions.length === 0 && needsAction(module),
      corrections,
      photos: [...new Set([...(now.photos ?? []), ...photosOfActions(e.correctiveActions)])],
      pending: chain.some((r) => pending.has(r.id)),
      clockSuspect: chain.some((r) => meta.get(r.id)?.clock_suspect === true),
    }
  }

  const rows: ControlRow[] = []

  // Températures des enceintes
  for (const e of buildEntries(records, ['temperature_check'], asTemperatureCheck)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('temperatures', e, (p) => ({
        subject: refs.equipmentName(p.equipment_id),
        detail: `${t(p.value_c)} (${SOURCE[p.source] ?? p.source})`,
        status: p.in_range ? 'ok' : 'ko',
        statusLabel: 'Hors seuil',
      })),
    )
  }

  // Refroidissement / remise en température : une ligne par lot
  for (const kind of ['cooling', 'reheating'] as const) {
    for (const b of buildTimedBatches(records, kind)) {
      if (!inPeriod(b.startedAt)) continue
      const stepText = (s: Entry<{ value_c: number; step: string }>) =>
        `${s.payload.step === 'start' ? 'début' : s.payload.step === 'end' ? 'fin' : 'contrôle'} ${t(s.payload.value_c)} à ${formatClock(s.time, tz)}`
      const allCorrections = b.steps.flatMap((s) =>
        s.versions.slice(1).map((v, i) => ({
          time: v.record.device_time,
          author: refs.staffName(v.record.author_id),
          reason: v.reason ?? '',
          before: stepText({ ...s, payload: s.versions[i].payload }),
        })),
      )
      const actions = b.steps.flatMap((s) => s.correctiveActions)
      const status: RowStatus = b.running ? 'running' : b.inRange ? 'ok' : 'ko'
      const chain = b.steps.flatMap((s) => [s.original, ...s.versions.slice(1).map((v) => v.record)])
      rows.push({
        id: b.start.id,
        module: kind,
        time: b.startedAt,
        author: refs.staffName(b.start.authorId),
        device: refs.deviceName(b.start.original.device_id),
        subject: b.product,
        detail: [b.steps.map(stepText).join(', '), b.durationMin !== null ? `${b.durationMin} min` : ''].filter(Boolean).join(' — '),
        status,
        statusLabel: status === 'ko' ? 'Objectif non atteint' : status === 'running' ? 'Non clôturé' : '',
        actions: actionsOf(actions),
        missingAction: b.missingAction,
        corrections: allCorrections,
        photos: photosOfActions(actions),
        pending: chain.some((r) => pending.has(r.id)),
        clockSuspect: chain.some((r) => meta.get(r.id)?.clock_suspect === true),
      })
    }
  }

  // Cuisson à cœur et maintien au chaud
  for (const e of buildSpotChecks(records)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('cooking', e, (p) => ({
        subject: `${e.kind === 'cooking_check' ? 'Cuisson' : 'Maintien au chaud'} — ${p.product}`,
        detail: `${t(p.value_c)} à cœur (${SOURCE[p.source] ?? p.source})${p.equipment_id ? `, ${refs.equipmentName(p.equipment_id)}` : ''}`,
        status: p.in_range ? 'ok' : 'ko',
        statusLabel: 'Sous le seuil',
      })),
    )
  }

  // Décongélation
  for (const b of buildThawBatches(records)) {
    if (!inPeriod(b.startedAt)) continue
    const detail = [
      `en ${refs.equipmentName(b.equipmentId)}`,
      `début ${formatDayTime(b.startedAt, tz)}`,
      b.endedAt ? `fin ${formatDayTime(b.endedAt, tz)}` : 'en cours',
      b.dlc ? `DLC ${isoDay(b.dlc)}` : '',
    ]
      .filter(Boolean)
      .join(', ')
    const chain = b.steps.flatMap((s) => [s.original, ...s.versions.slice(1).map((v) => v.record)])
    rows.push({
      id: b.start.id,
      module: 'thawing',
      time: b.startedAt,
      author: refs.staffName(b.start.authorId),
      device: refs.deviceName(b.start.original.device_id),
      subject: b.product,
      detail,
      status: b.running ? 'running' : 'info',
      statusLabel: b.running ? 'En cours' : '',
      actions: [],
      missingAction: false,
      corrections: b.steps.flatMap((s) =>
        s.versions.slice(1).map((v, i) => ({
          time: v.record.device_time,
          author: refs.staffName(v.record.author_id),
          reason: v.reason ?? '',
          before: s.versions[i].payload.dlc ? `DLC ${isoDay(s.versions[i].payload.dlc!)}` : s.versions[i].payload.product,
        })),
      ),
      photos: [],
      pending: chain.some((r) => pending.has(r.id)),
      clockSuspect: chain.some((r) => meta.get(r.id)?.clock_suspect === true),
    })
  }

  // Réceptions
  for (const e of buildEntries(records, ['reception'], asReception)) {
    if (!inPeriod(e.time)) continue
    rows.push(rowOf('reception', e, (p) => describeReception(p, refs)))
  }

  // Étiquettes
  for (const e of buildEntries(records, ['label_printed'], asLabel)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('labels', e, (p) => ({
        subject: `${p.name} (${KIND_TITLES[p.kind].toLowerCase()})`,
        detail: [
          `fait le ${formatDayTime(p.made_at, tz)}`,
          `DLC ${formatDayTime(p.dlc_at, tz)}`,
          p.lot ? `lot ${p.lot}` : '',
          STORAGE_LABELS[p.storage] ? `conservation : ${STORAGE_LABELS[p.storage].toLowerCase()}` : '',
          `${p.copies} étiquette${p.copies > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(', '),
        status: 'info',
      })),
    )
  }

  // Produits jetés
  for (const e of buildEntries(records, ['waste'], asWaste)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('waste', e, (p) => ({
        subject: p.product,
        detail: [WASTE_REASON_LABELS[p.reason], p.quantity ?? '', p.lot ? `lot ${p.lot}` : '', p.comment ?? ''].filter(Boolean).join(', '),
        status: 'info',
        photos: p.photo_paths,
      })),
    )
  }

  // Nettoyage
  for (const e of buildEntries(records, ['cleaning_done'], asCleaningDone)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('cleaning', e, (p) => ({
        subject: refs.cleaningTaskName(p.task_id),
        detail: p.comment?.trim() ? `Fait — ${p.comment.trim()}` : 'Fait',
        status: 'ok',
        photos: p.photo_paths,
      })),
    )
  }

  // Checklists
  for (const e of buildEntries(records, ['checklist_done'], asChecklistDone)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('checklists', e, (p) => {
        const c = refs.checklist(p.checklist_id)
        const no = p.answers.filter((a) => !a.ok)
        return {
          subject: c ? (c.name.toLowerCase() === CHECKLIST_KIND_LABELS[c.kind].toLowerCase() ? c.name : `${c.name} (${CHECKLIST_KIND_LABELS[c.kind].toLowerCase()})`) : 'Checklist',
          detail: no.length
            ? `${p.answers.length - no.length}/${p.answers.length} points conformes. Non : ${no.map((a) => `${itemLabel(c, a.item_id)}${a.comment ? ` (${a.comment})` : ''}`).join(' ; ')}`
            : `${p.answers.length}/${p.answers.length} points conformes`,
          status: p.all_ok ? 'ok' : 'ko',
          statusLabel: 'Point non conforme',
        }
      }),
    )
  }

  // Huiles
  for (const e of buildEntries(records, ['oil_check'], asOilCheck)) {
    if (!inPeriod(e.time)) continue
    rows.push(
      rowOf('oil', e, (p) => ({
        subject: refs.equipmentName(p.equipment_id),
        detail: `Composés polaires ${formatPercent(p.polar_percent).replace(/ /g, ' ')} (${p.method === 'tester' ? 'testeur' : 'bandelette'})`,
        status: p.in_range ? 'ok' : 'ko',
        statusLabel: 'Hors limite',
      })),
    )
  }
  for (const e of buildEntries(records, ['oil_change'], asOilChange)) {
    if (!inPeriod(e.time)) continue
    rows.push(rowOf('oil', e, (p) => ({ subject: refs.equipmentName(p.equipment_id), detail: `Huile changée${p.comment ? ` — ${p.comment}` : ''}`, status: 'info' })))
  }

  // Alertes prises en compte
  const asAck = (p: unknown) => (isObj(p) && typeof p.alert_id === 'string' ? { alert_id: p.alert_id, comment: typeof p.comment === 'string' ? p.comment : '' } : null)
  for (const e of buildEntries(records, ['alert_ack'], asAck)) {
    if (!inPeriod(e.time)) continue
    rows.push(rowOf('alerts', e, (p) => ({ subject: 'Alerte prise en compte', detail: p.comment || '—', status: 'info' })))
  }

  rows.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
  const modules: ModuleSummary[] = MODULES.map((m) => {
    const list = rows.filter((r) => r.module === m.id)
    return {
      module: m.id,
      title: m.title,
      short: m.short,
      rows: list,
      total: list.length,
      nonConform: list.filter((r) => r.status === 'ko').length,
      missingActions: list.filter((r) => r.missingAction).length,
      corrected: list.filter((r) => r.corrections.length > 0).length,
    }
  })
  const ko = rows.filter((r) => r.status === 'ko')
  const countIn = (type: RecordType) => input.records.filter((r) => r.type === type && inPeriod(r.device_time)).length
  return {
    from,
    to,
    modules,
    nonConformities: [...ko].sort((a, b) => b.time.localeCompare(a.time)),
    totals: {
      entries: rows.length,
      nonConform: ko.length,
      withAction: ko.filter((r) => r.actions.length > 0).length,
      missingActions: rows.filter((r) => r.missingAction).length,
      corrected: rows.filter((r) => r.corrections.length > 0).length,
      pending: rows.filter((r) => r.pending).length,
      clockSuspect: rows.filter((r) => r.clockSuspect).length,
      photos: rows.reduce((s, r) => s + r.photos.length, 0),
    },
    quarantined: input.records.filter((r) => r.quarantine_reason && inPeriod(r.device_time)).length,
    tests: countIn('system_test'),
  }
}

/** Les checklists n'exigent pas d'action corrective (commentaire obligatoire sur chaque « Non »). */
function needsAction(module: ControlModule): boolean {
  return module !== 'checklists'
}

function describeReception(p: ReceptionPayload, refs: ControlRefs): { subject: string; detail: string; status: RowStatus; statusLabel: string; photos: string[] } {
  const items = p.items.map((i) => {
    const bits = [i.lot ? `lot ${i.lot}` : '', i.dlc ? `DLC ${isoDay(i.dlc)}` : i.ddm ? `DDM ${isoDay(i.ddm)}` : '', typeof i.temperature_c === 'number' ? t(i.temperature_c) : '']
      .filter(Boolean)
      .join(', ')
    const head = `${i.product}${bits ? ` (${bits})` : ''}`
    if (!i.accepted) return `${head} REFUSÉ : ${i.refusal_reason ?? ''}`.trim()
    return isOutOfRange(i) ? `${head} HORS TEMPÉRATURE` : head
  })
  const checks = [p.vehicle_ok ? '' : 'véhicule / transport non conforme', p.packaging_ok ? '' : 'emballages abîmés'].filter(Boolean)
  const outOfRange = p.items.some((i) => i.accepted && isOutOfRange(i))
  const refused = p.items.filter((i) => !i.accepted).length
  return {
    subject: `${refs.supplierName(p.supplier_id)}${p.delivery_note ? ` — BL ${p.delivery_note}` : ''}`,
    detail: [items.join(' ; '), checks.length ? `Constat : ${checks.join(', ')}` : '', p.comment ? `Commentaire : ${p.comment}` : ''].filter(Boolean).join('. '),
    status: outOfRange ? 'ko' : 'ok',
    statusLabel: outOfRange ? 'Produit hors température accepté' : refused ? `${refused} refus` : '',
    photos: receptionPhotoPaths(p),
  }
}

/** Texte de la colonne « Résultat ». */
export function statusText(r: ControlRow): string {
  if (r.status === 'ok') return r.statusLabel ? `Conforme (${r.statusLabel})` : 'Conforme'
  if (r.status === 'ko') return r.statusLabel || 'Non conforme'
  if (r.status === 'running') return r.statusLabel || 'En cours'
  return '—'
}

/** Texte « actions et corrections » d'une ligne (export). */
export function followUpText(r: ControlRow, timeZone: string): string {
  const parts = [
    ...r.actions.map((a) => `Action corrective : ${a}`),
    ...(r.missingAction ? ['ACTION CORRECTIVE MANQUANTE'] : []),
    ...r.corrections.map((c) => `Corrigé le ${formatDayTime(c.time, timeZone)} par ${c.author} (motif : ${c.reason || 'non précisé'}) ; avant : ${c.before}`),
  ]
  return parts.join('\n')
}
