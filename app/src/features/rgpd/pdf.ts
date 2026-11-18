// PDF RGPD : registre des traitements (à garder avec le PMS) et note d'information de l'équipe
// (à remettre à chaque employé, avec une zone de signature).
import { Report } from '../documents/report.ts'
import type { LabelFonts } from '../labels/fonts.ts'
import { GOOD_PRACTICES, identityRows, missingIdentity, processingRows, processings, PROCESSORS, RIGHTS, SECURITY, type RgpdContext } from './model.ts'

const FOOTER = 'Document établi avec l’application HACCP ; à relire et à mettre à jour si votre activité change.'

export async function buildRegisterPdf(ctx: RgpdContext, fonts: LabelFonts, editedLabel: string): Promise<Uint8Array> {
  const name = ctx.legalName.trim() || 'Établissement'
  const pdf = await Report.create(fonts, { title: `Registre des traitements — ${name}`, header: `${name} — Registre des traitements (RGPD)`, headerRight: editedLabel, footer: FOOTER })
  pdf.h1('Registre des activités de traitement')
  pdf.paragraph('Article 30 du règlement général sur la protection des données (RGPD). Ce registre décrit les données personnelles utilisées par l’application HACCP de l’établissement.', { tone: 'muted' })
  const missing = missingIdentity(ctx)
  if (missing.length) pdf.callout(`À compléter dans l’assistant PMS (Documents & contrôle › Plan) : ${missing.join(', ')}.`, 'warn')
  pdf.h2('Responsable du traitement')
  pdf.keyValues(identityRows(ctx))
  for (const p of processings(ctx)) {
    pdf.h2(p.name)
    pdf.keyValues(processingRows(p))
  }
  pdf.h2('Hébergement et prestataires techniques')
  pdf.keyValues(PROCESSORS)
  pdf.h2('Mesures de sécurité')
  pdf.bullets(SECURITY)
  pdf.h2('Droits des personnes')
  pdf.bullets(RIGHTS)
  pdf.h2('Bonnes pratiques de l’établissement')
  pdf.bullets(GOOD_PRACTICES)
  pdf.paragraph(editedLabel, { size: 9, tone: 'muted' })
  return pdf.save()
}

export async function buildStaffNoticePdf(ctx: RgpdContext, fonts: LabelFonts, editedLabel: string): Promise<Uint8Array> {
  const name = ctx.legalName.trim() || 'l’établissement'
  const [hygiene] = processings(ctx)
  const pdf = await Report.create(fonts, { title: 'Information de l’équipe — données personnelles', header: `${ctx.legalName.trim() || 'Établissement'} — Information de l’équipe (RGPD)`, headerRight: editedLabel, footer: FOOTER })
  pdf.h1('Vos données dans l’application HACCP')
  pdf.paragraph(`Chez ${name}, les contrôles d’hygiène (températures, cuissons, nettoyage, achats…) sont notés dans une application. Chaque saisie porte le nom de la personne qui l’a faite : c’est obligatoire pour la sécurité des aliments.`)
  pdf.h2('Ce qui est enregistré')
  pdf.bullets([
    'Votre prénom et nom, et votre rôle.',
    'Votre code PIN, enregistré chiffré : personne ne peut le lire, même le gérant. Ne le donnez à personne.',
    'Chaque contrôle que vous saisissez : date, heure, appareil, valeurs, commentaires et photos de produits.',
  ])
  pdf.h2('Pourquoi')
  pdf.paragraph(`${hygiene.purpose} ${hygiene.legalBasis}`)
  pdf.h2('Qui peut les voir')
  pdf.paragraph(hygiene.recipients)
  pdf.h2('Combien de temps')
  pdf.paragraph(hygiene.retention)
  pdf.h2('Vos droits')
  pdf.bullets(RIGHTS)
  pdf.keyValues([
    ['Responsable', ctx.owner.trim() || 'Le gérant'],
    ['Contact', ctx.contact.trim() || 'Auprès du gérant'],
  ])
  pdf.space(18)
  pdf.keyValues([
    ['Nom de l’employé', '______________________________'],
    ['Date et signature', '______________________________'],
  ])
  pdf.space(30)
  return pdf.save()
}
