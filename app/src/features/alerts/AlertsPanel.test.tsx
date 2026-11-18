// Lot 6 : alertes du serveur sur l'écran Aujourd'hui (affichage, « Vu », « Ouvrir »), règles d'affichage.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Alert } from '../../../../shared/payloads.ts'
import { createFakeCore } from '../../ui/fakeCore.ts'
import { renderWithCore } from '../../ui/testUtils.tsx'
import { AlertsPanel } from './AlertsPanel.tsx'
import { demoAlerts } from './demoData.ts'
import { acknowledgedIds, alertsToNotify, alertTarget, buildAlertViews, processViewOf } from './model.ts'
import { vapidKeyBytes } from './pushSetup.ts'

const NOW = new Date('2026-11-18T09:30:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('règles d’affichage (model)', () => {
  const alerts = demoAlerts(NOW)

  it('non vues d’abord (plus récentes en tête), puis vues ; résolues exclues ; « vu » local pris en compte', () => {
    const resolved: Alert = { ...alerts[0], id: 'resolue', resolved_at: NOW.toISOString() }
    const views = buildAlertViews([...alerts, resolved], new Set([alerts[1].id]))
    expect(views.map((v) => [v.alert.id, v.seen])).toEqual([
      [alerts[2].id, false],
      [alerts[0].id, false],
      [alerts[1].id, true], // vu sur cet appareil, pas encore remonté
      [alerts[3].id, true], // pris en compte sur le serveur
    ])
    expect(views[0].title).toBe('Procédé non clôturé')
  })

  it('écran à ouvrir selon le type d’alerte', () => {
    expect(alertTarget({ kind: 'check_overdue', equipment_id: 'e' })).toBe('temperatures')
    expect(alertTarget({ kind: 'corrective_action_missing', equipment_id: 'e' })).toBe('temperatures')
    expect(alertTarget({ kind: 'corrective_action_missing', equipment_id: null })).toBe('processes')
    expect(alertTarget({ kind: 'process_overdue', equipment_id: null })).toBe('processes')
    expect(alertTarget({ kind: 'sensor_battery_low', equipment_id: 'e' })).toBeNull()
    expect(processViewOf('Remise en température « Chili » non clôturée')).toBe('reheating')
    expect(processViewOf('Refroidissement « Chili » non clôturé')).toBe('cooling')
    expect(processViewOf('Cuisson « Steak » : 50 °C hors seuil')).toBe('cooking')
  })

  it('notifications : seulement les non vues pas encore signalées', () => {
    const views = buildAlertViews(alerts, new Set())
    expect(alertsToNotify(views, new Set([alerts[0].id])).map((v) => v.alert.id)).toEqual([alerts[2].id, alerts[1].id])
  })

  it('acknowledgedIds lit les records alert_ack', () => {
    const rec = { type: 'alert_ack', payload: { alert_id: 'x' } } as never
    expect([...acknowledgedIds([rec])]).toEqual(['x'])
  })

  it('clé VAPID base64url → 65 octets', () => {
    const raw = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i))
    const b64url = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect([...vapidKeyBytes(b64url)]).toEqual([...raw])
  })
})

describe('bloc Alertes', () => {
  function setup(alerts: Alert[]) {
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', autoSyncDelayMs: null, alerts })
    const onOpenTemperatures = vi.fn()
    const onOpenProcess = vi.fn()
    renderWithCore(core, <AlertsPanel onOpenTemperatures={onOpenTemperatures} onOpenProcess={onOpenProcess} />)
    return { core, onOpenTemperatures, onOpenProcess }
  }

  it('affiche les alertes non vues avec leur message ; « Vu » enregistre la prise en compte', async () => {
    const alerts = demoAlerts(NOW)
    const { core } = setup(alerts)
    expect(await screen.findByRole('heading', { name: '3 alertes à voir' })).toBeTruthy()
    expect(screen.getByText('Frigo 1 : relevé de 08:00 non fait')).toBeTruthy()
    expect(screen.getByText('Refroidissement « Chili » non clôturé : démarré 10:05, durée max 120 min')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Marquer comme vue : Relevé en retard — Frigo 1/ }))
    await screen.findByRole('heading', { name: '2 alertes à voir' })
    const acks = await core.listRecords({ type: 'alert_ack' })
    expect(acks.map((r) => r.payload)).toEqual([{ alert_id: alerts[0].id }])
  })

  it('« Ouvrir » mène au bon écran', async () => {
    const { onOpenTemperatures, onOpenProcess } = setup(demoAlerts(NOW))
    const rows = await screen.findAllByRole('listitem')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Ouvrir' })) // refroidissement (le plus récent)
    expect(onOpenProcess).toHaveBeenCalledWith('cooling')
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Ouvrir' }))
    expect(onOpenTemperatures).toHaveBeenCalled()
  })

  it('« Tout marquer comme vu » puis plus aucune alerte à voir ; les alertes vues restent listées', async () => {
    const { core } = setup(demoAlerts(NOW))
    fireEvent.click(await screen.findByRole('button', { name: 'Tout marquer comme vu' }))
    expect(await screen.findByRole('heading', { name: 'Alertes vues, toujours en cours' })).toBeTruthy()
    expect(await core.listRecords({ type: 'alert_ack' })).toHaveLength(3)
    expect(screen.getAllByText(/déjà vue, toujours en cours/)).toHaveLength(4)
  })

  it('au-delà de 3 alertes : les autres sont repliées', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...demoAlerts(NOW)[0], id: `a0000000-0000-4000-8000-00000000010${i}`, message: `Enceinte ${i} : relevé non fait` }))
    setup(many)
    await screen.findByRole('heading', { name: '5 alertes à voir' })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Voir les 2 autres alertes' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('aucune alerte : pas de bloc rouge', async () => {
    setup([])
    await waitFor(() => expect(screen.queryByRole('heading', { name: /alerte/ })).toBeNull())
  })
})
