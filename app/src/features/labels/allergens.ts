// Calcul des allergènes d'une recette (lot 4 bis) — fonctions pures, testées dans allergens.test.ts.
//
// - Présents = union récursive des allergènes des produits, des préparations (sous-recettes) et des
//   allergènes ajoutés à la main (`extra_allergens`).
// - « Peut en contenir » (traces) = union récursive des `may_contain` (produits, sous-recettes, recette),
//   MOINS les allergènes présents (un allergène présent n'est jamais affiché aussi en trace).
// - Protection anti-cycle : une sous-recette déjà en cours d'exploration (A → B → A) est ignorée et signalée.
//   Un ingrédient inconnu (supprimé, pas encore synchronisé) est ignoré.
// - Ordre de sortie : celui de l'annexe II (ALLERGENS).
import { ALLERGENS, type Allergen, type Product, type Recipe } from '../../../../shared/payloads.ts'

/** Ce qu'il faut d'une recette pour le calcul (brouillon du formulaire compris : `id` facultatif). */
export type RecipeLike = Pick<Recipe, 'ingredient_product_ids' | 'extra_allergens'> &
  Partial<Pick<Recipe, 'id' | 'name' | 'ingredient_recipe_ids' | 'may_contain'>>

export interface AllergenOrigin {
  allergen: Allergen
  /** Ingrédients directs qui l'apportent (« Pain brioché », « Sauce UFO »), ou « ajouté à la recette ». */
  from: string[]
}

export interface AllergenProfile {
  present: Allergen[]
  traces: Allergen[]
  presentFrom: AllergenOrigin[]
  tracesFrom: AllergenOrigin[]
  /** Noms des sous-recettes ignorées parce qu'elles bouclent (A → B → A). Vide en temps normal. */
  cycles: string[]
}

export const ADDED_TO_RECIPE = 'ajouté à la recette'
export const RECIPE_TRACES = 'indiqué sur la recette'

const ordered = (set: ReadonlySet<Allergen>): Allergen[] => ALLERGENS.filter((a) => set.has(a))

/** Traces propres d'un produit : `may_contain` sans les allergènes présents. */
export function productTraces(p: Pick<Product, 'allergens' | 'may_contain'>): Allergen[] {
  const present = new Set(p.allergens)
  return ALLERGENS.filter((a) => (p.may_contain ?? []).includes(a) && !present.has(a))
}

interface Raw {
  present: Set<Allergen>
  maybe: Set<Allergen>
}

/** Index des références pour des calculs répétés (tableau, liste). */
export interface Catalog {
  products: ReadonlyMap<string, Product>
  recipes: ReadonlyMap<string, Recipe>
}
export function catalogOf(products: readonly Product[], recipes: readonly Recipe[] = []): Catalog {
  return { products: new Map(products.map((p) => [p.id, p])), recipes: new Map(recipes.map((r) => [r.id, r])) }
}

/** Union récursive brute (présents, tous les « peut en contenir ») d'une recette. `path` = ids en cours. */
function rawOf(r: RecipeLike, cat: Catalog, path: ReadonlySet<string>, cycles: Set<string>, memo: Map<string, Raw>): Raw {
  const present = new Set<Allergen>(r.extra_allergens)
  const maybe = new Set<Allergen>(r.may_contain ?? [])
  for (const id of r.ingredient_product_ids) {
    const p = cat.products.get(id)
    if (!p) continue
    p.allergens.forEach((a) => present.add(a))
    ;(p.may_contain ?? []).forEach((a) => maybe.add(a))
  }
  for (const id of r.ingredient_recipe_ids ?? []) {
    const sub = cat.recipes.get(id)
    if (!sub) continue
    if (path.has(id)) {
      cycles.add(sub.name)
      continue
    }
    let raw = memo.get(id)
    if (!raw) {
      raw = rawOf(sub, cat, new Set([...path, id]), cycles, memo)
      // Un résultat obtenu en coupant un cycle dépend du chemin : on ne le garde pas en mémoire.
      if (cycles.size === 0) memo.set(id, raw)
    }
    raw.present.forEach((a) => present.add(a))
    raw.maybe.forEach((a) => maybe.add(a))
  }
  return { present, maybe }
}

/** Allergènes présents et traces d'une recette, avec leur origine (ingrédients directs). */
export function allergenProfile(recipe: RecipeLike, catalog: Catalog): AllergenProfile {
  const cycles = new Set<string>()
  const memo = new Map<string, Raw>()
  const root = new Set(recipe.id ? [recipe.id] : [])
  const total = rawOf(recipe, catalog, root, cycles, memo)
  const traces = new Set([...total.maybe].filter((a) => !total.present.has(a)))

  // Origine : pour chaque ingrédient direct, ce qu'il apporte (récursivement pour une préparation).
  const direct: { name: string; raw: Raw }[] = []
  for (const id of recipe.ingredient_product_ids) {
    const p = catalog.products.get(id)
    if (p) direct.push({ name: p.name, raw: { present: new Set(p.allergens), maybe: new Set(p.may_contain ?? []) } })
  }
  for (const id of recipe.ingredient_recipe_ids ?? []) {
    const sub = catalog.recipes.get(id)
    if (!sub || root.has(id)) continue
    direct.push({ name: sub.name, raw: rawOf(sub, catalog, new Set([...root, id]), new Set(), new Map()) })
  }
  const presentFrom = ordered(total.present).map((allergen) => ({
    allergen,
    from: [...direct.filter((d) => d.raw.present.has(allergen)).map((d) => d.name), ...(recipe.extra_allergens.includes(allergen) ? [ADDED_TO_RECIPE] : [])],
  }))
  const tracesFrom = ordered(traces).map((allergen) => ({
    allergen,
    from: [...direct.filter((d) => d.raw.maybe.has(allergen)).map((d) => d.name), ...((recipe.may_contain ?? []).includes(allergen) ? [RECIPE_TRACES] : [])],
  }))
  return { present: ordered(total.present), traces: ordered(traces), presentFrom, tracesFrom, cycles: [...cycles] }
}

/** Raccourci : profil d'une recette à partir des listes. */
export function recipeProfile(recipe: RecipeLike, products: readonly Product[], recipes: readonly Recipe[] = []): AllergenProfile {
  return allergenProfile(recipe, catalogOf(products, recipes))
}

/**
 * Sous-recettes que `recipeId` peut utiliser sans créer de boucle : la candidate ne doit pas être la recette
 * elle-même ni contenir (directement ou non) `recipeId`. `recipeId` absent (nouvelle recette) : aucune boucle possible.
 */
export function wouldCreateCycle(recipeId: string | undefined, candidateId: string, recipes: readonly Recipe[]): boolean {
  if (!recipeId) return false
  if (candidateId === recipeId) return true
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const seen = new Set<string>()
  const stack = [candidateId]
  while (stack.length) {
    const id = stack.pop()!
    if (id === recipeId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(byId.get(id)?.ingredient_recipe_ids ?? []))
  }
  return false
}
