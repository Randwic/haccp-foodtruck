// RGPD : export des données d'un membre de l'équipe (droit d'accès et de portabilité).
// Un fichier CSV lisible par Excel / Numbers : identité en tête, puis toutes les saisies HACCP
// qu'il a signées (même colonnes que l'export du mode Contrôle).
import type { CoreApi } from '../../core/api.ts'
import type { ManagedStaff, ManagerApi } from '../../manager/api.ts'
import { controlCsv } from '../control/csv.ts'
import { loadControlData } from '../control/load.ts'
import { buildControlReport, formatDayTime, type ControlReport } from '../control/model.ts'

/** Début du registre : bien avant la mise en service de l'application. */
const SINCE = new Date('2020-01-01T00:00:00Z')

function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Ne garde que les lignes signées par ce membre (les totaux sont recalculés). */
export function onlyAuthor(report: ControlReport, staffId: string): ControlReport {
  const modules = report.modules.map((m) => {
    const rows = m.rows.filter((r) => r.authorId === staffId)
    return {
      ...m,
      rows,
      total: rows.length,
      nonConform: rows.filter((r) => r.status === 'ko').length,
      missingActions: rows.filter((r) => r.missingAction).length,
      corrected: rows.filter((r) => r.corrections.length > 0).length,
    }
  })
  return { ...report, modules, nonConformities: report.nonConformities.filter((r) => r.authorId === staffId) }
}

export function staffExportCsv(input: { staff: ManagedStaff; establishmentName: string; report: ControlReport; timeZone: string; now: Date; source: 'server' | 'device' }): string {
  const { staff, report, timeZone, now } = input
  const own = onlyAuthor(report, staff.id)
  const count = own.modules.reduce((n, m) => n + m.rows.length, 0)
  const head = [
    ['Export des données personnelles (RGPD)'],
    ['Établissement', input.establishmentName],
    ['Nom', staff.display_name],
    ['Rôle', staff.role === 'manager' ? 'Gérant' : 'Équipier'],
    ['Statut', staff.forgotten_at ? 'Nom effacé (RGPD)' : staff.active ? 'Actif' : 'Désactivé'],
    ['Exporté le', formatDayTime(now.toISOString(), timeZone)],
    ['Source', input.source === 'server' ? 'Registre complet du serveur' : 'Saisies de cet appareil seulement (pas de connexion gérant)'],
    ['Données conservées', 'Nom, rôle, code PIN chiffré (jamais lisible, même par le gérant), saisies HACCP signées ci-dessous'],
    ['Saisies signées', String(count)],
    [],
  ]
  const body = controlCsv(own, timeZone).replace(/^﻿/, '')
  return `﻿${head.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n${body}`
}

/** Charge tout le registre et construit le fichier d'un membre. */
export async function buildStaffExport(core: CoreApi, manager: ManagerApi, staff: ManagedStaff, now = new Date()): Promise<{ name: string; csv: string }> {
  const data = await loadControlData(core, manager, { from: SINCE, to: now })
  const report = buildControlReport({ records: data.records, pendingIds: data.pendingIds, from: SINCE, to: now, refs: data.refs })
  const csv = staffExportCsv({ staff, establishmentName: data.establishmentName, report, timeZone: data.refs.timeZone, now, source: data.source })
  const slug = staff.display_name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'membre'
  return { name: `donnees-${slug}-${now.toISOString().slice(0, 10)}.csv`, csv }
}
