// PDF du plan de maîtrise sanitaire. Les réponses du questionnaire sont rangées dans les métadonnées du PDF :
// la version suivante repart de la dernière version enregistrée dans les documents.
import { Report, readInfoEntry } from '../documents/report.ts'
import type { LabelFonts } from '../labels/fonts.ts'
import { parseAnswers, type PmsAnswers, type PmsDocument } from './model.ts'

/** Clé des réponses dans le dictionnaire Info du PDF. */
export const PMS_INFO_KEY = 'HaccpPmsAnswers'

export async function buildPmsPdf(doc: PmsDocument, answers: PmsAnswers, fonts: LabelFonts, editedLabel: string): Promise<Uint8Array> {
  const pdf = await Report.create(fonts, {
    title: `${doc.title} (${doc.versionLabel})`,
    header: doc.title,
    headerRight: doc.versionLabel,
    footer: 'Plan établi avec l’assistant de l’application HACCP ; il ne vaut pas agrément et ne remplace pas la responsabilité de l’exploitant.',
  })
  pdf.cover('Plan de maîtrise sanitaire', `${doc.title.replace(/^Plan de maîtrise sanitaire — /, '')} — ${doc.versionLabel}`, doc.cover)
  if (doc.missing.length) {
    pdf.callout(`À compléter avant de présenter ce plan : ${doc.missing.join(', ')}.`, 'warn')
  }
  pdf.h2('Sommaire')
  pdf.bullets(doc.blocks.filter((b) => b.kind === 'h1').map((b) => (b as { text: string }).text))
  pdf.paragraph(editedLabel, { size: 9, tone: 'muted' })
  pdf.pageBreak()
  for (const b of doc.blocks) {
    if (b.kind === 'h1') pdf.h1(b.text)
    else if (b.kind === 'h2') pdf.h2(b.text)
    else if (b.kind === 'p') pdf.paragraph(b.text, { tone: b.tone === 'warn' ? 'warn' : b.tone })
    else if (b.kind === 'bullets') pdf.bullets(b.items)
    else if (b.kind === 'kv') pdf.keyValues(b.rows)
    else if (b.kind === 'table') pdf.table(b.columns, b.rows, { empty: b.empty, size: b.size })
    else if (b.kind === 'callout') pdf.callout(b.text, b.tone)
    else pdf.pageBreak()
  }
  pdf.setInfoEntry(PMS_INFO_KEY, JSON.stringify(answers))
  return pdf.save()
}

/** Réponses rangées dans un PDF de PMS généré par l'assistant, ou null. */
export async function answersFromPdf(bytes: Uint8Array | ArrayBuffer, defaults: PmsAnswers): Promise<PmsAnswers | null> {
  const raw = await readInfoEntry(bytes, PMS_INFO_KEY)
  if (!raw) return null
  try {
    return parseAnswers(JSON.parse(raw), defaults)
  } catch {
    return null
  }
}
