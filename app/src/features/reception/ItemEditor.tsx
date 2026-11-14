// Saisie d'une ligne de livraison : produit, lot, DLC/DDM, conservation, température, photos, décision.
import { useState, type ReactNode } from 'react'
import type { ReceptionItem } from '../../../../shared/payloads.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Button, Notice, TemperatureInput, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconBan, IconCheck, IconFridge, IconOk, IconSnowflake, IconBox, IconWarn, type IconProps } from '../../ui/icons.tsx'
import { PhotoPicker } from '../../ui/photos/Photos.tsx'
import { describeThreshold, formatTemperature } from '../../ui/temperature.ts'
import { chipClass, ProductField, StickyActions } from '../processes/common.tsx'
import { receptionExtensions, type LabelReading } from './extensions.ts'
import { frenchDate, isOutOfRange, PHOTOS_PER_FIELD, REFUSAL_QUICK_REASONS, STORAGE_LABELS, STORAGE_ORDER, storageThreshold, type Storage } from './model.ts'

/** Ligne en cours de saisie (clé locale + action corrective à prévoir). */
export interface DraftItem extends ReceptionItem {
  key: string
  /** Acceptée hors température en connaissance de cause : action corrective obligatoire après l'enregistrement. */
  needsAction?: boolean
}

const STORAGE_ICONS: Record<Storage, (p: IconProps) => ReactNode> = { fridge: IconFridge, freezer: IconSnowflake, ambient: IconBox }

export function StorageIcon({ storage, ...p }: IconProps & { storage: Storage }) {
  const I = STORAGE_ICONS[storage]
  return <I {...p} />
}

interface Props {
  item: DraftItem | null
  suggestions: { product: string; storage: Storage }[]
  /** Photos encore autorisées pour toute la réception, en plus de celles de cette ligne. */
  remainingPhotos: number
  /** Date du jour (AAAA-MM-JJ) : DLC dépassée signalée. */
  today: string
  /** Chemins déjà enregistrés (version précédente) : jamais effacés de l'appareil. */
  keepPhotos: readonly string[]
  onSave: (item: DraftItem) => void
  onCancel: () => void
}

export function ItemEditor({ item, suggestions, remainingPhotos, today, keepPhotos, onSave, onCancel }: Props) {
  const ext = receptionExtensions()
  const core = useCore()
  const [product, setProduct] = useState(item?.product ?? '')
  const [lot, setLot] = useState(item?.lot ?? '')
  const [dateKind, setDateKind] = useState<'dlc' | 'ddm'>(item?.ddm && !item.dlc ? 'ddm' : 'dlc')
  const [date, setDate] = useState(item?.dlc ?? item?.ddm ?? '')
  const [gtin, setGtin] = useState(item?.gtin ?? '')
  const [storage, setStorage] = useState<Storage>(item?.storage ?? 'fridge')
  const [temp, setTemp] = useState<number | null>(item?.temperature_c ?? null)
  const [photos, setPhotos] = useState<string[]>(item?.photo_paths ?? [])
  const [decision, setDecision] = useState<'accepted' | 'refused' | null>(item ? (item.accepted ? 'accepted' : 'refused') : null)
  const [reason, setReason] = useState(item?.refusal_reason ?? '')
  const [confirmOut, setConfirmOut] = useState(false)
  const [readFrom, setReadFrom] = useState<string[] | null>(null)

  const threshold = storageThreshold(storage)
  const needsTemp = threshold !== null
  const out = needsTemp && temp !== null && isOutOfRange({ storage, temperature_c: temp })
  const expired = dateKind === 'dlc' && date !== '' && date < today

  const missing: string[] = []
  if (!product.trim()) missing.push('le produit')
  if (needsTemp && temp === null) missing.push('la température')
  if (decision === null) missing.push('la décision (accepté ou refusé)')
  if (decision === 'refused' && !reason.trim()) missing.push('le motif du refus')

  const build = (over: Partial<DraftItem> = {}): DraftItem => {
    const it: DraftItem = { key: item?.key ?? crypto.randomUUID(), product: product.trim(), storage, accepted: decision !== 'refused' }
    if (lot.trim()) it.lot = lot.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) it[dateKind] = date
    if (gtin) it.gtin = gtin
    if (needsTemp && temp !== null) it.temperature_c = temp
    if (photos.length) it.photo_paths = photos
    if (decision === 'refused') it.refusal_reason = reason.trim()
    return { ...it, ...over }
  }

  const submit = () => {
    if (missing.length) return
    if (decision === 'accepted' && out) return setConfirmOut(true)
    onSave(build())
  }

  const onLabelPhoto = async (_path: string, image: Blob) => {
    if (!ext.readLabel) return
    const r: LabelReading | null = await ext.readLabel(image).catch(() => null)
    if (!r) return
    const filled: string[] = []
    if (r.product && !product.trim()) {
      setProduct(r.product)
      filled.push('produit')
    }
    if (r.lot && !lot.trim()) {
      setLot(r.lot)
      filled.push('lot')
    }
    if ((r.dlc || r.ddm) && !date) {
      setDateKind(r.dlc ? 'dlc' : 'ddm')
      setDate((r.dlc ?? r.ddm)!)
      filled.push(r.dlc ? 'DLC' : 'DDM')
    }
    if (r.gtin && !gtin) {
      setGtin(r.gtin)
      filled.push('code-barres')
    }
    if (filled.length) setReadFrom(filled)
  }

  const choiceClass = (active: boolean, tone: 'ok' | 'danger') =>
    `flex min-h-16 flex-1 items-center justify-center gap-2.5 rounded-2xl border-2 px-4 text-[18px] font-semibold transition-colors active:bg-pressed ${
      active ? (tone === 'ok' ? 'border-ok bg-ok-soft text-ok' : 'border-danger bg-danger-soft text-danger') : 'border-line-strong bg-elevated text-fg'
    }`

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-6">
        <h2 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg">{item ? 'Modifier le produit' : 'Ajouter un produit'}</h2>
        <ProductField
          value={product}
          onChange={(v) => {
            setProduct(v)
            const s = suggestions.find((x) => x.product === v)
            if (s && !item) setStorage(s.storage)
          }}
          suggestions={suggestions.map((s) => s.product)}
        />
        {readFrom && <Notice tone="warn">Lu sur l’étiquette : {readFrom.join(', ')}. Vérifiez avant de valider.</Notice>}
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="N° de lot" value={lot} onChange={setLot} maxLength={LIMITS.lotMax} placeholder="Ex. : L2311A" autoCapitalize="characters" />
          <div>
            <div role="radiogroup" aria-label="Type de date" className="mb-1.5 flex gap-1 rounded-lg bg-sunken p-0.5 text-[14px] font-semibold">
              {(['dlc', 'ddm'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={dateKind === k}
                  onClick={() => setDateKind(k)}
                  className={`min-h-9 flex-1 rounded-md px-2 ${dateKind === k ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted'}`}
                >
                  {k === 'dlc' ? 'DLC (à consommer jusqu’au)' : 'DDM (de préférence avant)'}
                </button>
              ))}
            </div>
            <TextField label={dateKind === 'dlc' ? 'DLC' : 'DDM'} type="date" value={date} onChange={setDate} />
          </div>
        </div>
        {expired && <Notice>DLC dépassée ({frenchDate(date)}) : ce produit doit être refusé.</Notice>}
        {ext.scanBarcode && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={async () => setGtin((await ext.scanBarcode!().catch(() => null)) ?? gtin)}>
              Scanner le code-barres
            </Button>
            {gtin && <span className="text-[15px] text-fg-muted tabular-nums">GTIN {gtin}</span>}
          </div>
        )}

        <div role="radiogroup" aria-label="Conservation">
          <p className="mb-2 text-[15px] font-semibold text-fg">Conservation</p>
          <div className="flex flex-wrap gap-2">
            {STORAGE_ORDER.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={storage === s} className={`${chipClass(storage === s)} inline-flex items-center gap-2`} onClick={() => setStorage(s)}>
                <StorageIcon storage={s} size={18} />
                {STORAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <PhotoPicker
          label="Photos de l’étiquette"
          hint="Lot et date bien lisibles. Facultatif."
          paths={photos}
          onChange={setPhotos}
          max={PHOTOS_PER_FIELD}
          remaining={remainingPhotos}
          keep={keepPhotos}
          onAdded={onLabelPhoto}
        />

        <div role="radiogroup" aria-label="Décision">
          <p className="mb-2 text-[15px] font-semibold text-fg">Décision</p>
          <div className="flex gap-3">
            <button type="button" role="radio" aria-checked={decision === 'accepted'} className={choiceClass(decision === 'accepted', 'ok')} onClick={() => setDecision('accepted')}>
              <IconOk size={22} /> Accepté
            </button>
            <button type="button" role="radio" aria-checked={decision === 'refused'} className={choiceClass(decision === 'refused', 'danger')} onClick={() => setDecision('refused')}>
              <IconBan size={22} /> Refusé
            </button>
          </div>
        </div>
        {decision === 'refused' && (
          <TextField
            label="Motif du refus (obligatoire)"
            value={reason}
            onChange={setReason}
            maxLength={LIMITS.refusalReasonMax}
            autoCapitalize="sentences"
            below={
              <div className="mt-2 flex flex-wrap gap-2">
                {REFUSAL_QUICK_REASONS.map((q) => (
                  <button key={q} type="button" className={chipClass(reason === q)} aria-pressed={reason === q} onClick={() => setReason(q)}>
                    {q}
                  </button>
                ))}
              </div>
            }
          />
        )}
      </div>

      <div className="min-w-0">
        {threshold ? (
          <TemperatureInput label="Température à réception" value={temp} onChange={setTemp} threshold={threshold} />
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-4 text-[16px] text-fg-muted shadow-card">Produit ambiant : pas de contrôle de température.</p>
        )}
        {threshold && <p className="mt-1 max-w-sm text-[14px] text-fg-subtle">Seuil {STORAGE_LABELS[storage].toLowerCase()} {describeThreshold(threshold)} : valeur proposée, à confirmer selon votre PMS.</p>}
        {confirmOut && decision === 'accepted' && out ? (
          <div role="alert" className="mt-4 max-w-sm rounded-2xl border-2 border-danger bg-danger-soft p-4">
            <p className="flex items-start gap-2 text-[18px] font-bold text-danger">
              <IconWarn size={24} className="mt-0.5 shrink-0" />
              Température hors seuil : {formatTemperature(temp!)}
            </p>
            <p className="mt-1 text-[15px] text-fg">
              Seuil {describeThreshold(threshold!)}. Refusez le produit, ou acceptez-le en enregistrant une action corrective juste après la réception.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="danger" block icon={<IconBan size={20} />} onClick={() => onSave(build({ accepted: false, refusal_reason: `Température non conforme (${formatTemperature(temp!)})` }))}>
                Refuser ce produit
              </Button>
              <Button variant="secondary" block onClick={() => onSave(build({ needsAction: true }))}>
                Accepter avec action corrective
              </Button>
              <Button variant="ghost" block onClick={() => setConfirmOut(false)}>
                Revenir à la saisie
              </Button>
            </div>
          </div>
        ) : (
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={missing.length > 0} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              Valider ce produit
            </Button>
            {missing.length > 0 && <p className="text-[14px] text-fg-subtle">À indiquer : {missing.join(', ')}.</p>}
            <Button
              variant="ghost"
              block
              onClick={() => {
                // Photos prises pendant cette saisie abandonnée : effacées (brouillons).
                const before = new Set([...(item?.photo_paths ?? []), ...keepPhotos])
                for (const p of photos) if (!before.has(p)) void core.discardPhoto(p).catch(() => false)
                onCancel()
              }}
            >
              Annuler
            </Button>
          </StickyActions>
        )}
      </div>
    </div>
  )
}
