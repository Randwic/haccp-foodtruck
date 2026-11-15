import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Allergen, Product, Recipe, StorageMode } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { normalizeRecipeInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconAllergen, IconCheck, IconPlus, IconRecipe } from '../../ui/icons.tsx'
import { ALLERGEN_LABELS, allergenSources, formatShelfLife, orderAllergens, recipeAllergens, splitShelfLife, STORAGE_LABELS } from '../labels/model.ts'
import { AllergenChecklist, ShelfLifeField, shelfValueHours, StoragePicker, VerifyNotice, type ShelfLifeValue } from './catalogFields.tsx'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'
import { AllergenList } from './ProductSection.tsx'

type Dialog = { kind: 'add' } | { kind: 'edit'; r: Recipe } | { kind: 'deactivate'; r: Recipe } | { kind: 'reactivate'; r: Recipe } | null

/** Gestion › Recettes : ingrédients (produits), allergènes supplémentaires, allergènes calculés en direct. */
export function RecipeSection({ onOpenAllergens }: { onOpenAllergens?: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<{ recipes: Recipe[]; products: Product[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      const [recipes, products] = await Promise.all([manager.listRecipes(), manager.listProducts()])
      setItems({ recipes, products })
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const active = items?.recipes.filter((r) => r.active) ?? []
  const inactive = items?.recipes.filter((r) => !r.active) ?? []
  const close = () => setDialog(null)

  return (
    <section aria-labelledby="rec-title">
      <h2 id="rec-title" className="sr-only">
        Recettes
      </h2>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[17px] text-fg-muted">Préparations maison : leurs allergènes sont calculés à partir des ingrédients et alimentent le tableau des allergènes.</p>
        <div className="flex flex-wrap gap-3">
          {onOpenAllergens && (
            <Button variant="secondary" onClick={onOpenAllergens} icon={<IconAllergen size={20} />}>
              Tableau des allergènes
            </Button>
          )}
          <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />} disabled={!items}>
            Ajouter une recette
          </Button>
        </div>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actives</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucune recette active.</p>
          ) : (
            <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {active.map((r) => (
                <RecipeCard key={r.id} r={r} products={items.products}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', r })} aria-label={`Modifier – ${r.name}`}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', r })} aria-label={`Désactiver – ${r.name}`}>
                    Désactiver
                  </Button>
                </RecipeCard>
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivées</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((r) => (
                  <RecipeCard key={r.id} r={r} products={items.products} inactive>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', r })} aria-label={`Réactiver – ${r.name}`}>
                      Réactiver
                    </Button>
                  </RecipeCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {items && (dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <RecipeModal
          recipe={dialog.kind === 'edit' ? dialog.r : null}
          products={items.products}
          onClose={close}
          onDone={async () => {
            close()
            await load()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal open title="Désactiver cette recette ?" confirmLabel="Désactiver" danger onClose={close} onConfirm={() => run(() => manager.updateRecipe(dialog.r.id, { active: false }), `« ${dialog.r.name} » désactivée`).then(load)}>
          <p>
            <strong>{dialog.r.name}</strong> ne sera plus proposée pour les étiquettes ni affichée dans le tableau des allergènes. Vous pourrez la réactiver.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal open title="Réactiver cette recette ?" confirmLabel="Réactiver" onClose={close} onConfirm={() => run(() => manager.updateRecipe(dialog.r.id, { active: true }), `« ${dialog.r.name} » réactivée`).then(load)}>
          <p>
            <strong>{dialog.r.name}</strong> sera de nouveau proposée.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function RecipeCard({ r, products, inactive, children }: { r: Recipe; products: Product[]; inactive?: boolean; children: ReactNode }) {
  const names = r.ingredient_product_ids.map((id) => products.find((p) => p.id === id)?.name ?? 'Produit inconnu')
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconRecipe size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{r.name}</h3>
            <Badge tone="neutral">{STORAGE_LABELS[r.storage]}</Badge>
            {inactive && <Badge tone="neutral">Désactivée</Badge>}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            Allergènes : <AllergenList allergens={recipeAllergens(r, products)} />
          </p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {names.length ? `Ingrédients : ${names.join(', ')}` : 'Aucun ingrédient référencé'} · DLC : préparation + <span className="text-fg">{formatShelfLife(r.shelf_life_hours)}</span>
          </p>
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

function RecipeModal({ recipe, products, onClose, onDone }: { recipe: Recipe | null; products: Product[]; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(recipe?.name ?? '')
  const [ingredients, setIngredients] = useState<string[]>(recipe?.ingredient_product_ids ?? [])
  const [extra, setExtra] = useState<Allergen[]>(recipe?.extra_allergens ?? [])
  const [storage, setStorage] = useState<StorageMode>(recipe?.storage ?? 'fridge')
  const [life, setLife] = useState<ShelfLifeValue>(recipe ? { none: false, ...splitShelfLife(recipe.shelf_life_hours) } : { none: false, value: '3', unit: 'days' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Produits proposés : actifs + ceux déjà dans la recette (même désactivés, pour ne pas les perdre).
  const choices = products.filter((p) => p.active || ingredients.includes(p.id))
  const draft = { ingredient_product_ids: ingredients, extra_allergens: extra }
  const fromIngredients = useMemo(() => orderAllergens(ingredients.flatMap((id) => products.find((p) => p.id === id)?.allergens ?? [])), [ingredients, products])
  const sources = allergenSources(draft, products)

  const toggle = (id: string) => setIngredients((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const h = shelfValueHours(life)
    const errs: Record<string, string> = {}
    if (h === null || Number.isNaN(h)) errs.life = 'Indiquez la durée de vie de la préparation (jours ou heures).'
    // Un allergène déjà apporté par un ingrédient n'est pas répété en « supplémentaire ».
    const input = { name, ingredient_product_ids: ingredients, extra_allergens: extra.filter((a) => !fromIngredients.includes(a)), storage, shelf_life_hours: h ?? 0 }
    const n = Object.keys(errs).length ? null : normalizeRecipeInput(input)
    if (n && !n.ok) errs[n.field === 'shelf_life_hours' ? 'life' : n.field === 'name' ? 'name' : 'form'] = n.message
    setErrors(errs)
    if (!n || !n.ok) return
    setBusy(true)
    setError(null)
    try {
      const value = { ...input, ...n.value } as typeof input
      if (recipe) await run(() => manager.updateRecipe(recipe.id, value), 'Recette modifiée')
      else await run(() => manager.addRecipe(value), `« ${n.value.name} » ajoutée`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={recipe ? `Modifier « ${recipe.name} »` : 'Ajouter une recette'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-7">
        <TextField label="Nom de la recette" value={name} onChange={setName} error={errors.name} maxLength={80} autoCapitalize="sentences" placeholder="Ex. : Sauce cheddar maison" />

        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold text-fg">Ingrédients (produits)</legend>
          <p className="mb-2 text-[15px] text-fg-muted">Leurs allergènes sont repris automatiquement.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {choices.map((p) => {
              const on = ingredients.includes(p.id)
              return (
                <label
                  key={p.id}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 text-[16px] active:bg-pressed ${on ? 'border-accent bg-accent-soft' : 'border-line-strong bg-elevated'}`}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(p.id)} />
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-surface'}`}>
                    {on && <IconCheck size={18} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 leading-snug">
                    <span className={`block text-fg ${on ? 'font-semibold' : ''}`}>
                      {p.name}
                      {!p.active && <span className="font-normal text-fg-muted"> (désactivé)</span>}
                    </span>
                    <span className="block text-[13px] text-fg-muted">
                      <AllergenList allergens={p.allergens} />
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <AllergenChecklist legend="Allergènes supplémentaires (farine, œuf, lait ajoutés…)" value={extra} onChange={setExtra} locked={fromIngredients} />

        <section aria-live="polite" aria-labelledby="computed-title" className="sticky bottom-0 z-10 -mx-1 rounded-2xl border-2 border-accent bg-surface p-4 shadow-pop">
          <h3 id="computed-title" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <IconAllergen size={18} className="text-accent" />
            Allergènes de la recette (calculés)
          </h3>
          {sources.length === 0 ? (
            <p className="mt-1.5 text-[17px] font-semibold text-fg">Aucun allergène déclaré</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {sources.map((s) => (
                <li key={s.allergen} className="text-[16px] text-fg">
                  <span className="font-bold">{ALLERGEN_LABELS[s.allergen]}</span>
                  <span className="text-fg-muted"> — {s.from.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <StoragePicker value={storage} onChange={setStorage} />
        <ShelfLifeField label="Durée de vie de la préparation" hint="DLC proposée à la fabrication." value={life} onChange={setLife} error={errors.life} />
        <VerifyNotice />
        {(error || errors.form) && <Notice>{error ?? errors.form}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : recipe ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
