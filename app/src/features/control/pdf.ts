// Dossier « contrôle sanitaire » (PDF A4) : synthèse de la période, intégrité du registre, écarts et actions
// correctives, registres détaillés, annexes (équipements et seuils, équipe, documents, photos).
import type { DocumentRef, IntegrityReport } from '../../../../shared/payloads.ts'
import type { Equipment, Threshold } from '../../../../shared/types.ts'
import { kindLabel } from '../../manager/helpers.ts'
import { describeThreshold } from '../../ui/temperature.ts'
import { CATEGORY_LABELS, formatIsoDay } from '../documents/model.ts'
import { Report, type Cell } from '../documents/report.ts'
import type { LabelFonts } from '../labels/fonts.ts'
import { formatDay, formatDayTime, followUpText, statusText, type ControlReport, type ControlRow } from './model.ts'

export interface ControlPdfInput {
  report: ControlReport
  establishmentName: string
  timeZone: string
  generatedAt: Date
  source: 'server' | 'device'
  deviceCount: number
  integrity: IntegrityReport | null
  staff: { display_name: string; role: string; active: boolean }[]
  equipment: Equipment[]
  thresholds: Threshold[]
  documents: DocumentRef[] | null
  photos?: { row: ControlRow; bytes: Uint8Array; kind: 'jpg' | 'png' }[]
}

const PROBLEM_LABELS = { hash_mismatch: 'empreinte différente', broken_chain: 'chaînage rompu', seq_gap: 'saisie manquante' } as const

export function statusCell(r: ControlRow): Cell {
  const text = statusText(r)
  if (r.status === 'ko') return { text, tone: 'danger', bold: true }
  if (r.status === 'ok') return { text, tone: 'ok' }
  if (r.status === 'running') return { text, tone: 'warn' }
  return { text, tone: 'muted' }
}

function followCell(r: ControlRow, tz: string): Cell {
  const text = followUpText(r, tz)
  return r.missingAction ? { text, tone: 'danger', bold: true } : text || '—'
}

export function integritySummary(i: IntegrityReport | null, source: 'server' | 'device'): string {
  if (!i) return 'Non vérifiée pour ce dossier.'
  const where = source === 'server' ? 'registre complet du serveur' : 'saisies de cet appareil'
  const n = i.devices.reduce((s, d) => s + d.problems.length, 0)
  return i.ok
    ? `Intègre : ${i.total_records.toLocaleString('fr-FR')} saisies vérifiées (${where}, ${i.devices.length} appareil${i.devices.length > 1 ? 's' : ''}), aucune anomalie.`
    : `ANOMALIE : ${n} problème${n > 1 ? 's' : ''} détecté${n > 1 ? 's' : ''} sur ${i.total_records.toLocaleString('fr-FR')} saisies (${where}).`
}

export async function buildControlPdf(input: ControlPdfInput, fonts: LabelFonts): Promise<Uint8Array> {
  const { report, timeZone: tz } = input
  const period = `du ${formatDay(report.from, tz)} au ${formatDay(report.to, tz)}`
  const edited = `Édité le ${formatDayTime(input.generatedAt.toISOString(), tz)}`
  const name = input.establishmentName || 'Établissement'
  const pdf = await Report.create(fonts, {
    title: `${name} – Dossier contrôle sanitaire ${period}`,
    header: `${name} — Dossier contrôle sanitaire ${period}`,
    headerRight: edited,
    footer: 'Registre HACCP infalsifiable : chaque saisie est horodatée, signée par empreinte et jamais effacée.',
  })

  // ---- Page de titre ----
  pdf.cover('Dossier contrôle sanitaire', `${name} — registres HACCP ${period}`, [
    ['Établissement', name],
    ['Période', period.replace(/^du/, 'Du')],
    ['Édition', edited.replace(/^Édité le /, '')],
    [
      'Source des données',
      input.source === 'server'
        ? `Registre complet du serveur (${input.deviceCount} appareil${input.deviceCount > 1 ? 's' : ''})${report.totals.pending ? `, plus ${report.totals.pending} saisie(s) de cet appareil pas encore envoyée(s)` : ''}`
        : 'Saisies enregistrées sur cet appareil (pas de connexion au serveur au moment de l’édition)',
    ],
    ['Intégrité du registre', integritySummary(input.integrity, input.source)],
  ])
  pdf.h2('Synthèse de la période')
  pdf.table(
    [
      { title: 'Registre', width: 3.2 },
      { title: 'Saisies', width: 1, align: 'right' },
      { title: 'Non conformes', width: 1.3, align: 'right' },
      { title: 'Sans action corrective', width: 1.5, align: 'right' },
      { title: 'Corrigées', width: 1.1, align: 'right' },
    ],
    [
      ...report.modules
        .filter((m) => m.total > 0)
        .map((m): Cell[] => [
          m.title,
          String(m.total),
          m.nonConform ? { text: String(m.nonConform), tone: 'danger', bold: true } : '0',
          m.missingActions ? { text: String(m.missingActions), tone: 'danger', bold: true } : '0',
          String(m.corrected),
        ]),
      [
        { text: 'Total', bold: true },
        { text: String(report.totals.entries), bold: true },
        { text: String(report.totals.nonConform), bold: true },
        { text: String(report.totals.missingActions), bold: true, tone: report.totals.missingActions ? 'danger' : 'normal' },
        { text: String(report.totals.corrected), bold: true },
      ],
    ],
    { size: 9.5, empty: 'Aucune saisie sur la période.' },
  )
  const notes = [
    report.totals.nonConform
      ? `${report.totals.nonConform} écart(s) relevé(s), dont ${report.totals.withAction} avec action corrective enregistrée.`
      : 'Aucun écart relevé sur la période.',
    report.totals.corrected ? `${report.totals.corrected} saisie(s) corrigée(s) : l’original reste visible (barré) avec le motif de la correction.` : '',
    report.totals.pending ? `${report.totals.pending} saisie(s) de cet appareil pas encore reçue(s) par le serveur au moment de l’édition.` : '',
    report.totals.clockSuspect ? `${report.totals.clockSuspect} saisie(s) faite(s) avec une horloge d’appareil décalée (signalée par le serveur).` : '',
    report.quarantined ? `${report.quarantined} saisie(s) refusée(s) par le serveur (contenu invalide), conservée(s) à part et non reprise(s) ici.` : '',
  ].filter(Boolean)
  pdf.bullets(notes)
  pdf.callout(
    'Comment lire ce dossier : chaque ligne est une saisie faite sur la tablette du food truck, horodatée et signée par une empreinte numérique (SHA-256) chaînée à la précédente. Une saisie n’est jamais modifiée ni effacée : une erreur est corrigée par une nouvelle saisie qui indique le motif et laisse l’original visible.',
    'info',
  )

  // ---- Intégrité ----
  if (input.integrity) {
    pdf.h1('Intégrité du registre')
    pdf.paragraph(`Vérification du ${formatDayTime(input.integrity.checked_at, tz)} : ${integritySummary(input.integrity, input.source)}`, { tone: input.integrity.ok ? 'ok' : 'danger', weight: 'bold' })
    pdf.paragraph(
      'Pour chaque appareil, l’empreinte de chaque saisie est recalculée et comparée à celle enregistrée, et chaque saisie doit citer l’empreinte de la précédente, sans numéro manquant. Une saisie modifiée, retirée ou insérée après coup serait signalée.',
      { size: 9, tone: 'muted' },
    )
    pdf.table(
      [
        { title: 'Appareil', width: 2.4 },
        { title: 'Saisies', width: 1, align: 'right' },
        { title: 'Numéros', width: 1.4 },
        { title: 'Résultat', width: 3 },
      ],
      input.integrity.devices.map((d): Cell[] => [
        d.device_name,
        String(d.records),
        d.records ? `${d.first_seq} à ${d.last_seq}` : '—',
        d.ok
          ? { text: 'Aucune anomalie', tone: 'ok' }
          : {
              text: d.problems
                .slice(0, 8)
                .map((p) => `n° ${p.device_seq} : ${PROBLEM_LABELS[p.problem]}`)
                .join(' ; ') + (d.problems.length > 8 ? ` … (${d.problems.length} au total)` : ''),
              tone: 'danger',
              bold: true,
            },
      ]),
    )
    if (input.integrity.anchors_used > 0) {
      pdf.paragraph(`${input.integrity.anchors_used} appareil(s) ont des saisies anciennes purgées selon la durée de conservation : la chaîne reprend à un point d’ancrage enregistré.`, { size: 9, tone: 'muted' })
    }
  }

  // ---- Écarts ----
  pdf.h1('Écarts et actions correctives')
  pdf.table(
    [
      { title: 'Date', width: 1.25 },
      { title: 'Registre', width: 1.25 },
      { title: 'Objet', width: 1.8 },
      { title: 'Constat', width: 2.4 },
      { title: 'Suite donnée', width: 3.2 },
    ],
    report.nonConformities.map((r): Cell[] => [formatDayTime(r.time, tz), shortOf(report, r), r.subject, `${r.detail}\n${statusText(r)}`, followCell(r, tz)]),
    { empty: 'Aucun écart sur la période.' },
  )

  // ---- Registres détaillés ----
  for (const m of report.modules) {
    if (m.total === 0) continue
    pdf.h1(m.title)
    pdf.paragraph(
      `${m.total} saisie${m.total > 1 ? 's' : ''}${m.nonConform ? `, ${m.nonConform} non conforme${m.nonConform > 1 ? 's' : ''}` : ''}${m.missingActions ? ` dont ${m.missingActions} sans action corrective` : ''}${m.corrected ? `, ${m.corrected} corrigée${m.corrected > 1 ? 's' : ''}` : ''}.`,
      { size: 9.5, tone: 'muted' },
    )
    pdf.table(
      [
        { title: 'Date', width: 1.2 },
        { title: 'Objet', width: 1.9 },
        { title: 'Détail', width: 2.9 },
        { title: 'Résultat', width: 1.3 },
        { title: 'Suivi', width: 2.4 },
        { title: 'Par', width: 1 },
      ],
      m.rows.map((r): Cell[] => [
        formatDayTime(r.time, tz) + (r.pending ? '\n(non envoyée)' : '') + (r.clockSuspect ? '\n(horloge à vérifier)' : ''),
        r.subject,
        r.detail + (r.photos.length ? `\n${r.photos.length} photo${r.photos.length > 1 ? 's' : ''}` : ''),
        statusCell(r),
        followCell(r, tz),
        r.author,
      ]),
      { size: 8 },
    )
  }

  // ---- Annexes ----
  pdf.h1('Annexe : équipements et seuils')
  const thresholdOf = (e: Equipment) => {
    const t = input.thresholds.find((x) => x.equipment_id === e.id && (x.check_type === 'temperature_check' || x.check_type === 'hot_holding'))
    return t ? `${describeThreshold(t)}${t.tolerance_minutes ? ` (alerte après ${t.tolerance_minutes} min hors seuil)` : ''}` : '—'
  }
  pdf.table(
    [
      { title: 'Équipement', width: 2.5 },
      { title: 'Type', width: 1.6 },
      { title: 'Seuil', width: 3 },
      { title: 'État', width: 1 },
    ],
    [...input.equipment]
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr'))
      .map((e): Cell[] => [e.name, kindLabel(e.kind), thresholdOf(e), e.active ? 'En service' : { text: 'Retiré', tone: 'muted' }]),
  )
  pdf.h2('Équipe')
  pdf.table(
    [
      { title: 'Nom', width: 3 },
      { title: 'Rôle', width: 2 },
      { title: 'État', width: 1.5 },
    ],
    input.staff.map((s): Cell[] => [s.display_name, s.role === 'manager' ? 'Gérant' : 'Équipier', s.active ? 'Actif' : { text: 'Désactivé', tone: 'muted' }]),
  )
  if (input.documents) {
    const docs = input.documents.filter((d) => d.active)
    pdf.h2('Documents disponibles')
    pdf.table(
      [
        { title: 'Document', width: 3 },
        { title: 'Catégorie', width: 2.4 },
        { title: 'Daté du', width: 1.1 },
        { title: 'Échéance', width: 1.1 },
      ],
      docs.map((d): Cell[] => [d.title, CATEGORY_LABELS[d.category], d.issued_on ? formatIsoDay(d.issued_on) : '—', d.valid_until ? formatIsoDay(d.valid_until) : '—']),
      { empty: 'Aucun document déposé dans l’application.' },
    )
  }
  if (input.photos && input.photos.length > 0) {
    pdf.h1('Annexe : photos')
    await pdf.photos(
      input.photos.map((p) => ({
        bytes: p.bytes,
        kind: p.kind,
        caption: `${formatDayTime(p.row.time, tz)} — ${shortOf(report, p.row)} — ${p.row.subject}`,
      })),
    )
  }
  return pdf.save()
}

function shortOf(report: ControlReport, r: ControlRow): string {
  return report.modules.find((m) => m.module === r.module)?.short ?? ''
}
