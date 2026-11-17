// Chargement des données du mode Contrôle : registre du serveur (tous appareils) si le gérant est connecté,
// complété par les saisies de cet appareil pas encore envoyées ; sinon, saisies de cet appareil seulement.
import type { Checklist, CleaningTask, DocumentRef, Supplier } from '../../../../shared/payloads.ts'
import type { Equipment, HaccpRecord, Threshold } from '../../../../shared/types.ts'
import type { CoreApi } from '../../core/api.ts'
import type { ManagedDevice, ManagedStaff, ManagerApi, RegistryRecord } from '../../manager/api.ts'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import type { ControlRefs } from './model.ts'

export interface ControlData {
  /** 'server' : registre complet (tous appareils) ; 'device' : cet appareil seulement (hors connexion). */
  source: 'server' | 'device'
  records: (HaccpRecord & { clock_suspect?: boolean; quarantine_reason?: string | null })[]
  pendingIds: Set<string>
  refs: ControlRefs
  establishmentName: string
  staff: Pick<ManagedStaff, 'id' | 'display_name' | 'role' | 'active'>[]
  equipment: Equipment[]
  thresholds: Threshold[]
  devices: ManagedDevice[]
  /** null : pas de connexion gérant (liste non disponible). */
  documents: DocumentRef[] | null
  /** Message si le serveur n'a pas pu être lu (repli sur l'appareil). */
  fallbackReason: string | null
}

/**
 * `manager` null : hors connexion ou sans session gérant. Le registre du serveur est lu sur [from, to] ;
 * les saisies locales sont toutes lues (l'appareil n'en garde que quelques milliers).
 */
export async function loadControlData(core: CoreApi, manager: ManagerApi | null, range: { from: Date; to: Date }): Promise<ControlData> {
  const [local, establishment, deviceInfo] = await Promise.all([core.listRecords(), core.getEstablishment(), core.getDevice()])
  const timeZone = establishment?.timezone || DEFAULT_TIMEZONE

  let server: RegistryRecord[] | null = null
  let fallbackReason: string | null = null
  let staff: ControlData['staff'] = []
  let equipment: Equipment[] = []
  let suppliers: Supplier[] = []
  let tasks: CleaningTask[] = []
  let checklists: Checklist[] = []
  let devices: ManagedDevice[] = []
  let documents: DocumentRef[] | null = null
  let thresholds: Threshold[] = []

  if (manager) {
    try {
      ;[server, staff, equipment, suppliers, tasks, checklists, devices, documents, thresholds] = await Promise.all([
        manager.listRegistry({ from: range.from.toISOString(), to: range.to.toISOString() }),
        manager.listStaff(),
        manager.listEquipment(),
        manager.listSuppliers(),
        manager.listCleaningTasks(),
        manager.listChecklists(),
        manager.listDevices(),
        manager.listDocuments(),
        manager.listThresholds(),
      ])
    } catch (e) {
      server = null
      fallbackReason = e instanceof Error ? e.message : String(e)
    }
  }
  if (!server) {
    const [s, eq, sup, t, c, th] = await Promise.all([
      core.listStaff(),
      core.listEquipment(),
      core.listSuppliers({ includeInactive: true }),
      core.listCleaningTasks({ includeInactive: true }),
      core.listChecklists({ includeInactive: true }),
      core.listThresholds(),
    ])
    staff = s
    equipment = eq
    suppliers = sup
    tasks = t
    checklists = c
    thresholds = th
    documents = null
    devices = deviceInfo ? [{ id: deviceInfo.device_id, name: deviceInfo.name, revoked_at: null }] : []
  }

  const byId = new Map<string, ControlData['records'][number]>()
  for (const r of server ?? []) byId.set(r.id, r)
  const pendingIds = new Set<string>()
  for (const r of local) {
    if (byId.has(r.id)) continue
    byId.set(r.id, r)
    if (!r.server_time) pendingIds.add(r.id)
  }
  if (deviceInfo && !devices.some((d) => d.id === deviceInfo.device_id)) devices.push({ id: deviceInfo.device_id, name: deviceInfo.name, revoked_at: null })

  const names = <T extends { id: string }>(list: readonly T[], label: (x: T) => string) => new Map(list.map((x) => [x.id, label(x)]))
  const staffNames = names(staff, (s) => s.display_name)
  const deviceNames = names(devices, (d) => d.name)
  const equipmentNames = names(equipment, (e) => e.name)
  const supplierNames = names(suppliers, (s) => s.name)
  const taskNames = names(tasks, (t) => t.name)
  const checklistById = new Map(checklists.map((c) => [c.id, c]))

  return {
    source: server ? 'server' : 'device',
    records: [...byId.values()],
    pendingIds,
    refs: {
      timeZone,
      staffName: (id) => staffNames.get(id) ?? 'Équipier inconnu',
      deviceName: (id) => deviceNames.get(id) ?? 'Autre appareil',
      equipmentName: (id) => equipmentNames.get(id) ?? 'Équipement retiré',
      supplierName: (id) => supplierNames.get(id) ?? 'Fournisseur inconnu',
      cleaningTaskName: (id) => taskNames.get(id) ?? 'Tâche retirée du plan',
      checklist: (id) => checklistById.get(id),
    },
    establishmentName: establishment?.name ?? '',
    staff,
    equipment,
    thresholds,
    devices,
    documents,
    fallbackReason,
  }
}
