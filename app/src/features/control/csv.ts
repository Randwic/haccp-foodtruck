// Export CSV du mode Contrôle : une ligne par saisie, lisible par Excel / Numbers en français
// (séparateur « ; », UTF-8 avec BOM, retours à la ligne protégés par des guillemets).
import { formatClock, formatDay, followUpText, statusText, type ControlReport } from './model.ts'

export const CSV_HEADERS = [
  'Date',
  'Heure',
  'Registre',
  'Objet',
  'Détail',
  'Résultat',
  'Actions correctives et corrections',
  'Par',
  'Appareil',
  'Photos',
  'Remarque',
  'Identifiant',
] as const

function cell(v: string | number): string {
  const s = String(v)
  // Protection contre l'interprétation comme formule par un tableur.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function controlCsv(report: ControlReport, timeZone: string): string {
  const lines = [CSV_HEADERS.join(';')]
  for (const m of report.modules) {
    for (const r of m.rows) {
      const remark = [r.pending ? 'pas encore envoyée au serveur' : '', r.clockSuspect ? 'horloge de l’appareil à vérifier' : ''].filter(Boolean).join(', ')
      lines.push(
        [
          formatDay(r.time, timeZone),
          formatClock(r.time, timeZone),
          m.short,
          r.subject,
          r.detail,
          statusText(r),
          followUpText(r, timeZone),
          r.author,
          r.device,
          r.photos.length,
          remark,
          r.id,
        ]
          .map(cell)
          .join(';'),
      )
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
