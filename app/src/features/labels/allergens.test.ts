// Lot 4 bis : calcul récursif des allergènes (présents, traces, origine, anti-cycle) et données du menu.
import { describe, expect, it } from 'vitest'
import type { Product, Recipe } from '../../../../shared/payloads.ts'
import { normalizeProduct, normalizeRecipe } from '../../core/catalog.ts'
import { MENU_PRODUCTS, MENU_RECIPES } from '../../core/demoMenu.ts'
import { DEMO_PRODUCTS, DEMO_RECIPES } from '../../core/mockTransport.ts'
import { createMockManagerApi } from '../../manager/mockManager.ts'
import { normalizeProductInput, normalizeRecipeInput } from '../../manager/helpers.ts'
import { productTraces, recipeProfile, wouldCreateCycle } from './allergens.ts'
import { recipeAllergens, recipeTraces } from './model.ts'

const T = '2026-11-15T00:00:00.000Z'
const prod = (id: string, allergens: Product['allergens'], may_contain: Product['may_contain'] = []): Product => ({
  id,
  name: `Produit ${id}`,
  allergens,
  may_contain,
  storage: 'fridge',
  shelf_life_opened_hours: 48,
  shelf_life_thawed_hours: null,
  cook_min_c: null,
  active: true,
  updated_at: T,
})
const rec = (id: string, r: Partial<Recipe>): Recipe => ({
  id,
  name: `Recette ${id}`,
  kind: 'preparation',
  category: null,
  ingredient_product_ids: [],
  ingredient_recipe_ids: [],
  extra_allergens: [],
  may_contain: [],
  storage: 'fridge',
  shelf_life_hours: 24,
  active: true,
  updated_at: T,
  ...r,
})

const ALL_PRODUCTS = [...DEMO_PRODUCTS, ...MENU_PRODUCTS]
const ALL_RECIPES = [...DEMO_RECIPES, ...MENU_RECIPES]
const menu = (name: string) => ALL_RECIPES.find((r) => r.name.startsWith(name))!

describe('allergènes d’une recette (récursif)', () => {
  it('présents = produits + sous-recettes + ajoutés ; traces = union des may_contain moins les présents', () => {
    const products = [prod('a', ['gluten'], ['lait', 'soja']), prod('b', ['lait'], ['celeri']), prod('c', [], ['gluten', 'sesame'])]
    const sauce = rec('s', { ingredient_product_ids: ['b'], may_contain: ['moutarde'] })
    const plat = rec('p', { kind: 'menu_item', ingredient_product_ids: ['a', 'c'], ingredient_recipe_ids: ['s'], extra_allergens: ['oeufs'], may_contain: ['lait', 'lupin'], shelf_life_hours: null })
    const p = recipeProfile(plat, products, [sauce, plat])
    expect(p.present).toEqual(['gluten', 'oeufs', 'lait'])
    // lait (trace de a et de la recette) et gluten (trace de c) sont présents → retirés des traces.
    expect(p.traces).toEqual(['soja', 'celeri', 'moutarde', 'sesame', 'lupin'])
    expect(p.presentFrom.find((x) => x.allergen === 'lait')?.from).toEqual(['Recette s'])
    expect(p.presentFrom.find((x) => x.allergen === 'oeufs')?.from).toEqual(['ajouté à la recette'])
    expect(p.tracesFrom.find((x) => x.allergen === 'moutarde')?.from).toEqual(['Recette s'])
    expect(p.tracesFrom.find((x) => x.allergen === 'lupin')?.from).toEqual(['indiqué sur la recette'])
    expect(p.cycles).toEqual([])
  })

  it('plusieurs niveaux de sous-recettes', () => {
    const products = [prod('x', ['poissons'], ['crustaces'])]
    const r1 = rec('r1', { ingredient_product_ids: ['x'] })
    const r2 = rec('r2', { ingredient_recipe_ids: ['r1'] })
    const r3 = rec('r3', { ingredient_recipe_ids: ['r2'], extra_allergens: ['sesame'] })
    expect(recipeAllergens(r3, products, [r1, r2, r3])).toEqual(['poissons', 'sesame'])
    expect(recipeTraces(r3, products, [r1, r2, r3])).toEqual(['crustaces'])
  })

  it('anti-cycle : A → B → A ne boucle pas, le cycle est signalé, le reste est compté', () => {
    const products = [prod('a', ['gluten']), prod('b', ['lait'], ['soja'])]
    const A = rec('A', { ingredient_product_ids: ['a'], ingredient_recipe_ids: ['B'] })
    const B = rec('B', { ingredient_product_ids: ['b'], ingredient_recipe_ids: ['A'] })
    const self = rec('S', { ingredient_recipe_ids: ['S'], extra_allergens: ['lupin'] })
    const pa = recipeProfile(A, products, [A, B, self])
    expect(pa.present).toEqual(['gluten', 'lait'])
    expect(pa.traces).toEqual(['soja'])
    expect(pa.cycles).toEqual(['Recette A'])
    expect(recipeProfile(self, products, [self]).present).toEqual(['lupin'])
    // Ingrédient inconnu : ignoré.
    expect(recipeAllergens(rec('Z', { ingredient_product_ids: ['?'], ingredient_recipe_ids: ['??'] }), products, [])).toEqual([])
  })

  it('wouldCreateCycle : interdit la recette elle-même et toute préparation qui la contient déjà', () => {
    const A = rec('A', { ingredient_recipe_ids: ['B'] })
    const B = rec('B', { ingredient_recipe_ids: ['C'] })
    const C = rec('C', {})
    const list = [A, B, C]
    expect(wouldCreateCycle('C', 'A', list)).toBe(true)
    expect(wouldCreateCycle('C', 'C', list)).toBe(true)
    expect(wouldCreateCycle('A', 'C', list)).toBe(false)
    expect(wouldCreateCycle(undefined, 'A', list)).toBe(false)
  })

  it('productTraces retire les allergènes présents', () => {
    expect(productTraces({ allergens: ['gluten'], may_contain: ['gluten', 'lait'] })).toEqual(['lait'])
  })

  it('menu Space Diner : identique au tableau du propriétaire', () => {
    const check = (name: string, present: string[], traces: string[]) => {
      const p = recipeProfile(menu(name), ALL_PRODUCTS, ALL_RECIPES)
      expect([name, p.present, p.traces]).toEqual([name, present, traces])
    }
    check('Supernova', ['gluten', 'oeufs', 'poissons', 'lait', 'moutarde'], ['celeri', 'sulfites'])
    check('Houston', ['gluten', 'oeufs', 'lait', 'moutarde'], ['celeri', 'sulfites'])
    check('Comète', ['gluten', 'oeufs', 'lait', 'fruits_a_coque'], [])
    check('Vénus', ['gluten', 'oeufs', 'lait'], [])
    check('Frites nature', [], ['gluten'])
    check('Frites Roswell', ['lait'], ['gluten', 'sulfites'])
    check('Menu enfant', ['gluten'], ['oeufs', 'lait', 'celeri', 'moutarde'])
  })
})

describe('valeurs par défaut (serveur ou base plus anciens)', () => {
  it('produit lot 4 : aucune trace, pas de température ; recette lot 4 : préparation sans sous-recette', () => {
    const old = { id: 'p', name: 'Pain', allergens: ['sesame', 'gluten', 'inconnu'], storage: 'ambient', shelf_life_opened_hours: 48, shelf_life_thawed_hours: null, active: true, updated_at: T }
    expect(normalizeProduct(old)).toMatchObject({ allergens: ['gluten', 'sesame'], may_contain: [], cook_min_c: null })
    expect(normalizeProduct({ ...old, may_contain: ['gluten', 'lait'], cook_min_c: 63 })).toMatchObject({ may_contain: ['lait'], cook_min_c: 63 })
    const r = { id: 'r', name: 'Sauce', ingredient_product_ids: ['p'], extra_allergens: [], storage: 'fridge', shelf_life_hours: 72, active: true, updated_at: T }
    expect(normalizeRecipe(r)).toMatchObject({ kind: 'preparation', category: null, ingredient_recipe_ids: [], may_contain: [], shelf_life_hours: 72 })
    expect(normalizeRecipe({ ...r, kind: 'menu_item', category: ' Dessert ', ingredient_recipe_ids: ['r', 'x'] })).toMatchObject({ kind: 'menu_item', category: 'Dessert', ingredient_recipe_ids: ['x'], shelf_life_hours: null })
  })
})

describe('règles de saisie (espace gérant)', () => {
  it('produit : traces disjointes des allergènes, température 40..100 °C', () => {
    expect(normalizeProductInput({ allergens: ['gluten'], may_contain: ['gluten'] })).toMatchObject({ ok: false, field: 'may_contain' })
    expect(normalizeProductInput({ allergens: ['gluten'], may_contain: ['lait', 'soja'] })).toMatchObject({ ok: true, value: { may_contain: ['soja', 'lait'] } })
    expect(normalizeProductInput({ cook_min_c: 74 })).toMatchObject({ ok: true })
    expect(normalizeProductInput({ cook_min_c: 63.55 })).toMatchObject({ ok: false, field: 'cook_min_c' })
    expect(normalizeProductInput({ cook_min_c: 300 })).toMatchObject({ ok: false, field: 'cook_min_c' })
  })

  it('recette : plat du menu sans durée de vie, rubrique bornée, préparation avec durée obligatoire', () => {
    expect(normalizeRecipeInput({ kind: 'menu_item', category: '  Croq’Brioche ', shelf_life_hours: 24 })).toMatchObject({ ok: true, value: { category: 'Croq’Brioche', shelf_life_hours: null } })
    expect(normalizeRecipeInput({ kind: 'menu_item', category: 'x'.repeat(41) })).toMatchObject({ ok: false, field: 'category' })
    expect(normalizeRecipeInput({ kind: 'preparation', shelf_life_hours: null })).toMatchObject({ ok: false, field: 'shelf_life_hours' })
  })

  it('serveur simulé du gérant : refuse une boucle et un plat du menu utilisé comme sous-recette', async () => {
    const manager = createMockManagerApi({ seeded: true, signedIn: true, catalog: { products: ALL_PRODUCTS, recipes: ALL_RECIPES } })
    const ufo = menu('Sauce UFO')
    const base = await manager.addRecipe({ name: 'Base', kind: 'preparation', category: null, ingredient_product_ids: [], ingredient_recipe_ids: [ufo.id], extra_allergens: [], may_contain: [], storage: 'fridge', shelf_life_hours: 24 })
    await expect(manager.updateRecipe(ufo.id, { ingredient_recipe_ids: [base.id] })).rejects.toThrow(/elle-même/)
    await expect(
      manager.addRecipe({ name: 'X', kind: 'menu_item', category: null, ingredient_product_ids: [], ingredient_recipe_ids: [menu('Supernova').id], extra_allergens: [], may_contain: [], storage: 'fridge', shelf_life_hours: null }),
    ).rejects.toThrow(/Préparation inconnue/)
  })

  it('démo : les écritures du gérant sont répercutées sur le core factice (referenceSink)', async () => {
    const received: string[] = []
    const sink = { upsertSupplier: () => {}, upsertProduct: (p: Product) => received.push(p.name), upsertRecipe: (r: Recipe) => received.push(r.name), upsertCleaningTask: () => {}, upsertChecklist: () => {} }
    const manager = createMockManagerApi({ seeded: true, signedIn: true, referenceSink: sink })
    await manager.addProduct({ name: 'Oignons frits', allergens: ['gluten'], may_contain: [], storage: 'ambient', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: null })
    await manager.addRecipe({ name: 'Sauce oignon', kind: 'preparation', category: null, ingredient_product_ids: [], ingredient_recipe_ids: [], extra_allergens: [], may_contain: [], storage: 'fridge', shelf_life_hours: 48 })
    expect(received).toEqual(['Oignons frits', 'Sauce oignon'])
  })
})
