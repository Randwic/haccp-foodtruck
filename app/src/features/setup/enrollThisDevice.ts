import type { CoreApi } from '../../core/api.ts'
import type { ManagerApi } from '../../manager/api.ts'

export type EnrollPhase = 'enroll' | 'sync'

/**
 * Enrôle cet appareil avec la session gérant en cours : device-enroll → core.enrollDevice → première synchro.
 * Un échec de la synchro n'est pas bloquant (l'appareil est enrôlé, l'équipe arrivera à la prochaine).
 */
export async function enrollThisDevice(manager: ManagerApi, core: CoreApi, name: string, onPhase?: (p: EnrollPhase) => void): Promise<void> {
  onPhase?.('enroll')
  const deviceName = name.trim() || 'Appareil'
  const { device_id, device_token } = await manager.enrollDevice(deviceName)
  await core.enrollDevice({ device_id, device_token, name: deviceName })
  onPhase?.('sync')
  try {
    await core.syncNow()
  } catch {
    /* l'indicateur de synchro affichera l'erreur */
  }
}
