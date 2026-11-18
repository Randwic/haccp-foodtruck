// RGPD (lot 8) : PDF A4 — note d'information de l'équipe, registre des traitements, copie des données d'une personne.
import type { ManagedDevice, ManagedStaff, RegistryRecord, StaffAuditEntry } from '../../manager/api.ts'
import { formatDayTime } from '../control/model.ts'
import { formatIsoDay } from '../documents/model.ts'
import { Report } from '../documents/report.ts'
import type { LabelFonts } from '../labels/fonts.ts'
import { noticeSections, RECORD_LABELS, recordSummary, registerTreatments, staffHistory, type PrivacyContext, type TextSection } from './model.ts'

const FOOTER = 'Document établi avec l’application HACCP du Space Diner — RGPD (règlement (UE) 2016/679).'

function sections(pdf: Report, list: readonly TextSection[]): void {
  for (const s of list) {
    pdf.h2(s.title)
    for (const p of s.paragraphs ?? []) pdf.paragraph(p)
    if (s.bullets?.length) pdf.bullets(s.bullets)
  }
}

/** Note d'information à remettre (et faire signer) à chaque membre de l'équipe. */
export async function buildNoticePdf(ctx: PrivacyContext, fonts: LabelFonts, o: { personName?: string | null; generatedAt: Date; timeZone: string }): Promise<Uint8Array> {
  const name = ctx.establishmentName || 'Établissement'
  const pdf = await Report.create(fonts, {
    title: `${name} – Note d’information sur vos données personnelles`,
    header: `${name} — Vos données personnelles`,
    headerRight: `Édité le ${formatDayTime(o.generatedAt.toISOString(), o.timeZone)}`,
    footer: FOOTER,
  })
  pdf.h1('Note d’information : vos données dans l’application d’hygiène')
  if (o.personName) pdf.paragraph(`Remise à : ${o.personName}`, { weight: 'bold', size: 11 })
  sections(pdf, noticeSections(ctx))
  pdf.space(10)
  pdf.h2('Accusé de remise')
  pdf.paragraph('Je reconnais avoir reçu cette note d’information.')
  pdf.keyValues([
    ['Nom', o.personName ?? '…………………………………………'],
    ['Date', '……… / ……… / …………'],
    ['Signature', ''],
  ], { size: 11 })
  pdf.space(24)
  return pdf.save()
}

/** Registre des activités de traitement (art. 30), à garder avec le PMS. */
export async function buildRegisterPdf(ctx: PrivacyContext, fonts: LabelFonts, o: { generatedAt: Date; timeZone: string; staff: readonly ManagedStaff[] }): Promise<Uint8Array> {
  const name = ctx.establishmentName || 'Établissement'
  const edited = `Édité le ${formatDayTime(o.generatedAt.toISOString(), o.timeZone)}`
  const pdf = await Report.create(fonts, {
    title: `${name} – Registre des traitements (RGPD)`,
    header: `${name} — Registre des traitements de données personnelles`,
    headerRight: edited,
    footer: FOOTER,
  })
  pdf.h1('Registre des activités de traitement')
  pdf.keyValues([
    ['Responsable du traitement', name],
    ['Représentant', ctx.managerName ?? '…………………………………………'],
    ['Contact', ctx.managerEmail ?? '…………………………………………'],
    ['Adresse / SIRET', '…………………………………………………………………………'],
    ['Délégué à la protection des données', 'Non désigné (non obligatoire pour cette activité).'],
    ['Mise à jour', edited],
  ])
  pdf.callout('Tenu en application de l’article 30 du RGPD. À relire et compléter (adresse, SIRET) puis à ranger avec le plan de maîtrise sanitaire. Mettez-le à jour si vous ajoutez un outil ou un prestataire.')
  for (const t of registerTreatments(ctx)) {
    pdf.h2(t.name)
    pdf.keyValues(t.rows)
  }
  pdf.h2('Information des personnes')
  const rows = o.staff.filter((s) => !s.forgotten_at).map((s) => [
    s.display_name,
    s.role === 'manager' ? 'Gérant' : 'Équipier',
    s.active ? 'Actif' : 'Parti',
    s.privacy_notice_on ? `Remise le ${formatIsoDay(s.privacy_notice_on)}` : { text: 'À remettre', tone: 'warn' as const, bold: true },
  ])
  pdf.table(
    [
      { title: 'Personne', width: 3 },
      { title: 'Rôle', width: 1.4 },
      { title: 'Statut', width: 1.2 },
      { title: 'Note d’information', width: 2 },
    ],
    rows,
    { empty: 'Aucune personne dans l’équipe.' },
  )
  const forgotten = o.staff.filter((s) => s.forgotten_at).length
  if (forgotten > 0) pdf.paragraph(`${forgotten} ancien${forgotten > 1 ? 's' : ''} équipier${forgotten > 1 ? 's' : ''} dont les données ont été effacées (pseudonyme sur les saisies conservées).`, { tone: 'muted' })
  pdf.h2('Demandes des personnes (accès, effacement)')
  pdf.paragraph('Gestion › Équipe › Données personnelles : copie des données d’une personne en PDF, effacement après son départ. Chaque effacement est noté dans le journal de l’application.')
  return pdf.save()
}

export interface StaffExportInput {
  staff: ManagedStaff
  records: readonly RegistryRecord[]
  audit: readonly StaffAuditEntry[]
  devices: readonly ManagedDevice[]
  ctx: PrivacyContext
  generatedAt: Date
  timeZone: string
}

/** Copie des données d'une personne (droit d'accès, art. 15). */
export async function buildStaffExportPdf(input: StaffExportInput, fonts: LabelFonts): Promise<Uint8Array> {
  const { staff: s, ctx, timeZone: tz } = input
  const name = ctx.establishmentName || 'Établissement'
  const edited = `Édité le ${formatDayTime(input.generatedAt.toISOString(), tz)}`
  const pdf = await Report.create(fonts, {
    title: `${name} – Données personnelles de ${s.display_name}`,
    header: `${name} — Données personnelles de ${s.display_name}`,
    headerRight: edited,
    footer: FOOTER,
  })
  pdf.h1(`Vos données : ${s.display_name}`)
  pdf.paragraph(`Copie de toutes les informations que l’application garde sur vous, établie à votre demande (article 15 du RGPD). Responsable : ${name}.`)
  pdf.h2('Votre fiche')
  pdf.keyValues([
    ['Nom affiché', s.display_name],
    ['Rôle', s.role === 'manager' ? 'Gérant' : 'Équipier'],
    ['Statut', s.forgotten_at ? 'Données effacées' : s.active ? 'Actif' : 'Désactivé (départ)'],
    ['Ajouté le', s.created_at ? formatDayTime(s.created_at, tz) : '—'],
    ['Départ le', s.deactivated_at ? formatDayTime(s.deactivated_at, tz) : '—'],
    ['Note d’information remise le', s.privacy_notice_on ? formatIsoDay(s.privacy_notice_on) : 'Non indiqué'],
    ['Code PIN', 'Gardé uniquement sous forme d’empreinte chiffrée, illisible.'],
  ])
  pdf.h2('Historique du compte')
  const history = staffHistory(input.audit)
  pdf.table(
    [
      { title: 'Date', width: 1.4 },
      { title: 'Événement', width: 3 },
    ],
    history.map((h) => [formatDayTime(h.at, tz), h.label]),
    { empty: 'Aucun événement.' },
  )
  const devices = new Map(input.devices.map((d) => [d.id, d.name]))
  const records = input.records.filter((r) => !r.quarantine_reason)
  pdf.h2(`Vos saisies (${records.length.toLocaleString('fr-FR')})`)
  pdf.paragraph(`Saisies du registre d’hygiène signées avec votre code, gardées ${ctx.retentionYears} an${ctx.retentionYears > 1 ? 's' : ''} puis effacées automatiquement.`, { tone: 'muted', size: 9 })
  pdf.table(
    [
      { title: 'Date', width: 1.3 },
      { title: 'Type', width: 1.5 },
      { title: 'Appareil', width: 1 },
      { title: 'Détail', width: 3 },
    ],
    records.map((r) => [formatDayTime(r.device_time, tz), RECORD_LABELS[r.type] ?? r.type, devices.get(r.device_id) ?? 'Appareil', recordSummary(r) || '—']),
    { empty: 'Aucune saisie conservée.' },
  )
  return pdf.save()
}
