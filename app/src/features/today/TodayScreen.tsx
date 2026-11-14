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

const ICON = 22

const UPCOMING = [
  { title: 'Réception', Icon: IconDelivery, description: 'Livraisons, lots, DLC' },
  { title: 'Étiquettes DLC', Icon: IconLabel, description: 'Impression et allergènes' },
  { title: 'Nettoyage', Icon: IconCleaning, description: 'Plan et checklists' },
  { title: 'Huiles de friture', Icon: IconOil, description: 'Composés polaires, vidanges' },
  { title: 'Documents & PMS', Icon: IconDocuments, description: 'Plan de maîtrise, export contrôle' },
] as const

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

export type ProcessView = 'cooling' | 'reheating' | 'cooking' | 'thawing'

export interface TodayScreenProps {
  onOpenSystemTest: () => void
  onOpenManagement?: () => void
  onOpenTemperatures: () => void
  onOpenProcess: (view: ProcessView) => void
}

/** Accueil « Aujourd'hui » : alertes, modules HACCP puis outils. */
export function TodayScreen({ onOpenSystemTest, onOpenManagement, onOpenTemperatures, onOpenProcess }: TodayScreenProps) {
  const { summary } = useTemperatureStatus()
  const { summary: processes, data: processData } = useProcessStatus(15_000)
  const temp = temperatureLines(summary)
  const lines = processLines(processes)
  const processMissing = processes ? processes.cooling.missingActions + processes.reheating.missingActions + processes.spot.missingActions : 0

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
      <h1 className="mb-6 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Aujourd’hui</h1>

      {summary && summary.missingActions > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5 sm:px-5">
          <IconError size={22} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-[16px] text-fg">
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
          <p className="min-w-0 flex-1 text-[16px] text-fg">
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
          {UPCOMING.map((m) => (
            <Tile key={m.title} title={m.title} icon={<m.Icon size={ICON} />} description={m.description} disabled />
          ))}
        </div>
      </section>

      <section aria-labelledby="tools-title" className="mt-8">
        <SectionLabel id="tools-title">Outils</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {onOpenManagement && (
            <Tile layout="row" title="Gestion" icon={<IconSliders size={ICON} />} description="Équipements, équipe, réglages" onClick={onOpenManagement} />
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
