// Module Huiles de friture (lot 5) : un panneau par bac (dernier contrôle, dernier changement, jauge,
// évolution depuis le changement), contrôle des composés polaires, changement d'huile, action corrective
// obligatoire au-delà de la limite (« Changer l'huile » enregistre aussi un `oil_change`), historique 30 jours.
import { useState } from 'react'
import type { Equipment, HaccpRecord } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { Badge, Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatTime } from '../../ui/format.ts'
import { IconEdit, IconError, IconFryer, IconGauge, IconHistory, IconMore, IconOilChange } from '../../ui/icons.tsx'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { BackButton, EmptyCard, EntryTrail, MissingAction, PageTitle, SectionLabel, SyncBadge, entryRecords, useAuthorName } from '../processes/common.tsx'
import { CorrectionTrail } from '../cleaning/parts.tsx'
import { dayLabel, whenLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { diffOilChange, diffOilCheck, formatPercent, METHOD_LABELS, OIL_HISTORY_DAYS, oilLevel, type OilCheckEntry, type VatStatus } from './model.ts'
import { OilChangeForm, OilCheckForm } from './OilForms.tsx'
import { LevelLabel, OilGauge, OilTrend } from './OilGauge.tsx'
import { useOilStatus } from './useOilData.ts'
import type { OilData } from './useOilData.ts'

type Back = { name: 'home' } | { name: 'history'; vatId: string }
type View =
  | Back
  | { name: 'check'; vatId: string }
  | { name: 'change'; vatId: string }
  | { name: 'correct-check'; entryId: string; back: Back }
  | { name: 'correct-change'; entryId: string; back: Back }
  | { name: 'action'; vatId: string; recordId: string; value: number; back: Back }
  | { name: 'action-other'; vatId: string; recordId: string; value: number; back: Back }

export function OilScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now, statuses } = useOilStatus(60_000)
  const [view, setView] = useState<View>({ name: 'home' })

  if (error && !data) return <Main><Notice>Lecture impossible : {error}</Notice></Main>
  if (!data) return <Main><p className="text-[17px] text-fg-muted">Chargement…</p></Main>
  const vatOf = (id: string) => data.vats.find((v) => v.id === id)
  const afterCheck = async (rec: HaccpRecord, inRange: boolean, value: number, vatId: string, back: Back, hadAction: boolean) => {
    await reload()
    if (!inRange && !hadAction) setView({ name: 'action', vatId, recordId: rec.id, value, back })
    else setView(back)
  }

  if (view.name === 'action-other') {
    const vat = vatOf(view.vatId)
    return (
      <CorrectiveActionFlow
        relatedRecordId={view.recordId}
        subject={`Huile hors limite — ${vat?.name ?? 'bac'}`}
        detail={<span className="font-semibold text-danger">{formatPercent(view.value)} de composés polaires · limite {formatPercent(data.limits.max)}</span>}
        onDone={async () => {
          await reload()
          setView(view.back)
        }}
      />
    )
  }
  if (view.name === 'action') {
    const vat = vatOf(view.vatId)
    return vat ? (
      <OilCorrective
        vat={vat}
        recordId={view.recordId}
        value={view.value}
        data={data}
        onOther={() => setView({ ...view, name: 'action-other' })}
        onDone={async () => {
          await reload()
          setView(view.back)
        }}
      />
    ) : null
  }

  let body
  if (view.name === 'check' || view.name === 'correct-check') {
    const entry = view.name === 'correct-check' ? data.checks.find((c) => c.id === view.entryId) : undefined
    const vat = vatOf(view.name === 'check' ? view.vatId : (entry?.payload.equipment_id ?? ''))
    const back: Back = view.name === 'correct-check' ? view.back : { name: 'home' }
    body = !vat ? (
      <Notice>Bac de friteuse introuvable ou retiré du service.</Notice>
    ) : (
      <>
        <BackButton label={back.name === 'history' ? 'Historique' : 'Huiles de friture'} onClick={() => setView(back)} />
        <OilCheckForm
          vat={vat}
          limits={data.limits}
          timeZone={data.timeZone}
          correcting={entry}
          onCancel={() => setView(back)}
          onSaved={(rec, p) => void afterCheck(rec, p.in_range, p.polar_percent, vat.id, back, (entry?.correctiveActions.length ?? 0) > 0)}
        />
      </>
    )
  } else if (view.name === 'change' || view.name === 'correct-change') {
    const entry = view.name === 'correct-change' ? data.changes.find((c) => c.id === view.entryId) : undefined
    const vat = vatOf(view.name === 'change' ? view.vatId : (entry?.payload.equipment_id ?? ''))
    const back: Back = view.name === 'correct-change' ? view.back : { name: 'home' }
    body = !vat ? (
      <Notice>Bac de friteuse introuvable ou retiré du service.</Notice>
    ) : (
      <>
        <BackButton label={back.name === 'history' ? 'Historique' : 'Huiles de friture'} onClick={() => setView(back)} />
        <OilChangeForm
          vat={vat}
          timeZone={data.timeZone}
          correcting={entry}
          onCancel={() => setView(back)}
          onSaved={async () => {
            await reload()
            setView(back)
          }}
        />
      </>
    )
  } else if (view.name === 'history') {
    const st = statuses.find((s) => s.vat.id === view.vatId)
    const back: Back = view
    body = (
      <>
        <BackButton label="Huiles de friture" onClick={() => setView({ name: 'home' })} />
        {st ? (
          <OilHistory
            status={st}
            data={data}
            now={now}
            onCorrectCheck={(e) => setView({ name: 'correct-check', entryId: e.id, back })}
            onCorrectChange={(id) => setView({ name: 'correct-change', entryId: id, back })}
            onAction={(e) => setView({ name: 'action', vatId: st.vat.id, recordId: e.latest.id, value: e.payload.polar_percent, back })}
          />
        ) : (
          <Notice>Bac de friteuse introuvable.</Notice>
        )}
      </>
    )
  } else {
    const missing = statuses.flatMap((s) => s.missingActions.map((e) => ({ s, e })))
    body = (
      <>
        <BackButton label="Accueil" onClick={onBack} />
        <PageTitle
          title="Huiles de friture"
          subtitle={`Composés polaires : alerte à ${formatPercent(data.limits.warn)}, limite ${formatPercent(data.limits.max)} (décret n° 2008-184)`}
        />
        {missing.length > 0 && (
          <section aria-labelledby="oil-missing" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
            <h2 id="oil-missing" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
              <IconError size={22} className="shrink-0" />
              {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {missing.map(({ s, e }) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                  <span className="text-[16px] text-fg">
                    <span className="font-semibold">{s.vat.name}</span> · {whenLabel(e.time, now, data.timeZone)} · {formatPercent(e.payload.polar_percent)}
                  </span>
                  <Button variant="danger" onClick={() => setView({ name: 'action', vatId: s.vat.id, recordId: e.latest.id, value: e.payload.polar_percent, back: { name: 'home' } })}>
                    Faire l’action corrective
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {statuses.length === 0 ? (
          <EmptyCard>Aucun bac de friteuse en service. Le gérant peut en ajouter dans Gestion › Équipements (type « Bac de friteuse »).</EmptyCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {statuses.map((s) => (
              <VatPanel
                key={s.vat.id}
                status={s}
                data={data}
                now={now}
                onCheck={() => setView({ name: 'check', vatId: s.vat.id })}
                onChange={() => setView({ name: 'change', vatId: s.vat.id })}
                onHistory={() => setView({ name: 'history', vatId: s.vat.id })}
              />
            ))}
          </div>
        )}
        <p className="mt-6 max-w-3xl text-[14px] text-fg-subtle">
          Seuils réglables par le gérant (Gestion › Réglages). La limite de 25 % est la limite réglementaire : un réglage plus strict reste possible selon votre PMS.
        </p>
      </>
    )
  }
  return <Main>{body}</Main>
}

function Main({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{children}</main>
}

function VatPanel({ status: s, data, now, onCheck, onChange, onHistory }: { status: VatStatus; data: OilData; now: Date; onCheck: () => void; onChange: () => void; onHistory: () => void }) {
  const tz = data.timeZone
  const current = s.level !== null ? s.lastCheck : null
  const border = s.missingActions.length || s.level === 'out' ? 'border-danger/55' : s.level === 'warn' ? 'border-warn/55' : 'border-line'
  return (
    <section aria-label={s.vat.name} className={`flex flex-col rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${border}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconFryer size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-snug font-semibold text-fg">{s.vat.name}</h2>
          <p className="text-[15px] text-fg-muted">
            {s.lastChange ? `Huile changée ${whenLabel(s.lastChange.time, now, tz)}` : 'Aucun changement d’huile enregistré (30 jours)'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[34px] leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums">{current ? formatPercent(current.payload.polar_percent) : '––'}</p>
          {s.level && <LevelLabel level={s.level} className="mt-1 text-[15px]" />}
        </div>
      </div>
      <div className="mt-4">
        <OilGauge value={current?.payload.polar_percent ?? null} limits={data.limits} label={`Composés polaires — ${s.vat.name}`} />
      </div>
      <p className="mt-2 text-[15px] text-fg-muted">
        {current
          ? `Dernier contrôle ${whenLabel(current.time, now, tz)} · ${METHOD_LABELS[current.payload.method].toLowerCase()}`
          : s.lastChange
            ? 'Aucun contrôle depuis le changement d’huile'
            : 'Aucun contrôle enregistré'}
        {!s.checkedToday && current ? ' · pas encore contrôlé aujourd’hui' : ''}
      </p>
      <div className="mt-3 rounded-xl bg-sunken px-3 pt-2 pb-1">
        <p className="mb-1 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Depuis le changement</p>
        <OilTrend points={s.sinceChange.map((c) => ({ time: c.time, value: c.payload.polar_percent }))} limits={data.limits} timeZone={tz} label={`Évolution — ${s.vat.name}`} height={84} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button onClick={onCheck} icon={<IconGauge size={20} />} aria-label={`Contrôle — ${s.vat.name}`}>
          Contrôle
        </Button>
        <Button variant="secondary" onClick={onChange} icon={<IconOilChange size={20} />} aria-label={`Changement d’huile — ${s.vat.name}`}>
          Changer l’huile
        </Button>
      </div>
      <Button variant="ghost" className="mt-2 text-accent" onClick={onHistory} icon={<IconHistory size={20} />} aria-label={`Historique — ${s.vat.name}`}>
        Historique
      </Button>
    </section>
  )
}

/** Action corrective obligatoire après un contrôle hors limite : « Changer l'huile » ou une autre action. */
function OilCorrective({ vat, recordId, value, data, onOther, onDone }: { vat: Equipment; recordId: string; value: number; data: OilData; onOther: () => void; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const core = useCore()
  const change = async () => {
    setBusy(true)
    setError(null)
    try {
      const change = { equipment_id: vat.id, comment: `Changement après contrôle hors limite (${formatPercent(value)})` }
      const action = { related_record_id: recordId, action: 'discard', comment: `Huile changée (${vat.name}) : ${formatPercent(value)} > ${formatPercent(data.limits.max)}` }
      for (const [type, p] of [['oil_change', change], ['corrective_action', action]] as const) {
        const v = validatePayload(type, p)
        if (!v.ok) throw new Error(`Saisie refusée : ${v.detail}`)
      }
      await core.addRecord('oil_change', change)
      await core.addRecord('corrective_action', action)
      toast('Changement d’huile et action corrective enregistrés', 'ok')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:pt-7">
      <div className="flex items-start gap-4 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-danger">
          <IconError size={26} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[28px]">Action corrective obligatoire</h1>
          <p className="mt-1 text-[17px] font-semibold text-fg">Huile hors limite — {vat.name}</p>
          <p className="mt-0.5 text-[16px] text-fg-muted">
            <span className="font-semibold text-danger">{formatPercent(value)}</span> de composés polaires · limite {formatPercent(data.limits.max)}. L’huile ne doit plus être utilisée.
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={change}
          disabled={busy}
          className="flex min-h-28 items-center gap-4 rounded-2xl border border-accent bg-accent p-5 text-left text-on-accent shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-accent-pressed disabled:opacity-50"
        >
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-on-accent/15">
            <IconOilChange size={26} />
          </span>
          <span className="min-w-0">
            <span className="block text-[20px] leading-snug font-semibold">{busy ? 'Enregistrement…' : 'Changer l’huile'}</span>
            <span className="mt-0.5 block text-[15px] opacity-85">Enregistre le changement d’huile et l’action corrective</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onOther}
          disabled={busy}
          className="flex min-h-28 items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left text-fg shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-pressed"
        >
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconMore size={26} />
          </span>
          <span className="min-w-0">
            <span className="block text-[20px] leading-snug font-semibold">Autre action corrective</span>
            <span className="mt-0.5 block text-[15px] text-fg-muted">Bac mis hors service, technicien appelé…</span>
          </span>
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      <p className="mt-4 text-[14px] text-fg-subtle">Tant qu’aucune action n’est enregistrée, le contrôle reste signalé « Action corrective manquante ».</p>
    </main>
  )
}


function OilHistory(props: {
  status: VatStatus
  data: OilData
  now: Date
  onCorrectCheck: (e: OilCheckEntry) => void
  onCorrectChange: (entryId: string) => void
  onAction: (e: OilCheckEntry) => void
}) {
  const { status: s, data, now } = props
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const from = startOfLocalDay(now, tz, OIL_HISTORY_DAYS).getTime()
  type Item = { kind: 'check'; e: OilCheckEntry; time: string } | { kind: 'change'; e: (typeof data.changes)[number]; time: string }
  const items: Item[] = [
    ...data.checks.filter((c) => c.payload.equipment_id === s.vat.id).map((e) => ({ kind: 'check' as const, e, time: e.time })),
    ...data.changes.filter((c) => c.payload.equipment_id === s.vat.id).map((e) => ({ kind: 'change' as const, e, time: e.time })),
  ]
    .filter((i) => Date.parse(i.time) >= from)
    .sort((a, b) => b.time.localeCompare(a.time))
  const groups = new Map<string, Item[]>()
  for (const i of items) groups.set(localDayKey(i.time, tz), [...(groups.get(localDayKey(i.time, tz)) ?? []), i])

  return (
    <>
      <PageTitle title={`Historique — ${s.vat.name}`} subtitle={`Les ${OIL_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      <section aria-label="Évolution depuis le dernier changement" className="mb-7 max-w-2xl rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <SectionLabel>Évolution depuis le dernier changement</SectionLabel>
        <OilTrend points={s.sinceChange.map((c) => ({ time: c.time, value: c.payload.polar_percent }))} limits={data.limits} timeZone={tz} label={`Évolution — ${s.vat.name}`} height={120} />
      </section>
      {items.length === 0 ? (
        <EmptyCard>Aucun contrôle ni changement d’huile sur cette période.</EmptyCard>
      ) : (
        [...groups.entries()].map(([key, list]) => (
          <section key={key} aria-label={dayLabel(list[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(list[0].time, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {list.map((i) =>
                i.kind === 'check' ? (
                  <li key={i.e.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Contrôle de ${formatTime(i.time, tz)}, ${formatPercent(i.e.payload.polar_percent)}`}>
                    <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold text-fg tabular-nums">{formatTime(i.time, tz)}</div>
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="flex flex-wrap items-center gap-2">
                        <IconGauge size={18} className="text-fg-subtle" />
                        <span className="text-[18px] font-semibold text-fg tabular-nums">{formatPercent(i.e.payload.polar_percent)}</span>
                        <LevelLabel level={oilLevel(i.e.payload.polar_percent, data.limits)} className="text-[15px]" />
                        {i.e.corrected && (
                          <Badge tone="neutral">
                            <IconEdit size={14} /> Corrigé
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[15px] text-fg-muted">
                        {METHOD_LABELS[i.e.payload.method]} · par {author(i.e.authorId)}
                      </p>
                      {i.e.versions.slice(1).map((v, k) => (
                        <CorrectionTrail key={v.record.id} when={formatTime(v.record.device_time, tz)} author={author(v.record.author_id)} reason={v.reason} changes={diffOilCheck(i.e.versions[k].payload, v.payload)} />
                      ))}
                      <EntryTrail entry={{ ...i.e, versions: i.e.versions.slice(0, 1) }} tz={tz} author={author} describe={() => ''} />
                      {i.e.missingAction && <MissingAction onClick={() => props.onAction(i.e)} />}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                      <SyncBadge records={entryRecords(i.e)} />
                      <Button variant="secondary" onClick={() => props.onCorrectCheck(i.e)} icon={<IconEdit size={18} />} aria-label={`Corriger le contrôle de ${formatTime(i.time, tz)}`}>
                        Corriger
                      </Button>
                    </div>
                  </li>
                ) : (
                  <li key={i.e.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 bg-accent-soft/40 px-4 py-4 sm:px-5" aria-label={`Changement d’huile de ${formatTime(i.time, tz)}`}>
                    <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold text-fg tabular-nums">{formatTime(i.time, tz)}</div>
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex items-center gap-2 text-[18px] font-semibold text-fg">
                        <IconOilChange size={18} className="text-accent" />
                        Huile changée
                      </p>
                      <p className="mt-0.5 text-[15px] text-fg-muted">par {author(i.e.authorId)}</p>
                      {i.e.payload.comment && <p className="mt-1 text-[15px] text-fg">{i.e.payload.comment}</p>}
                      {i.e.versions.slice(1).map((v, k) => (
                        <CorrectionTrail key={v.record.id} when={formatTime(v.record.device_time, tz)} author={author(v.record.author_id)} reason={v.reason} changes={diffOilChange(i.e.versions[k].payload, v.payload)} />
                      ))}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                      <SyncBadge records={entryRecords(i.e)} />
                      <Button variant="secondary" onClick={() => props.onCorrectChange(i.e.id)} icon={<IconEdit size={18} />} aria-label={`Corriger le changement d’huile de ${formatTime(i.time, tz)}`}>
                        Corriger
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))
      )}
      <p className="text-[14px] text-fg-subtle">
        Les valeurs sont jugées avec les seuils actuels (alerte {formatPercent(data.limits.warn)}, limite {formatPercent(data.limits.max)}).
      </p>
    </>
  )
}
