// Tableau des allergènes pour la clientèle (lot 4 bis) — calcul pur, testé dans allergens.test.ts.
// Seuls les plats du menu (kind 'menu_item') actifs, groupés par rubrique dans l'ordre du menu Space Diner
// (Croq'Brioche, Dessert, Frites, Menu enfant, puis les autres rubriques, puis « Autres plats »),
// avec ● présents et ○ « peut en contenir » calculés récursivement (allergens.ts).
import type { Allergen, Product, Recipe } from '../../../../shared/payloads.ts'
import { MENU_CATEGORIES } from '../../manager/helpers.ts'
import { allergenProfile, catalogOf } from './allergens.ts'

export const ALLERGEN_TABLE_TITLE = 'Allergènes'
export const ALLERGEN_TABLE_SUBTITLE = 'Les 14 allergènes à déclarer, recette par recette'
export const LEGEND_PRESENT = 'présent dans la recette'
export const LEGEND_TRACES = 'peut en contenir (selon le produit du fournisseur)'
/** Mention du propriétaire (tableau Space Diner). */
export const ALLERGEN_NOTICE = [
  'Tout est préparé dans la même remorque, avec une friteuse commune aux frites et aux nuggets : des traces d’autres allergènes sont possibles.',
  'Boissons : voir l’étiquette de chaque canette ou bouteille.',
] as const
export const ALLERGEN_CALLOUT = ['Une allergie ?', 'Parle-nous-en avant de commander.'] as const
export const OTHER_DISHES = 'Autres plats'

export interface AllergenTableRow {
  name: string
  /** ● présents. */
  allergens: readonly Allergen[]
  /** ○ peut en contenir (sans les présents). */
  traces: readonly Allergen[]
}
export interface AllergenTableGroup {
  title: string
  rows: AllergenTableRow[]
}
export interface AllergenTable {
  groups: AllergenTableGroup[]
  /** Dernière modification d'un plat ou d'un ingrédient utilisé (ISO), ou null. */
  updatedAt: string | null
}

/** Ordre des rubriques : celui du menu, puis les autres (alphabétique), « Autres plats » en dernier. */
export function categoryOrder(a: string, b: string): number {
  const rank = (c: string) => {
    if (c === OTHER_DISHES) return 1000
    const i = (MENU_CATEGORIES as readonly string[]).findIndex((m) => m.localeCompare(c, 'fr', { sensitivity: 'base' }) === 0)
    return i < 0 ? 100 : i
  }
  return rank(a) - rank(b) || a.localeCompare(b, 'fr')
}

/** Lignes du tableau : plats du menu actifs, groupés par rubrique (l'ordre des plats suit le nom). */
export function menuAllergenTable(recipes: readonly Recipe[], products: readonly Product[]): AllergenTable {
  const catalog = catalogOf(products, recipes)
  const dishes = recipes.filter((r) => r.active && r.kind === 'menu_item').sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const groups = new Map<string, AllergenTableRow[]>()
  const dates: string[] = []
  for (const r of dishes) {
    const p = allergenProfile(r, catalog)
    const title = r.category?.trim() || OTHER_DISHES
    groups.set(title, [...(groups.get(title) ?? []), { name: r.name, allergens: p.present, traces: p.traces }])
    // Date de mise à jour : le plat et tout ce qu'il utilise (récursivement).
    const seen = new Set<string>()
    const visit = (x: Recipe) => {
      if (seen.has(x.id)) return
      seen.add(x.id)
      dates.push(x.updated_at)
      x.ingredient_product_ids.forEach((id) => {
        const pr = catalog.products.get(id)
        if (pr) dates.push(pr.updated_at)
      })
      x.ingredient_recipe_ids.forEach((id) => {
        const sub = catalog.recipes.get(id)
        if (sub) visit(sub)
      })
    }
    visit(r)
  }
  dates.sort()
  return {
    groups: [...groups.entries()].sort(([a], [b]) => categoryOrder(a, b)).map(([title, rows]) => ({ title, rows })),
    updatedAt: dates[dates.length - 1] ?? null,
  }
}
