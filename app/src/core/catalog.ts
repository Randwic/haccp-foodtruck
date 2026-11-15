// Lot 4 bis : produits et recettes reçus d'un serveur (ou lus dans une base locale) plus anciens que le contrat.
// Les champs ajoutés (traces, température de cuisson, type de recette, rubrique, sous-recettes) reçoivent une
// valeur par défaut sûre ; les valeurs illisibles sont écartées. Fonctions pures (testées dans products.test.ts).
import { ALLERGENS, type Allergen, type Product, type Recipe } from '../../../shared/payloads.ts'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Allergènes connus, sans doublon, dans l'ordre de l'annexe II. */
export function allergenList(v: unknown): Allergen[] {
  if (!Array.isArray(v)) return []
  const set = new Set(v)
  return ALLERGENS.filter((a) => set.has(a))
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [])
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Produit complété : `may_contain` (défaut []) privé des allergènes présents, `cook_min_c` (défaut null).
 * `shelf_life_opened_hours: null` = « selon l'étiquette du fabricant » (DLC saisie à la main).
 */
export function normalizeProduct(raw: Product | Record<string, unknown>): Product {
  const p = raw as Record<string, unknown>
  const allergens = allergenList(p.allergens)
  return {
    ...(raw as Product),
    allergens,
    may_contain: allergenList(p.may_contain).filter((a) => !allergens.includes(a)),
    cook_min_c: numOrNull(p.cook_min_c),
    shelf_life_opened_hours: numOrNull(p.shelf_life_opened_hours),
    shelf_life_thawed_hours: numOrNull(p.shelf_life_thawed_hours),
  }
}

/** Recette complétée : type 'preparation' par défaut (recettes du lot 4), sans rubrique, sans sous-recette ni trace. */
export function normalizeRecipe(raw: Recipe | Record<string, unknown>): Recipe {
  const r = raw as Record<string, unknown>
  const kind: Recipe['kind'] = r.kind === 'menu_item' ? 'menu_item' : 'preparation'
  const category = typeof r.category === 'string' && r.category.trim() ? r.category.trim() : null
  const id = typeof r.id === 'string' ? r.id : ''
  return {
    ...(raw as Recipe),
    kind,
    category,
    ingredient_product_ids: strings(r.ingredient_product_ids),
    ingredient_recipe_ids: strings(r.ingredient_recipe_ids).filter((x) => x !== id),
    extra_allergens: allergenList(r.extra_allergens),
    may_contain: allergenList(r.may_contain),
    shelf_life_hours: kind === 'menu_item' ? null : numOrNull(r.shelf_life_hours),
  }
}

/** Liste reçue (éventuellement absente ou mal formée) → produits / recettes complétés. */
export function normalizeProducts(rows: unknown): Product[] {
  return Array.isArray(rows) ? rows.filter(isObj).map(normalizeProduct) : []
}
export function normalizeRecipes(rows: unknown): Recipe[] {
  return Array.isArray(rows) ? rows.filter(isObj).map(normalizeRecipe) : []
}
