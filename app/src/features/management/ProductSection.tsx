import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Allergen, Product, StorageMode } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { normalizeProductInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconPlus, IconProduct } from '../../ui/icons.tsx'
import { ALLERGEN_SHORT, formatShelfLife, splitShelfLife, STORAGE_LABELS } from '../labels/model.ts'
import { AllergenChecklist, ShelfLifeField, shelfValueHours, StoragePicker, VerifyNotice, type ShelfLifeValue } from './catalogFields.tsx'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'

type Dialog = { kind: 'add' } | { kind: 'edit'; p: Product } | { kind: 'deactivate'; p: Product } | { kind: 'reactivate'; p: Product } | null

export function AllergenList({ allergens }: { allergens: readonly Allergen[] }) {
  return allergens.length ? (
    <span className="font-semibold text-fg">{allergens.map((a) => ALLERGEN_SHORT[a]).join(', ')}</span>
  ) : (
    <span className="text-fg-subtle">Aucun allergène déclaré</span>
  )
}

/** Gestion › Produits : allergènes, conservation, durées de vie secondaires (jamais supprimés : désactiver). */
export function ProductSection() {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<Product[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      setItems(await manager.listProducts())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const active = items?.filter((p) => p.active) ?? []
  const inactive = items?.filter((p) => !p.active) ?? []
  const close = () => setDialog(null)

  return (
    <section aria-labelledby="prod-title">
      <h2 id="prod-title" className="sr-only">
        Produits
      </h2>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[17px] text-fg-muted">Matières premières : allergènes et durées de vie après ouverture ou décongélation, reprises sur les étiquettes DLC.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter un produit
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actifs</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucun produit actif.</p>
          ) : (
            <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {active.map((p) => (
                <ProductCard key={p.id} p={p}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', p })} aria-label={`Modifier – ${p.name}`}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', p })} aria-label={`Désactiver – ${p.name}`}>
                    Désactiver
                  </Button>
                </ProductCard>
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivés</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((p) => (
                  <ProductCard key={p.id} p={p} inactive>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', p })} aria-label={`Réactiver – ${p.name}`}>
                      Réactiver
                    </Button>
                  </ProductCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <ProductModal
          product={dialog.kind === 'edit' ? dialog.p : null}
          onClose={close}
          onDone={async () => {
            close()
            await load()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal open title="Désactiver ce produit ?" confirmLabel="Désactiver" danger onClose={close} onConfirm={() => run(() => manager.updateProduct(dialog.p.id, { active: false }), `« ${dialog.p.name} » désactivé`).then(load)}>
          <p>
            <strong>{dialog.p.name}</strong> ne sera plus proposé pour les étiquettes. Les étiquettes passées et les recettes qui l’utilisent gardent ses allergènes ; vous pourrez le réactiver.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal open title="Réactiver ce produit ?" confirmLabel="Réactiver" onClose={close} onConfirm={() => run(() => manager.updateProduct(dialog.p.id, { active: true }), `« ${dialog.p.name} » réactivé`).then(load)}>
          <p>
            <strong>{dialog.p.name}</strong> sera de nouveau proposé pour les étiquettes.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function ProductCard({ p, inactive, children }: { p: Product; inactive?: boolean; children: ReactNode }) {
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconProduct size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{p.name}</h3>
            <Badge tone="neutral">{STORAGE_LABELS[p.storage]}</Badge>
            {inactive && <Badge tone="neutral">Désactivé</Badge>}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            Allergènes : <AllergenList allergens={p.allergens} />
          </p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            Après ouverture : <span className="text-fg">{p.shelf_life_opened_hours === null ? "—" : formatShelfLife(p.shelf_life_opened_hours)}</span> · Après décongélation : <span className="text-fg">{p.shelf_life_thawed_hours === null ? "—" : formatShelfLife(p.shelf_life_thawed_hours)}</span>
          </p>
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

const shelf = (h: number | null): ShelfLifeValue => (h === null ? { none: true, value: '', unit: 'days' } : { none: false, ...splitShelfLife(h) })

function ProductModal({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(product?.name ?? '')
  const [allergens, setAllergens] = useState<Allergen[]>(product?.allergens ?? [])
  const [storage, setStorage] = useState<StorageMode>(product?.storage ?? 'fridge')
  const [opened, setOpened] = useState<ShelfLifeValue>(product ? shelf(product.shelf_life_opened_hours) : { none: false, value: '3', unit: 'days' })
  const [thawed, setThawed] = useState<ShelfLifeValue>(product ? shelf(product.shelf_life_thawed_hours) : { none: true, value: '', unit: 'days' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const o = shelfValueHours(opened)
    const t = shelfValueHours(thawed)
    const input = { name, allergens, storage, shelf_life_opened_hours: o, shelf_life_thawed_hours: t }
    const errs: Record<string, string> = {}
    if (Number.isNaN(o)) errs.opened = 'Indiquez un nombre entier de jours ou d’heures (ou « Non applicable »).'
    if (Number.isNaN(t)) errs.thawed = 'Indiquez un nombre entier de jours ou d’heures (ou « Non applicable »).'
    const n = Object.keys(errs).length ? null : normalizeProductInput(input)
    if (n && !n.ok) errs[n.field === 'shelf_life_opened_hours' ? 'opened' : n.field === 'shelf_life_thawed_hours' ? 'thawed' : 'name'] = n.message
    setErrors(errs)
    if (!n || !n.ok) return
    setBusy(true)
    setError(null)
    try {
      const value = { ...input, ...n.value } as typeof input
      if (product) await run(() => manager.updateProduct(product.id, value), 'Produit modifié')
      else await run(() => manager.addProduct(value), `« ${n.value.name} » ajouté`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={product ? `Modifier « ${product.name} »` : 'Ajouter un produit'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-7">
        <TextField label="Nom du produit" value={name} onChange={setName} error={errors.name} maxLength={80} autoCapitalize="sentences" placeholder="Ex. : Sauce burger" />
        <StoragePicker value={storage} onChange={setStorage} label="Conservation (avant ouverture)" />
        <AllergenChecklist legend="Allergènes (14 allergènes réglementaires)" value={allergens} onChange={setAllergens} />
        <ShelfLifeField label="Durée de vie après ouverture" hint="DLC proposée à l’ouverture du conditionnement." value={opened} onChange={setOpened} nullable error={errors.opened} />
        <ShelfLifeField label="Durée de vie après décongélation" hint="Pour un produit surgelé décongelé au frigo." value={thawed} onChange={setThawed} nullable error={errors.thawed} />
        <VerifyNotice />
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : product ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
