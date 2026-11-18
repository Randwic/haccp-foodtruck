// Étape 2 d'un parcours : aperçu fidèle + DLC modifiable, lot, copies, puis impression et « Imprimé ? ».
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LabelPrintedPayload, Product, Recipe } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Button, Modal, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { initials } from '../../ui/format.ts'
import { IconCheck, IconCopies, IconInfo, IconMinus, IconPlus, IconPrint, IconWarn } from '../../ui/icons.tsx'
import { chipClass, EntryLayout, ErrorNotice, useRecordSaver } from '../processes/common.tsx'
import { useLabelHeightMm } from './labelSettings.ts'
import { LabelPaper, LabelPrintSheet, printSheet, useLabelFonts, useLabelLayout } from './LabelPreview.tsx'
import {
  computeDlc,
  dlcProblem,
  formatLabelDateTime,
  formatShelfLife,
  fromLocalInputs,
  internalLot,
  KIND_MADE_LABEL,
  recentLots,
  recipeAllergens,
  recipeTraces,
  toLocalInputs,
  weekdayOf,
  type LabelContent,
  type LabelKind,
} from './model.ts'
import { productTraces } from './allergens.ts'
import { buildLabelPdf } from './pdf.ts'
import { canSharePdf, pdfFilename, sharePdf } from './printing.ts'
import type { LabelData } from './useLabelData.ts'

/**
 * Enregistrer les traces imprimées (`may_contain`) dans le registre. À passer à true SEULEMENT après avoir
 * redéployé les fonctions Supabase (nouveau validateur) : sinon le serveur met l'étiquette en quarantaine.
 * Fonctions redéployées le 18/11/2026 (validateur à jour) : activé.
 */
export const LABEL_TRACES_IN_REGISTRY = true

/** Ce que le parcours a choisi à l'étape 1. */
export interface LabelDraft {
  kind: LabelKind
  product?: Product
  recipe?: Recipe
  /** Ouverture / fabrication / fin de décongélation. */
  madeAt: Date
  /** DLC proposée (modifiable) ; null = DLC du fabricant à saisir (produit « selon l'étiquette »). */
  dlc: Date | null
  /** Origine de la DLC proposée, affichée (« ouverture + 2 jours »). */
  dlcOrigin: string
  /** Enregistrements amont déjà connus (décongélation reprise du module Procédés). */
  sourceIds: string[]
  /** Libellé libre d'une décongélation reprise (si aucun produit du catalogue ne correspond). */
  thawProductName?: string
}

/** Mention sous le champ de DLC quand elle est lue sur l'emballage. */
export const MANUFACTURER_DLC_ORIGIN = 'DLC du fabricant, lue sur l’emballage'

export function draftFor(kind: LabelKind, item: Product | Recipe, now: Date): LabelDraft {
  const madeAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  if (kind === 'prepared') {
    const r = item as Recipe
    const h = r.shelf_life_hours ?? 0
    return { kind, recipe: r, madeAt, dlc: computeDlc(madeAt, h), dlcOrigin: `préparation + ${formatShelfLife(h)}`, sourceIds: [] }
  }
  const p = item as Product
  // Ouverture d'un produit « selon l'étiquette du fabricant » : pas de DLC calculée, elle est saisie à la main.
  if (kind === 'opened' && p.shelf_life_opened_hours === null) return { kind, product: p, madeAt, dlc: null, dlcOrigin: MANUFACTURER_DLC_ORIGIN, sourceIds: [] }
  const hours = kind === 'opened' ? p.shelf_life_opened_hours! : p.shelf_life_thawed_hours!
  return { kind, product: p, madeAt, dlc: computeDlc(madeAt, hours), dlcOrigin: `${kind === 'opened' ? 'ouverture' : 'décongélation'} + ${formatShelfLife(hours)}`, sourceIds: [] }
}

const COPIES_MAX = LIMITS.labelCopiesMax

export function CopiesStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const btn =
    'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-elevated text-fg shadow-card transition-transform active:scale-[0.96] active:bg-pressed disabled:opacity-40'
  return (
    <div>
      <p id="copies-label" className="mb-1.5 text-[15px] font-semibold text-fg">
        Nombre d’étiquettes
      </p>
      <div role="group" aria-labelledby="copies-label" className="flex items-center gap-3">
        <button type="button" className={btn} onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="Une étiquette de moins">
          <IconMinus size={22} />
        </button>
        <output aria-live="polite" className="min-w-16 text-center text-[26px] font-bold text-fg tabular-nums">
          {value}
        </output>
        <button type="button" className={btn} onClick={() => onChange(Math.min(COPIES_MAX, value + 1))} disabled={value >= COPIES_MAX} aria-label="Une étiquette de plus">
          <IconPlus size={22} />
        </button>
      </div>
    </div>
  )
}

/** Champs date + heure (heure locale de l'établissement). */
export function DlcFields({
  date,
  time,
  onDate,
  onTime,
  error,
  legend = 'À consommer jusqu’au',
  timeOptional = false,
}: {
  date: string
  time: string
  onDate: (v: string) => void
  onTime: (v: string) => void
  error?: string | null
  legend?: string
  /** Heure facultative (DLC du fabricant) : vide = 23:59. */
  timeOptional?: boolean
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[15px] font-semibold text-fg">{legend}</legend>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
        <input
          type="date"
          aria-label="Date limite de consommation"
          value={date}
          onChange={(e) => onDate(e.target.value)}
          className={`min-h-14 w-full min-w-0 rounded-xl border bg-elevated px-3 text-[17px] text-fg tabular-nums focus:border-accent ${error ? 'border-danger' : 'border-line-strong'}`}
        />
        <input
          type="time"
          step={60}
          aria-label={timeOptional ? 'Heure limite de consommation (facultative)' : 'Heure limite de consommation'}
          value={time}
          onChange={(e) => onTime(e.target.value)}
          className={`min-h-14 w-full min-w-0 rounded-xl border bg-elevated px-3 text-[17px] text-fg tabular-nums focus:border-accent ${error ? 'border-danger' : 'border-line-strong'}`}
        />
      </div>
      {timeOptional && <p className="mt-1.5 text-[14px] text-fg-muted">Heure facultative : sans heure, la DLC court jusqu’à 23:59.</p>}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[15px] font-medium text-danger">
          <IconWarn size={18} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Génère le PDF dès que l'aperçu change (le partage iOS doit partir pendant le toucher). */
export function useLabelPdf(content: LabelContent | null, copies: number, heightMm: number) {
  const { fonts, error: fontError } = useLabelFonts()
  const layout = useLabelLayout(content, heightMm, fonts)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; key: string } | null>(null)
  const key = layout ? `${JSON.stringify(content)}|${copies}|${heightMm}` : ''
  useEffect(() => {
    if (!layout || !fonts) return
    let alive = true
    const t = setTimeout(() => {
      buildLabelPdf(layout, copies, fonts, content ? `Étiquette – ${content.name}` : undefined).then(
        (bytes) => alive && setPdf({ bytes, key }),
        () => {},
      )
    }, 150)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [layout, fonts, copies, key, content])
  return { layout, fontError, pdf: pdf && pdf.key === key ? pdf.bytes : null }
}

/** Boutons d'impression (partage → Imprimer, ou impression directe) ; `onPrinted` après l'action. */
export function PrintButtons({ pdf, name, disabled, onPrinted }: { pdf: Uint8Array | null; name: string; disabled?: boolean; onPrinted: () => void }) {
  const toast = useToast()
  const share = canSharePdf()
  const print = async () => {
    if (!pdf) return
    try {
      const out = await sharePdf(pdf, pdfFilename('etiquette', name), `Étiquette – ${name}`)
      if (out !== 'cancelled') onPrinted()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }
  return (
    <>
      <Button size="lg" block onClick={print} disabled={disabled || !pdf} icon={<IconPrint size={22} />}>
        {!pdf ? 'Préparation du PDF…' : share ? 'Imprimer / Partager' : 'Imprimer (PDF)'}
      </Button>
      <Button
        variant="secondary"
        block
        disabled={disabled}
        onClick={() => {
          printSheet('labels')
          onPrinted()
        }}
      >
        Impression directe
      </Button>
    </>
  )
}

export function LabelEditor({ draft, data, onCancel, onSaved, header }: { draft: LabelDraft; data: LabelData; onCancel: () => void; onSaved: (rec: HaccpRecord) => void; header: ReactNode }) {
  const core = useCore()
  const toast = useToast()
  const tz = data.timeZone
  const heightMm = useLabelHeightMm()
  const { save, busy, error } = useRecordSaver()
  const staff = core.currentStaff()
  const operator = staff ? initials(staff.display_name) : '?'

  const [productId, setProductId] = useState<string | null>(draft.product?.id ?? null)
  const product = draft.kind === 'prepared' ? undefined : data.products.find((p) => p.id === productId)
  const recipe = draft.recipe
  const manual = draft.dlc === null
  const initial = draft.dlc ? toLocalInputs(draft.dlc, tz) : { date: '', time: '' }
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [lot, setLot] = useState('')
  const [lotSource, setLotSource] = useState<string | null>(null)
  const [copies, setCopies] = useState(1)
  const [confirm, setConfirm] = useState(false)

  // DLC du fabricant : date obligatoire, heure facultative (fin de journée).
  const dlc = manual && !date ? null : fromLocalInputs(date, manual && !time ? '23:59' : time, tz)
  const problem = manual && !date ? 'Saisissez la DLC lue sur l’emballage avant d’imprimer.' : dlcProblem(draft.madeAt, dlc)
  const name = (recipe?.name ?? product?.name ?? draft.thawProductName ?? '').slice(0, LIMITS.labelNameMax)
  const allergens = useMemo(() => (recipe ? recipeAllergens(recipe, data.products, data.recipes) : (product?.allergens ?? [])), [recipe, product, data.products, data.recipes])
  const traces = useMemo(
    () => (recipe ? recipeTraces(recipe, data.products, data.recipes) : productTraces(product ?? { allergens: [], may_contain: [] })),
    [recipe, product, data.products, data.recipes],
  )
  const storage = recipe?.storage ?? (draft.kind === 'thawed' ? 'fridge' : (product?.storage ?? 'fridge'))
  const lots = useMemo(() => (product ? recentLots(data.receptions, product.name) : draft.thawProductName ? recentLots(data.receptions, draft.thawProductName) : []), [product, draft.thawProductName, data.receptions])
  const trimmedLot = lot.trim().slice(0, LIMITS.lotMax)

  const content = useMemo<LabelContent | null>(
    () =>
      name && dlc && !problem
        ? { kind: draft.kind, name, madeAt: draft.madeAt.toISOString(), dlcAt: dlc.toISOString(), storage, allergens, traces, lot: trimmedLot || undefined, operator, timeZone: tz }
        : null,
    [name, dlc?.getTime(), problem, draft.kind, draft.madeAt, storage, allergens, traces, trimmedLot, operator, tz],
  )
  const { layout, pdf, fontError } = useLabelPdf(content, copies, heightMm)
  const needsProduct = draft.kind !== 'prepared' && !product
  const ready = !!content && !needsProduct && !busy

  const payload = (): LabelPrintedPayload | null => {
    if (!content) return null
    const sources = [...new Set([...draft.sourceIds, ...(lotSource ? [lotSource] : [])])]
    const p: LabelPrintedPayload = {
      kind: draft.kind,
      name: content.name,
      made_at: content.madeAt,
      dlc_at: content.dlcAt,
      allergens: content.allergens,
      storage: content.storage,
      copies,
    }
    if (draft.kind === 'prepared') p.recipe_id = recipe!.id
    else p.product_id = product!.id
    if (LABEL_TRACES_IN_REGISTRY && content.traces?.length) p.may_contain = [...content.traces]
    if (content.lot) p.lot = content.lot
    if (sources.length) p.source_record_ids = sources.slice(0, LIMITS.labelSourceRecordsMax)
    return p
  }

  const record = async () => {
    const p = payload()
    if (!p) return
    const rec = await save('label_printed', { ...p })
    if (!rec) return
    setConfirm(false)
    toast(`${copies > 1 ? `${copies} étiquettes enregistrées` : 'Étiquette enregistrée'} : ${p.name}`, 'ok')
    onSaved(rec)
  }

  const madeLabel = `${KIND_MADE_LABEL[draft.kind]} ${formatLabelDateTime(draft.madeAt, tz).replace(' ', ' à ')}`

  return (
    <EntryLayout
      left={
        <>
          {header}
          <p className="mt-1 text-[16px] text-fg-muted">{madeLabel}</p>
          <div className="mt-5">
            {layout ? (
              <LabelPaper layout={layout} heightMm={heightMm} title={`Aperçu de l’étiquette ${name}`} />
            ) : fontError ? (
              <Notice>Aperçu impossible : {fontError}</Notice>
            ) : needsProduct ? (
              <Notice tone="warn">Choisissez le produit du catalogue correspondant pour imprimer l’étiquette (allergènes).</Notice>
            ) : manual && !date ? (
              <Notice tone="info">Saisissez la DLC indiquée sur l’emballage du fabricant : l’aperçu s’affiche ensuite.</Notice>
            ) : problem ? null : (
              <div className="mx-auto aspect-[62/50] w-full max-w-[26rem] animate-pulse rounded-[6px] bg-sunken" aria-label="Préparation de l’aperçu" />
            )}
            {layout?.overflow && (
              <div className="mt-3">
                <Notice tone="warn">Le texte est serré sur une étiquette de {heightMm} mm : le gérant peut augmenter la hauteur dans Gestion › Réglages.</Notice>
              </div>
            )}
          </div>
        </>
      }
      right={
        <div className="space-y-6">
          {needsProduct && (
            <div role="radiogroup" aria-label="Produit du catalogue">
              <p className="mb-2 text-[15px] font-semibold text-fg">Produit du catalogue</p>
              <div className="flex flex-wrap gap-2">
                {data.products
                  .filter((p) => p.active)
                  .map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={productId === p.id} className={chipClass(productId === p.id)} onClick={() => setProductId(p.id)}>
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div>
            {manual && (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-warn/35 bg-warn-soft px-4 py-3 text-[15px] leading-snug text-fg">
                <IconInfo size={20} className="mt-px shrink-0 text-warn" />
                <span>
                  Durée après ouverture <span className="font-semibold">selon l’étiquette du fabricant</span> : recopiez la date limite indiquée sur l’emballage (après ouverture).
                </span>
              </p>
            )}
            <DlcFields
              date={date}
              time={time}
              onDate={setDate}
              onTime={setTime}
              legend={manual ? 'DLC lue sur l’emballage' : undefined}
              timeOptional={manual}
              error={problem && (date || time) ? problem : null}
            />
            <p className="mt-2 text-[15px] text-fg-muted">
              {dlc && !problem ? (
                <>
                  <span className="font-semibold text-fg">{weekdayOf(dlc, tz).replace(/^./, (c) => c.toUpperCase())}</span> · {manual ? draft.dlcOrigin : `proposée : ${draft.dlcOrigin}`}
                </>
              ) : manual ? (
                <>Obligatoire avant l’impression.</>
              ) : (
                <>Proposée : {draft.dlcOrigin}</>
              )}
              {!manual && (date !== initial.date || time !== initial.time) && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="font-semibold text-accent underline"
                    onClick={() => {
                      setDate(initial.date)
                      setTime(initial.time)
                    }}
                  >
                    Rétablir
                  </button>
                </>
              )}
            </p>
          </div>

          <TextField
            label="N° de lot (facultatif)"
            value={lot}
            onChange={(v) => {
              setLot(v)
              setLotSource(lots.find((l) => l.lot === v.trim())?.receptionId ?? null)
            }}
            maxLength={LIMITS.lotMax}
            autoCapitalize="characters"
            below={
              (lots.length > 0 || draft.kind === 'prepared') && (
                <div role="group" aria-label="Lots proposés" className="mt-2.5 flex flex-wrap gap-2">
                  {lots.map((l) => (
                    <button
                      key={l.lot}
                      type="button"
                      className={chipClass(lotSource === l.receptionId && lot.trim() === l.lot)}
                      aria-pressed={lotSource === l.receptionId && lot.trim() === l.lot}
                      aria-label={`Lot ${l.lot}, reçu le ${formatLabelDateTime(l.receivedAt, tz).slice(0, 5)}`}
                      onClick={() => {
                        setLot(l.lot)
                        setLotSource(l.receptionId)
                      }}
                    >
                      {l.lot}
                      <span className="ml-1.5 font-normal opacity-80">reçu {formatLabelDateTime(l.receivedAt, tz).slice(0, 5)}</span>
                    </button>
                  ))}
                  {draft.kind === 'prepared' && (
                    <button
                      type="button"
                      className={chipClass(lot === internalLot(draft.madeAt, tz))}
                      aria-pressed={lot === internalLot(draft.madeAt, tz)}
                      onClick={() => {
                        setLot(internalLot(draft.madeAt, tz))
                        setLotSource(null)
                      }}
                    >
                      Lot interne {internalLot(draft.madeAt, tz)}
                    </button>
                  )}
                </div>
              )
            }
          />

          <CopiesStepper value={copies} onChange={setCopies} />

          <ErrorNotice error={error} />
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 bg-canvas/95 px-4 pt-2 pb-3 backdrop-blur-sm">
            <PrintButtons pdf={pdf} name={name} disabled={!ready} onPrinted={() => setConfirm(true)} />
            <Button variant="ghost" block onClick={onCancel}>
              Annuler
            </Button>
          </div>
          {layout && <LabelPrintSheet layout={layout} copies={copies} heightMm={heightMm} />}

          <Modal
            open={confirm}
            title="Étiquette imprimée ?"
            onClose={() => setConfirm(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
                  Non, pas encore
                </Button>
                <Button onClick={record} disabled={busy} icon={<IconCheck size={20} />}>
                  {busy ? 'Enregistrement…' : 'Oui, enregistrer'}
                </Button>
              </>
            }
          >
            <p className="flex items-center gap-2 text-[17px] text-fg">
              <IconCopies size={20} className="shrink-0 text-fg-subtle" />
              <span>
                <span className="font-semibold">
                  {copies} × {name}
                </span>{' '}
                — DLC {dlc ? formatLabelDateTime(dlc, tz).replace(' ', ' à ') : ''}
              </span>
            </p>
            <p className="mt-3 text-[15px] text-fg-muted">L’étiquette est enregistrée dans le registre (traçabilité) seulement si elle est bien sortie de l’imprimante.</p>
            <ErrorNotice error={error} />
          </Modal>
        </div>
      }
    />
  )
}
