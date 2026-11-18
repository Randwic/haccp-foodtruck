import type { ReactNode } from 'react'
import { Button, Tile } from '../../ui/components/index.ts'
import {
  IconChevronRight,
  IconCleaning,
  IconCooking,
  IconCooling,
  IconDelivery,
  IconDocuments,
  IconDue,
  IconError,
  IconLabel,
  IconOil,
  IconOk,
  IconReheating,
  IconSliders,
  IconSystemTest,
  IconTemperature,
  IconThawing,
  IconTimer,
} from '../../ui/icons.tsx'
import { TIMED_LABELS } from '../processes/labels.ts'
import type { TimedKind, TimedRule } from '../processes/thresholds.ts'
import { describeThreshold } from '../../ui/temperature.ts'
import { formatMinutes, plainSpaces, remainingLabel, type TimedSummary } from '../processes/timing.ts'
import { useProcessStatus, type ProcessSummary } from '../processes/useProcessData.ts'
import { plural, type TemperatureSummary } from '../temperatures/schedule.ts'
import { useTemperatureStatus } from '../temperatures/useTemperatureData.ts'
import { useReceptionStatus, type ReceptionStatus } from '../reception/useReceptionData.ts'
import { whenLabel } from '../temperatures/format.ts'
import { IconAllergen, IconBan, IconSyncPending, IconWarn } from '../../ui/icons.tsx'
import { useLabelStatus } from '../labels/useLabelData.ts'
import type { DueSummary } from '../labels/model.ts'
import { useCleaningStatus, type CleaningStatus } from '../cleaning/useCleaningData.ts'
import { useOilStatus } from '../oil/useOilData.ts'
import type { OilSummary, VatStatus } from '../oil/model.ts'
import { formatPercent } from '../oil/model.ts'
import { wastesThisWeek } from '../reception/wasteModel.ts'
import { IconChecklist, IconWaste } from '../../ui/icons.tsx'
import { useDocumentReminders, type DocumentReminders } from '../documents/useDocumentReminders.ts'

const ICON = 22


function SectionLabel({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
      {children}
    </h2>
  )
}

/** Ligne d'état d'une tuile : icône + texte, jamais la couleur seule. */
export interface StatusLine {
  tone: 'danger' | 'warn' | 'ok' | 'muted' | 'accent'
  icon: ReactNode
  text: string
}
const LINE_TONE = { danger: 'text-danger', warn: 'text-warn', ok: 'text-ok', muted: 'text-fg-subtle', accent: 'text-accent' } as const

function StatusLines({ lines }: { lines: StatusLine[] | null }) {
  if (!lines) return <span className="text-[14px] text-fg-subtle">Chargement…</span>
  return (
    <span className="flex flex-col gap-1">
      {lines.map((l) => (
        <span key={l.text} className={`flex items-center gap-1.5 text-[15px] leading-snug font-semibold ${LINE_TONE[l.tone]}`}>
          {l.icon}
          {l.text}
        </span>
      ))}
    </span>
  )
}

const missingLine = (n: number): StatusLine[] =>
  n > 0 ? [{ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: plural(n, 'action corrective manquante', 'actions correctives manquantes') }] : []

function temperatureLines(s: TemperatureSummary | null): StatusLine[] | null {
  if (!s) return null
  if (s.enclosures === 0) return [{ tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: 'Aucune enceinte en service' }]
  const lines = missingLine(s.missingActions)
  if (s.due > 0) lines.push({ tone: 'warn', icon: <IconDue size={17} className="shrink-0" />, text: plural(s.due, 'relevé à faire', 'relevés à faire') })
  else if (s.missingActions === 0) lines.push({ tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Tout est fait' })
  return lines
}

function temperatureTileLabel(s: TemperatureSummary | null): string {
  if (!s) return 'Températures'
  const parts = [
    s.missingActions > 0 ? plural(s.missingActions, 'action corrective manquante', 'actions correctives manquantes') : '',
    s.due > 0 ? plural(s.due, 'relevé à faire', 'relevés à faire') : '',
  ].filter(Boolean)
  return `Températures : ${parts.length ? parts.join(', ') : s.enclosures ? 'tout est fait' : 'aucune enceinte'}`
}

/** Compteurs d'un procédé chronométré : actions manquantes, lots en cours et temps restant du plus urgent. */
function timedLines(s: TimedSummary): StatusLine[] {
  const lines = missingLine(s.missingActions)
  if (s.next) {
    const u = s.next.countdown.urgency
    lines.push({
      tone: u === 'overdue' ? 'danger' : u === 'soon' ? 'warn' : 'accent',
      icon: u === 'overdue' ? <IconError size={17} className="shrink-0" /> : <IconTimer size={17} className="shrink-0" />,
      text: `${s.running} en cours · ${remainingLabel(s.next.countdown)}`,
    })
  } else if (s.missingActions === 0) lines.push({ tone: 'muted', icon: <IconOk size={17} className="shrink-0" />, text: 'Aucun lot en cours' })
  return lines
}

function processLines(p: ProcessSummary | null): Record<'cooling' | 'reheating' | 'cooking' | 'thawing', StatusLine[] | null> {
  if (!p) return { cooling: null, reheating: null, cooking: null, thawing: null }
  const cooking = missingLine(p.spot.missingActions)
  if (p.spot.missingActions === 0)
    cooking.push(
      p.spot.today > 0
        ? { tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: plural(p.spot.today, 'mesure aujourd’hui', 'mesures aujourd’hui') }
        : { tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: 'Aucune mesure aujourd’hui' },
    )
  const thawing: StatusLine[] =
    p.thawing.running > 0
      ? [{ tone: 'accent', icon: <IconTimer size={17} className="shrink-0" />, text: `${p.thawing.running} en cours` }]
      : [{ tone: 'muted', icon: <IconOk size={17} className="shrink-0" />, text: 'Aucune en cours' }]
  return { cooling: timedLines(p.cooling), reheating: timedLines(p.reheating), cooking, thawing }
}

function tileTone(lines: StatusLine[] | null): 'danger' | 'warn' | undefined {
  if (lines?.some((l) => l.tone === 'danger')) return 'danger'
  if (lines?.some((l) => l.tone === 'warn')) return 'warn'
  return undefined
}

const ariaOf = (title: string, lines: StatusLine[] | null) => (lines ? plainSpaces(`${title} : ${lines.map((l) => l.text).join(', ')}`) : title)

/** Rappel des lots chronométrés en cours (ambre si l'échéance approche, rouge si dépassée). */
function RunningReminder({ kind, summary, onOpen }: { kind: TimedKind; summary: TimedSummary; onOpen: () => void }) {
  if (!summary.next) return null
  const u = summary.next.countdown.urgency
  const cls = u === 'overdue' ? 'border-danger/45 bg-danger-soft' : u === 'soon' ? 'border-warn/45 bg-warn-soft' : 'border-line bg-surface shadow-card'
  const iconCls = u === 'overdue' ? 'text-danger' : u === 'soon' ? 'text-warn' : 'text-accent'
  const text = `${plural(summary.running, TIMED_LABELS[kind].one, TIMED_LABELS[kind].many)} · ${remainingLabel(summary.next.countdown)}`
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={plainSpaces(`${text} — ${summary.next.batch.product}`)}
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-[background-color,transform] active:scale-[0.99] active:bg-pressed sm:px-5 ${cls}`}
    >
      {u === 'overdue' ? <IconError size={22} className={`shrink-0 ${iconCls}`} /> : <IconTimer size={22} className={`shrink-0 ${iconCls}`} />}
      <span className="min-w-0 flex-1 text-[16px] text-fg">
        <span className="font-semibold">{text}</span>
        <span className="text-fg-muted">
          {' '}
          — {summary.next.batch.product}
          {u === 'overdue' ? ' : mesurez et clôturez le lot' : ''}
        </span>
      </span>
      <IconChevronRight size={20} className="shrink-0 text-fg-subtle" />
    </button>
  )
}

/** « ≥ 63 °C → ≤ 10 °C en 2 h » (tuile). */
function shortObjective(rule: TimedRule): string {
  const d = formatMinutes(rule.maxMinutes * 60_000)
  return rule.start ? `${describeThreshold(rule.start)} → ${describeThreshold(rule.target)} en ${d}` : `${describeThreshold(rule.target)} en ${d}`
}

/** Compteurs de la tuile Réception : action manquante, dernière réception, photos en attente, refus de la semaine. */
function receptionLines(s: ReceptionStatus | null, now: Date, tz: string): StatusLine[] | null {
  if (!s) return null
  const lines = missingLine(s.missingActions)
  lines.push(
    s.last
      ? { tone: 'muted', icon: <IconOk size={17} className="shrink-0" />, text: `Dernier achat : ${whenLabel(s.last, now, tz)}` }
      : { tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: 'Aucun achat récent' },
  )
  if (s.photos.failed > 0) lines.push({ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: plural(s.photos.failed, 'photo refusée', 'photos refusées') })
  else if (s.photos.pending > 0)
    lines.push({ tone: 'warn', icon: <IconSyncPending size={17} className="shrink-0" />, text: `${plural(s.photos.pending, 'photo', 'photos')} en attente d’envoi` })
  if (s.refusedThisWeek > 0) lines.push({ tone: 'warn', icon: <IconBan size={17} className="shrink-0" />, text: `${plural(s.refusedThisWeek, 'refus', 'refus')} cette semaine` })
  return lines
}

/** Tuile Étiquettes : DLC dépassées (rouge), DLC aujourd'hui (ambre), demain. */
function labelLines(s: DueSummary | null): StatusLine[] | null {
  if (!s) return null
  const lines: StatusLine[] = []
  if (s.expired > 0) lines.push({ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: plural(s.expired, 'DLC dépassée', 'DLC dépassées') })
  if (s.today > 0) lines.push({ tone: 'warn', icon: <IconDue size={17} className="shrink-0" />, text: `${plural(s.today, 'produit', 'produits')} à DLC aujourd’hui` })
  if (s.tomorrow > 0) lines.push({ tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: `${plural(s.tomorrow, 'produit', 'produits')} à DLC demain` })
  if (!lines.length) lines.push({ tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Aucune DLC proche' })
  return lines
}

/** Tuile Nettoyage : tâches en retard (rouge / ambre), à faire, checklists à faire. */
function cleaningLines(s: CleaningStatus | null): StatusLine[] | null {
  if (!s) return null
  const { summary: m } = s
  const lines: StatusLine[] = []
  if (m.overdue > 0) lines.push({ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: plural(m.overdue, 'tâche très en retard', 'tâches très en retard') })
  if (m.late > 0) lines.push({ tone: 'warn', icon: <IconWarn size={17} className="shrink-0" />, text: plural(m.late, 'tâche en retard', 'tâches en retard') })
  const due = m.todo - m.late - m.overdue
  if (due > 0) lines.push({ tone: 'accent', icon: <IconDue size={17} className="shrink-0" />, text: plural(due, 'tâche à faire', 'tâches à faire') })
  if (m.checklists.length > 0)
    lines.push({ tone: m.checklists.some((c) => c.state !== 'due') ? 'warn' : 'accent', icon: <IconChecklist size={17} className="shrink-0" />, text: plural(m.checklists.length, 'checklist à faire', 'checklists à faire') })
  if (!lines.length) lines.push({ tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Plan de nettoyage à jour' })
  return lines
}

/** Tuile Huiles : actions manquantes, bacs hors limite / à surveiller, contrôle du jour. */
function oilLines(s: OilSummary | null, statuses: readonly VatStatus[]): StatusLine[] | null {
  if (!s) return null
  if (s.vats === 0) return [{ tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: 'Aucun bac de friteuse en service' }]
  const lines = missingLine(s.missingActions)
  for (const v of statuses) {
    if (v.level !== 'out' && v.level !== 'warn') continue
    const value = v.lastCheck ? ` (${formatPercent(v.lastCheck.payload.polar_percent)})` : ''
    if (v.level === 'out' && v.missingActions.length === 0) lines.push({ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: `${v.vat.name} hors limite${value}` })
    else if (v.level === 'warn') lines.push({ tone: 'warn', icon: <IconWarn size={17} className="shrink-0" />, text: `${v.vat.name} à surveiller${value}` })
  }
  if (s.notCheckedToday > 0) lines.push({ tone: 'muted', icon: <IconDue size={17} className="shrink-0" />, text: s.notCheckedToday === s.vats ? 'Aucun contrôle aujourd’hui' : plural(s.notCheckedToday, 'bac non contrôlé aujourd’hui', 'bacs non contrôlés aujourd’hui') })
  if (!lines.length) lines.push({ tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Huiles conformes' })
  return lines
}

/** Tuile Documents & PMS : documents échus (rouge) ou à renouveler sous 30 jours (ambre). */
function documentLines(r: DocumentReminders | null): StatusLine[] {
  if (!r) return [{ tone: 'muted', icon: <IconDocuments size={17} className="shrink-0" />, text: 'Dossier pour un contrôle' }]
  const lines: StatusLine[] = []
  if (r.expired > 0) lines.push({ tone: 'danger', icon: <IconError size={17} className="shrink-0" />, text: plural(r.expired, 'document échu', 'documents échus') })
  if (r.soon > 0) lines.push({ tone: 'warn', icon: <IconDue size={17} className="shrink-0" />, text: plural(r.soon, 'document à renouveler', 'documents à renouveler') })
  if (!lines.length) lines.push({ tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Documents à jour' })
  return lines
}

/** Rappels des checklists (ouverture, fermeture, nuisibles) : ambre si en retard. */
function ChecklistReminder({ status, onOpen }: { status: CleaningStatus['summary']['checklists'][number]; onOpen: () => void }) {
  const late = status.state === 'late' || status.state === 'overdue'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={plainSpaces(`Checklist ${status.checklist.name} — ${status.label}`)}
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-[background-color,transform] active:scale-[0.99] active:bg-pressed sm:px-5 ${late ? 'border-warn/45 bg-warn-soft' : 'border-line bg-surface shadow-card'}`}
    >
      <IconChecklist size={22} className={`shrink-0 ${late ? 'text-warn' : 'text-accent'}`} />
      <span className="min-w-0 flex-1 text-[16px] text-fg">
        <span className="font-semibold">Checklist {status.checklist.name}</span>
        <span className="text-fg-muted"> — {status.label}</span>
      </span>
      <IconChevronRight size={20} className="shrink-0 text-fg-subtle" />
    </button>
  )
}

export type ProcessView = 'cooling' | 'reheating' | 'cooking' | 'thawing'

export interface TodayScreenProps {
  onOpenSystemTest: () => void
  onOpenManagement?: () => void
  onOpenTemperatures: () => void
  onOpenReception?: () => void
  onOpenProcess: (view: ProcessView) => void
  onOpenLabels?: () => void
  onOpenAllergens?: () => void
  /** Nettoyage ; avec un identifiant : ouvre directement cette checklist (rappel). */
  onOpenCleaning?: (checklistId?: string) => void
  onOpenOil?: () => void
  onOpenWaste?: () => void
  /** Documents & PMS (gérant). Sans gestionnaire : tuile grisée « réservé au gérant ». */
  onOpenDocuments?: () => void
}

/** Accueil « Aujourd'hui » : alertes, modules HACCP puis outils. */
export function TodayScreen({ onOpenSystemTest, onOpenManagement, onOpenTemperatures, onOpenReception, onOpenProcess, onOpenLabels, onOpenAllergens, onOpenCleaning, onOpenOil, onOpenWaste, onOpenDocuments }: TodayScreenProps) {
  const documents = documentLines(useDocumentReminders(!!onOpenDocuments))
  const { status: cleaningStatus } = useCleaningStatus(60_000)
  const cleaning = cleaningLines(cleaningStatus)
  const { summary: oilSummary, statuses: vatStatuses } = useOilStatus(60_000)
  const oil = oilLines(oilSummary, vatStatuses)
  const { summary: labelSummary } = useLabelStatus(60_000)
  const labels = labelLines(labelSummary)
  const { summary } = useTemperatureStatus()
  const { summary: processes, data: processData } = useProcessStatus(15_000)
  const temp = temperatureLines(summary)
  const lines = processLines(processes)
  const { summary: receptionSummary, data: receptionData, now: receptionNow } = useReceptionStatus(60_000)
  const reception = receptionLines(receptionSummary, receptionNow, receptionData?.timeZone ?? 'Europe/Paris')
  const weekWastes = receptionData ? wastesThisWeek(receptionData.wastes, receptionNow, receptionData.timeZone).length : null
  const waste: StatusLine[] | null =
    weekWastes === null
      ? null
      : [weekWastes > 0
          ? { tone: 'muted', icon: <IconWaste size={17} className="shrink-0" />, text: `${plural(weekWastes, 'produit jeté', 'produits jetés')} en 7 jours` }
          : { tone: 'ok', icon: <IconOk size={17} className="shrink-0" />, text: 'Aucun produit jeté en 7 jours' }]
  const reminders = cleaningStatus?.summary.checklists ?? []
  const processMissing = processes ? processes.cooling.missingActions + processes.reheating.missingActions + processes.spot.missingActions : 0

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
      <h1 className="mb-6 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Aujourd’hui</h1>

      {summary && summary.missingActions > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5 sm:px-5">
          <IconError size={22} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
            <span className="font-semibold">{plural(summary.missingActions, 'relevé hors seuil', 'relevés hors seuil')} sans action corrective.</span> À traiter dans Températures.
          </p>
          <Button variant="danger" onClick={onOpenTemperatures}>
            Traiter
          </Button>
        </div>
      )}
      {processMissing > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5 sm:px-5">
          <IconError size={22} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
            <span className="font-semibold">{plural(processMissing, 'mesure hors objectif', 'mesures hors objectif')} sans action corrective.</span> À traiter depuis la tuile signalée en rouge.
          </p>
        </div>
      )}

      {processes && (processes.cooling.next || processes.reheating.next) && (
        <section aria-label="Lots en cours" className="mb-4 grid gap-3 md:grid-cols-2">
          <RunningReminder kind="cooling" summary={processes.cooling} onOpen={() => onOpenProcess('cooling')} />
          <RunningReminder kind="reheating" summary={processes.reheating} onOpen={() => onOpenProcess('reheating')} />
        </section>
      )}

      {onOpenCleaning && reminders.length > 0 && (
        <section aria-label="Checklists à faire" className="mb-4 grid gap-3 md:grid-cols-2">
          {reminders.map((r) => (
            <ChecklistReminder key={r.checklist.id} status={r} onOpen={() => onOpenCleaning(r.checklist.id)} />
          ))}
        </section>
      )}

      <section aria-labelledby="modules-title" className="mt-6">
        <SectionLabel id="modules-title">Registres HACCP</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Tile
            title="Températures"
            icon={<IconTemperature size={ICON} />}
            description="Frigos et congélateurs"
            status={<StatusLines lines={temp} />}
            tone={tileTone(temp)}
            ariaLabel={temperatureTileLabel(summary)}
            onClick={onOpenTemperatures}
          />
          <Tile
            title="Refroidissement"
            icon={<IconCooling size={ICON} />}
            description={processData ? shortObjective(processData.rules.cooling) : "≥ 63 °C → ≤ 10 °C en 2 h"}
            status={<StatusLines lines={lines.cooling} />}
            tone={tileTone(lines.cooling)}
            ariaLabel={ariaOf('Refroidissement', lines.cooling)}
            onClick={() => onOpenProcess('cooling')}
          />
          <Tile
            title="Remise en température"
            icon={<IconReheating size={ICON} />}
            description={processData ? shortObjective(processData.rules.reheating) : "≥ 63 °C en 1 h"}
            status={<StatusLines lines={lines.reheating} />}
            tone={tileTone(lines.reheating)}
            ariaLabel={ariaOf('Remise en température', lines.reheating)}
            onClick={() => onOpenProcess('reheating')}
          />
          <Tile
            title="Cuisson & maintien"
            icon={<IconCooking size={ICON} />}
            description="À cœur et au chaud"
            status={<StatusLines lines={lines.cooking} />}
            tone={tileTone(lines.cooking)}
            ariaLabel={ariaOf('Cuisson & maintien', lines.cooking)}
            onClick={() => onOpenProcess('cooking')}
          />
          <Tile
            title="Décongélation"
            icon={<IconThawing size={ICON} />}
            description="En enceinte froide, DLC"
            status={<StatusLines lines={lines.thawing} />}
            tone={tileTone(lines.thawing)}
            ariaLabel={ariaOf('Décongélation', lines.thawing)}
            onClick={() => onOpenProcess('thawing')}
          />
          {onOpenReception && (
            <Tile
              title="Achats & réception"
              icon={<IconDelivery size={ICON} />}
              description="Approvisionnement, lots, DLC"
              status={<StatusLines lines={reception} />}
              tone={tileTone(reception)}
              ariaLabel={ariaOf('Achats & réception', reception)}
              onClick={onOpenReception}
            />
          )}
          {onOpenLabels && (
            <Tile
              title="Étiquettes DLC"
              icon={<IconLabel size={ICON} />}
              description="Ouverture, préparations, décongélation"
              status={<StatusLines lines={labels} />}
              tone={tileTone(labels)}
              ariaLabel={ariaOf('Étiquettes DLC', labels)}
              onClick={onOpenLabels}
            />
          )}
          {onOpenWaste && (
            <Tile
              title="Produits jetés"
              icon={<IconWaste size={ICON} />}
              description="Pertes, dates dépassées, rappels"
              status={<StatusLines lines={waste} />}
              ariaLabel={ariaOf('Produits jetés', waste)}
              onClick={onOpenWaste}
            />
          )}
          {onOpenCleaning && (
            <Tile
              title="Nettoyage"
              icon={<IconCleaning size={ICON} />}
              description="Plan de nettoyage, checklists"
              status={<StatusLines lines={cleaning} />}
              tone={tileTone(cleaning)}
              ariaLabel={ariaOf('Nettoyage', cleaning)}
              onClick={() => onOpenCleaning()}
            />
          )}
          {onOpenOil && (
            <Tile
              title="Huiles de friture"
              icon={<IconOil size={ICON} />}
              description="Composés polaires, changements"
              status={<StatusLines lines={oil} />}
              tone={tileTone(oil)}
              ariaLabel={ariaOf('Huiles de friture', oil)}
              onClick={onOpenOil}
            />
          )}
          {onOpenDocuments ? (
            <Tile
              title="Documents & PMS"
              icon={<IconDocuments size={ICON} />}
              description="Mode Contrôle, documents, plan"
              status={<StatusLines lines={documents} />}
              tone={tileTone(documents)}
              ariaLabel={ariaOf('Documents & PMS', documents)}
              onClick={onOpenDocuments}
            />
          ) : (
            <Tile title="Documents & PMS" icon={<IconDocuments size={ICON} />} description="Réservé au gérant" disabled />
          )}
        </div>
      </section>

      <section aria-labelledby="tools-title" className="mt-8">
        <SectionLabel id="tools-title">Outils</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {onOpenManagement && (
            <Tile layout="row" title="Gestion" icon={<IconSliders size={ICON} />} description="Équipements, équipe, produits, nettoyage, réglages" onClick={onOpenManagement} />
          )}
          {onOpenAllergens && (
            <Tile layout="row" title="Tableau des allergènes" icon={<IconAllergen size={ICON} />} description="Information clientèle, impression A4" onClick={onOpenAllergens} />
          )}
          <Tile layout="row" title="Test d’enregistrement" icon={<IconSystemTest size={ICON} />} description="Vérifier saisie et synchro" onClick={onOpenSystemTest} />
        </div>
      </section>

      <p className="mt-10 max-w-3xl text-[13px] leading-relaxed text-fg-subtle">
        Outil d’aide à l’application du Plan de Maîtrise Sanitaire : il ne vaut pas agrément et ne remplace pas la responsabilité de l’exploitant.
      </p>
    </main>
  )
}
