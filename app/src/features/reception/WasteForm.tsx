// Pertes / produits jetés (type `waste`) : produit, lot, quantité, motif, photo, lien vers la réception.
import { useMemo, useState } from 'react'
import type { WastePayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Button, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconWaste } from '../../ui/icons.tsx'
import { PhotoPicker } from '../../ui/photos/Photos.tsx'
import { chipClass, EntryLayout, ErrorNotice, ProductField, StickyActions, useRecordSaver } from '../processes/common.tsx'
import { matchingReceptions, PHOTOS_PER_FIELD, supplierNameOf, supplierProducts, WASTE_REASON_LABELS, WASTE_REASON_ORDER, type WasteReason } from './model.ts'
import type { ReceptionData } from './useReceptionData.ts'

export function WasteForm({ data, onSaved, onCancel }: { data: ReceptionData; onSaved: (rec: HaccpRecord) => void; onCancel: () => void }) {
  const core = useCore()
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [product, setProduct] = useState('')
  const [lot, setLot] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<WasteReason | null>(null)
  const [comment, setComment] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [related, setRelated] = useState<string | null>(null)
  const supplierName = supplierNameOf(data.suppliers)

  const suggestions = useMemo(() => supplierProducts(data.receptions, null).map((s) => s.product), [data.receptions])
  const matches = useMemo(() => matchingReceptions(data.receptions, product).slice(0, 6), [data.receptions, product])
  const lots = useMemo(() => {
    const p = product.trim().toLocaleLowerCase('fr-FR')
    const out = new Set<string>()
    for (const e of matches) for (const i of e.payload.items) if (i.lot && i.product.trim().toLocaleLowerCase('fr-FR') === p) out.add(i.lot)
    return [...out].slice(0, 6)
  }, [matches, product])

  const commentRequired = reason === 'other'
  const missing: string[] = []
  if (!product.trim()) missing.push('le produit')
  if (!reason) missing.push('le motif')
  if (commentRequired && !comment.trim()) missing.push('le commentaire')

  const submit = async () => {
    if (missing.length || !reason) return
    const payload: WastePayload = { product: product.trim(), reason }
    if (lot.trim()) payload.lot = lot.trim()
    if (quantity.trim()) payload.quantity = quantity.trim()
    if (comment.trim()) payload.comment = comment.trim()
    if (related && matches.some((m) => m.latest.id === related || m.id === related)) payload.related_record_id = related
    if (photos.length) payload.photo_paths = photos
    const rec = await save('waste', { ...payload })
    if (!rec) return
    toast(`Perte enregistrée : ${payload.product}`, 'ok')
    onSaved(rec)
  }

  return (
    <EntryLayout
      left={
        <>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <IconWaste size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Perte / produit jeté</h1>
              <p className="text-[16px] text-fg-muted">Produit non conforme découvert après la réception, date dépassée, rappel…</p>
            </div>
          </div>
          <div className="mt-6 space-y-6">
            <ProductField
              value={product}
              onChange={(v) => {
                setProduct(v)
                setRelated(null)
              }}
              suggestions={suggestions}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="N° de lot (facultatif)"
                value={lot}
                onChange={setLot}
                maxLength={LIMITS.lotMax}
                autoCapitalize="characters"
                below={
                  lots.length > 0 && (
                    <div role="group" aria-label="Lots reçus" className="mt-2 flex flex-wrap gap-2">
                      {lots.map((l) => (
                        <button key={l} type="button" className={chipClass(lot === l)} aria-pressed={lot === l} onClick={() => setLot(l)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  )
                }
              />
              <TextField label="Quantité (facultatif)" value={quantity} onChange={setQuantity} maxLength={LIMITS.quantityMax} placeholder="Ex. : 2 kg, 6 pièces" />
            </div>
            <div role="radiogroup" aria-label="Motif">
              <p className="mb-2 text-[15px] font-semibold text-fg">Motif</p>
              <div className="flex flex-wrap gap-2">
                {WASTE_REASON_ORDER.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={reason === r} className={chipClass(reason === r)} onClick={() => setReason(r)}>
                    {WASTE_REASON_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="waste-comment" className="mb-1.5 block text-[15px] font-semibold text-fg">
                Commentaire {commentRequired ? '(obligatoire)' : '(facultatif)'}
              </label>
              <textarea
                id="waste-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={LIMITS.wasteCommentMax}
                rows={3}
                aria-required={commentRequired || undefined}
                className="block w-full resize-y rounded-xl border border-line-strong bg-elevated px-4 py-3 text-[17px] text-fg transition-colors focus:border-accent"
              />
            </div>
          </div>
        </>
      }
      right={
        <div className="space-y-6">
          <PhotoPicker label="Photo" hint="Facultatif : produit, étiquette, défaut constaté." paths={photos} onChange={setPhotos} max={PHOTOS_PER_FIELD} />
          {matches.length > 0 && (
            <div role="radiogroup" aria-label="Réception concernée (facultatif)">
              <p className="mb-2 text-[15px] font-semibold text-fg">Réception concernée (facultatif)</p>
              <div className="grid gap-2">
                {matches.map((m) => {
                  const on = related === m.latest.id
                  const lotsOf = m.payload.items.filter((i) => i.lot).map((i) => i.lot)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setRelated(on ? null : m.latest.id)}
                      className={`min-h-14 rounded-xl border-2 px-4 py-2.5 text-left text-[15px] transition-colors active:bg-pressed ${on ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                    >
                      <span className="block font-semibold text-fg">{supplierName(m.payload.supplier_id)}</span>
                      <span className="block text-fg-muted">
                        {formatDateTime(m.time, data.timeZone)}
                        {lotsOf.length ? ` · lot ${lotsOf.slice(0, 2).join(', ')}` : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={missing.length > 0 || busy} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : 'Enregistrer la perte'}
            </Button>
            {missing.length > 0 && <p className="text-[14px] text-fg-subtle">À indiquer : {missing.join(', ')}.</p>}
            <Button
              variant="ghost"
              block
              onClick={() => {
                for (const p of photos) void core.discardPhoto(p).catch(() => false)
                onCancel()
              }}
            >
              Annuler
            </Button>
          </StickyActions>
        </div>
      }
    />
  )
}
