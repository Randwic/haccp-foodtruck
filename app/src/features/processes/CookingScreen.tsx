// Cuisson & maintien : contrôles ponctuels de cuisson à cœur (cooking_check) et de maintien au chaud (hot_holding).
import { useMemo, useState } from 'react'
import type { HotHoldingPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { Button, Notice, TemperatureInput, useToast } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconCheck, IconCooking, IconEdit, IconError, IconFlame, IconHistory, IconPlus, IconTemperature } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature, isInRange } from '../../ui/temperature.ts'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { dayLabel, whenLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import {
  BackButton,
  chipClass,
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
import { recentProducts, type SpotEntry } from './entries.ts'
import { catalogProductNamed, cookableProducts, cookingRuleFor, type SpotKind, type SpotRule } from './thresholds.ts'
import { PROCESS_HISTORY_DAYS, useProcessStatus, type ProcessData } from './useProcessData.ts'

const SPOT_LABELS: Record<SpotKind, { title: string; short: string; hint: string; defaults: readonly string[] }> = {
  cooking_check: {
    title: 'Cuisson à cœur',
    short: 'Cuisson',
    hint: 'Sonde au centre de la pièce la plus épaisse, en fin de cuisson.',
    defaults: ['Nuggets de poulet surgelés', 'Porc BBQ cuit', 'Émincé de poulet cuit'],
  },
  hot_holding: {
    title: 'Maintien au chaud',
    short: 'Maintien',
    hint: 'Sonde au cœur du produit dans le bac, la vitrine ou le bain-marie.',
    defaults: ['Porc BBQ cuit', 'Émincé de poulet cuit', 'Trio poivrons cuits'],
  },
}

/** Seuil en vigueur : cuisson → celui du produit du catalogue (cook_min_c) s'il existe ; maintien → générique. */
function ruleFor(data: ProcessData, kind: SpotKind, product: string): SpotRule {
  return kind === 'cooking_check' ? cookingRuleFor(product, data.products, data.rules.cooking_check) : data.rules[kind]
}

function SpotIcon({ kind, size = 22 }: { kind: SpotKind; size?: number }) {
  return kind === 'cooking_check' ? <IconCooking size={size} /> : <IconFlame size={size} />
}

type Filter = SpotKind | 'all'
type Back = { name: 'list' } | { name: 'history'; filter: Filter }
type View = Back | { name: 'entry'; kind: SpotKind } | { name: 'correct'; entryId: string; back: Back } | { name: 'action'; entryId: string; relatedRecordId: string; value_c: number; back: Back }

export function CookingScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now } = useProcessStatus(30_000)
  const [view, setView] = useState<View>({ name: 'list' })

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else {
    const entry = 'entryId' in view ? data.spot.find((e) => e.id === view.entryId) : undefined
    if (view.name === 'action') {
      const kind = entry?.kind ?? 'cooking_check'
      return (
        <CorrectiveActionFlow
          key={view.relatedRecordId}
          relatedRecordId={view.relatedRecordId}
          subject={`${SPOT_LABELS[kind].title} — ${entry?.payload.product ?? ''}`}
          detail={
            <>
              <span className="font-semibold text-danger tabular-nums">{formatTemperature(view.value_c)}</span>
              {entry ? ` ${whenLabel(entry.time, now, data.timeZone)}` : ''} · seuil {describeThreshold(ruleFor(data, kind, entry?.payload.product ?? '').threshold)}
            </>
          }
          onDone={async () => {
            await reload()
            setView(view.back)
          }}
        />
      )
    }
    if (view.name === 'entry') {
      body = (
        <>
          <BackButton label="Cuisson & maintien" onClick={() => setView({ name: 'list' })} />
          <SpotEntryForm
            key={view.kind}
            kind={view.kind}
            data={data}
            onSaved={async (rec, payload) => {
              await reload()
              setView(payload.in_range ? { name: 'list' } : { name: 'action', entryId: rec.id, relatedRecordId: rec.id, value_c: payload.value_c, back: { name: 'list' } })
            }}
          />
        </>
      )
    } else if (view.name === 'correct') {
      body = (
        <>
          <BackButton label="Historique" onClick={() => setView(view.back)} />
          {entry ? (
            <SpotCorrection
              entry={entry}
              data={data}
              now={now}
              onCancel={() => setView(view.back)}
              onSaved={async (rec, replacement) => {
                await reload()
                if (!replacement.in_range && entry.correctiveActions.length === 0) {
                  setView({ name: 'action', entryId: entry.id, relatedRecordId: rec.id, value_c: replacement.value_c, back: view.back })
                } else setView(view.back)
              }}
            />
          ) : (
            <Notice>Mesure introuvable.</Notice>
          )}
        </>
      )
    } else if (view.name === 'history') {
      const back: Back = view
      body = (
        <>
          <BackButton label="Cuisson & maintien" onClick={() => setView({ name: 'list' })} />
          <SpotHistory
            data={data}
            now={now}
            filter={view.filter}
            onFilter={(filter) => setView({ name: 'history', filter })}
            onCorrect={(e) => setView({ name: 'correct', entryId: e.id, back })}
            onCorrectiveAction={(e) => setView({ name: 'action', entryId: e.id, relatedRecordId: e.latest.id, value_c: e.payload.value_c, back })}
          />
        </>
      )
    } else {
      body = (
        <>
          <BackButton label="Accueil" onClick={onBack} />
          <SpotList
            data={data}
            now={now}
            onEntry={(kind) => setView({ name: 'entry', kind })}
            onHistory={() => setView({ name: 'history', filter: 'all' })}
            onCorrectiveAction={(e) => setView({ name: 'action', entryId: e.id, relatedRecordId: e.latest.id, value_c: e.payload.value_c, back: { name: 'list' } })}
          />
        </>
      )
    }
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}

function SpotList({ data, now, onEntry, onHistory, onCorrectiveAction }: { data: ProcessData; now: Date; onEntry: (k: SpotKind) => void; onHistory: () => void; onCorrectiveAction: (e: SpotEntry) => void }) {
  const tz = data.timeZone
  const todayStart = startOfLocalDay(now, tz).getTime()
  const today = data.spot.filter((e) => Date.parse(e.time) >= todayStart)
  const missing = data.spot.filter((e) => e.missingAction)
  const anyDefault = data.rules.cooking_check.isDefault || data.rules.hot_holding.isDefault
  const cookable = cookableProducts(data.products)

  return (
    <>
      <PageTitle
        title="Cuisson & maintien"
        subtitle={`Contrôles ponctuels à la sonde${anyDefault ? ' · seuils par défaut, à confirmer selon votre PMS' : ''}`}
        actions={
          <Button variant="secondary" onClick={onHistory} icon={<IconHistory size={20} />}>
            Historique
          </Button>
        }
      />

      {missing.length > 0 && (
        <section aria-labelledby="missing-title" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
          <h2 id="missing-title" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
            <IconError size={22} className="shrink-0" />
            {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {missing.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <span className="text-[16px] text-fg">
                  <span className="font-semibold">{e.payload.product}</span> · {SPOT_LABELS[e.kind].short.toLowerCase()} · {formatTemperature(e.payload.value_c)} · {whenLabel(e.time, now, tz)}
                </span>
                <Button variant="danger" onClick={() => onCorrectiveAction(e)}>
                  Faire l’action corrective
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {(['cooking_check', 'hot_holding'] as SpotKind[]).map((kind) => {
          const n = today.filter((e) => e.kind === kind).length
          return (
            <article key={kind} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <SpotIcon kind={kind} size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[20px] leading-snug font-semibold text-fg">{SPOT_LABELS[kind].title}</h2>
                  <p className="text-[15px] text-fg-muted">
                    {kind === 'cooking_check' && cookable.length > 0
                      ? `Seuil selon le produit (sinon ${describeThreshold(data.rules[kind].threshold)})`
                      : `Seuil ${describeThreshold(data.rules[kind].threshold)}`}{' '}
                    · {n === 0 ? 'aucune mesure aujourd’hui' : plural(n, 'mesure aujourd’hui', 'mesures aujourd’hui')}
                  </p>
                </div>
              </div>
              <Button size="lg" block onClick={() => onEntry(kind)} icon={<IconPlus size={22} />} aria-label={`Nouvelle mesure — ${SPOT_LABELS[kind].title}`}>
                Nouvelle mesure
              </Button>
            </article>
          )
        })}
      </div>

      <section className="mt-8" aria-labelledby="today-title">
        <SectionLabel id="today-title">Aujourd’hui</SectionLabel>
        {today.length === 0 ? (
          <EmptyCard>Aucune mesure aujourd’hui.</EmptyCard>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {today.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <span className="w-14 shrink-0 text-[16px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</span>
                <span className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
                  <span className="font-semibold">{e.payload.product}</span>
                  <span className="text-fg-muted"> · {SPOT_LABELS[e.kind].short}</span>
                </span>
                <span className="text-[19px] font-semibold text-fg tabular-nums">{formatTemperature(e.payload.value_c)}</span>
                <ResultBadge ok={e.payload.in_range} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function SpotEntryForm({ kind, data, onSaved }: { kind: SpotKind; data: ProcessData; onSaved: (rec: HaccpRecord, payload: HotHoldingPayload) => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const labels = SPOT_LABELS[kind]
  const [product, setProduct] = useState('')
  // Cuisson : seuil du produit du catalogue (cook_min_c), sinon seuil générique.
  const rule = ruleFor(data, kind, product)
  const catalog = kind === 'cooking_check' ? cookableProducts(data.products) : []
  const fromCatalog = kind === 'cooking_check' ? catalogProductNamed(data.products, product) : null
  const [value, setValue] = useState<number | null>(null)
  const [equipmentId, setEquipmentId] = useState<string | null>(null)
  const holders = kind === 'hot_holding' ? data.equipment.filter((e) => e.active && e.kind === 'hot_holding') : []
  const suggestions = useMemo(
    () => recentProducts(data.spot.filter((e) => e.kind === kind).map((e) => ({ product: e.payload.product, time: e.time })), labels.defaults),
    [data.spot, kind, labels.defaults],
  )

  const submit = async () => {
    if (value === null || !product.trim()) return
    const payload: HotHoldingPayload = { product: product.trim(), value_c: value, source: 'manual', in_range: isInRange(value, rule.threshold) }
    if (equipmentId) payload.equipment_id = equipmentId
    const rec = await save(kind, { ...payload })
    if (!rec) return
    if (payload.in_range) toast(`Mesure enregistrée : ${payload.product}, ${formatTemperature(value)}`, 'ok')
    onSaved(rec, payload)
  }

  return (
    <EntryLayout
      left={
        <>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <SpotIcon kind={kind} size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{labels.title}</h1>
              <p className="text-[16px] text-fg-muted">
                Seuil {describeThreshold(rule.threshold)}
                {rule.isDefault ? ' (par défaut, à confirmer selon votre PMS)' : ''}
              </p>
            </div>
          </div>
          {catalog.length > 0 && (
            <div role="radiogroup" aria-label="Produit du catalogue" className="mt-6">
              <p className="mb-2 text-[15px] font-semibold text-fg">Produit du catalogue</p>
              <div className="flex flex-wrap gap-2">
                {catalog.map((p) => {
                  const on = fromCatalog?.id === p.id
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} className={chipClass(on)} onClick={() => setProduct(p.name)}>
                      {p.name}
                      <span className="ml-1.5 font-normal tabular-nums opacity-80">≥ {formatTemperature(p.cook_min_c!)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="mt-6">
            <ProductField
              label={catalog.length > 0 ? 'Produit (ou autre produit, saisie libre)' : 'Produit'}
              value={product}
              onChange={setProduct}
              suggestions={suggestions.filter((x) => !catalog.some((p) => p.name === x))}
            />
          </div>
          {kind === 'cooking_check' && product.trim() && (
            <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-sunken px-4 py-3 text-[15px] leading-snug text-fg">
              <IconTemperature size={20} className="mt-px shrink-0 text-accent" />
              <span>
                Seuil appliqué : <span className="font-semibold tabular-nums">{describeThreshold(rule.threshold)}</span>
                {fromCatalog ? ` — température à cœur minimale de « ${fromCatalog.name} »` : ` — seuil générique${rule.isDefault ? ' (par défaut, à confirmer selon votre PMS)' : ''}`}
              </span>
            </p>
          )}
          {holders.length > 0 && (
            <div role="group" aria-label="Équipement (facultatif)" className="mt-5">
              <p className="mb-2 text-[15px] font-semibold text-fg">Équipement (facultatif)</p>
              <div className="flex flex-wrap gap-2">
                {holders.map((e) => (
                  <button key={e.id} type="button" className={chipClass(equipmentId === e.id)} aria-pressed={equipmentId === e.id} onClick={() => setEquipmentId(equipmentId === e.id ? null : e.id)}>
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-5 max-w-md text-[15px] text-fg-subtle">{labels.hint} Hors seuil, une action corrective sera demandée.</p>
        </>
      }
      right={
        <>
          <TemperatureInput label="Température à cœur" value={value} onChange={setValue} threshold={rule.threshold} />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={value === null || !product.trim() || busy} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : 'Enregistrer la mesure'}
            </Button>
            {!product.trim() && <p className="text-[14px] text-fg-subtle">Indiquez le produit.</p>}
          </StickyActions>
        </>
      }
    />
  )
}

function SpotCorrection({ entry, data, now, onSaved, onCancel }: { entry: SpotEntry; data: ProcessData; now: Date; onSaved: (rec: HaccpRecord, r: HotHoldingPayload) => void; onCancel: () => void }) {
  const author = useAuthorName(data.staff)
  const rule = ruleFor(data, entry.kind, entry.payload.product)
  return (
    <TemperatureCorrection<HotHoldingPayload>
      type={entry.kind}
      latestId={entry.latest.id}
      value_c={entry.payload.value_c}
      threshold={rule.threshold}
      replacementFor={(value_c) => ({ ...entry.payload, value_c, in_range: isInRange(value_c, rule.threshold) })}
      summary={
        <>
          <p className="text-[17px] font-semibold text-fg">
            {entry.payload.product} — {SPOT_LABELS[entry.kind].title.toLowerCase()}
          </p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            Mesure {whenLabel(entry.time, now, data.timeZone)} par {author(entry.authorId)} · seuil {describeThreshold(rule.threshold)}
          </p>
        </>
      }
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}

function SpotHistory(props: {
  data: ProcessData
  now: Date
  filter: Filter
  onFilter: (f: Filter) => void
  onCorrect: (e: SpotEntry) => void
  onCorrectiveAction: (e: SpotEntry) => void
}) {
  const { data, now, filter } = props
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const from = startOfLocalDay(now, tz, PROCESS_HISTORY_DAYS).getTime()
  const days = useMemo(() => {
    const groups = new Map<string, SpotEntry[]>()
    for (const e of data.spot.filter((x) => Date.parse(x.time) >= from && (filter === 'all' || x.kind === filter))) {
      const k = localDayKey(e.time, tz)
      groups.set(k, [...(groups.get(k) ?? []), e])
    }
    return [...groups.entries()]
  }, [data.spot, from, filter, tz])

  return (
    <>
      <PageTitle title="Historique — cuisson & maintien" subtitle={`Aujourd’hui et les ${PROCESS_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      <div role="group" aria-label="Filtrer par contrôle" className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ['all', 'Tous'],
            ['cooking_check', SPOT_LABELS.cooking_check.title],
            ['hot_holding', SPOT_LABELS.hot_holding.title],
          ] as const
        ).map(([f, label]) => (
          <button key={f} type="button" className={chipClass(filter === f)} aria-pressed={filter === f} onClick={() => props.onFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      {days.length === 0 ? (
        <EmptyCard>Aucune mesure sur cette période.</EmptyCard>
      ) : (
        days.map(([key, list]) => (
          <section key={key} aria-label={dayLabel(list[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(list[0].time, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`${SPOT_LABELS[e.kind].title} de ${formatTime(e.time, tz)}, ${e.payload.product}`}>
                  <div className="w-16 shrink-0 pt-1 text-[17px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</div>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {e.versions.slice(0, -1).map((v) => (
                        <s key={v.record.id} className="text-[19px] text-fg-subtle tabular-nums" aria-label={`Valeur d’origine ${formatTemperature(v.payload.value_c)}, corrigée`}>
                          {formatTemperature(v.payload.value_c)}
                        </s>
                      ))}
                      <span className="text-[24px] leading-tight font-semibold text-fg tabular-nums">{formatTemperature(e.payload.value_c)}</span>
                      <ResultBadge ok={e.payload.in_range} />
                    </div>
                    <div className="mt-1 text-[15px] text-fg-muted">
                      <span className="font-medium text-fg">{e.payload.product}</span> · {SPOT_LABELS[e.kind].title.toLowerCase()} · par {author(e.authorId)}
                    </div>
                    <EntryTrail entry={e} tz={tz} author={author} describe={(p) => formatTemperature((p as HotHoldingPayload).value_c)} />
                    {e.missingAction && <MissingAction onClick={() => props.onCorrectiveAction(e)} />}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <SyncBadge records={entryRecords(e)} />
                    <Button variant="secondary" onClick={() => props.onCorrect(e)} icon={<IconEdit size={18} />} aria-label={`Corriger la mesure de ${formatTime(e.time, tz)} (${e.payload.product})`}>
                      Corriger
                    </Button>
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
