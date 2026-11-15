// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncPullResponse } from '../../../shared/types.ts'
import type { MemoryRepo } from './memory_repo.ts'
import { createSyncPullHandler, PULL_OVERLAP_MS } from './sync_pull.ts'
import {
  CHECKLIST_ID,
  CLEANING_TASK_ID,
  FRIDGE_ID,
  INACTIVE_STAFF_ID,
  NOW,
  PRODUCT_ID,
  RECIPE_ID,
  STAFF_ID,
  SUPPLIER_ID,
  TOKEN,
  memoryLogger,
  seededRepo,
} from './test_helpers.ts'

let repo: MemoryRepo
let handler: (req: Request) => Promise<Response>

beforeEach(async () => {
  repo = await seededRepo()
  repo.thresholds.push({
    id: '00000000-0000-4000-8000-0000000000c1',
    equipment_id: FRIDGE_ID,
    check_type: 'temperature_check',
    min_c: 0,
    max_c: 4,
    tolerance_minutes: 20,
    updated_at: '2026-11-01T00:00:00.000Z',
  })
  handler = createSyncPullHandler({ repo, logger: memoryLogger(), allowedOrigins: [], now: () => NOW })
})

function pullReq(since?: string, token: string | null = TOKEN): Request {
  const url = new URL('https://fn.example/sync-pull')
  if (since !== undefined) url.searchParams.set('since', since)
  return new Request(url, { headers: token ? { 'x-device-token': token } : {} })
}

async function pull(since?: string): Promise<SyncPullResponse> {
  const res = await handler(pullReq(since))
  expect(res.status).toBe(200)
  return (await res.json()) as SyncPullResponse
}

describe('sync-pull', () => {
  it('authentifie l’appareil (401 sans jeton, 401 device_revoked)', async () => {
    expect((await handler(pullReq(undefined, null))).status).toBe(401)
    repo.devices[0].revoked_at = NOW.toISOString()
    const res = await handler(pullReq())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'device_revoked' })
  })
  it('sans since : tout, staff actifs seulement (avec sel et hash du PIN), aucun deleted', async () => {
    const out = await pull()
    expect(out.server_now).toBe(NOW.toISOString())
    expect(out.establishment).toEqual(repo.establishment)
    expect(out.staff.map((s) => s.id)).toEqual([STAFF_ID])
    expect(out.staff[0]).toMatchObject({ pin_salt: 'c2Fs', pin_hash: 'aGFzaA==' })
    expect(out.equipment.map((e) => e.id)).toEqual([FRIDGE_ID])
    expect(out.thresholds).toHaveLength(1)
    expect(out.settings).toEqual({ retention_years: 3, auto_lock_minutes: 2, clock_suspect_minutes: 5, email_alerts: true, daily_check_times: ['08:00', '18:00'], missed_slot_carry_over: true, thaw_dlc_days: 3, oil_polar_max: 25, oil_polar_warn: 22 })
    expect(out.deleted).toEqual([])
  })
  it('since vide = tout', async () => {
    expect((await pull('')).staff).toHaveLength(1)
  })
  it('avec since : seulement les modifications, et les désactivations dans deleted', async () => {
    repo.equipment.push({ id: '00000000-0000-4000-8000-0000000000e2', name: 'Frigo 2', kind: 'fridge', active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    const out = await pull('2026-11-05T00:00:00.000Z')
    expect(out.staff).toEqual([])
    expect(out.equipment).toEqual([])
    expect(out.thresholds).toEqual([])
    expect(out.deleted).toEqual([
      { table: 'staff', id: INACTIVE_STAFF_ID },
      { table: 'equipment', id: '00000000-0000-4000-8000-0000000000e2' },
    ])
    // Données toujours présentes même sans modification
    expect(out.settings.retention_years).toBe(3)
    expect(out.establishment.timezone).toBe('Europe/Paris')
  })
  it(`applique un recouvrement de ${PULL_OVERLAP_MS / 60000} min sur since (transactions en vol)`, async () => {
    repo.staff[0].updated_at = '2026-11-14T09:58:00.000Z'
    const out = await pull('2026-11-14T10:00:00.000Z')
    expect(out.staff.map((s) => s.id)).toEqual([STAFF_ID])
  })
  it('n’expose pas de champs hors contrat', async () => {
    ;(repo.staff[0] as unknown as Record<string, unknown>).email = 'secret@example.com'
    const out = await pull()
    expect(Object.keys(out.staff[0]).sort()).toEqual(['active', 'display_name', 'id', 'pin_hash', 'pin_salt', 'role', 'updated_at'])
  })
  it('fournisseurs : actifs seulement, champs du contrat, désactivés dans deleted (lot 3)', async () => {
    const OLD = '00000000-0000-4000-8000-0000000000b2'
    repo.suppliers.push({ id: OLD, name: 'Ancien grossiste', phone: null, email: 'contact@example.test', active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    ;(repo.suppliers[0] as unknown as Record<string, unknown>).siret = '123'
    const all = await pull()
    expect(all.suppliers).toEqual([
      { id: SUPPLIER_ID, name: 'Boucherie Martin', phone: '0102030405', email: null, active: true, updated_at: '2026-11-01T00:00:00.000Z' },
    ])
    expect(all.deleted).toEqual([])
    const since = await pull('2026-11-05T00:00:00.000Z')
    expect(since.suppliers).toEqual([])
    expect(since.deleted).toContainEqual({ table: 'suppliers', id: OLD })
  })
  it('produits et recettes : actifs seulement, champs du contrat, désactivés dans deleted (lot 4)', async () => {
    const OLD_P = '00000000-0000-4000-8000-0000000000c5'
    const OLD_R = '00000000-0000-4000-8000-0000000000c6'
    repo.products.push({ id: OLD_P, name: 'Ancien pain', allergens: ['gluten'], storage: 'ambient', shelf_life_opened_hours: null, shelf_life_thawed_hours: null, active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    repo.recipes.push({ id: OLD_R, name: 'Ancienne sauce', ingredient_product_ids: [], extra_allergens: [], storage: 'fridge', shelf_life_hours: 24, active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    ;(repo.products[0] as unknown as Record<string, unknown>).created_at = '2026-01-01'
    ;(repo.recipes[0] as unknown as Record<string, unknown>).notes = 'interne'
    const all = await pull()
    expect(all.products).toEqual([
      { id: PRODUCT_ID, name: 'Cheddar tranches', allergens: ['lait'], storage: 'fridge', shelf_life_opened_hours: 72, shelf_life_thawed_hours: null, active: true, updated_at: '2026-11-01T00:00:00.000Z' },
    ])
    expect(all.recipes).toEqual([
      { id: RECIPE_ID, name: 'Sauce cheddar maison', ingredient_product_ids: [PRODUCT_ID], extra_allergens: ['gluten'], storage: 'fridge', shelf_life_hours: 72, active: true, updated_at: '2026-11-01T00:00:00.000Z' },
    ])
    expect(all.deleted).toEqual([])
    const since = await pull('2026-11-05T00:00:00.000Z')
    expect(since.products).toEqual([])
    expect(since.recipes).toEqual([])
    expect(since.deleted).toEqual(expect.arrayContaining([{ table: 'products', id: OLD_P }, { table: 'recipes', id: OLD_R }]))
  })
  it('tâches de nettoyage et checklists : actives seulement, champs du contrat, désactivées dans deleted (lot 5)', async () => {
    const OLD_T = '00000000-0000-4000-8000-000000000502'
    const OLD_C = '00000000-0000-4000-8000-000000000552'
    repo.cleaningTasks.push({ id: OLD_T, name: 'Ancienne tâche', frequency: 'weekly', product: null, method: null, active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    repo.checklists.push({ id: OLD_C, name: 'Ancienne', kind: 'other', items: [{ id: 'a', label: 'A', required: false }], active: false, updated_at: '2026-11-12T00:00:00.000Z' })
    ;(repo.cleaningTasks[0] as unknown as Record<string, unknown>).created_at = '2026-01-01'
    ;(repo.checklists[0] as unknown as Record<string, unknown>).created_at = '2026-01-01'
    ;(repo.checklists[0].items[0] as unknown as Record<string, unknown>).internal = 'x'
    const all = await pull()
    expect(all.cleaning_tasks).toEqual([
      {
        id: CLEANING_TASK_ID,
        name: 'Plans de travail',
        frequency: 'after_service',
        product: 'Détergent-désinfectant contact alimentaire',
        method: null,
        active: true,
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    ])
    expect(all.checklists).toEqual([
      {
        id: CHECKLIST_ID,
        name: 'Ouverture',
        kind: 'opening',
        items: [
          { id: 'lave_mains', label: 'Lave-mains approvisionné', required: true },
          { id: 'eau_potable', label: 'Eau potable disponible', required: true },
        ],
        active: true,
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    ])
    expect(all.deleted).toEqual([])
    const since = await pull('2026-11-05T00:00:00.000Z')
    expect(since.cleaning_tasks).toEqual([])
    expect(since.checklists).toEqual([])
    expect(since.deleted).toEqual(expect.arrayContaining([{ table: 'cleaning_tasks', id: OLD_T }, { table: 'checklists', id: OLD_C }]))
  })
  it('400 si since n’est pas une date', async () => {
    const res = await handler(pullReq('hier'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })
  it('503 not_configured si établissement ou paramètres absents', async () => {
    repo.settings = null
    expect((await handler(pullReq())).status).toBe(503)
  })
  it('met à jour last_seen_at', async () => {
    await pull()
    expect(repo.devices[0].last_seen_at).toBe(NOW.toISOString())
  })
  it('405 en POST', async () => {
    expect((await handler(new Request('https://fn.example/sync-pull', { method: 'POST' }))).status).toBe(405)
  })
})
