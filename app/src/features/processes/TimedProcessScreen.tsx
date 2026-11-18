// Refroidissement rapide et remise en température : lots chronométrés (start → check… → end).
import { useMemo, useState } from 'react'
import type { CoolingPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { Badge, Button, Notice, TemperatureInput, useToast } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconCheck, IconCooling, IconDue, IconEdit, IconError, IconFinish, IconHistory, IconReheating, IconStart, IconTemperature, IconTimer, IconWarn } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature, isInRange } from '../../ui/temperature.ts'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { dayLabel, whenLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import {
  BackButton,
  DeadlineBar,
  EmptyCard,
  EntryLayout,
  EntryTrail,
  ErrorNotice,
  MissingAction,
  PageTitle,
  ProductField,
  ResultBadge,
  SectionLabel,
  StickyActions,
  SyncBadge,
  entryRecords,
  useAuthorName,
  useRecordSaver,

} from './common.tsx'
import { TemperatureCorrection } from './CorrectionForms.tsx'
import { lastValue, recentProducts, type Entry, type TimedBatch } from './entries.ts'
import { objectiveLabel, TIMED_LABELS } from './labels.ts'
import { requestDeadlineNotifications } from './notifications.ts'
import { ruleForBatch, type TimedKind, type TimedRule } from './thresholds.ts'
import { countdown, elapsedLabel, plainSpaces, evaluateEnd, formatMinutes, remainingLabel, type Countdown } from './timing.ts'
import { batchesOf, PROCESS_HISTORY_DAYS, useProcessStatus, type ProcessData } from './useProcessData.ts'

export function TimedIcon({ kind, size = 22 }: { kind: TimedKind; size?: number }) {
  return kind === 'cooling' ? <IconCooling size={size} /> : <IconReheating size={size} />
}

const STEP_LABEL = { start: 'Début', check: 'Mesure', end: 'Fin' } as const

type Back = { name: 'list' } | { name: 'history' }
type View =
  | Back
  | { name: 'start' }
  | { name: 'measure'; batchId: string; step: 'check' | 'end' }
  | { name: 'correct'; batchId: string; entryId: string; back: Back }
  | { name: 'action'; batchId: string; relatedRecordId: string; value_c: number; durationMin: number; back: Back }

/** Écran d'un procédé chronométré : lots en cours, démarrage, mesures, clôture, historique, corrections. */
export function TimedProcessScreen({ kind, onBack }: { kind: TimedKind; onBack: () => void }) {
  const { data, error, reload, now } = useProcessStatus(5_000)
  const [view, setView] = useState<View>({ name: 'list' })
  const labels = TIMED_LABELS[kind]

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else {
    const rule = data.rules[kind]
    const batches = batchesOf(data, kind)
    const batch = 'batchId' in view ? batches.find((b) => b.batchId === view.batchId) : undefined

    if (view.name === 'action') {
      return (
        <CorrectiveActionFlow
          key={view.relatedRecordId}
          relatedRecordId={view.relatedRecordId}
          subject={`${labels.title} — ${batch?.product ?? 'lot'}`}
          detail={
            <>
              <span className="font-semibold text-danger tabular-nums">{formatTemperature(view.value_c)}</span> après {formatMinutes(view.durationMin * 60_000)} · objectif{' '}
              {describeThreshold(rule.target)} en {formatMinutes(rule.maxMinutes * 60_000)} maximum
            </>
          }
          onDone={async () => {
            await reload()
            setView(view.back)
          }}
        />
      )
    }
    if (view.name === 'start') {
      body = (
        <>
          <BackButton label={labels.title} onClick={() => setView({ name: 'list' })} />
          <StartBatch
            kind={kind}
            data={data}
            onStarted={async () => {
              await reload()
              setView({ name: 'list' })
            }}
          />
        </>
      )
    } else if (view.name === 'measure') {
      body = (
        <>
          <BackButton label={labels.title} onClick={() => setView({ name: 'list' })} />
          {batch && batch.running ? (
            <MeasureStep
              batch={batch}
              step={view.step}
              rule={ruleForBatch(rule, batch.product, data.products)}
              data={data}
              now={now}
              onSaved={async (rec, payload) => {
                await reload()
                if (payload.step === 'end' && payload.in_range === false) {
                  setView({ name: 'action', batchId: batch.batchId, relatedRecordId: rec.id, value_c: payload.value_c, durationMin: payload.duration_min ?? 0, back: { name: 'list' } })
                } else setView({ name: 'list' })
              }}
            />
          ) : (
            <Notice tone="info">Ce lot est déjà clôturé.</Notice>
          )}
        </>
      )
    } else if (view.name === 'correct') {
      const entry = batch?.steps.find((s) => s.id === view.entryId)
      body = (
        <>
          <BackButton label="Historique" onClick={() => setView(view.back)} />
          {batch && entry ? (
            <StepCorrection
              batch={batch}
              entry={entry}
              rule={ruleForBatch(rule, batch.product, data.products)}
              data={data}
              now={now}
              onCancel={() => setView(view.back)}
              onSaved={async (rec, replacement) => {
                await reload()
                if (replacement.step === 'end' && replacement.in_range === false && entry.correctiveActions.length === 0) {
                  setView({ name: 'action', batchId: batch.batchId, relatedRecordId: rec.id, value_c: replacement.value_c, durationMin: replacement.duration_min ?? 0, back: view.back })
                } else setView(view.back)
              }}
            />
          ) : (
            <Notice>Étape introuvable.</Notice>
          )}
        </>
      )
    } else if (view.name === 'history') {
      body = (
        <>
          <BackButton label={labels.title} onClick={() => setView({ name: 'list' })} />
          <TimedHistory
            kind={kind}
            batches={batches}
            data={data}
            now={now}
            onCorrect={(b, e) => setView({ name: 'correct', batchId: b.batchId, entryId: e.id, back: { name: 'history' } })}
            onCorrectiveAction={(b) => setView(actionFor(b, { name: 'history' }))}
          />
        </>
      )
    } else {
      body = (
        <>
          <BackButton label="Accueil" onClick={onBack} />
          <TimedList
            kind={kind}
            batches={batches}
            rule={rule}
            data={data}
            now={now}
            onStart={() => setView({ name: 'start' })}
            onHistory={() => setView({ name: 'history' })}
            onMeasure={(b, step) => setView({ name: 'measure', batchId: b.batchId, step })}
            onCorrectiveAction={(b) => setView(actionFor(b, { name: 'list' }))}
          />
        </>
      )
    }
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}

function actionFor(b: TimedBatch, back: Back): View {
  return { name: 'action', batchId: b.batchId, relatedRecordId: b.end!.latest.id, value_c: b.end!.payload.value_c, durationMin: b.durationMin ?? 0, back }
}

function UrgencyBadge({ c }: { c: Countdown }) {
  if (c.urgency === 'overdue')
    return (
      <Badge tone="error">
        <IconError size={14} strokeWidth={2.25} />
        Délai dépassé
      </Badge>
    )
  if (c.urgency === 'soon')
    return (
      <Badge tone="warn">
        <IconDue size={14} strokeWidth={2.25} />
        Échéance proche
      </Badge>
    )
  return (
    <Badge tone="info">
      <IconTimer size={14} strokeWidth={2.25} />
      En cours
    </Badge>
  )
}

/** Chronomètre d'un lot : écoulé / restant, barre de progression, échéance. */
export function BatchChrono({ batch, rule, now, tz }: { batch: TimedBatch; rule: TimedRule; now: Date; tz: string }) {
  const c = countdown(batch.startedAt, rule, now)
  const tone = c.urgency === 'overdue' ? 'text-danger' : c.urgency === 'soon' ? 'text-warn' : 'text-fg'
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Écoulé</div>
          <div className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums">{elapsedLabel(c)}</div>
        </div>
        <div className="text-right">
          <div className={`text-[19px] leading-tight font-semibold tabular-nums first-letter:uppercase ${tone}`}>{remainingLabel(c)}</div>
          <div className="text-[14px] text-fg-muted tabular-nums">Échéance {formatTime(c.deadline, tz)}</div>
        </div>
      </div>
      <div className="mt-3">
        <DeadlineBar progress={c.progress} urgency={c.urgency} label={`Temps écoulé sur ${formatMinutes(rule.maxMinutes * 60_000)}`} />
      </div>
    </div>
  )
}

function TimedList(props: {
  kind: TimedKind
  batches: TimedBatch[]
  rule: TimedRule
  data: ProcessData
  now: Date
  onStart: () => void
  onHistory: () => void
  onMeasure: (b: TimedBatch, step: 'check' | 'end') => void
  onCorrectiveAction: (b: TimedBatch) => void
}) {
  const { kind, batches, rule, data, now } = props
  const labels = TIMED_LABELS[kind]
  const tz = data.timeZone
  const running = batches.filter((b) => b.running).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const missing = batches.filter((b) => b.missingAction)
  const todayStart = startOfLocalDay(now, tz).getTime()
  const doneToday = batches.filter((b) => !b.running && Date.parse(b.endedAt!) >= todayStart)

  return (
    <>
      <PageTitle
        title={labels.title}
        subtitle={
          <>
            Objectif : {objectiveLabel(rule)}
            {rule.isDefault ? ' (valeurs par défaut, à confirmer selon votre PMS)' : ''}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={props.onHistory} icon={<IconHistory size={20} />}>
              Historique
            </Button>
            <Button onClick={props.onStart} icon={<IconStart size={20} />}>
              Démarrer un lot
            </Button>
          </>
        }
      />

      {missing.length > 0 && (
        <section aria-labelledby="missing-title" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
          <h2 id="missing-title" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
            <IconError size={22} className="shrink-0" />
            {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {missing.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <span className="text-[16px] text-fg">
                  <span className="font-semibold">{b.product}</span> · {formatTemperature(b.end!.payload.value_c)} en {formatMinutes((b.durationMin ?? 0) * 60_000)} · clôturé{' '}
                  {whenLabel(b.endedAt!, now, tz)}
                </span>
                <Button variant="danger" onClick={() => props.onCorrectiveAction(b)}>
                  Faire l’action corrective
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SectionLabel>{running.length ? plural(running.length, labels.one, labels.many) : 'En cours'}</SectionLabel>
      {running.length === 0 ? (
        <EmptyCard>Aucun lot en cours. Touchez « Démarrer un lot » dès la mesure de départ.</EmptyCard>
      ) : (
        <ul className="grid gap-3 sm:gap-4 md:grid-cols-2" aria-label="Lots en cours">
          {running.map((b) => (
            <li key={b.batchId}>
              <RunningCard batch={b} rule={ruleForBatch(rule, b.product, data.products)} data={data} now={now} onMeasure={props.onMeasure} />
            </li>
          ))}
        </ul>
      )}

      {doneToday.length > 0 && (
        <section className="mt-8" aria-labelledby="done-title">
          <SectionLabel id="done-title">Clôturés aujourd’hui</SectionLabel>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {doneToday.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <span className="min-w-0 flex-1 text-[16px] text-fg">
                  <span className="font-semibold">{b.product}</span>
                  <span className="text-fg-muted tabular-nums">
                    {' '}
                    · {formatTime(b.startedAt, tz)} → {formatTime(b.endedAt!, tz)} · {formatMinutes((b.durationMin ?? 0) * 60_000)} · {formatTemperature(b.end!.payload.value_c)}
                  </span>
                </span>
                <ResultBadge ok={b.inRange === true} koLabel="Hors objectif" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function RunningCard({ batch, rule, data, now, onMeasure }: { batch: TimedBatch; rule: TimedRule; data: ProcessData; now: Date; onMeasure: (b: TimedBatch, step: 'check' | 'end') => void }) {
  const c = countdown(batch.startedAt, rule, now)
  const last = lastValue(batch)
  const tz = data.timeZone
  return (
    <article
      aria-label={plainSpaces(`${batch.product}, ${remainingLabel(c)}`)}
      className={`flex h-full flex-col gap-4 rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${c.urgency === 'overdue' ? 'border-danger/60' : c.urgency === 'soon' ? 'border-warn/60' : 'border-line'}`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <TimedIcon kind={batch.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[19px] leading-snug font-semibold tracking-[-0.01em] text-fg">{batch.product}</h3>
          <p className="text-[14px] text-fg-muted tabular-nums">
            Début {formatTime(batch.startedAt, tz)} à {formatTemperature(batch.start.payload.value_c)}
          </p>
        </div>
        <UrgencyBadge c={c} />
      </div>
      <BatchChrono batch={batch} rule={rule} now={now} tz={tz} />
      <p className="flex items-center gap-2 text-[15px] text-fg-muted">
        <IconTemperature size={18} className="shrink-0 text-fg-subtle" />
        {last.step === 'start' ? 'Aucune mesure intermédiaire' : `Dernière mesure : ${formatTemperature(last.value_c)} à ${formatTime(last.time, tz)}`}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => onMeasure(batch, 'check')} aria-label={`Mesure intermédiaire — ${batch.product}`}>
          Mesurer
        </Button>
        <Button onClick={() => onMeasure(batch, 'end')} icon={<IconFinish size={20} />} aria-label={`Clôturer — ${batch.product}`}>
          Clôturer
        </Button>
      </div>
    </article>
  )
}

function StartBatch({ kind, data, onStarted }: { kind: TimedKind; data: ProcessData; onStarted: () => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const labels = TIMED_LABELS[kind]
  const [product, setProduct] = useState('')
  const rule = ruleForBatch(data.rules[kind], product, data.products)
  const [value, setValue] = useState<number | null>(null)
  const suggestions = useMemo(
    () => recentProducts(batchesOf(data, kind).map((b) => ({ product: b.product, time: b.startedAt })), labels.defaults),
    [data, kind, labels.defaults],
  )
  const lowStart = value !== null && rule.start !== null && !isInRange(value, rule.start)

  const submit = async () => {
    if (value === null || !product.trim()) return
    void requestDeadlineNotifications()
    const payload: CoolingPayload = { batch_id: crypto.randomUUID(), step: 'start', product: product.trim(), value_c: value, source: 'manual' }
    const rec = await save(kind, { ...payload })
    if (!rec) return
    toast(`Lot démarré : ${payload.product}, échéance dans ${formatMinutes(rule.maxMinutes * 60_000)}`, 'ok')
    onStarted()
  }

  return (
    <EntryLayout
      left={
        <>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <TimedIcon kind={kind} size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Démarrer un lot</h1>
              <p className="text-[16px] text-fg-muted">{objectiveLabel(rule)}</p>
            </div>
          </div>
          <div className="mt-6">
            <ProductField value={product} onChange={setProduct} suggestions={suggestions} />
          </div>
          {rule.product && (
            <p className="mt-3 max-w-md text-[15px] font-semibold text-fg">
              {rule.product.name} : objectif {describeThreshold(rule.target)} à cœur (cuisson à cœur du produit, plus exigeante que le seuil général).
            </p>
          )}
          <p className="mt-5 max-w-md text-[15px] text-fg-subtle">{labels.startHint} Le chronomètre part à l’enregistrement.</p>
        </>
      }
      right={
        <>
          <TemperatureInput label="Température à cœur au départ" value={value} onChange={setValue} threshold={rule.start ?? undefined} />
          {lowStart && (
            <div className="mt-1 max-w-sm">
              <Notice tone="warn">
                <span className="font-semibold">Départ sous {formatTemperature(rule.start!.min_c ?? 0)}.</span> Le refroidissement rapide part d’un produit qui sort de cuisson. Vérifiez
                la mesure : le lot peut être démarré, l’écart restera visible dans l’historique.
              </Notice>
            </div>
          )}
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={value === null || !product.trim() || busy} icon={<IconStart size={22} />}>
              {busy ? 'Enregistrement…' : 'Démarrer le chronomètre'}
            </Button>
            {!product.trim() && <p className="text-[14px] text-fg-subtle">Indiquez le produit pour démarrer.</p>}
          </StickyActions>
        </>
      }
    />
  )
}

function MeasureStep(props: { batch: TimedBatch; step: 'check' | 'end'; rule: TimedRule; data: ProcessData; now: Date; onSaved: (rec: HaccpRecord, payload: CoolingPayload) => void }) {
  const { batch, step, rule, data, now } = props
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [value, setValue] = useState<number | null>(null)
  const tz = data.timeZone
  const preview = value === null ? null : evaluateEnd({ startedAt: batch.startedAt, endedAt: now, value_c: value, rule })
  const live = evaluateEnd({ startedAt: batch.startedAt, endedAt: now, value_c: 0, rule })

  const submit = async () => {
    if (value === null) return
    const payload: CoolingPayload = { batch_id: batch.batchId, step, product: batch.product, value_c: value, source: 'manual' }
    if (step === 'end') {
      // Conformité et durée calculées par l'app, à l'instant de l'enregistrement.
      const r = evaluateEnd({ startedAt: batch.startedAt, endedAt: new Date(), value_c: value, rule })
      payload.in_range = r.in_range
      payload.duration_min = r.duration_min
    }
    const rec = await save(batch.kind, { ...payload })
    if (!rec) return
    if (step === 'check') toast(`Mesure enregistrée : ${batch.product}, ${formatTemperature(value)}`, 'ok')
    else if (payload.in_range) toast(`Lot clôturé, conforme : ${batch.product}`, 'ok')
    props.onSaved(rec, payload)
  }

  return (
    <EntryLayout
      left={
        <>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{step === 'end' ? 'Clôturer le lot' : 'Mesure intermédiaire'}</h1>
          <p className="mt-1 text-[17px] font-semibold text-fg">{batch.product}</p>
          <p className="text-[15px] text-fg-muted tabular-nums">
            Début {whenLabel(batch.startedAt, now, tz)} à {formatTemperature(batch.start.payload.value_c)} · objectif {describeThreshold(rule.target)}
          </p>
          <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <BatchChrono batch={batch} rule={rule} now={now} tz={tz} />
          </div>
          {step === 'end' && (
            <div className="mt-4">
              {preview ? (
                <EndPreview targetReached={preview.targetReached} withinTime={preview.withinTime} durationMin={preview.duration_min} rule={rule} />
              ) : (
                <p className="text-[15px] text-fg-subtle">
                  Durée à ce jour : {formatMinutes(live.duration_min * 60_000)}. La conformité (température et délai) est calculée automatiquement.
                </p>
              )}
            </div>
          )}
        </>
      }
      right={
        <>
          <TemperatureInput label={step === 'end' ? 'Température à cœur finale' : 'Température à cœur'} value={value} onChange={setValue} threshold={rule.target} autoFocus />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={value === null || busy} icon={step === 'end' ? <IconFinish size={22} /> : <IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : step === 'end' ? 'Clôturer le lot' : 'Enregistrer la mesure'}
            </Button>
          </StickyActions>
        </>
      }
    />
  )
}

function EndPreview({ targetReached, withinTime, durationMin, rule }: { targetReached: boolean; withinTime: boolean; durationMin: number; rule: TimedRule }) {
  const ok = targetReached && withinTime
  return (
    <div className={`rounded-2xl border p-4 ${ok ? 'border-ok/35 bg-ok-soft' : 'border-danger/35 bg-danger-soft'}`} role="status">
      <p className={`flex items-center gap-2 text-[17px] font-semibold ${ok ? 'text-ok' : 'text-danger'}`}>
        {ok ? <IconCheck size={20} strokeWidth={2.25} /> : <IconWarn size={20} />}
        {ok ? 'Objectif atteint dans le délai' : 'Hors objectif : action corrective obligatoire'}
      </p>
      <ul className="mt-2 space-y-1 text-[15px] text-fg">
        <li>
          Température : {targetReached ? 'objectif atteint' : 'objectif non atteint'} ({describeThreshold(rule.target)})
        </li>
        <li>
          Durée : {formatMinutes(durationMin * 60_000)} — {withinTime ? 'dans le délai' : 'délai dépassé'} ({formatMinutes(rule.maxMinutes * 60_000)} maximum)
        </li>
      </ul>
    </div>
  )
}

function StepCorrection(props: {
  batch: TimedBatch
  entry: Entry<CoolingPayload>
  rule: TimedRule
  data: ProcessData
  now: Date
  onSaved: (rec: HaccpRecord, replacement: CoolingPayload) => void
  onCancel: () => void
}) {
  const { batch, entry, rule, data, now } = props
  const author = useAuthorName(data.staff)
  const isEnd = entry.payload.step === 'end'
  const replacementFor = (value_c: number): CoolingPayload => {
    const p: CoolingPayload = { ...entry.payload, value_c }
    // Fin : conformité recalculée avec la durée enregistrée (l'heure de clôture ne change pas).
    if (isEnd) p.in_range = isInRange(value_c, rule.target) && (p.duration_min ?? 0) <= rule.maxMinutes
    return p
  }
  return (
    <TemperatureCorrection<CoolingPayload>
      type={batch.kind}
      latestId={entry.latest.id}
      value_c={entry.payload.value_c}
      threshold={entry.payload.step === 'start' ? (rule.start ?? undefined) : rule.target}
      replacementFor={replacementFor}
      summary={
        <>
          <p className="text-[17px] font-semibold text-fg">
            {batch.product} — {STEP_LABEL[entry.payload.step].toLowerCase()} du lot
          </p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {TIMED_LABELS[batch.kind].title}, mesure {whenLabel(entry.time, now, data.timeZone)} par {author(entry.authorId)}
            {isEnd ? ` · durée ${formatMinutes((entry.payload.duration_min ?? 0) * 60_000)}` : ''}
          </p>
        </>
      }
      onSaved={props.onSaved}
      onCancel={props.onCancel}
    />
  )
}

function TimedHistory(props: {
  kind: TimedKind
  batches: TimedBatch[]
  data: ProcessData
  now: Date
  onCorrect: (b: TimedBatch, e: Entry<CoolingPayload>) => void
  onCorrectiveAction: (b: TimedBatch) => void
}) {
  const { kind, data, now } = props
  const tz = data.timeZone
  const from = startOfLocalDay(now, tz, PROCESS_HISTORY_DAYS).getTime()
  const days = useMemo(() => {
    const groups = new Map<string, TimedBatch[]>()
    for (const b of props.batches.filter((x) => Date.parse(x.startedAt) >= from)) {
      const k = localDayKey(b.startedAt, tz)
      groups.set(k, [...(groups.get(k) ?? []), b])
    }
    return [...groups.values()]
  }, [props.batches, from, tz])

  return (
    <>
      <PageTitle title={`Historique — ${TIMED_LABELS[kind].title.toLowerCase()}`} subtitle={`Aujourd’hui et les ${PROCESS_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      {days.length === 0 ? (
        <EmptyCard>Aucun lot sur cette période.</EmptyCard>
      ) : (
        days.map((list) => (
          <section key={list[0].batchId} aria-label={dayLabel(list[0].startedAt, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(list[0].startedAt, now, tz)}</SectionLabel>
            <ul className="space-y-3">
              {list.map((b) => (
                <li key={b.batchId}>
                  <BatchHistoryCard batch={b} data={data} onCorrect={(e) => props.onCorrect(b, e)} onCorrectiveAction={() => props.onCorrectiveAction(b)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}

function BatchHistoryCard({ batch, data, onCorrect, onCorrectiveAction }: { batch: TimedBatch; data: ProcessData; onCorrect: (e: Entry<CoolingPayload>) => void; onCorrectiveAction: () => void }) {
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const rule = ruleForBatch(data.rules[batch.kind], batch.product, data.products)
  return (
    <article aria-label={`Lot ${batch.product} de ${formatTime(batch.startedAt, tz)}`} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
        <h3 className="min-w-0 basis-full text-[18px] font-semibold text-fg sm:flex-1 sm:basis-auto">
          {batch.product}
          <span className="block text-[15px] font-normal text-fg-muted tabular-nums sm:ml-2 sm:inline">
            {formatTime(batch.startedAt, tz)}
            {batch.endedAt ? ` → ${formatTime(batch.endedAt, tz)} · ${formatMinutes((batch.durationMin ?? 0) * 60_000)}` : ''}
          </span>
        </h3>
        {batch.running ? (
          <Badge tone="info">
            <IconTimer size={14} strokeWidth={2.25} />
            En cours
          </Badge>
        ) : (
          <ResultBadge ok={batch.inRange === true} okLabel="Conforme" koLabel="Hors objectif" />
        )}
        <SyncBadge records={batch.steps.flatMap(entryRecords)} />
      </header>
      <ul className="divide-y divide-line">
        {batch.steps.map((s) => {
          const lowStart = s.payload.step === 'start' && rule.start !== null && !isInRange(s.payload.value_c, rule.start)
          return (
            <li key={s.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 sm:px-5" aria-label={`${STEP_LABEL[s.payload.step]} à ${formatTime(s.time, tz)}`}>
              <div className="w-16 shrink-0 pt-0.5 text-[16px] font-semibold text-fg tabular-nums">{formatTime(s.time, tz)}</div>
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[14px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">{STEP_LABEL[s.payload.step]}</span>
                  {s.versions.slice(0, -1).map((v) => (
                    <s key={v.record.id} className="text-[17px] text-fg-subtle tabular-nums" aria-label={`Valeur d’origine ${formatTemperature(v.payload.value_c)}, corrigée`}>
                      {formatTemperature(v.payload.value_c)}
                    </s>
                  ))}
                  <span className="text-[21px] leading-tight font-semibold text-fg tabular-nums">{formatTemperature(s.payload.value_c)}</span>
                  {s.payload.step === 'end' && <ResultBadge ok={s.payload.in_range === true} koLabel="Hors objectif" />}
                  {lowStart && (
                    <Badge tone="warn">
                      <IconWarn size={14} strokeWidth={2.25} />
                      Départ sous {formatTemperature(rule.start!.min_c!)}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[15px] text-fg-muted">par {author(s.authorId)}</div>
                <EntryTrail entry={s} tz={tz} author={author} describe={(p) => formatTemperature((p as CoolingPayload).value_c)} />
                {s.payload.step === 'end' && batch.missingAction && <MissingAction onClick={onCorrectiveAction} />}
              </div>
              <Button
                variant="secondary"
                className="max-sm:ml-20"
                onClick={() => onCorrect(s)}
                icon={<IconEdit size={18} />}
                aria-label={`Corriger ${STEP_LABEL[s.payload.step].toLowerCase()} de ${formatTime(s.time, tz)} (${batch.product})`}
              >
                Corriger
              </Button>
            </li>
          )
        })}
      </ul>
    </article>
  )
}
