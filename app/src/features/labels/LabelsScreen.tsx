// Module Étiquettes DLC (lot 4) : 3 parcours en 2 touches (ouverture, préparation maison, décongélation),
// aperçu fidèle + impression 62 mm, échéances (« Jeté » → perte), historique 7 jours et corrections.
import { useMemo, useState, type ReactNode } from 'react'
import type { Allergen, LabelPrintedPayload, Product, Recipe, WastePayload } from '../../../../shared/payloads.ts'
import { productTraces } from './allergens.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Badge, Button, Modal, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { formatTime, initials } from '../../ui/format.ts'
import {
  IconAllergen,
  IconBan,
  IconCheck,
  IconChevronRight,
  IconDlc,
  IconEdit,
  IconError,
  IconHistory,
  IconOpened,
  IconRecipe,
  IconSnowflake,
  IconThawing,
  IconWaste,
} from '../../ui/icons.tsx'
import { BackButton, EmptyCard, ErrorNotice, PageTitle, ReasonField, SectionLabel, SyncBadge, entryRecords, useAuthorName, useRecordSaver } from '../processes/common.tsx'
import type { ThawBatch } from '../processes/entries.ts'
import { formatIsoDate } from '../processes/timing.ts'
import { dayLabel, whenLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { useLabelHeightMm, markConsumed } from './labelSettings.ts'
import { CopiesStepper, DateKindChoice, DlcFields, draftFor, LabelEditor, MANUFACTURER_DLC_ORIGIN, PrintButtons, useLabelPdf, type LabelDraft } from './LabelEditor.tsx'
import { LabelPaper, LabelPrintSheet } from './LabelPreview.tsx'
import {
  ALLERGEN_SHORT,
  contentFromPayload,
  dlcFromDate,
  dlcProblem,
  finishedThaws,
  dateKindOf,
  formatLabelDateTime,
  formatLimit,
  formatShelfLife,
  fromLocalInputs,
  KIND_MADE_LABEL,
  KIND_TITLES,
  productForName,
  receivedForOpening,
  recipeAllergens,
  recipeTraces,
  STORAGE_LABELS,
  toLocalInputs,
  type DueItem,
  type LabelEntry,
  type LabelKind,
  type ReceivedForOpening,
} from './model.ts'
import { LABEL_HISTORY_DAYS, useLabelStatus, type LabelData } from './useLabelData.ts'

type View =
  | { name: 'home' }
  | { name: 'pick'; kind: LabelKind }
  | { name: 'edit'; draft: LabelDraft; back: View }
  | { name: 'history' }
  | { name: 'correct'; entryId: string }
  | { name: 'reprint'; entryId: string }

const KIND_ICON: Record<LabelKind, (p: { size?: number; className?: string }) => ReactNode> = { opened: IconOpened, prepared: IconRecipe, thawed: IconThawing }
const KIND_HINT: Record<LabelKind, string> = {
  opened: 'Sachet, bocal, conditionnement entamé',
  prepared: 'Sauce, préparation du jour',
  thawed: 'Produit sorti du congélateur',
}

export function LabelsScreen({ onBack, onOpenAllergens }: { onBack: () => void; onOpenAllergens: () => void }) {
  const [consumedVersion, setConsumedVersion] = useState(0)
  const { data, error, reload, now, due } = useLabelStatus(30_000, consumedVersion)
  const [view, setView] = useState<View>({ name: 'home' })
  const [wasteFor, setWasteFor] = useState<DueItem | null>(null)

  let body: ReactNode
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data || !due) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else if (view.name === 'pick') {
    body = (
      <>
        <BackButton label="Étiquettes" onClick={() => setView({ name: 'home' })} />
        <Picker kind={view.kind} data={data} now={now} onPick={(draft) => setView({ name: 'edit', draft, back: view })} />
      </>
    )
  } else if (view.name === 'edit') {
    const Icon = KIND_ICON[view.draft.kind]
    body = (
      <>
        <BackButton label={view.back.name === 'pick' ? KIND_TITLES[view.draft.kind] : 'Étiquettes'} onClick={() => setView(view.back)} />
        <LabelEditor
          draft={view.draft}
          data={data}
          onCancel={() => setView({ name: 'home' })}
          onSaved={async () => {
            await reload()
            setView({ name: 'home' })
          }}
          header={
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">{KIND_TITLES[view.draft.kind]}</p>
                <h1 className="truncate text-[26px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[30px]">
                  {view.draft.recipe?.name ?? view.draft.product?.name ?? view.draft.thawProductName}
                </h1>
              </div>
            </div>
          }
        />
      </>
    )
  } else if (view.name === 'history') {
    body = (
      <>
        <BackButton label="Étiquettes" onClick={() => setView({ name: 'home' })} />
        <LabelHistory data={data} now={now} onCorrect={(e) => setView({ name: 'correct', entryId: e.id })} />
      </>
    )
  } else if (view.name === 'correct' || view.name === 'reprint') {
    const entry = data.labels.find((l) => l.id === view.entryId)
    body = (
      <>
        <BackButton label="Historique" onClick={() => setView({ name: 'history' })} />
        {!entry ? (
          <Notice>Étiquette introuvable.</Notice>
        ) : view.name === 'correct' ? (
          <LabelCorrection
            entry={entry}
            data={data}
            onCancel={() => setView({ name: 'history' })}
            onSaved={async () => {
              await reload()
              setView({ name: 'reprint', entryId: entry.id })
            }}
          />
        ) : (
          <Reprint entry={entry} data={data} onDone={() => setView({ name: 'history' })} />
        )}
      </>
    )
  } else {
    body = (
      <LabelsHome
        data={data}
        now={now}
        due={due}
        onBack={onBack}
        onPick={(kind) => setView({ name: 'pick', kind })}
        onHistory={() => setView({ name: 'history' })}
        onAllergens={onOpenAllergens}
        onWaste={setWasteFor}
        onConsumed={(item) => {
          markConsumed(item.entry.id)
          setConsumedVersion((v) => v + 1)
        }}
      />
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
      {body}
      {wasteFor && data && (
        <WasteModal
          item={wasteFor}
          tz={data.timeZone}
          onClose={() => setWasteFor(null)}
          onSaved={async () => {
            setWasteFor(null)
            await reload()
          }}
        />
      )}
    </main>
  )
}

// ---------- Accueil du module ----------

function ActionCard({ title, description, icon, onClick }: { title: string; description: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left text-fg shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-pressed sm:min-h-28 sm:p-5"
    >
      <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[19px] leading-snug font-semibold">{title}</span>
        <span className="mt-0.5 block text-[15px] text-fg-muted">{description}</span>
      </span>
      <IconChevronRight size={20} className="shrink-0 text-fg-subtle" />
    </button>
  )
}

const DUE_TONE = {
  expired: { badge: 'error', label: 'DLC dépassée', Icon: IconError },
  today: { badge: 'warn', label: 'Aujourd’hui', Icon: IconDlc },
  tomorrow: { badge: 'neutral', label: 'Demain', Icon: IconDlc },
} as const

function LabelsHome(props: {
  data: LabelData
  now: Date
  due: DueItem[]
  onBack: () => void
  onPick: (k: LabelKind) => void
  onHistory: () => void
  onAllergens: () => void
  onWaste: (i: DueItem) => void
  onConsumed: (i: DueItem) => void
}) {
  const { data, now, due } = props
  const tz = data.timeZone
  const todayStart = startOfLocalDay(now, tz).getTime()
  const today = data.labels.filter((l) => Date.parse(l.time) >= todayStart)
  const expired = due.filter((d) => d.state === 'expired').length
  return (
    <>
      <BackButton label="Accueil" onClick={props.onBack} />
      <PageTitle
        title="Étiquettes DLC"
        subtitle="Ouverture, préparations maison et décongélation · rouleau 62 mm"
        actions={
          <>
            <Button variant="secondary" onClick={props.onAllergens} icon={<IconAllergen size={20} />}>
              Tableau des allergènes
            </Button>
            <Button variant="secondary" onClick={props.onHistory} icon={<IconHistory size={20} />}>
              Historique
            </Button>
          </>
        }
      />

      {expired > 0 && (
        <div role="alert" className="mb-5 flex items-center gap-3 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5 sm:px-5">
          <IconError size={22} className="shrink-0 text-danger" />
          <p className="text-[16px] text-fg">
            <span className="font-semibold">{plural(expired, 'produit a dépassé sa DLC', 'produits ont dépassé leur DLC')}.</span> Retirez-{expired > 1 ? 'les' : 'le'} et notez la perte (« Jeté »).
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
        {(['opened', 'prepared', 'thawed'] as const).map((k) => {
          const Icon = KIND_ICON[k]
          return <ActionCard key={k} title={KIND_TITLES[k]} description={KIND_HINT[k]} icon={<Icon size={26} />} onClick={() => props.onPick(k)} />
        })}
      </div>

      <section className="mt-8" aria-labelledby="lb-due">
        <SectionLabel id="lb-due">Produits arrivant à échéance</SectionLabel>
        {due.length === 0 ? (
          <EmptyCard>Aucune DLC aujourd’hui ni demain.</EmptyCard>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {due.map((d) => (
              <DueRow key={d.entry.id} item={d} tz={tz} onWaste={() => props.onWaste(d)} onConsumed={() => props.onConsumed(d)} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="lb-today">
        <SectionLabel id="lb-today">Imprimées aujourd’hui</SectionLabel>
        {today.length === 0 ? (
          <EmptyCard>Aucune étiquette imprimée aujourd’hui.</EmptyCard>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {today.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5">
                <span className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
                  <span className="font-semibold">{l.payload.name}</span>
                  <span className="text-fg-muted">
                    {' '}
                    · {KIND_MADE_LABEL[l.payload.kind].replace(' le', '')} à {formatTime(l.payload.made_at, tz)} · {plural(l.payload.copies, 'étiquette', 'étiquettes')}
                  </span>
                </span>
                <span className="text-[16px] font-semibold text-fg tabular-nums">{dateKindOf(l.payload)} {formatLimit(l.payload, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function DueRow({ item, tz, onWaste, onConsumed }: { item: DueItem; tz: string; onWaste: () => void; onConsumed: () => void }) {
  const t = DUE_TONE[item.state]
  const p = item.entry.payload
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5 ${item.state === 'expired' ? 'bg-danger-soft/60' : ''}`}>
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[18px] font-semibold text-fg">{p.name}</span>
          <Badge tone={t.badge}>
            <t.Icon size={14} strokeWidth={2.25} />
            {t.label}
          </Badge>
        </div>
        <p className="mt-0.5 text-[15px] text-fg-muted tabular-nums">
          {dateKindOf(p)} <span className={`font-semibold ${item.state === 'expired' ? 'text-danger' : 'text-fg'}`}>{formatLimit(p, tz).replace(' ', ' à ')}</span>
          {p.lot ? ` · lot ${p.lot}` : ''} · {STORAGE_LABELS[p.storage]}
        </p>
      </div>
      <div className="flex shrink-0 gap-2 max-sm:w-full">
        <Button variant="ghost" onClick={onConsumed} className="max-sm:flex-1" aria-label={`Épuisé (utilisé) – ${p.name}`}>
          <IconCheck size={18} />
          Épuisé
        </Button>
        <Button variant={item.state === 'expired' ? 'danger' : 'secondary'} onClick={onWaste} icon={<IconWaste size={18} />} className="max-sm:flex-1" aria-label={`Jeté – ${p.name}`}>
          Jeté
        </Button>
      </div>
    </li>
  )
}

function WasteModal({ item, tz, onClose, onSaved }: { item: DueItem; tz: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [quantity, setQuantity] = useState('')
  const p = item.entry.payload
  const submit = async () => {
    const w: WastePayload = { product: p.name.slice(0, LIMITS.productMax), reason: 'expired', related_record_id: item.entry.id }
    if (p.lot) w.lot = p.lot
    if (quantity.trim()) w.quantity = quantity.trim().slice(0, LIMITS.quantityMax)
    const rec = await save('waste', { ...w })
    if (!rec) return
    toast(`Perte enregistrée : ${p.name}`, 'ok')
    onSaved()
  }
  return (
    <Modal
      open
      title="Produit jeté"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy} icon={<IconWaste size={20} />}>
            {busy ? 'Enregistrement…' : 'Enregistrer la perte'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-[17px] text-fg">
          <span className="font-semibold">{p.name}</span>
          {p.lot ? ` · lot ${p.lot}` : ''} — {dateKindOf(p)} {formatLimit(p, tz).replace(' ', ' à ')}
        </p>
        <p className="text-[15px] text-fg-muted">Motif : date dépassée. La perte est reliée à l’étiquette dans le registre (traçabilité).</p>
        <TextField label="Quantité (facultatif)" value={quantity} onChange={setQuantity} maxLength={LIMITS.quantityMax} placeholder="Ex. : 1/2 bocal, 300 g" />
        <ErrorNotice error={error} />
      </div>
    </Modal>
  )
}

// ---------- Étape 1 : choix du produit / de la recette ----------

function AllergenLine({ allergens, traces = [] }: { allergens: readonly Allergen[]; traces?: readonly Allergen[] }) {
  return (
    <>
      {allergens.length ? <span className="font-semibold text-fg">{allergens.map((a) => ALLERGEN_SHORT[a]).join(', ')}</span> : <span>Aucun allergène déclaré</span>}
      {traces.length > 0 && <span> · traces possibles : {traces.map((a) => ALLERGEN_SHORT[a]).join(', ')}</span>}
    </>
  )
}

function ChoiceCard({ title, lines, onClick, disabled, icon, ariaLabel }: { title: string; lines: ReactNode[]; onClick: () => void; disabled?: boolean; icon: ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex min-h-24 w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-pressed disabled:cursor-default disabled:bg-sunken disabled:shadow-none disabled:active:scale-100"
    >
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${disabled ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[18px] leading-snug font-semibold ${disabled ? 'text-fg-muted' : 'text-fg'}`}>{title}</span>
        {lines.map((l, i) => (
          <span key={i} className="mt-0.5 block text-[15px] leading-snug text-fg-muted">
            {l}
          </span>
        ))}
      </span>
    </button>
  )
}

function Picker({ kind, data, now, onPick }: { kind: LabelKind; data: LabelData; now: Date; onPick: (d: LabelDraft) => void }) {
  const tz = data.timeZone
  const products = data.products.filter((p) => p.active)
  const Icon = KIND_ICON[kind]
  const hoursOf = (p: Product) => (kind === 'opened' ? p.shelf_life_opened_hours : p.shelf_life_thawed_hours)
  // Ouverture : un produit sans durée = « selon l'étiquette du fabricant » (DLC saisie à la main), donc proposé.
  const usable = products.filter((p) => kind === 'opened' || hoursOf(p) !== null)
  const others = products.filter((p) => kind !== 'opened' && hoursOf(p) === null)
  // Préparation maison : seulement les recettes de type 'preparation' (pas les plats du menu).
  const recipes = data.recipes.filter((r) => r.active && r.kind === 'preparation' && r.shelf_life_hours !== null)
  const dlcText = (p: Product) => (hoursOf(p) === null ? 'selon l’étiquette du fabricant' : `${kind === 'opened' ? 'ouverture' : 'décongélation'} + ${formatShelfLife(hoursOf(p))}`)
  const thaws = kind === 'thawed' ? finishedThaws(data.thaws, now) : []
  const received = kind === 'opened' ? receivedForOpening(data.receptions, products, now, tz, data.openingLabels) : []

  const productCard = (p: Product) => (
    <li key={p.id}>
      <ChoiceCard
        title={p.name}
        icon={<Icon size={20} />}
        ariaLabel={`${p.name} — DLC ${dlcText(p).replace(/\u00a0/g, ' ')}`}
        lines={[`DLC : ${dlcText(p)} · ${STORAGE_LABELS[kind === 'thawed' ? 'fridge' : p.storage]}`, <AllergenLine key="a" allergens={p.allergens} traces={productTraces(p)} />]}
        onClick={() => onPick(draftFor(kind, p, new Date()))}
      />
    </li>
  )
  const recipeCard = (r: Recipe) => (
    <li key={r.id}>
      <ChoiceCard
        title={r.name}
        icon={<IconRecipe size={20} />}
        ariaLabel={`${r.name} — DLC préparation + ${formatShelfLife(r.shelf_life_hours).replace(/ /g, ' ')}`}
        lines={[`DLC : préparation + ${formatShelfLife(r.shelf_life_hours)} · ${STORAGE_LABELS[r.storage]}`, <AllergenLine key="a" allergens={recipeAllergens(r, data.products, data.recipes)} traces={recipeTraces(r, data.products, data.recipes)} />]}
        onClick={() => onPick(draftFor('prepared', r, new Date()))}
      />
    </li>
  )
  const fromThaw = (b: ThawBatch) => {
    const product = productForName(products, b.product)
    const madeAt = new Date(b.endedAt!)
    const draft: LabelDraft = {
      kind: 'thawed',
      product: product ?? undefined,
      thawProductName: product ? undefined : b.product,
      madeAt,
      dlc: dlcFromDate(b.dlc!, tz),
      dlcOrigin: `DLC de la décongélation (${formatIsoDate(b.dlc!)})`,
      sourceIds: [b.end!.latest.id],
    }
    onPick(draft)
  }

  // Achat repris : lot et DLC d'origine déjà saisis à la réception, rien à rescanner.
  const fromReception = (r: ReceivedForOpening) => {
    const madeAt = new Date(Math.floor(Date.now() / 60_000) * 60_000)
    const base: LabelDraft = r.catalog
      ? draftFor('opened', r.catalog, madeAt)
      : { kind: 'opened', madeAt, dlc: null, dlcOrigin: MANUFACTURER_DLC_ORIGIN, sourceIds: [], thawProductName: r.product }
    onPick({ ...base, lot: r.lot, lotSource: r.lot ? r.receptionId : undefined, originalDlc: r.dlc, originalDdm: r.dlc ? undefined : r.ddm, sourceIds: r.lot ? [] : [r.receptionId] })
  }
  const receivedLine = (r: ReceivedForOpening) =>
    [r.lot && `Lot ${r.lot}`, r.dlc ? `DLC d’origine ${r.dlc.slice(8, 10)}/${r.dlc.slice(5, 7)}/${r.dlc.slice(0, 4)}` : r.ddm && `DDM ${r.ddm.slice(8, 10)}/${r.ddm.slice(5, 7)}/${r.ddm.slice(0, 4)}`].filter(Boolean).join(' · ')

  return (
    <>
      <PageTitle title={KIND_TITLES[kind]} subtitle={kind === 'prepared' ? 'Choisissez la préparation : la DLC et les allergènes sont calculés.' : 'Choisissez le produit : la DLC et les allergènes sont repris de sa fiche.'} />
      {kind === 'thawed' && thaws.length > 0 && (
        <section className="mb-8" aria-labelledby="pk-thaws">
          <SectionLabel id="pk-thaws">Décongélations terminées (module Procédés)</SectionLabel>
          <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {thaws.map((b) => (
              <li key={b.batchId}>
                <ChoiceCard
                  title={b.product}
                  icon={<IconSnowflake size={20} />}
                  ariaLabel={`Reprendre la décongélation ${b.product} terminée ${whenLabel(b.endedAt!, now, tz)}`}
                  lines={[`Terminée ${whenLabel(b.endedAt!, now, tz)}`, <span key="d" className="font-semibold text-fg">DLC {formatIsoDate(b.dlc!)}</span>]}
                  onClick={() => fromThaw(b)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {received.length > 0 && (
        <section className="mb-8" aria-labelledby="pk-received">
          <SectionLabel id="pk-received">Produits reçus aux Achats (lot et DLC déjà enregistrés)</SectionLabel>
          <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {received.map((r) => (
              <li key={`${r.receptionId}-${r.product}-${r.lot ?? ''}-${r.dlc ?? ''}`}>
                <ChoiceCard
                  title={r.catalog?.name ?? r.product}
                  icon={<Icon size={20} />}
                  ariaLabel={`Ouvrir ${r.catalog?.name ?? r.product} reçu ${whenLabel(r.receivedAt, now, tz)}${r.lot ? `, lot ${r.lot}` : ''}`}
                  lines={[<span key="l" className="font-semibold text-fg">{receivedLine(r)}</span>, `Reçu ${whenLabel(r.receivedAt, now, tz)}`]}
                  onClick={() => fromReception(r)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {kind === 'opened' && received.length > 0 && <SectionLabel>Autre produit (sans achat enregistré)</SectionLabel>}
      {kind === 'prepared' ? (
        recipes.length === 0 ? (
          <EmptyCard>Aucune recette. Le gérant les ajoute dans Gestion › Recettes.</EmptyCard>
        ) : (
          <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">{recipes.map(recipeCard)}</ul>
        )
      ) : (
        <>
          {kind === 'thawed' && thaws.length > 0 && <SectionLabel>Autre produit décongelé</SectionLabel>}
          {usable.length === 0 ? (
            <EmptyCard>Aucun produit avec une durée de vie {kind === 'opened' ? 'après ouverture' : 'après décongélation'}. Le gérant la renseigne dans Gestion › Produits.</EmptyCard>
          ) : (
            <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">{usable.map(productCard)}</ul>
          )}
          {others.length > 0 && (
            <p className="mt-5 flex items-start gap-2 text-[15px] text-fg-muted">
              <IconBan size={18} className="mt-0.5 shrink-0" />
              <span>
                Sans durée {kind === 'opened' ? 'après ouverture' : 'après décongélation'} (non proposés) : {others.map((p) => p.name).join(', ')}. À renseigner dans Gestion › Produits si besoin.
              </span>
            </p>
          )}
        </>
      )}
    </>
  )
}

// ---------- Historique, corrections ----------

const kindBadge = (k: LabelKind) => <Badge tone="info">{KIND_TITLES[k].replace(' d’un produit', '')}</Badge>

function LabelHistory({ data, now, onCorrect }: { data: LabelData; now: Date; onCorrect: (e: LabelEntry) => void }) {
  const tz = data.timeZone
  const author = useAuthorName(data.staff)
  const from = startOfLocalDay(now, tz, LABEL_HISTORY_DAYS).getTime()
  const days = useMemo(() => {
    const groups = new Map<string, LabelEntry[]>()
    for (const l of data.labels.filter((x) => Date.parse(x.time) >= from)) {
      const k = localDayKey(l.time, tz)
      groups.set(k, [...(groups.get(k) ?? []), l])
    }
    return [...groups.entries()]
  }, [data.labels, from, tz])
  return (
    <>
      <PageTitle title="Historique — étiquettes" subtitle={`Aujourd’hui et les ${LABEL_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      {days.length === 0 ? (
        <EmptyCard>Aucune étiquette sur cette période.</EmptyCard>
      ) : (
        days.map(([key, list]) => (
          <section key={key} aria-label={dayLabel(list[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(list[0].time, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {list.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Étiquette ${l.payload.name} de ${formatTime(l.time, tz)}`}>
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[18px] font-semibold text-fg">{l.payload.name}</span>
                      {kindBadge(l.payload.kind)}
                      {l.waste && (
                        <Badge tone="neutral">
                          <IconWaste size={14} strokeWidth={2.25} />
                          Jeté {whenLabel(l.waste.time, now, tz)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[15px] text-fg-muted tabular-nums">
                      {KIND_MADE_LABEL[l.payload.kind]} {formatLabelDateTime(l.payload.made_at, tz).replace(' ', ' à ')} · {plural(l.payload.copies, 'étiquette', 'étiquettes')} · {author(l.authorId)}
                    </p>
                    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[17px] text-fg tabular-nums">
                      <span className="font-semibold">{dateKindOf(l.payload)}</span>
                      {l.versions.slice(0, -1).map((v) =>
                        v.payload.dlc_at !== l.payload.dlc_at ? (
                          <s key={v.record.id} className="text-fg-subtle" aria-label={`DLC d’origine ${formatLabelDateTime(v.payload.dlc_at, tz)}, corrigée`}>
                            {formatLabelDateTime(v.payload.dlc_at, tz)}
                          </s>
                        ) : null,
                      )}
                      <span className="font-semibold">{formatLabelDateTime(l.payload.dlc_at, tz)}</span>
                      {l.versions.slice(0, -1).map((v) =>
                        (v.payload.lot ?? '') !== (l.payload.lot ?? '') ? (
                          <s key={`lot-${v.record.id}`} className="text-[15px] text-fg-subtle">
                            lot {v.payload.lot ?? '—'}
                          </s>
                        ) : null,
                      )}
                      <span className="text-[15px] text-fg-muted">{l.payload.lot ? `lot ${l.payload.lot}` : 'sans lot'}</span>
                    </p>
                    <p className="mt-1 text-[15px] text-fg-muted">
                      Allergènes : <AllergenLine allergens={l.payload.allergens} traces={l.payload.may_contain} />
                    </p>
                    {l.versions.slice(1).map((c) => (
                      <p key={c.record.id} className="mt-1.5 flex items-start gap-2 text-[15px] text-fg">
                        <IconEdit size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
                        <span>
                          Corrigé {whenLabel(c.record.device_time, now, tz)} par {author(c.record.author_id)}
                          {c.reason ? <span className="text-fg-muted"> — motif : {c.reason}</span> : null}
                        </span>
                      </p>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                    <SyncBadge records={[...entryRecords(l), ...(l.waste ? entryRecords(l.waste) : [])]} />
                    <Button variant="secondary" onClick={() => onCorrect(l)} icon={<IconEdit size={18} />} aria-label={`Corriger (${l.payload.name})`}>
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

const QUICK_REASONS = ['Erreur de DLC', 'C’est une DDM, pas une DLC', 'Erreur de lot', 'Nombre d’étiquettes erroné'] as const

function LabelCorrection({ entry, data, onCancel, onSaved }: { entry: LabelEntry; data: LabelData; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast()
  const tz = data.timeZone
  const { save, busy, error } = useRecordSaver()
  const p = entry.payload
  const init = toLocalInputs(new Date(p.dlc_at), tz)
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [lot, setLot] = useState(p.lot ?? '')
  const [copies, setCopies] = useState(p.copies)
  const initialKind: 'dlc' | 'ddm' = p.date_kind === 'ddm' ? 'ddm' : 'dlc'
  const [dateKind, setDateKind] = useState<'dlc' | 'ddm'>(initialKind)
  const [reason, setReason] = useState('')
  const dlc = fromLocalInputs(date, time, tz)
  const problem = dlcProblem(new Date(p.made_at), dlc)
  const replacement = (): LabelPrintedPayload => {
    const r: LabelPrintedPayload = { ...p, dlc_at: dlc!.toISOString(), copies }
    const l = lot.trim().slice(0, LIMITS.lotMax)
    if (l) r.lot = l
    else delete r.lot
    if (dateKind === 'ddm') r.date_kind = 'ddm'
    else delete r.date_kind
    return r
  }
  const changed = !problem && (dlc!.toISOString() !== p.dlc_at || lot.trim() !== (p.lot ?? '') || copies !== p.copies || dateKind !== initialKind)
  const submit = async () => {
    if (!changed || !reason.trim()) return
    const rec = await save('correction', { reason: reason.trim(), replacement: { ...replacement() } }, { supersedes_id: entry.latest.id, ctx: { supersededType: 'label_printed' } })
    if (!rec) return
    toast('Correction enregistrée', 'ok')
    onSaved()
  }
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Corriger une étiquette</h1>
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <p className="text-[17px] font-semibold text-fg">{p.name}</p>
          <p className="mt-0.5 text-[15px] text-fg-muted tabular-nums">
            {KIND_MADE_LABEL[p.kind]} {formatLabelDateTime(p.made_at, tz).replace(' ', ' à ')} · {dateKindOf(p)} enregistrée {formatLimit(p, tz).replace(' ', ' à ')}
            {p.lot ? ` · lot ${p.lot}` : ''}
          </p>
        </div>
        <div className="mt-5">
          <ReasonField value={reason} onChange={setReason} quick={QUICK_REASONS} />
        </div>
        <div className="mt-5">
          <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Pensez à réimprimer l’étiquette corrigée.</Notice>
        </div>
      </div>
      <div className="space-y-6">
        <div>
          <DateKindChoice value={dateKind} onChange={setDateKind} />
          <DlcFields date={date} time={time} onDate={setDate} onTime={setTime} error={problem} legend={dateKind === 'ddm' ? 'À consommer de préférence avant' : undefined} />
        </div>
        <TextField label="N° de lot" value={lot} onChange={setLot} maxLength={LIMITS.lotMax} autoCapitalize="characters" />
        <CopiesStepper value={copies} onChange={setCopies} />
        <ErrorNotice error={error} />
        <div className="flex flex-col gap-2">
          <Button size="lg" block onClick={submit} disabled={!changed || !reason.trim() || busy} icon={<IconCheck size={22} />}>
            {busy ? 'Enregistrement…' : 'Enregistrer la correction'}
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Réimpression de la version en vigueur (après correction) : impression seule, rien n'est ajouté au registre. */
function Reprint({ entry, data, onDone }: { entry: LabelEntry; data: LabelData; onDone: () => void }) {
  const heightMm = useLabelHeightMm()
  const author = data.staff.find((s) => s.id === entry.latest.author_id)
  const content = useMemo(() => contentFromPayload(entry.payload, author ? initials(author.display_name) : '?', data.timeZone, data), [entry.payload, author, data])
  const { layout, pdf } = useLabelPdf(content, entry.payload.copies, heightMm)
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10">
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Réimprimer l’étiquette corrigée</h1>
        <p className="mt-1 mb-5 text-[16px] text-fg-muted">La correction est enregistrée. Remplacez l’ancienne étiquette sur le produit.</p>
        {layout && <LabelPaper layout={layout} heightMm={heightMm} title={`Aperçu de l’étiquette ${entry.payload.name}`} />}
      </div>
      <div className="flex flex-col gap-2 md:pt-14">
        <PrintButtons pdf={pdf} name={entry.payload.name} onPrinted={() => {}} />
        <Button variant="ghost" block onClick={onDone}>
          Terminé
        </Button>
        {layout && <LabelPrintSheet layout={layout} copies={entry.payload.copies} heightMm={heightMm} />}
      </div>
    </div>
  )
}
