// Lot 4 : produits et recettes reçus par sync-pull, migration de la base locale (version 3).
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_CHECKLISTS, DEMO_CLEANING_TASKS, DEMO_PRODUCTS, DEMO_RECIPES } from './mockTransport.ts'
import { CoreDb } from './db.ts'
import { createCore } from './core.ts'
import { disposeAll, enrollAndUnlock, makeHarness, uniqueDbName } from './testUtils.ts'
import { createMockTransport, DEMO_DEVICE } from './mockTransport.ts'

afterEach(disposeAll)

describe('produits et recettes (sync-pull)', () => {
  it('stockés localement, triés par nom ; un produit désactivé reste lisible mais inactif', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const products = await core.listProducts()
    expect(products).toHaveLength(DEMO_PRODUCTS.length)
    expect(products[0].name).toBe('Bacon en tranches')
    expect(products.find((p) => p.name === 'Pain burger')?.allergens).toEqual(['gluten', 'sesame'])
    expect((await core.listRecipes()).map((r) => r.name)).toEqual(['Sauce cheddar maison'])

    server.upsertProduct({ id: '00000000-0000-4000-8000-000000000499', name: 'Oignons rouges', allergens: [], storage: 'fridge', shelf_life_opened_hours: 48, shelf_life_thawed_hours: null, may_contain: [], cook_min_c: null, active: true })
    server.deactivate('products', DEMO_PRODUCTS[7].id)
    server.deactivate('recipes', DEMO_RECIPES[0].id)
    await core.syncNow()
    const names = (await core.listProducts()).map((p) => p.name)
    expect(names).toContain('Oignons rouges')
    expect(names).not.toContain('Cornichons')
    expect((await core.listProducts({ includeInactive: true })).find((p) => p.id === DEMO_PRODUCTS[7].id)?.active).toBe(false)
    expect(await core.listRecipes()).toEqual([])
    expect((await core.listRecipes({ includeInactive: true }))[0].active).toBe(false)
  })

  it('lot 5 : tâches de nettoyage et checklists exposées, triées par nom ; désactivées lisibles avec includeInactive', async () => {
    const { core, server } = makeHarness()
    await enrollAndUnlock(core)
    const tasks = await core.listCleaningTasks()
    expect(tasks).toHaveLength(DEMO_CLEANING_TASKS.length)
    expect(tasks[0].name).toBe('Congélateur — dégivrage')
    expect((await core.listChecklists()).map((c) => c.name)).toEqual(['Contrôle nuisibles', 'Fermeture', 'Ouverture'])
    expect((await core.listChecklists()).find((c) => c.kind === 'opening')?.items).toHaveLength(6)

    server.upsertChecklist({ ...DEMO_CHECKLISTS[0], items: [...DEMO_CHECKLISTS[0].items, { id: 'gants', label: 'Gants disponibles', required: false }] })
    server.deactivate('cleaning_tasks', DEMO_CLEANING_TASKS[10].id)
    await core.syncNow()
    expect((await core.listChecklists()).find((c) => c.kind === 'opening')?.items.at(-1)).toEqual({ id: 'gants', label: 'Gants disponibles', required: false })
    expect((await core.listCleaningTasks()).map((t) => t.id)).not.toContain(DEMO_CLEANING_TASKS[10].id)
    expect((await core.listCleaningTasks({ includeInactive: true })).find((t) => t.id === DEMO_CLEANING_TASKS[10].id)?.active).toBe(false)
  })

  it('serveur plus ancien (sans products/recipes dans la réponse) : rien ne casse', async () => {
    const { core } = makeHarness({
      transport: (server) => ({
        push: (r, a) => server.push(r, a),
        async pull(since, auth) {
          const res = await server.pull(since, auth)
          const old = { ...res } as Partial<typeof res>
          delete old.products
          delete old.recipes
          delete old.cleaning_tasks
          delete old.checklists
          return old as typeof res
        },
        uploadPhoto: (p, b, a) => server.uploadPhoto!(p, b, a),
      }),
    })
    await enrollAndUnlock(core)
    expect(await core.listProducts()).toEqual([])
    expect(await core.listCleaningTasks()).toEqual([])
    expect(await core.listChecklists()).toEqual([])
    expect((await core.listStaff()).length).toBeGreaterThan(0)
  })

  it('migration v2 → v3 : les enregistrements sont conservés et le prochain sync-pull est complet', async () => {
    const dbName = uniqueDbName()
    // Base « lot 3 » : schéma version 2, déjà synchronisée (since posé), sans produits.
    const v2 = new Dexie(dbName)
    v2.version(1).stores({
      device: '&key',
      records: '&id, &[device_id+device_seq], type, device_time',
      record_sync: '&id, [state+device_seq], state',
      chain: '&device_id',
      staff: '&id',
      equipment: '&id',
      thresholds: '&id',
      pin_attempts: '&staff_id',
      meta: '&key',
    })
    v2.version(2).stores({ photos: '&path, state, created_at', suppliers: '&id' })
    await v2.open()
    await v2.table('device').put({ key: 'self', device_id: DEMO_DEVICE.device_id, device_token: DEMO_DEVICE.device_token, name: 'iPad', enrolled_at: '2026-11-01T00:00:00.000Z' })
    await v2.table('meta').put({ key: 'since', value: '2099-01-01T00:00:00.000Z' })
    v2.close()

    const db = new CoreDb(dbName)
    await db.open()
    expect(db.verno).toBe(5) // v4 puis v5 (lot 6, alertes) appliquées à la suite
    expect(await db.getMeta('since', 'absent')).toBeNull()
    expect(await db.products.count()).toBe(0)
    db.close()

    const core = createCore({ transport: createMockTransport(), dbName, background: false })
    await core.syncNow()
    expect((await core.listProducts()).length).toBe(DEMO_PRODUCTS.length)
    await core.dispose()
  })

  it('migration v3 → v4 (lot 4 bis) : produits / recettes complétés, sync-pull complet, registre intact', async () => {
    const dbName = uniqueDbName()
    const v3 = new Dexie(dbName)
    v3.version(1).stores({
      device: '&key',
      records: '&id, &[device_id+device_seq], type, device_time',
      record_sync: '&id, [state+device_seq], state',
      chain: '&device_id',
      staff: '&id',
      equipment: '&id',
      thresholds: '&id',
      pin_attempts: '&staff_id',
      meta: '&key',
    })
    v3.version(2).stores({ photos: '&path, state, created_at', suppliers: '&id' })
    v3.version(3).stores({ products: '&id', recipes: '&id', cleaning_tasks: '&id', checklists: '&id' })
    await v3.open()
    const T = '2026-11-01T00:00:00.000Z'
    await v3.table('products').put({ id: 'p1', name: 'Pain', allergens: ['gluten'], storage: 'ambient', shelf_life_opened_hours: 48, shelf_life_thawed_hours: null, active: true, updated_at: T })
    await v3.table('recipes').put({ id: 'r1', name: 'Sauce', ingredient_product_ids: ['p1'], extra_allergens: [], storage: 'fridge', shelf_life_hours: 72, active: true, updated_at: T })
    await v3.table('records').add({ id: 'rec-1', device_id: 'd', device_seq: 1, type: 'system_test', payload: {}, author_id: 'a', device_time: T, prev_hash: 'x', hash: 'y', supersedes_id: null })
    await v3.table('meta').put({ key: 'since', value: '2099-01-01T00:00:00.000Z' })
    v3.close()

    const db = new CoreDb(dbName)
    await db.open()
    expect(db.verno).toBe(5) // v4 puis v5 (lot 6, alertes) appliquées à la suite
    expect(await db.getMeta('since', 'absent')).toBeNull()
    expect(await db.products.get('p1')).toMatchObject({ may_contain: [], cook_min_c: null, shelf_life_opened_hours: 48 })
    expect(await db.recipes.get('r1')).toMatchObject({ kind: 'preparation', category: null, ingredient_recipe_ids: [], may_contain: [], shelf_life_hours: 72 })
    expect(await db.records.count()).toBe(1)
    db.close()
  })

  it('sync-pull d’un serveur sans les champs du lot 4 bis : valeurs par défaut', async () => {
    const { core } = makeHarness({
      transport: (server) => ({
        push: (r, a) => server.push(r, a),
        async pull(since, auth) {
          const res = await server.pull(since, auth)
          const strip = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
          return {
            ...res,
            products: res.products?.map((p) => strip(p, ['may_contain', 'cook_min_c'])),
            recipes: res.recipes?.map((r) => strip(r, ['kind', 'category', 'ingredient_recipe_ids', 'may_contain'])),
          } as typeof res
        },
        uploadPhoto: (p, b, a) => server.uploadPhoto!(p, b, a),
      }),
    })
    await enrollAndUnlock(core)
    expect((await core.listProducts()).every((p) => Array.isArray(p.may_contain) && p.cook_min_c === null)).toBe(true)
    expect((await core.listRecipes())[0]).toMatchObject({ kind: 'preparation', ingredient_recipe_ids: [], may_contain: [] })
  })
})
