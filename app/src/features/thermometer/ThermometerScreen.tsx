// Module Thermomètres (lot 9) : une carte par thermomètre (dernière vérification, échéance), vérification
// à l'eau glacée / bouillante / par référence, action corrective obligatoire hors tolérance, historique.
import { useState } from 'react'
import type { CorrectiveActionPayload } from '../../../../shared/payloads.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { Badge, Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatLongDate } from '../../ui/format.ts'
import { IconDue, IconEdit, IconError, IconHistory, IconMore, IconOk, IconPlus, IconThermometerCheck, IconWarn, IconWrench } from '../../ui/icons.tsx'
import { formatTemperature } from '../../ui/temperature.ts'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { CorrectionTrail } from '../cleaning/parts.tsx'
import { BackButton, EmptyCard, EntryTrail, MissingAction, PageTitle, SectionLabel, SyncBadge, entryRecords, useAuthorName } from '../processes/common.tsx'
import { whenLabel } from '../temperatures/format.ts'
import { plural } from '../temperatures/schedule.ts'
import {
  METHOD_LABELS,
  deviation,
  diffThermometerCheck,
  dueLabel,
  formatDeviation,
  formatTolerance,
  thermometerKey,
  type ThermometerCheckEntry,
  type ThermometerStatus,
} from './model.ts'
import { ThermometerCheckForm } from './ThermometerForm.tsx'
import { useThermometerStatus, type ThermometerData } from './useThermometerData.ts'

type Back = { name: 'home' } | { name: 'history' }
type ActionTarget = { recordId: string; check: ThermometerCheckEntry['payload']; back: Back }
type View =
  | Back
  | { name: 'check'; thermometer?: string }
  | { name: 'correct'; entryId: string; back: Back }
  | ({ name: 'action' } & ActionTarget)
  | ({ name: 'action-other' } & ActionTarget)

export function ThermometerScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now, statuses } = useThermometerStatus(60_000)
  const [view, setView] = useState<View>({ name: 'home' })

  if (error && !data) return <Main><Notice>Lecture impossible : {error}</Notice></Main>
  if (!data) return <Main><p className="text-[17px] text-fg-muted">Chargement…</p></Main>
  const names = statuses.map((s) => s.name)

  if (view.name === 'action-other') {
    return (
      <CorrectiveActionFlow
        relatedRecordId={view.recordId}
        subject={`Thermomètre hors tolérance — ${view.check.thermometer}`}
        detail={<ActionDetail check={view.check} />}
        onDone={async () => {
          await reload()
          setView(view.back)
        }}
      />
    )
  }
  if (view.name === 'action') {
    return (
      <ThermometerCorrective
        target={view}
        onOther={() => setView({ ...view, name: 'action-other' })}
        onDone={async (recheck) => {
          await reload()
          setView(recheck ? { name: 'check', thermometer: view.check.thermometer } : view.back)
        }}
      />
    )
  }

  let body
  if (view.name === 'check' || view.name === 'correct') {
    const entry = view.name === 'correct' ? data.checks.find((c) => c.id === view.entryId) : undefined
    const back: Back = view.name === 'correct' ? view.back : { name: 'home' }
    body =
      view.name === 'correct' && !entry ? (
        <Notice>Vérification introuvable.</Notice>
      ) : (
        <>
          <BackButton label={back.name === 'history' ? 'Historique' : 'Thermomètres'} onClick={() => setView(back)} />
          <ThermometerCheckForm
            key={view.name === 'check' ? (view.thermometer ?? 'new') : view.entryId}
            rules={data.rules}
            timeZone={data.timeZone}
            names={names}
            initialName={view.name === 'check' ? view.thermometer : undefined}
            correcting={entry}
            onCancel={() => setView(back)}
            onSaved={async (rec, p) => {
              await reload()
              const hadAction = (entry?.correctiveActions.length ?? 0) > 0
              if (!p.in_range && !hadAction) setView({ name: 'action', recordId: rec.id, check: p, back })
              else setView(back)
            }}
          />
        </>
      )
  } else if (view.name === 'history') {
    body = (
      <>
        <BackButton label="Thermomètres" onClick={() => setView({ name: 'home' })} />
        <ThermometerHistory
          data={data}
          now={now}
          onCorrect={(e) => setView({ name: 'correct', entryId: e.id, back: { name: 'history' } })}
          onAction={(e) => setView({ name: 'action', recordId: e.latest.id, check: e.payload, back: { name: 'history' } })}
        />
      </>
    )
  } else {
    const missing = statuses.flatMap((s) => s.missingActions)
    body = (
      <>
        <BackButton label="Accueil" onClick={onBack} />
        <PageTitle
          title="Thermomètres"
          subtitle={`Vérification au moins tous les ${data.rules.days} jours · écart admis ${formatTolerance(data.rules.tolerance)}`}
          actions={
            <Button onClick={() => setView({ name: 'check' })} icon={<IconPlus size={20} />}>
              Vérifier un thermomètre
            </Button>
          }
        />
        {missing.length > 0 && (
          <section aria-labelledby="thermo-missing" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
            <h2 id="thermo-missing" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
              <IconError size={22} className="shrink-0" />
              {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {missing.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                  <span className="text-[16px] text-fg">
                    <span className="font-semibold">{e.payload.thermometer}</span> · {whenLabel(e.time, now, data.timeZone)} · écart {formatDeviation(deviation(e.payload.measured_c, e.payload.reference_c))}
                  </span>
                  <Button variant="danger" onClick={() => setView({ name: 'action', recordId: e.latest.id, check: e.payload, back: { name: 'home' } })}>
                    Faire l’action corrective
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {statuses.length === 0 ? (
          <EmptyCard>
            Aucun thermomètre vérifié pour l’instant. Touchez « Vérifier un thermomètre » : la sonde dans un verre d’eau avec beaucoup de glaçons doit indiquer 0 °C.
          </EmptyCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {statuses.map((s) => (
              <ThermometerPanel key={s.key} status={s} data={data} now={now} onCheck={() => setView({ name: 'check', thermometer: s.name })} />
            ))}
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="ghost" className="text-accent" onClick={() => setView({ name: 'history' })} icon={<IconHistory size={20} />}>
            Historique des vérifications
          </Button>
        </div>
        <p className="mt-4 max-w-3xl text-[14px] text-fg-subtle">
          Fréquence et écart admis réglables par le gérant (Gestion › Réglages). Un thermomètre hors tolérance ne doit plus servir aux contrôles tant qu’il n’a pas été réglé ou remplacé, puis revérifié.
        </p>
      </>
    )
  }
  return <Main>{body}</Main>
}

function Main({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{children}</main>
}

function ActionDetail({ check }: { check: ThermometerCheckEntry['payload'] }) {
  return (
    <span className="font-semibold text-danger">
      Lu {formatTemperature(check.measured_c)} pour {formatTemperature(check.reference_c)} attendu · écart {formatDeviation(deviation(check.measured_c, check.reference_c))}, admis {formatTolerance(check.tolerance_c)}
    </span>
  )
}

function ThermometerPanel({ status: s, data, now, onCheck }: { status: ThermometerStatus; data: ThermometerData; now: Date; onCheck: () => void }) {
  const tz = data.timeZone
  const p = s.last.payload
  const border = s.out || s.missingActions.length || s.due === 'overdue' ? 'border-danger/55' : s.due === 'soon' ? 'border-warn/55' : 'border-line'
  return (
    <section aria-label={s.name} className={`flex flex-col rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${border}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconThermometerCheck size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-snug font-semibold text-fg">{s.name}</h2>
          <p className="text-[15px] text-fg-muted">
            Vérifié {whenLabel(s.last.time, now, tz)} · {METHOD_LABELS[p.method].toLowerCase()}
          </p>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[16px]">
        {s.out ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <IconError size={18} /> Hors tolérance
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-ok">
            <IconOk size={18} /> Conforme
          </span>
        )}
        <span className="text-fg-muted">
          lu {formatTemperature(p.measured_c)} pour {formatTemperature(p.reference_c)} (écart {formatDeviation(deviation(p.measured_c, p.reference_c))})
        </span>
      </p>
      <p className={`mt-2 flex items-center gap-1.5 text-[15px] font-semibold ${s.due === 'overdue' ? 'text-danger' : s.due === 'soon' ? 'text-warn' : 'text-fg-muted'}`}>
        {s.due === 'overdue' ? <IconError size={17} /> : s.due === 'soon' ? <IconWarn size={17} /> : <IconDue size={17} />}
        Prochaine vérification {dueLabel(s)} ({formatLongDate(s.dueAt, tz).toLowerCase()})
      </p>
      <div className="mt-4">
        <Button onClick={onCheck} icon={<IconThermometerCheck size={20} />} aria-label={`Vérifier — ${s.name}`}>
          Vérifier
        </Button>
      </div>
    </section>
  )
}

/** Action corrective obligatoire après une vérification hors tolérance. */
function ThermometerCorrective({ target, onOther, onDone }: { target: ActionTarget; onOther: () => void; onDone: (recheck: boolean) => void }) {
  const core = useCore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = target.check.thermometer
  const record = async (payload: CorrectiveActionPayload, recheck: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const v = validatePayload('corrective_action', payload)
      if (!v.ok) throw new Error(`Saisie refusée : ${v.detail}`)
      await core.addRecord('corrective_action', { ...payload })
      toast('Action corrective enregistrée', 'ok')
      onDone(recheck)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  const choices = [
    {
      title: 'Thermomètre réglé',
      hint: 'Étalonné ou pile changée : une nouvelle vérification s’ouvre ensuite',
      icon: <IconWrench size={26} />,
      primary: true,
      run: () => record({ related_record_id: target.recordId, action: 'adjust_equipment', comment: `Thermomètre « ${name} » réglé, nouvelle vérification à faire` }, true),
    },
    {
      title: 'Thermomètre remplacé',
      hint: 'Ancien thermomètre retiré du service',
      icon: <IconThermometerCheck size={26} />,
      primary: false,
      run: () => record({ related_record_id: target.recordId, action: 'other', comment: `Thermomètre « ${name} » retiré du service et remplacé` }, false),
    },
    { title: 'Autre action corrective', hint: 'Technicien, retour au fabricant…', icon: <IconMore size={26} />, primary: false, run: onOther },
  ]
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:pt-7">
      <div className="flex items-start gap-4 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-danger">
          <IconError size={26} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[28px]">Action corrective obligatoire</h1>
          <p className="mt-1 text-[17px] font-semibold text-fg">Thermomètre hors tolérance — {name}</p>
          <p className="mt-0.5 text-[16px] text-fg-muted">
            <ActionDetail check={target.check} />. Ne plus l’utiliser pour les contrôles. Vérifiez aussi les dernières mesures faites avec ce thermomètre.
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {choices.map((ch) => (
          <button
            key={ch.title}
            type="button"
            onClick={ch.run}
            disabled={busy}
            className={`flex min-h-28 items-center gap-4 rounded-2xl border p-5 text-left shadow-card transition-[background-color,transform] active:scale-[0.99] disabled:opacity-50 sm:flex-col sm:items-start ${
              ch.primary ? 'border-accent bg-accent text-on-accent active:bg-accent-pressed' : 'border-line bg-surface text-fg active:bg-pressed'
            }`}
          >
            <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${ch.primary ? 'bg-on-accent/15' : 'bg-accent-soft text-accent'}`}>
              {ch.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[19px] leading-snug font-semibold">{busy && ch.primary ? 'Enregistrement…' : ch.title}</span>
              <span className={`mt-0.5 block text-[15px] ${ch.primary ? 'opacity-85' : 'text-fg-muted'}`}>{ch.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      <p className="mt-4 text-[14px] text-fg-subtle">Tant qu’aucune action n’est enregistrée, la vérification reste signalée « Action corrective manquante ».</p>
    </main>
  )
}

function ThermometerHistory(props: { data: ThermometerData; now: Date; onCorrect: (e: ThermometerCheckEntry) => void; onAction: (e: ThermometerCheckEntry) => void }) {
  const { data, now } = props
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const [filter, setFilter] = useState<string | null>(null)
  const keys = [...new Map(data.checks.map((c) => [thermometerKey(c.payload.thermometer), c.payload.thermometer.trim()])).entries()]
  const list = filter ? data.checks.filter((c) => thermometerKey(c.payload.thermometer) === filter) : data.checks
  return (
    <>
      <PageTitle title="Historique des vérifications" subtitle="Une erreur se corrige, elle ne s’efface pas." />
      {keys.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filtrer par thermomètre">
          <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={`min-h-12 rounded-full border px-4 text-[15px] font-semibold ${filter === null ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-elevated text-fg'}`}>
            Tous
          </button>
          {keys.map(([k, n]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`min-h-12 rounded-full border px-4 text-[15px] font-semibold ${filter === k ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-elevated text-fg'}`}>
              {n}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <EmptyCard>Aucune vérification enregistrée.</EmptyCard>
      ) : (
        <section aria-label="Vérifications">
          <SectionLabel>{plural(list.length, 'vérification', 'vérifications')}</SectionLabel>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {list.map((e) => {
              const p = e.payload
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Vérification de ${p.thermometer}, ${whenLabel(e.time, now, tz)}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[18px] font-semibold text-fg">{p.thermometer}</span>
                      {p.in_range ? <Badge tone="ok">Conforme</Badge> : <Badge tone="error">Hors tolérance</Badge>}
                      {e.corrected && (
                        <Badge tone="neutral">
                          <IconEdit size={14} /> Corrigé
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[15px] text-fg-muted">
                      {whenLabel(e.time, now, tz)} · {METHOD_LABELS[p.method]} · lu {formatTemperature(p.measured_c)} pour {formatTemperature(p.reference_c)} (écart{' '}
                      {formatDeviation(deviation(p.measured_c, p.reference_c))}, admis {formatTolerance(p.tolerance_c)}) · par {author(e.authorId)}
                    </p>
                    {p.comment && <p className="mt-1 text-[15px] text-fg">{p.comment}</p>}
                    {e.versions.slice(1).map((v, k) => (
                      <CorrectionTrail key={v.record.id} when={whenLabel(v.record.device_time, now, tz)} author={author(v.record.author_id)} reason={v.reason} changes={diffThermometerCheck(e.versions[k].payload, v.payload)} />
                    ))}
                    <EntryTrail entry={{ ...e, versions: e.versions.slice(0, 1) }} tz={tz} author={author} describe={() => ''} />
                    {e.missingAction && <MissingAction onClick={() => props.onAction(e)} />}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <SyncBadge records={entryRecords(e)} />
                    <Button variant="secondary" onClick={() => props.onCorrect(e)} icon={<IconEdit size={18} />} aria-label={`Corriger la vérification de ${p.thermometer} (${whenLabel(e.time, now, tz)})`}>
                      Corriger
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
