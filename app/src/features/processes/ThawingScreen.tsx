// Décongélation en enceinte froide : démarrage (produit + enceinte), lots en cours, fin avec DLC.
import { useMemo, useState } from 'react'
import type { ThawingPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { Badge, Button, Notice, TextField } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconCalendar, IconEdit, IconFinish, IconFridge, IconHistory, IconStart, IconThawing, IconTimer } from '../../ui/icons.tsx'
import { dayLabel, whenLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import {
  BackButton,
  chipClass,
  EmptyCard,
  EntryLayout,
  EntryTrail,
  ErrorNotice,
  PageTitle,
  ProductField,
  SectionLabel,
  StickyActions,
  SyncBadge,
  entryRecords,
  useAuthorName,
  useRecordSaver,
  useToast,
} from './common.tsx'
import { DlcCorrection } from './CorrectionForms.tsx'
import { recentProducts, type ThawBatch } from './entries.ts'
import { defaultDlc, formatIsoDate, formatMinutes } from './timing.ts'
import { PROCESS_HISTORY_DAYS, useProcessStatus, type ProcessData } from './useProcessData.ts'

const DEFAULT_PRODUCTS = ['Steaks hachés', 'Pain burger', 'Frites']

type Back = { name: 'list' } | { name: 'history' }
type View = Back | { name: 'start' } | { name: 'end'; batchId: string } | { name: 'correct'; batchId: string; back: Back }

export function ThawingScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now } = useProcessStatus(30_000)
  const [view, setView] = useState<View>({ name: 'list' })

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else {
    const batch = 'batchId' in view ? data.thawing.find((b) => b.batchId === view.batchId) : undefined
    const backToList = async () => {
      await reload()
      setView({ name: 'list' })
    }
    if (view.name === 'start') {
      body = (
        <>
          <BackButton label="Décongélation" onClick={() => setView({ name: 'list' })} />
          <StartThaw data={data} onStarted={backToList} />
        </>
      )
    } else if (view.name === 'end') {
      body = (
        <>
          <BackButton label="Décongélation" onClick={() => setView({ name: 'list' })} />
          {batch?.running ? <EndThaw batch={batch} data={data} now={now} onDone={backToList} /> : <Notice tone="info">Cette décongélation est déjà terminée.</Notice>}
        </>
      )
    } else if (view.name === 'correct') {
      const end = batch?.end
      body = (
        <>
          <BackButton label="Historique" onClick={() => setView(view.back)} />
          {batch && end && end.payload.dlc ? (
            <DlcCorrectionView
              batch={batch}
              data={data}
              now={now}
              onCancel={() => setView(view.back)}
              onSaved={async () => {
                await reload()
                setView(view.back)
              }}
            />
          ) : (
            <Notice>Décongélation introuvable.</Notice>
          )}
        </>
      )
    } else if (view.name === 'history') {
      body = (
        <>
          <BackButton label="Décongélation" onClick={() => setView({ name: 'list' })} />
          <ThawHistory data={data} now={now} onCorrect={(b) => setView({ name: 'correct', batchId: b.batchId, back: { name: 'history' } })} />
        </>
      )
    } else {
      body = (
        <>
          <BackButton label="Accueil" onClick={onBack} />
          <ThawList data={data} now={now} onStart={() => setView({ name: 'start' })} onHistory={() => setView({ name: 'history' })} onEnd={(b) => setView({ name: 'end', batchId: b.batchId })} />
        </>
      )
    }
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}

function equipmentName(data: ProcessData, id: string) {
  return data.equipment.find((e) => e.id === id)?.name ?? 'Enceinte retirée'
}

function ThawList({ data, now, onStart, onHistory, onEnd }: { data: ProcessData; now: Date; onStart: () => void; onHistory: () => void; onEnd: (b: ThawBatch) => void }) {
  const tz = data.timeZone
  const running = data.thawing.filter((b) => b.running).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const todayStart = startOfLocalDay(now, tz).getTime()
  const doneToday = data.thawing.filter((b) => !b.running && Date.parse(b.endedAt!) >= todayStart)
  return (
    <>
      <PageTitle
        title="Décongélation"
        subtitle={`En enceinte froide · DLC proposée : fin + ${plural(data.thawDlcDays, 'jour', 'jours')} (réglage Gestion, à confirmer selon votre PMS)`}
        actions={
          <>
            <Button variant="secondary" onClick={onHistory} icon={<IconHistory size={20} />}>
              Historique
            </Button>
            <Button onClick={onStart} icon={<IconStart size={20} />}>
              Démarrer
            </Button>
          </>
        }
      />
      <SectionLabel>{running.length ? plural(running.length, 'décongélation en cours', 'décongélations en cours') : 'En cours'}</SectionLabel>
      {running.length === 0 ? (
        <EmptyCard>Aucune décongélation en cours.</EmptyCard>
      ) : (
        <ul className="grid gap-3 sm:gap-4 md:grid-cols-2" aria-label="Décongélations en cours">
          {running.map((b) => (
            <li key={b.batchId}>
              <article aria-label={`${b.product}, ${equipmentName(data, b.equipmentId)}`} className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <IconThawing size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[19px] leading-snug font-semibold text-fg">{b.product}</h3>
                    <p className="flex items-center gap-1.5 text-[15px] text-fg-muted">
                      <IconFridge size={16} className="shrink-0" />
                      {equipmentName(data, b.equipmentId)}
                    </p>
                  </div>
                  <Badge tone="info">
                    <IconTimer size={14} strokeWidth={2.25} />
                    {formatMinutes(now.getTime() - Date.parse(b.startedAt))}
                  </Badge>
                </div>
                <p className="text-[15px] text-fg-muted">Démarrée {whenLabel(b.startedAt, now, tz)}</p>
                <Button className="mt-auto" block onClick={() => onEnd(b)} icon={<IconFinish size={20} />} aria-label={`Terminer — ${b.product}`}>
                  Terminer
                </Button>
              </article>
            </li>
          ))}
        </ul>
      )}
      {doneToday.length > 0 && (
        <section className="mt-8" aria-labelledby="thaw-done-title">
          <SectionLabel id="thaw-done-title">Terminées aujourd’hui</SectionLabel>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {doneToday.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5">
                <span className="min-w-0 flex-1 text-[16px] text-fg">
                  <span className="font-semibold">{b.product}</span>
                  <span className="text-fg-muted"> · {equipmentName(data, b.equipmentId)} · terminée à {formatTime(b.endedAt!, tz)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[16px] font-semibold text-fg">
                  <IconCalendar size={18} className="text-fg-subtle" />
                  DLC {b.dlc ? formatIsoDate(b.dlc) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function StartThaw({ data, onStarted }: { data: ProcessData; onStarted: () => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const fridges = data.equipment.filter((e) => e.active && e.kind === 'fridge')
  const [product, setProduct] = useState('')
  const [equipmentId, setEquipmentId] = useState<string | null>(fridges.length === 1 ? fridges[0].id : null)
  const suggestions = useMemo(() => recentProducts(data.thawing.map((b) => ({ product: b.product, time: b.startedAt })), DEFAULT_PRODUCTS), [data.thawing])

  const submit = async () => {
    if (!equipmentId || !product.trim()) return
    const payload: ThawingPayload = { batch_id: crypto.randomUUID(), step: 'start', product: product.trim(), equipment_id: equipmentId }
    const rec = await save('thawing', { ...payload })
    if (!rec) return
    toast(`Décongélation démarrée : ${payload.product}`, 'ok')
    onStarted()
  }

  return (
    <EntryLayout
      left={
        <>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Démarrer une décongélation</h1>
          <p className="mt-1 text-[16px] text-fg-muted">Toujours en enceinte froide, jamais à température ambiante.</p>
          <div className="mt-6">
            <ProductField value={product} onChange={setProduct} suggestions={suggestions} />
          </div>
        </>
      }
      right={
        <>
          <div role="radiogroup" aria-label="Enceinte froide">
            <p className="mb-2 text-[15px] font-semibold text-fg">Enceinte froide</p>
            {fridges.length === 0 ? (
              <Notice tone="warn">Aucun frigo en service. Le gérant peut en ajouter dans Gestion › Équipements.</Notice>
            ) : (
              <div className="grid gap-3">
                {fridges.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={equipmentId === e.id}
                    onClick={() => setEquipmentId(e.id)}
                    className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 bg-surface px-4 text-left text-[17px] font-semibold text-fg shadow-card active:bg-pressed ${equipmentId === e.id ? 'border-accent' : 'border-line'}`}
                  >
                    <span aria-hidden="true" className={`flex h-10 w-10 items-center justify-center rounded-xl ${equipmentId === e.id ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'}`}>
                      <IconFridge size={20} />
                    </span>
                    {e.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!equipmentId || !product.trim() || busy} icon={<IconStart size={22} />}>
              {busy ? 'Enregistrement…' : 'Démarrer la décongélation'}
            </Button>
          </StickyActions>
        </>
      }
    />
  )
}

function EndThaw({ batch, data, now, onDone }: { batch: ThawBatch; data: ProcessData; now: Date; onDone: () => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const tz = data.timeZone
  const [dlc, setDlc] = useState(() => defaultDlc(new Date(), tz, data.thawDlcDays))
  const today = defaultDlc(now, tz, 0)
  const quick = [...new Set([1, 2, 3, data.thawDlcDays])].sort((a, b) => a - b).map((d) => ({ d, iso: defaultDlc(now, tz, d) }))
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(dlc) && dlc >= today

  const submit = async () => {
    if (!valid) return
    const payload: ThawingPayload = { batch_id: batch.batchId, step: 'end', product: batch.product, equipment_id: batch.equipmentId, dlc }
    const rec = await save('thawing', { ...payload })
    if (!rec) return
    toast(`Décongélation terminée : ${batch.product}, DLC ${formatIsoDate(dlc)}`, 'ok')
    onDone()
  }

  return (
    <EntryLayout
      left={
        <>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Terminer la décongélation</h1>
          <p className="mt-1 text-[17px] font-semibold text-fg">{batch.product}</p>
          <p className="text-[15px] text-fg-muted">
            {equipmentName(data, batch.equipmentId)} · démarrée {whenLabel(batch.startedAt, now, tz)} · {formatMinutes(now.getTime() - Date.parse(batch.startedAt))}
          </p>
          <div className="mt-5 max-w-md">
            <Notice tone="info">
              DLC proposée : fin + {plural(data.thawDlcDays, 'jour', 'jours')}, <span className="font-semibold">à confirmer selon votre PMS</span>. Reportez-la sur l’étiquette du produit.
            </Notice>
          </div>
        </>
      }
      right={
        <>
          <TextField label="DLC après décongélation" type="date" value={dlc} min={today} onChange={setDlc} error={dlc && !valid ? 'La DLC ne peut pas être antérieure à aujourd’hui.' : undefined} />
          <div role="group" aria-label="DLC rapide" className="mt-3 flex flex-wrap gap-2">
            {quick.map(({ d, iso }) => (
              <button key={d} type="button" className={chipClass(dlc === iso)} aria-pressed={dlc === iso} onClick={() => setDlc(iso)}>
                J+{d}
              </button>
            ))}
          </div>
          {valid && <p className="mt-3 text-[17px] font-semibold text-fg">DLC : {formatIsoDate(dlc)}</p>}
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!valid || busy} icon={<IconFinish size={22} />}>
              {busy ? 'Enregistrement…' : 'Terminer et enregistrer la DLC'}
            </Button>
          </StickyActions>
        </>
      }
    />
  )
}

function DlcCorrectionView({ batch, data, now, onSaved, onCancel }: { batch: ThawBatch; data: ProcessData; now: Date; onSaved: (rec: HaccpRecord) => void; onCancel: () => void }) {
  const end = batch.end!
  const author = useAuthorName(data.staff)
  return (
    <DlcCorrection<ThawingPayload>
      type="thawing"
      latestId={end.latest.id}
      dlc={end.payload.dlc!}
      min={defaultDlc(new Date(end.time), data.timeZone, 0)}
      replacementFor={(dlc) => ({ ...end.payload, dlc })}
      summary={
        <>
          <p className="text-[17px] font-semibold text-fg">{batch.product} — fin de décongélation</p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {equipmentName(data, batch.equipmentId)} · terminée {whenLabel(end.time, now, data.timeZone)} par {author(end.authorId)}
          </p>
        </>
      }
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

function ThawHistory({ data, now, onCorrect }: { data: ProcessData; now: Date; onCorrect: (b: ThawBatch) => void }) {
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const from = startOfLocalDay(now, tz, PROCESS_HISTORY_DAYS).getTime()
  const days = useMemo(() => {
    const groups = new Map<string, ThawBatch[]>()
    for (const b of data.thawing.filter((x) => Date.parse(x.startedAt) >= from)) {
      const k = localDayKey(b.startedAt, tz)
      groups.set(k, [...(groups.get(k) ?? []), b])
    }
    return [...groups.entries()]
  }, [data.thawing, from, tz])

  return (
    <>
      <PageTitle title="Historique — décongélation" subtitle={`Aujourd’hui et les ${PROCESS_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      {days.length === 0 ? (
        <EmptyCard>Aucune décongélation sur cette période.</EmptyCard>
      ) : (
        days.map(([key, list]) => (
          <section key={key} aria-label={dayLabel(list[0].startedAt, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(list[0].startedAt, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {list.map((b) => (
                <li key={b.batchId} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Décongélation ${b.product} de ${formatTime(b.startedAt, tz)}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[18px] font-semibold text-fg">{b.product}</span>
                      {b.running && (
                        <Badge tone="info">
                          <IconTimer size={14} strokeWidth={2.25} />
                          En cours
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[15px] text-fg-muted tabular-nums">
                      {equipmentName(data, b.equipmentId)} · début {formatTime(b.startedAt, tz)} par {author(b.start.authorId)}
                      {b.end ? ` · fin ${whenLabel(b.end.time, now, tz)} par ${author(b.end.authorId)}` : ''}
                    </p>
                    {b.end && (
                      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[17px] text-fg">
                        <span className="font-semibold">DLC</span>
                        {b.end.versions.slice(0, -1).map((v) => (
                          <s key={v.record.id} className="text-fg-subtle" aria-label={`DLC d’origine ${v.payload.dlc ? formatIsoDate(v.payload.dlc) : ''}, corrigée`}>
                            {v.payload.dlc ? formatIsoDate(v.payload.dlc) : '—'}
                          </s>
                        ))}
                        <span className="font-semibold">{b.dlc ? formatIsoDate(b.dlc) : '—'}</span>
                      </p>
                    )}
                    {b.end && <EntryTrail entry={b.end} tz={tz} author={author} describe={(p) => `DLC ${formatIsoDate((p as ThawingPayload).dlc ?? '')}`} />}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <SyncBadge records={b.steps.flatMap(entryRecords)} />
                    {b.end && (
                      <Button variant="secondary" onClick={() => onCorrect(b)} icon={<IconEdit size={18} />} aria-label={`Corriger la DLC (${b.product})`}>
                        Corriger la DLC
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}
