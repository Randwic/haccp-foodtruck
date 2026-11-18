// Fiche de rappel produit (PDF A4) : ce qui a été trouvé dans le registre pour un lot / un code-barres,
// et ce qui a été fait (retraits notés). À ranger dans le classeur PMS ou à transmettre si on la demande.
import type { LabelFonts } from '../labels/fonts.ts'
import { formatDayTime } from '../control/model.ts'
import { Report, type Cell } from '../documents/report.ts'
import { KIND_TITLES, formatLabelDateTime } from '../labels/model.ts'
import { WASTE_REASON_LABELS, frenchDate } from '../reception/model.ts'
import type { RecallResult } from './model.ts'

export interface RecallPdfInput {
  result: RecallResult
  establishmentName: string
  timeZone: string
  generatedAt: Date
  source: 'server' | 'device'
  supplierName: (id: string) => string
  staffName: (id: string) => string
}

export function recallTitle(r: RecallResult): string {
  const parts = []
  if (r.query.lot) parts.push(`lot ${r.query.lot}`)
  if (r.query.gtin && r.query.gtin !== r.query.lot) parts.push(`code-barres ${r.query.gtin}`)
  return parts.join(' / ')
}

export async function buildRecallPdf(input: RecallPdfInput, fonts: LabelFonts): Promise<Uint8Array> {
  const { result: r, timeZone: tz } = input
  const name = input.establishmentName || 'Établissement'
  const what = recallTitle(r)
  const edited = `Édité le ${formatDayTime(input.generatedAt.toISOString(), tz)}`
  const pdf = await Report.create(fonts, {
    title: `${name} – Rappel produit ${what}`,
    header: `${name} — Rappel produit (${what})`,
    headerRight: edited,
    footer: 'Extrait du registre HACCP : saisies horodatées, jamais effacées.',
  })
  pdf.cover('Fiche de rappel produit', `${name} — ${what}`, [
    ['Recherche', what],
    ['Édition', edited.replace(/^Édité le /, '')],
    ['Source des données', input.source === 'server' ? 'Registre complet du serveur (tous les appareils)' : 'Saisies de cet appareil seulement (pas de connexion au serveur)'],
    ['Résultat', `${r.receptions.length} achat(s) / réception(s), ${r.labels.length} étiquette(s), ${r.wastes.length} produit(s) jeté(s)`],
  ])
  if (r.lotsFound.length) pdf.paragraph(`Lots reçus avec ce code-barres : ${r.lotsFound.join(', ')}.`)
  if (r.withoutLot) pdf.callout(`${r.withoutLot} ligne(s) reçue(s) avec ce code-barres sans n° de lot noté : à vérifier dans les photos et le stock.`, 'warn')

  pdf.h2('Achats et réceptions')
  pdf.table(
    [
      { title: 'Date', width: 1.3 },
      { title: 'Fournisseur', width: 1.6 },
      { title: 'Produit', width: 2.2 },
      { title: 'Lot', width: 1.2 },
      { title: 'DLC / DDM', width: 1.1 },
      { title: 'Décision', width: 1.1 },
      { title: 'Retrait noté', width: 1.2 },
    ],
    r.receptions.flatMap((h) =>
      h.items.map((i): Cell[] => [
        formatDayTime(h.entry.time, tz),
        input.supplierName(h.entry.payload.supplier_id),
        i.product,
        i.lot ?? '—',
        i.dlc ? `DLC ${frenchDate(i.dlc)}` : i.ddm ? `DDM ${frenchDate(i.ddm)}` : '—',
        i.accepted ? 'Accepté' : { text: 'Refusé', tone: 'ok' },
        !i.accepted ? 'Sans objet' : h.withdrawn.length ? { text: 'Oui', tone: 'ok', bold: true } : { text: 'Non', tone: 'danger', bold: true },
      ]),
    ),
    { size: 9, empty: 'Aucun achat trouvé avec ce lot.' },
  )

  pdf.h2('Étiquettes (produits ouverts, préparations, décongélations)')
  pdf.table(
    [
      { title: 'Date', width: 1.3 },
      { title: 'Type', width: 1.3 },
      { title: 'Produit / préparation', width: 2.4 },
      { title: 'Lot', width: 1.2 },
      { title: 'DLC', width: 1.3 },
      { title: 'Trouvée par', width: 1.3 },
    ],
    r.labels.map((h): Cell[] => [
      formatDayTime(h.entry.time, tz),
      KIND_TITLES[h.entry.payload.kind],
      h.entry.payload.name,
      h.entry.payload.lot ?? '—',
      formatLabelDateTime(h.entry.payload.dlc_at, tz),
      h.matchedBy === 'lot' ? 'N° de lot' : 'Faite avec un produit du lot',
    ]),
    { size: 9, empty: 'Aucune étiquette liée.' },
  )

  pdf.h2('Produits jetés')
  pdf.table(
    [
      { title: 'Date', width: 1.3 },
      { title: 'Produit', width: 2.2 },
      { title: 'Lot', width: 1.2 },
      { title: 'Quantité', width: 1.1 },
      { title: 'Motif', width: 1.3 },
      { title: 'Par', width: 1.2 },
    ],
    r.wastes.map((h): Cell[] => [
      formatDayTime(h.entry.time, tz),
      h.entry.payload.product,
      h.entry.payload.lot ?? '—',
      h.entry.payload.quantity ?? '—',
      WASTE_REASON_LABELS[h.entry.payload.reason],
      input.staffName(h.entry.authorId),
    ]),
    { size: 9, empty: 'Aucun produit jeté lié.' },
  )
  const quarantined = [...r.receptions, ...r.labels, ...r.wastes].filter((h) => h.quarantine).length
  if (quarantined) pdf.callout(`${quarantined} saisie(s) ci-dessus avaient été refusées par le serveur (contenu invalide) : elles sont montrées quand même, par prudence.`, 'warn')
  pdf.setInfoEntry('HaccpRecall', what)
  return pdf.save()
}
