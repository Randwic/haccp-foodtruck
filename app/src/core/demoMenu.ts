// Échantillon réaliste du menu Space Diner (lot 4 bis), pour la démo, le mode essai et les tests.
// D'après le tableau des allergènes du propriétaire : Supernova (porc BBQ + Sauce UFO), Houston (poulet pané),
// Comète, Vénus, Frites nature, Frites Roswell, Menu enfant. Allergènes et traces indicatifs, à vérifier sur
// les fiches techniques des fournisseurs ; durées de vie et températures à confirmer selon le PMS.
import type { Product, Recipe } from '../../../shared/payloads.ts'
import { DEMO_PRODUCTS } from './mockTransport.ts'

const T = '2026-11-12T10:00:00.000Z'
const pid = (n: number) => `5d1e0000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const rid = (n: number) => `5d1e0000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`
const CHEDDAR = DEMO_PRODUCTS[1].id
const FRITES = DEMO_PRODUCTS[4].id

type P = Omit<Product, 'id' | 'active' | 'updated_at'>
const product = (n: number, p: P): Product => ({ id: pid(n), ...p, active: true, updated_at: T })

export const MENU_PRODUCTS: Product[] = [
  product(1, { name: 'Pain brioché', allergens: ['gluten', 'oeufs', 'lait'], may_contain: [], storage: 'ambient', shelf_life_opened_hours: 48, shelf_life_thawed_hours: 48, cook_min_c: null }),
  product(2, { name: 'Porc effiloché BBQ', allergens: [], may_contain: ['celeri', 'sulfites'], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, cook_min_c: 63 }),
  product(3, { name: 'Filet de poulet pané', allergens: ['gluten'], may_contain: ['celeri', 'moutarde'], storage: 'freezer', shelf_life_opened_hours: null, shelf_life_thawed_hours: 24, cook_min_c: 74 }),
  product(4, { name: 'Nuggets de poulet', allergens: ['gluten'], may_contain: ['oeufs', 'lait', 'celeri', 'moutarde'], storage: 'freezer', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: 74 }),
  product(5, { name: 'Mayonnaise (seau)', allergens: ['oeufs', 'moutarde'], may_contain: ['celeri', 'sulfites'], storage: 'fridge', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: null }),
  product(6, { name: 'Filets d’anchois', allergens: ['poissons'], may_contain: [], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, cook_min_c: null }),
  product(7, { name: 'Pâte à tartiner noisette', allergens: ['lait', 'fruits_a_coque'], may_contain: [], storage: 'ambient', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: null }),
  product(8, { name: 'Sauce cheddar (poche)', allergens: ['lait'], may_contain: ['sulfites'], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, cook_min_c: 63 }),
  product(9, { name: 'Ketchup', allergens: [], may_contain: [], storage: 'ambient', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: null }),
  product(10, { name: 'Compote en gourde', allergens: [], may_contain: [], storage: 'ambient', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, cook_min_c: null }),
  product(11, { name: 'Crème chantilly', allergens: ['lait'], may_contain: [], storage: 'fridge', shelf_life_opened_hours: 48, shelf_life_thawed_hours: null, cook_min_c: null }),
]
const [BRIOCHE, PORC, POULET, NUGGETS, MAYO, ANCHOIS, PATE, SAUCE_CHEDDAR, KETCHUP, COMPOTE, CHANTILLY] = MENU_PRODUCTS.map((p) => p.id)

type R = Omit<Recipe, 'id' | 'active' | 'updated_at' | 'extra_allergens' | 'may_contain' | 'ingredient_recipe_ids' | 'storage'> & Partial<Pick<Recipe, 'extra_allergens' | 'may_contain' | 'ingredient_recipe_ids' | 'storage'>>
const recipe = (n: number, r: R): Recipe => ({ id: rid(n), extra_allergens: [], may_contain: [], ingredient_recipe_ids: [], storage: 'fridge', ...r, active: true, updated_at: T })

export const SAUCE_UFO_ID = rid(1)
export const MENU_RECIPES: Recipe[] = [
  recipe(1, { name: 'Sauce UFO', kind: 'preparation', category: null, ingredient_product_ids: [MAYO, ANCHOIS], shelf_life_hours: 72 }),
  recipe(2, { name: 'Supernova', kind: 'menu_item', category: "Croq'Brioche", ingredient_product_ids: [BRIOCHE, PORC, CHEDDAR], ingredient_recipe_ids: [SAUCE_UFO_ID], shelf_life_hours: null }),
  recipe(3, { name: 'Houston', kind: 'menu_item', category: "Croq'Brioche", ingredient_product_ids: [BRIOCHE, POULET, CHEDDAR, MAYO], shelf_life_hours: null }),
  recipe(4, { name: 'Comète', kind: 'menu_item', category: 'Dessert', ingredient_product_ids: [BRIOCHE, PATE], shelf_life_hours: null }),
  recipe(5, { name: 'Vénus', kind: 'menu_item', category: 'Dessert', ingredient_product_ids: [BRIOCHE, CHANTILLY], shelf_life_hours: null }),
  recipe(6, { name: 'Frites nature (avec un Croq’Brioche ou en barquette)', kind: 'menu_item', category: 'Frites', ingredient_product_ids: [FRITES], may_contain: ['gluten'], storage: 'ambient', shelf_life_hours: null }),
  recipe(7, { name: 'Frites Roswell (supplément ou barquette)', kind: 'menu_item', category: 'Frites', ingredient_product_ids: [FRITES, SAUCE_CHEDDAR], may_contain: ['gluten'], storage: 'ambient', shelf_life_hours: null }),
  recipe(8, { name: 'Menu enfant (nuggets, frites, ketchup, compote)', kind: 'menu_item', category: 'Menu enfant', ingredient_product_ids: [NUGGETS, FRITES, KETCHUP, COMPOTE], storage: 'ambient', shelf_life_hours: null }),
]
