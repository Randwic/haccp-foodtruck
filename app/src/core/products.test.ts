// Lot 4 : produits et recettes reçus par sync-pull, migration de la base locale (version 3).
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_PRODUCTS, DEMO_RECIPES } from './mockTransport.ts'
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

    server.upsertProduct({ id: '00000000-0000-4000-8000-000000000499', name: 'Oignons rouges', allergens: [], storage: 'fridge', shelf_life_opened_hours: 48, shelf_life_thawed_hours: null, active: true })
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
    expect(db.verno).toBe(3)
    expect(await db.getMeta('since', 'absent')).toBeNull()
    expect(await db.products.count()).toBe(0)
    db.close()

    const core = createCore({ transport: createMockTransport(), dbName, background: false })
    await core.syncNow()
    expect((await core.listProducts()).length).toBe(DEMO_PRODUCTS.length)
    await core.dispose()
  })
})
