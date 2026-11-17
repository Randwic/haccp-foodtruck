import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Allergen, Product, Recipe, StorageMode } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { MENU_CATEGORIES, normalizeRecipeInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconAllergen, IconCheck, IconPlus, IconRecipe, IconWarn } from '../../ui/icons.tsx'
import { allergenProfile, catalogOf, productTraces, wouldCreateCycle, type AllergenOrigin } from '../labels/allergens.ts'
import { PresentDot, TraceDot } from '../labels/AllergenMarks.tsx'
import { categoryKey, categoryOrder, OTHER_DISHES } from '../labels/allergenTable.ts'
import { ALLERGEN_LABELS, formatShelfLife, splitShelfLife, STORAGE_LABELS } from '../labels/model.ts'
import { AllergenChecklist, ShelfLifeField, shelfValueHours, StoragePicker, VerifyNotice, type ShelfLifeValue } from './catalogFields.tsx'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'
import { AllergenList } from './ProductSection.tsx'

type Kind = Recipe['kind']
type Dialog = { kind: 'add'; recipeKind: Kind } | { kind: 'edit'; r: Recipe } | { kind: 'deactivate'; r: Recipe } | { kind: 'reactivate'; r: Recipe } | null

export const KIND_LABELS: Record<Kind, string> = { preparation: 'Préparation maison', menu_item: 'Plat du menu' }
const NO_CATEGORY = 'Sans rubrique'

/** Gestion › Recettes : préparations maison et plats du menu ; allergènes et traces calculés en direct. */
export function RecipeSection({ onOpenAllergens }: { onOpenAllergens?: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<{ recipes: Recipe[]; products: Product[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [filter, setFilter] = useState<Kind>('menu_item')

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

  const shown = items?.recipes.filter((r) => r.kind === filter) ?? []
  const active = shown.filter((r) => r.active)
  const inactive = shown.filter((r) => !r.active)
  const close = () => setDialog(null)
  const count = (k: Kind) => items?.recipes.filter((r) => r.kind === k && r.active).length ?? 0

  // Plats du menu groupés par rubrique.
  const groups = useMemo(() => {
    if (filter === 'preparation') return [{ title: 'Actives', list: active }]
    const m = new Map<string, Recipe[]>()
    for (const r of active) {
      const raw = r.category?.trim() || NO_CATEGORY
      const title = [...m.keys()].find((k) => categoryKey(k) === categoryKey(raw)) ?? raw
      m.set(title, [...(m.get(title) ?? []), r])
    }
    const rank = (t: string) => (t === NO_CATEGORY ? OTHER_DISHES : t)
    return [...m.entries()].sort(([a], [b]) => categoryOrder(rank(a), rank(b))).map(([title, list]) => ({ title, list }))
  }, [filter, active])

  const card = (r: Recipe, actions: ReactNode, off = false) => (
    <RecipeCard key={r.id} r={r} products={items!.products} recipes={items!.recipes} inactive={off}>
      {actions}
    </RecipeCard>
  )

  return (
    <section aria-labelledby="rec-title">
      <h2 id="rec-title" className="sr-only">
        Recettes
      </h2>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[17px] text-fg-muted">
          Préparations maison (sauces…) et plats du menu : allergènes et traces calculés à partir des produits et des préparations utilisés.
        </p>
        <div className="flex flex-wrap gap-3">
          {onOpenAllergens && (
            <Button variant="secondary" onClick={onOpenAllergens} icon={<IconAllergen size={20} />}>
              Tableau des allergènes
            </Button>
          )}
          <Button onClick={() => setDialog({ kind: 'add', recipeKind: filter })} icon={<IconPlus size={20} />} disabled={!items}>
            {filter === 'menu_item' ? 'Ajouter un plat' : 'Ajouter une préparation'}
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Type de recette" className="mb-6 grid max-w-md grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
        {(
          [
            ['menu_item', 'Menu'],
            ['preparation', 'Préparations'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={`min-h-12 rounded-lg px-3 text-[16px] font-semibold transition-colors ${filter === k ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`}
          >
            {label}
            {items && <span className="ml-1.5 font-normal tabular-nums opacity-80">({count(k)})</span>}
          </button>
        ))}
      </div>

      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">
              {filter === 'menu_item' ? 'Aucun plat du menu actif.' : 'Aucune préparation active.'}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.title}>
                <SectionTitle count={g.list.length}>{g.title}</SectionTitle>
                <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                  {g.list.map((r) =>
                    card(
                      r,
                      <>
                        <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', r })} aria-label={`Modifier – ${r.name}`}>
                          Modifier
                        </Button>
                        <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', r })} aria-label={`Désactiver – ${r.name}`}>
                          Désactiver
                        </Button>
                      </>,
                    ),
                  )}
                </ul>
              </div>
            ))
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivées</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((r) =>
                  card(
                    r,
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', r })} aria-label={`Réactiver – ${r.name}`}>
                      Réactiver
                    </Button>,
                    true,
                  ),
                )}
              </ul>
            </>
          )}
        </>
      )}

      {items && (dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <RecipeModal
          recipe={dialog.kind === 'edit' ? dialog.r : null}
          initialKind={dialog.kind === 'add' ? dialog.recipeKind : dialog.r.kind}
          products={items.products}
          recipes={items.recipes}
          onClose={close}
          onDone={async (k) => {
            close()
            setFilter(k)
            await load()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal open title="Désactiver cette recette ?" confirmLabel="Désactiver" danger onClose={close} onConfirm={() => run(() => manager.updateRecipe(dialog.r.id, { active: false }), `« ${dialog.r.name} » désactivée`).then(load)}>
          <p>
            <strong>{dialog.r.name}</strong> ne sera plus proposée pour les étiquettes ni affichée dans le tableau des allergènes. Les recettes qui l’utilisent gardent ses allergènes ; vous pourrez la réactiver.
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

function RecipeCard({ r, products, recipes, inactive, children }: { r: Recipe; products: Product[]; recipes: Recipe[]; inactive?: boolean; children: ReactNode }) {
  const profile = allergenProfile(r, catalogOf(products, recipes))
  const names = [
    ...r.ingredient_recipe_ids.map((id) => recipes.find((x) => x.id === id)?.name ?? 'Préparation inconnue'),
    ...r.ingredient_product_ids.map((id) => products.find((p) => p.id === id)?.name ?? 'Produit inconnu'),
  ]
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconRecipe size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{r.name}</h3>
            {r.kind === 'preparation' ? <Badge tone="neutral">{STORAGE_LABELS[r.storage]}</Badge> : r.category && <Badge tone="info">{r.category}</Badge>}
            {inactive && <Badge tone="neutral">Désactivée</Badge>}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            Allergènes : <AllergenList allergens={profile.present} traces={profile.traces} />
          </p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {names.length ? `Ingrédients : ${names.join(', ')}` : 'Aucun ingrédient référencé'}
            {r.kind === 'preparation' && r.shelf_life_hours !== null && (
              <>
                {' '}
                · DLC : préparation + <span className="text-fg">{formatShelfLife(r.shelf_life_hours)}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

/** Case à cocher d'un ingrédient (produit ou préparation). */
function IngredientOption({ on, onToggle, title, detail, disabled, note }: { on: boolean; onToggle: () => void; title: ReactNode; detail: ReactNode; disabled?: boolean; note?: string }) {
  return (
    <label
      className={`flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-2 text-[16px] ${
        disabled ? 'cursor-default border-line bg-sunken opacity-70' : `cursor-pointer active:bg-pressed ${on ? 'border-accent bg-accent-soft' : 'border-line-strong bg-elevated'}`
      }`}
    >
      <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={onToggle} />
      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-surface'}`}>
        {on && <IconCheck size={18} strokeWidth={3} />}
      </span>
      <span className="min-w-0 leading-snug">
        <span className={`block text-fg ${on ? 'font-semibold' : ''}`}>{title}</span>
        <span className="block text-[13px] text-fg-muted">{note ?? detail}</span>
      </span>
    </label>
  )
}

function OriginList({ items, mark, empty }: { items: AllergenOrigin[]; mark: ReactNode; empty: string }) {
  if (!items.length) return <p className="mt-1 text-[16px] text-fg-muted">{empty}</p>
  return (
    <ul className="mt-1 space-y-1">
      {items.map((s) => (
        <li key={s.allergen} className="flex items-baseline gap-2 text-[15px] leading-snug text-fg sm:text-[16px]">
          <span className="relative top-[1px] flex w-3 justify-center">{mark}</span>
          <span>
            <span className="font-bold">{ALLERGEN_LABELS[s.allergen]}</span>
            <span className="text-fg-muted"> — {s.from.join(', ')}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Panneau collant : allergènes présents (●) et traces (○) calculés en direct, avec leur origine. */
export function ComputedAllergens({ present, traces, cycles }: { present: AllergenOrigin[]; traces: AllergenOrigin[]; cycles: string[] }) {
  return (
    <section aria-live="polite" aria-labelledby="computed-title" className="sticky bottom-0 z-10 -mx-1 max-h-[30vh] overflow-y-auto rounded-2xl border-2 border-accent bg-surface p-3 shadow-pop sm:max-h-[45vh] sm:p-4">
      <h3 id="computed-title" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
        <IconAllergen size={18} className="text-accent" />
        Allergènes calculés
      </h3>
      <p className="mt-2 flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
        <PresentDot size={10} /> Présents
      </p>
      <OriginList items={present} mark={<PresentDot size={10} />} empty="Aucun allergène déclaré" />
      <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em] text-fg-subtle uppercase">
        <TraceDot size={10} /> Peut en contenir (traces)
      </p>
      <OriginList items={traces} mark={<TraceDot size={10} />} empty="Aucune trace signalée" />
      {cycles.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[15px] font-medium text-danger">
          <IconWarn size={18} className="mt-0.5 shrink-0" />
          Boucle ignorée : {cycles.join(', ')} se contient elle-même.
        </p>
      )}
    </section>
  )
}

function RecipeModal({
  recipe,
  initialKind,
  products,
  recipes,
  onClose,
  onDone,
}: {
  recipe: Recipe | null
  initialKind: Kind
  products: Product[]
  recipes: Recipe[]
  onClose: () => void
  onDone: (k: Kind) => void
}) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(recipe?.name ?? '')
  const [kind, setKind] = useState<Kind>(initialKind)
  const [category, setCategory] = useState(recipe?.category ?? '')
  const [ingredients, setIngredients] = useState<string[]>(recipe?.ingredient_product_ids ?? [])
  const [subs, setSubs] = useState<string[]>(recipe?.ingredient_recipe_ids ?? [])
  const [extra, setExtra] = useState<Allergen[]>(recipe?.extra_allergens ?? [])
  const [mayContain, setMayContain] = useState<Allergen[]>(recipe?.may_contain ?? [])
  const [storage, setStorage] = useState<StorageMode>(recipe?.storage ?? 'fridge')
  const [life, setLife] = useState<ShelfLifeValue>(recipe?.shelf_life_hours ? { none: false, ...splitShelfLife(recipe.shelf_life_hours) } : { none: false, value: '3', unit: 'days' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Produits proposés : actifs + ceux déjà dans la recette (même désactivés, pour ne pas les perdre).
  const choices = products.filter((p) => p.active || ingredients.includes(p.id))
  const subChoices = recipes.filter((r) => r.kind === 'preparation' && r.id !== recipe?.id && (r.active || subs.includes(r.id)))
  const catalog = useMemo(() => catalogOf(products, recipes), [products, recipes])
  // Ce qu'apportent les ingrédients seuls (cases verrouillées), puis le total avec les ajouts.
  const fromIngredients = useMemo(
    () => allergenProfile({ id: recipe?.id, ingredient_product_ids: ingredients, ingredient_recipe_ids: subs, extra_allergens: [], may_contain: [] }, catalog),
    [recipe?.id, ingredients, subs, catalog],
  )
  const profile = allergenProfile({ id: recipe?.id, ingredient_product_ids: ingredients, ingredient_recipe_ids: subs, extra_allergens: extra, may_contain: mayContain }, catalog)
  const ingredientTraces = fromIngredients.traces.filter((a) => !profile.present.includes(a))

  const toggle = (set: (f: (l: string[]) => string[]) => void, id: string) => set((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const h = kind === 'preparation' ? shelfValueHours(life) : null
    const errs: Record<string, string> = {}
    if (kind === 'preparation' && (h === null || Number.isNaN(h))) errs.life = 'Indiquez la durée de vie de la préparation (jours ou heures).'
    // Un allergène déjà apporté par un ingrédient n'est pas répété ; une trace déjà présente non plus.
    const extraOwn = extra.filter((a) => !fromIngredients.present.includes(a))
    const presentAll = new Set([...fromIngredients.present, ...extraOwn])
    const input = {
      name,
      kind,
      category: kind === 'menu_item' ? category : null,
      ingredient_product_ids: ingredients,
      ingredient_recipe_ids: subs,
      extra_allergens: extraOwn,
      may_contain: mayContain.filter((a) => !presentAll.has(a) && !fromIngredients.traces.includes(a)),
      storage,
      shelf_life_hours: h,
    }
    const n = Object.keys(errs).length ? null : normalizeRecipeInput(input)
    if (n && !n.ok) errs[n.field === 'shelf_life_hours' ? 'life' : n.field === 'name' ? 'name' : n.field === 'category' ? 'category' : 'form'] = n.message
    setErrors(errs)
    if (!n || !n.ok) return
    setBusy(true)
    setError(null)
    try {
      const value = { ...input, ...n.value } as typeof input
      if (recipe) await run(() => manager.updateRecipe(recipe.id, value), 'Recette modifiée')
      else await run(() => manager.addRecipe(value), `« ${n.value.name} » ajoutée`)
      onDone(kind)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const title = recipe ? `Modifier « ${recipe.name} »` : kind === 'menu_item' ? 'Ajouter un plat du menu' : 'Ajouter une préparation'
  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-7">
        <div role="radiogroup" aria-label="Type de recette">
          <p className="mb-1.5 text-[15px] font-semibold text-fg">Type</p>
          <div className="grid grid-cols-2 gap-2">
            {(['preparation', 'menu_item'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-14 rounded-xl border-2 px-3 text-[16px] font-semibold active:bg-pressed ${kind === k ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-elevated text-fg'}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[15px] text-fg-muted">
            {kind === 'menu_item'
              ? 'Plat vendu : affiché dans le tableau des allergènes, servi immédiatement (pas d’étiquette DLC).'
              : 'Sauce, mélange… : étiquette DLC « Préparation maison », utilisable dans d’autres recettes.'}
          </p>
        </div>

        <TextField
          label={kind === 'menu_item' ? 'Nom du plat' : 'Nom de la préparation'}
          value={name}
          onChange={setName}
          error={errors.name}
          maxLength={80}
          autoCapitalize="sentences"
          placeholder={kind === 'menu_item' ? 'Ex. : Supernova' : 'Ex. : Sauce UFO'}
        />

        {kind === 'menu_item' && (
          <TextField
            label="Rubrique du menu"
            hint="Regroupe les plats dans le tableau des allergènes."
            value={category}
            onChange={setCategory}
            error={errors.category}
            maxLength={40}
            autoCapitalize="sentences"
            placeholder="Ex. : Croq'Brioche"
            below={
              <div role="group" aria-label="Rubriques proposées" className="mt-2.5 flex flex-wrap gap-2">
                {[...new Set([...MENU_CATEGORIES, ...recipes.map((r) => r.category).filter((c): c is string => !!c)])].map((c) => {
                  const on = category.trim() === c
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCategory(c)}
                      className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold active:bg-pressed ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg'}`}
                    >
                      {c}
                    </button>
                  )
                })}
              </div>
            }
          />
        )}

        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold text-fg">Préparations maison utilisées</legend>
          <p className="mb-2 text-[15px] text-fg-muted">Ex. : Sauce UFO dans la Supernova. Leurs allergènes et traces sont repris.</p>
          {subChoices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-[15px] text-fg-muted">Aucune préparation maison. Ajoutez-en dans l’onglet « Préparations ».</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {subChoices.map((r) => {
                const loop = wouldCreateCycle(recipe?.id, r.id, recipes)
                const p = allergenProfile(r, catalog)
                return (
                  <IngredientOption
                    key={r.id}
                    on={subs.includes(r.id)}
                    onToggle={() => toggle(setSubs, r.id)}
                    disabled={loop && !subs.includes(r.id)}
                    note={loop ? 'Impossible : elle contient déjà cette recette' : undefined}
                    title={
                      <>
                        {r.name}
                        {!r.active && <span className="font-normal text-fg-muted"> (désactivée)</span>}
                      </>
                    }
                    detail={<AllergenList allergens={p.present} traces={p.traces} />}
                  />
                )
              })}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold text-fg">Produits</legend>
          <p className="mb-2 text-[15px] text-fg-muted">Leurs allergènes et traces sont repris automatiquement.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {choices.map((p) => (
              <IngredientOption
                key={p.id}
                on={ingredients.includes(p.id)}
                onToggle={() => toggle(setIngredients, p.id)}
                title={
                  <>
                    {p.name}
                    {!p.active && <span className="font-normal text-fg-muted"> (désactivé)</span>}
                  </>
                }
                detail={<AllergenList allergens={p.allergens} traces={productTraces(p)} />}
              />
            ))}
          </div>
        </fieldset>

        <AllergenChecklist legend="Allergènes ajoutés (farine, œuf, lait ajoutés…)" value={extra} onChange={setExtra} locked={fromIngredients.present} />
        <AllergenChecklist
          tone="traces"
          legend="Peut en contenir (traces) — propres à la recette"
          hint="Ex. : friteuse commune avec les nuggets → gluten. Les traces des ingrédients sont reprises automatiquement."
          value={mayContain}
          onChange={setMayContain}
          locked={ingredientTraces}
          lockedNote="trace d’un ingrédient"
          excluded={profile.present}
        />

        <ComputedAllergens present={profile.presentFrom} traces={profile.tracesFrom} cycles={profile.cycles} />

        <StoragePicker value={storage} onChange={setStorage} />
        {kind === 'preparation' && <ShelfLifeField label="Durée de vie de la préparation" hint="DLC proposée à la fabrication." value={life} onChange={setLife} error={errors.life} />}
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
