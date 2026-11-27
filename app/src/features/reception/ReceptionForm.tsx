// Parcours guidé d'une réception (achats faits par le gérant : cash & carry, grossiste) :
// 1. Approvisionnement → 2. Produits → 3. Validation. Libellés seulement : le contrat `reception` est inchangé.
// Sert aussi à la correction (pré-rempli, motif obligatoire ; l'original reste dans le registre).
import { useMemo, useState, type ReactNode } from 'react'
import type { ReceptionItem, ReceptionPayload, Supplier } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import type { PhotoStatus } from '../../core/api.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconBan, IconCheck, IconChevronRight, IconEdit, IconError, IconOk, IconPlus, IconSupplier, IconWarn } from '../../ui/icons.tsx'
import { PhotoGallery, PhotoPicker } from '../../ui/photos/Photos.tsx'
import { formatTemperature } from '../../ui/temperature.ts'
import { BackButton, ErrorNotice, ReasonField, useRecordSaver } from '../processes/common.tsx'
import { ItemEditor, StorageIcon, type DraftItem } from './ItemEditor.tsx'
import { frenchDate, isOutOfRange, PHOTOS_PER_FIELD, RECEPTION_MAX_PHOTOS, productsByGtin, STORAGE_LABELS, supplierProducts, todayIso, type ReceptionEntry } from './model.ts'
import { NewSupplierModal } from './NewSupplierModal.tsx'
import type { ReceptionData } from './useReceptionData.ts'

type Step = 'delivery' | 'items' | 'review'
const STEPS: { id: Step; label: string }[] = [
  { id: 'delivery', label: 'Approvisionnement' },
  { id: 'items', label: 'Produits' },
  { id: 'review', label: 'Validation' },
]

interface Draft {
  supplierId: string | null
  deliveryNote: string
  vehicleOk: boolean | null
  packagingOk: boolean | null
  notePhotos: string[]
  items: DraftItem[]
  comment: string
}

function draftOf(e: ReceptionEntry | undefined): Draft {
  if (!e) return { supplierId: null, deliveryNote: '', vehicleOk: null, packagingOk: null, notePhotos: [], items: [], comment: '' }
  const p = e.payload
  return {
    supplierId: p.supplier_id,
    deliveryNote: p.delivery_note ?? '',
    vehicleOk: p.vehicle_ok,
    packagingOk: p.packaging_ok,
    notePhotos: [...(p.photo_paths ?? [])],
    items: p.items.map((i) => ({ ...i, key: crypto.randomUUID() })),
    comment: p.comment ?? '',
  }
}

/** Payload du contrat, sans champ vide (le core refuse `undefined`). */
export function toPayload(d: Draft): ReceptionPayload {
  const items: ReceptionItem[] = d.items.map(({ key: _k, needsAction: _n, ...it }) => {
    void _k
    void _n
    const clean: ReceptionItem = { product: it.product, storage: it.storage, accepted: it.accepted }
    for (const f of ['lot', 'dlc', 'ddm', 'gtin', 'refusal_reason'] as const) if (it[f]) clean[f] = it[f]
    if (typeof it.temperature_c === 'number') clean.temperature_c = it.temperature_c
    if (it.photo_paths?.length) clean.photo_paths = [...it.photo_paths]
    return clean
  })
  const p: ReceptionPayload = { supplier_id: d.supplierId!, vehicle_ok: d.vehicleOk === true, packaging_ok: d.packagingOk === true, items }
  if (d.deliveryNote.trim()) p.delivery_note = d.deliveryNote.trim()
  if (d.notePhotos.length) p.photo_paths = [...d.notePhotos]
  if (d.comment.trim()) p.comment = d.comment.trim()
  return p
}

const countPhotos = (d: Draft) => d.notePhotos.length + d.items.reduce((n, i) => n + (i.photo_paths?.length ?? 0), 0)

interface Props {
  data: ReceptionData
  now: Date
  /** Gérant : peut créer un fournisseur pendant la saisie. */
  canAddSupplier: boolean
  /** Correction d'une réception existante. */
  correcting?: ReceptionEntry
  onSaved: (record: HaccpRecord, payload: ReceptionPayload) => void
  onCancel: () => void
}

export function ReceptionForm({ data, now, canAddSupplier, correcting, onSaved, onCancel }: Props) {
  const core = useCore()
  const { save, busy, error } = useRecordSaver()
  const [draft, setDraft] = useState<Draft>(() => draftOf(correcting))
  const [step, setStep] = useState<Step>('delivery')
  const [editing, setEditing] = useState<{ index: number | null } | null>(null)
  /** Compteur des saisies enchaînées : chaque nouveau produit repart d'un formulaire vide. */
  const [round, setRound] = useState(0)
  const [addSupplier, setAddSupplier] = useState(false)
  const [extraSuppliers, setExtraSuppliers] = useState<Supplier[]>([])
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [reason, setReason] = useState('')
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const kept = useMemo(() => (correcting ? correcting.photos : []), [correcting])
  const suppliers = useMemo(() => {
    const list = [...data.suppliers.filter((s) => s.active || s.id === draft.supplierId)]
    for (const s of extraSuppliers) if (!list.some((x) => x.id === s.id)) list.push(s)
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [data.suppliers, extraSuppliers, draft.supplierId])
  const supplier = suppliers.find((s) => s.id === draft.supplierId) ?? data.suppliers.find((s) => s.id === draft.supplierId)
  const total = countPhotos(draft)
  const today = todayIso(now, data.timeZone)
  const suggestions = useMemo(() => supplierProducts(data.receptions, draft.supplierId), [data.receptions, draft.supplierId])
  const knownGtins = useMemo(() => productsByGtin(data.receptions), [data.receptions])
  const deliveryDone = draft.supplierId !== null && draft.vehicleOk !== null && draft.packagingOk !== null
  const reached = (s: Step) => s === 'delivery' || (s === 'items' && deliveryDone) || (s === 'review' && deliveryDone && draft.items.length > 0)

  const discardNewPhotos = () => {
    const all = [...draft.notePhotos, ...draft.items.flatMap((i) => i.photo_paths ?? [])]
    for (const p of all) if (!kept.includes(p)) void core.discardPhoto(p).catch(() => false)
  }
  const cancel = () => {
    const dirty = correcting ? false : draft.supplierId !== null || draft.items.length > 0 || draft.notePhotos.length > 0
    if (dirty) setConfirmCancel(true)
    else {
      discardNewPhotos()
      onCancel()
    }
  }

  const submit = async () => {
    const payload = toPayload(draft)
    const rec = correcting
      ? await save('correction', { reason: reason.trim(), replacement: payload }, { supersedes_id: correcting.latest.id, ctx: { supersededType: 'reception' } })
      : await save('reception', { ...payload })
    if (rec) onSaved(rec, payload)
  }

  if (editing) {
    const current = editing.index === null ? null : draft.items[editing.index]
    const others = total - (current?.photo_paths?.length ?? 0)
    return (
      <ItemEditor
        key={round}
        item={current}
        suggestions={suggestions}
        catalog={data.catalog}
        knownGtins={knownGtins}
        remainingPhotos={RECEPTION_MAX_PHOTOS - others}
        today={today}
        keepPhotos={[...kept, ...(current?.photo_paths ?? [])]}
        onCancel={() => setEditing(null)}
        onSave={(it) => {
          const items = [...draft.items]
          if (editing.index === null) items.push(it)
          else items[editing.index] = it
          set({ items })
          setEditing(null)
        }}
        onSaveAndNext={
          editing.index === null && draft.items.length + 1 < LIMITS.receptionItemsMax
            ? (it) => {
                set({ items: [...draft.items, it] })
                setRound((r) => r + 1)
                window.scrollTo?.({ top: 0 })
              }
            : undefined
        }
      />
    )
  }

  const yesNo = (label: string, value: boolean | null, onChange: (v: boolean) => void, noHint: string) => (
    <div role="radiogroup" aria-label={label}>
      <p className="mb-2 text-[16px] font-semibold text-fg">{label}</p>
      <div className="flex gap-3">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 text-[17px] font-semibold transition-colors active:bg-pressed ${
              value === v ? (v ? 'border-ok bg-ok-soft text-ok' : 'border-danger bg-danger-soft text-danger') : 'border-line-strong bg-elevated text-fg'
            }`}
          >
            {v ? <IconOk size={20} /> : <IconBan size={20} />}
            {v ? 'Oui' : 'Non'}
          </button>
        ))}
      </div>
      {value === false && <p className="mt-2 text-[14px] text-warn">{noHint}</p>}
    </div>
  )

  let body: ReactNode
  if (step === 'delivery') {
    body = (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
        <section aria-labelledby="supplier-title">
          <h2 id="supplier-title" className="mb-3 text-[19px] font-semibold text-fg">
            Fournisseur / magasin
          </h2>
          {suppliers.length === 0 && (
            <p className="mb-3 rounded-2xl border border-dashed border-line-strong p-4 text-[16px] text-fg-muted">
              Aucun fournisseur ni magasin. {canAddSupplier ? 'Ajoutez-en un ci-dessous.' : 'Demandez au gérant de les ajouter dans Gestion › Fournisseurs.'}
            </p>
          )}
          <div role="radiogroup" aria-label="Fournisseur / magasin" className="grid gap-2.5 sm:grid-cols-2">
            {suppliers.map((s) => {
              const on = draft.supplierId === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ supplierId: s.id })}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 bg-surface px-4 py-3 text-left shadow-card transition-colors active:bg-pressed ${on ? 'border-accent' : 'border-line'}`}
                >
                  <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'}`}>
                    <IconSupplier size={20} />
                  </span>
                  <span className="min-w-0 flex-1 text-[17px] leading-snug font-semibold break-words text-fg">{s.name}</span>
                  {on && <IconCheck size={22} strokeWidth={2.5} className="shrink-0 text-accent" />}
                </button>
              )
            })}
            {canAddSupplier && (
              <button
                type="button"
                onClick={() => setAddSupplier(true)}
                className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong px-4 py-3 text-left text-[17px] font-semibold text-accent active:bg-pressed"
              >
                <IconPlus size={22} />
                Nouveau fournisseur / magasin
              </button>
            )}
          </div>
          <TextField
            className="mt-6 max-w-md"
            label="N° de ticket ou de facture (facultatif)"
            value={draft.deliveryNote}
            onChange={(deliveryNote) => set({ deliveryNote })}
            maxLength={LIMITS.deliveryNoteMax}
            autoCapitalize="characters"
          />
          <div className="mt-6">
            <PhotoPicker
              label="Photo du ticket ou de la facture"
              hint="Facultatif."
              paths={draft.notePhotos}
              onChange={(notePhotos) => set({ notePhotos })}
              max={PHOTOS_PER_FIELD}
              remaining={RECEPTION_MAX_PHOTOS - total}
              keep={kept}
            />
          </div>
        </section>
        <section aria-labelledby="checks-title" className="space-y-6">
          <h2 id="checks-title" className="text-[19px] font-semibold text-fg">
            Contrôles à l’arrivée au camion
          </h2>
          {yesNo('Transport conforme (glacière / caisson isotherme, trajet court) ?', draft.vehicleOk, (vehicleOk) => set({ vehicleOk }), 'Précisez-le en commentaire ; contrôlez la température de chaque produit frais ou surgelé.')}
          {yesNo('Emballages intacts ?', draft.packagingOk, (packagingOk) => set({ packagingOk }), 'Refusez les produits dont l’emballage est abîmé.')}
          <Button size="lg" block disabled={!deliveryDone} onClick={() => setStep('items')} icon={<IconChevronRight size={22} />}>
            Continuer : produits
          </Button>
          {!deliveryDone && <p className="text-[14px] text-fg-subtle">Choisissez le fournisseur ou le magasin et répondez aux deux contrôles.</p>}
        </section>
      </div>
    )
  } else if (step === 'items') {
    body = (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[16px] text-fg-muted">
            {supplier?.name} · <span className="tabular-nums">{draft.items.length}</span> produit{draft.items.length > 1 ? 's' : ''} ·{' '}
            <span className={`tabular-nums ${total >= RECEPTION_MAX_PHOTOS ? 'font-semibold text-warn' : ''}`}>
              photos {total}/{RECEPTION_MAX_PHOTOS}
            </span>
          </p>
          <Button onClick={() => setEditing({ index: null })} icon={<IconPlus size={20} />} disabled={draft.items.length >= LIMITS.receptionItemsMax}>
            Ajouter un produit
          </Button>
        </div>
        {draft.items.length === 0 ? (
          <button
            type="button"
            onClick={() => setEditing({ index: null })}
            className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong p-5 text-[17px] font-semibold text-accent active:bg-pressed"
          >
            <IconPlus size={26} />
            Ajouter le premier produit acheté
          </button>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {draft.items.map((it, k) => (
              <ItemCard
                key={it.key}
                item={it}
                actions={
                  <>
                    <Button variant="secondary" onClick={() => setEditing({ index: k })} icon={<IconEdit size={18} />} aria-label={`Modifier — ${it.product}`}>
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Retirer — ${it.product}`}
                      onClick={() => {
                        for (const p of it.photo_paths ?? []) if (!kept.includes(p)) void core.discardPhoto(p).catch(() => false)
                        set({ items: draft.items.filter((_, j) => j !== k) })
                      }}
                    >
                      Retirer
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setStep('delivery')}>
            Retour
          </Button>
          <Button size="lg" disabled={draft.items.length === 0} onClick={() => setStep('review')} icon={<IconChevronRight size={22} />}>
            Continuer : validation
          </Button>
        </div>
      </>
    )
  } else {
    const accepted = draft.items.filter((i) => i.accepted).length
    const refused = draft.items.length - accepted
    const out = draft.items.filter((i) => i.accepted && isOutOfRange(i))
    const actionAlready = correcting ? correcting.correctiveActions.length > 0 : false
    body = (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
        <section aria-label="Récapitulatif" className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <p className="text-[20px] font-semibold text-fg">{supplier?.name ?? 'Fournisseur / magasin'}</p>
            <p className="mt-0.5 text-[15px] text-fg-muted">
              {draft.deliveryNote.trim() ? `Ticket / facture ${draft.deliveryNote.trim()} · ` : ''}Transport {draft.vehicleOk ? 'conforme' : 'non conforme'} · Emballages{' '}
              {draft.packagingOk ? 'intacts' : 'abîmés'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="ok">
                <IconOk size={14} /> {accepted} accepté{accepted > 1 ? 's' : ''}
              </Badge>
              {refused > 0 && (
                <Badge tone="error">
                  <IconBan size={14} /> {refused} refusé{refused > 1 ? 's' : ''}
                </Badge>
              )}
              <Badge tone="neutral">
                {total} photo{total > 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
          <ul className="grid gap-3">
            {draft.items.map((it) => (
              <ItemCard key={it.key} item={it} />
            ))}
          </ul>
        </section>
        <section aria-label="Enregistrement" className="space-y-5">
          {out.length > 0 && !actionAlready && (
            <Notice>
              {out.length > 1 ? `${out.length} produits acceptés hors température` : 'Un produit accepté hors température'} : une action corrective sera demandée juste après
              l’enregistrement.
            </Notice>
          )}
          <div>
            <label htmlFor="reception-comment" className="mb-1.5 block text-[15px] font-semibold text-fg">
              Commentaire (facultatif)
            </label>
            <textarea
              id="reception-comment"
              value={draft.comment}
              onChange={(e) => set({ comment: e.target.value })}
              maxLength={LIMITS.receptionCommentMax}
              rows={3}
              className="block w-full resize-y rounded-xl border border-line-strong bg-elevated px-4 py-3 text-[17px] text-fg transition-colors focus:border-accent"
            />
          </div>
          {correcting && <ReasonField value={reason} onChange={setReason} quick={['Erreur de saisie', 'Photo ou lot oublié']} />}
          <ErrorNotice error={error} />
          <Button size="lg" block onClick={submit} disabled={busy || (correcting !== undefined && !reason.trim())} icon={<IconCheck size={22} strokeWidth={2.25} />}>
            {busy ? 'Enregistrement…' : correcting ? 'Enregistrer la correction' : 'Enregistrer l’approvisionnement'}
          </Button>
          <Button variant="secondary" block onClick={() => setStep('items')}>
            Retour aux produits
          </Button>
          {correcting && <Notice tone="info">L’enregistrement d’origine reste visible, barrée, dans l’historique. Rien n’est supprimé du registre.</Notice>}
        </section>
      </div>
    )
  }

  return (
    <>
      {step === 'delivery' ? (
        <BackButton label="Achats" onClick={cancel} />
      ) : (
        <BackButton label={step === 'items' ? 'Fournisseur et transport' : 'Produits'} onClick={() => setStep(step === 'items' ? 'delivery' : 'items')} />
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{correcting ? 'Corriger un approvisionnement' : 'Nouvel approvisionnement'}</h1>
        <Button variant="ghost" onClick={cancel}>
          Annuler
        </Button>
      </div>
      <ol aria-label="Étapes" className="mb-7 flex gap-2">
        {STEPS.map((s, k) => {
          const current = s.id === step
          const can = reached(s.id)
          return (
            <li key={s.id} className={`min-w-0 ${current ? 'flex-[2.4] sm:flex-1' : 'flex-1'}`}>
              <button
                type="button"
                disabled={!can || current}
                aria-current={current ? 'step' : undefined}
                onClick={() => setStep(s.id)}
                className={`flex min-h-12 w-full items-center gap-2 rounded-xl border px-2 text-left text-[15px] font-semibold sm:px-3 ${
                  current ? 'border-accent bg-accent-soft text-accent' : can ? 'border-line bg-surface text-fg active:bg-pressed' : 'border-line bg-sunken text-fg-subtle'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] tabular-nums ${current ? 'bg-accent text-on-accent' : 'bg-sunken text-fg-muted'}`}
                >
                  {k + 1}
                </span>
                <span className={`min-w-0 truncate ${current ? '' : 'max-sm:sr-only'}`}>{s.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {body}
      {addSupplier && (
        <NewSupplierModal
          onClose={() => setAddSupplier(false)}
          onCreated={(s) => {
            setExtraSuppliers((x) => [...x, s])
            set({ supplierId: s.id })
            setAddSupplier(false)
          }}
        />
      )}
      <Modal
        open={confirmCancel}
        title="Abandonner cet approvisionnement ?"
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Continuer la saisie
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                discardNewPhotos()
                onCancel()
              }}
            >
              Abandonner
            </Button>
          </>
        }
      >
        <p>Rien n’a encore été enregistré. Les produits et photos saisis seront perdus.</p>
      </Modal>
    </>
  )
}

/** Carte d'une ligne (saisie et récapitulatif) ; refus mis en évidence. */
export function ItemCard({ item, actions, photoStatus }: { item: DraftItem | ReceptionItem; actions?: ReactNode; photoStatus?: Record<string, PhotoStatus> }) {
  const out = item.accepted && isOutOfRange(item)
  const needsAction = 'needsAction' in item && item.needsAction
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-card ${!item.accepted ? 'border-danger/45 bg-danger-soft' : out ? 'border-warn/45 bg-surface' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-fg-muted">
          <StorageIcon storage={item.storage} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[18px] leading-snug font-semibold break-words text-fg">{item.product}</p>
            {item.accepted ? (
              out ? (
                <Badge tone="warn">
                  <IconWarn size={14} /> Accepté hors seuil
                </Badge>
              ) : (
                <Badge tone="ok">
                  <IconOk size={14} /> Accepté
                </Badge>
              )
            ) : (
              <Badge tone="error">
                <IconBan size={14} /> Refusé
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {[
              item.lot ? `Lot ${item.lot}` : 'Lot non indiqué',
              item.dlc ? `DLC ${frenchDate(item.dlc)}` : item.ddm ? `DDM ${frenchDate(item.ddm)}` : null,
              STORAGE_LABELS[item.storage],
              typeof item.temperature_c === 'number' ? formatTemperature(item.temperature_c) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {!item.accepted && item.refusal_reason && <p className="mt-1 text-[15px] font-semibold text-danger">Motif : {item.refusal_reason}</p>}
          {needsAction && (
            <p className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold text-warn">
              <IconError size={16} /> Action corrective à enregistrer
            </p>
          )}
        </div>
      </div>
      {(item.photo_paths?.length ?? 0) > 0 && <PhotoGallery paths={item.photo_paths!} label={`Étiquette — ${item.product}`} status={photoStatus} />}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </li>
  )
}
