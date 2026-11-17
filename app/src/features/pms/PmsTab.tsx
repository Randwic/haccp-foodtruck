// Assistant PMS : questionnaire en 4 étapes (pré-rempli), puis plan complet en PDF construit avec les données
// de l'application, enregistré comme nouvelle version dans les documents (l'ancienne version est archivée).
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocumentRef } from '../../../../shared/payloads.ts'
import { errorText, type ManagerApi } from '../../manager/api.ts'
import { Button, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck, IconChevronLeft, IconChevronRight, IconOk, IconShare, IconWarn } from '../../ui/icons.tsx'
import { TextArea } from '../cleaning/parts.tsx'
import { shareFile } from '../documents/files.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { buildPmsDocument, defaultAnswers, missingAnswers, parseAnswers, PMS_STEPS, type PmsAnswers, type PmsAppData } from './model.ts'
import { answersFromPdf, buildPmsPdf } from './pdf.ts'

const DRAFT_KEY = 'haccp.pms-draft.v1'
/** Note des PDF générés par l'assistant (reconnaissance des versions). */
export const PMS_NOTE = 'Généré par l’assistant PMS de l’application.'

function readDraft(defaults: PmsAnswers): PmsAnswers | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? parseAnswers(JSON.parse(raw), defaults) : null
  } catch {
    return null
  }
}
function writeDraft(a: PmsAnswers) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(a))
  } catch {
    /* stockage plein : sans importance, le brouillon reste à l'écran */
  }
}

const isAssistantPms = (d: DocumentRef) => d.category === 'pms' && d.mime_type === 'application/pdf' && (d.notes ?? '').startsWith(PMS_NOTE)

export function PmsTab({ manager, timeZone, onSaved }: { manager: ManagerApi | null; timeZone: string; onSaved?: () => void }) {
  const core = useCore()
  const toast = useToast()
  const [app, setApp] = useState<PmsAppData | null>(null)
  const [answers, setAnswers] = useState<PmsAnswers | null>(null)
  const [origin, setOrigin] = useState<'draft' | 'saved' | 'defaults'>('defaults')
  const [step, setStep] = useState(0)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; key: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [establishment, settings, equipment, thresholds, products, recipes, cleaningTasks, checklists, suppliers, staff] = await Promise.all([
      core.getEstablishment(),
      core.getSettings(),
      core.listEquipment(),
      core.listThresholds(),
      core.listProducts({ includeInactive: true }),
      core.listRecipes({ includeInactive: true }),
      core.listCleaningTasks(),
      core.listChecklists(),
      core.listSuppliers(),
      core.listStaff(),
    ])
    const documents = manager ? await manager.listDocuments().catch(() => null) : null
    const data: PmsAppData = {
      establishmentName: establishment?.name ?? '',
      settings,
      equipment,
      thresholds,
      products,
      recipes,
      cleaningTasks,
      checklists,
      suppliers,
      staff: staff.map((s) => ({ display_name: s.display_name, role: s.role, active: s.active })),
      documents,
    }
    setApp(data)
    const defaults = defaultAnswers({ establishmentName: data.establishmentName, ownerName: staff.find((s) => s.role === 'manager')?.display_name ?? '' })
    const draft = readDraft(defaults)
    if (draft) {
      setAnswers(draft)
      setOrigin('draft')
      return
    }
    const last = documents?.filter((d) => d.active && isAssistantPms(d)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    if (last && manager) {
      const saved = await manager
        .downloadDocument(last)
        .then((b) => b.arrayBuffer())
        .then((buf) => answersFromPdf(buf, defaults))
        .catch(() => null)
      if (saved) {
        setAnswers(saved)
        setOrigin('saved')
        return
      }
    }
    setAnswers(defaults)
    setOrigin('defaults')
  }, [core, manager])
  useEffect(() => {
    load().catch((e: unknown) => setError(errorText(e)))
  }, [load])

  const set = (field: keyof PmsAnswers, v: string) => {
    if (!answers) return
    const next = { ...answers, [field]: v }
    setAnswers(next)
    writeDraft(next)
    setPdf(null)
  }

  const version = useMemo(() => (app?.documents?.filter(isAssistantPms).length ?? 0) + 1, [app])
  const missing = answers ? missingAnswers(answers) : []
  const total = PMS_STEPS.length + 1

  const generate = async () => {
    if (!answers || !app) return null
    const key = JSON.stringify(answers)
    if (pdf && pdf.key === key) return pdf.bytes
    setBusy('Rédaction du plan…')
    try {
      const now = new Date()
      const doc = buildPmsDocument(answers, app, { version, date: now, timeZone })
      const edited = `Document établi le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone }).format(now)}.`
      const bytes = await buildPmsPdf(doc, answers, await loadLabelFonts(), edited)
      setPdf({ bytes, key })
      return bytes
    } catch (e) {
      setError(`Plan impossible à générer : ${errorText(e)}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!manager || !app) return
    const bytes = await generate()
    if (!bytes) return
    setBusy('Enregistrement…')
    setError(null)
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
      const next = new Date(`${today}T12:00:00Z`)
      next.setUTCFullYear(next.getUTCFullYear() + 1)
      const previous = (app.documents ?? []).filter((d) => d.active && isAssistantPms(d))
      await manager.addDocument(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), {
        title: `Plan de maîtrise sanitaire – version ${version}`,
        category: 'pms',
        issued_on: today,
        valid_until: next.toISOString().slice(0, 10),
        notes: `${PMS_NOTE} À relire au plus tard dans un an.`,
      })
      for (const d of previous) await manager.updateDocument(d.id, { active: false }).catch(() => {})
      localStorage.removeItem(DRAFT_KEY)
      toast(`Version ${version} du plan enregistrée dans les documents`, 'ok')
      setPdf(null)
      await load()
      onSaved?.()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && !answers) return <Notice>{error}</Notice>
  if (!answers || !app) return <p className="text-[17px] text-fg-muted">Préparation de l’assistant…</p>

  const current = PMS_STEPS[step]
  const counts: [string, number][] = [
    ['équipements', app.equipment.filter((e) => e.active).length],
    ['produits', app.products.filter((p) => p.active).length],
    ['préparations maison', app.recipes.filter((r) => r.active && r.kind === 'preparation').length],
    ['plats du menu', app.recipes.filter((r) => r.active && r.kind === 'menu_item').length],
    ['tâches de nettoyage', app.cleaningTasks.length],
    ['checklists', app.checklists.length],
    ['fournisseurs', app.suppliers.length],
  ]

  return (
    <section aria-labelledby="pms-title" className="space-y-6">
      <h2 id="pms-title" className="sr-only">
        Assistant PMS
      </h2>
      <p className="max-w-3xl text-[17px] text-fg-muted">
        Le plan de maîtrise sanitaire décrit comment vous garantissez la sécurité de ce que vous servez. L’assistant reprend tout ce qui est déjà dans l’application ; vous n’avez qu’à relire et compléter les réponses proposées.
      </p>
      {origin === 'draft' && <Notice tone="info">Brouillon en cours repris (enregistré sur cet appareil au fil de la saisie).</Notice>}
      {origin === 'saved' && <Notice tone="info">Réponses reprises de la dernière version enregistrée du plan.</Notice>}

      <ol className="grid grid-cols-5 gap-1 rounded-xl bg-sunken p-1" aria-label="Étapes">
        {[...PMS_STEPS.map((s) => s.title), 'Vérifier'].map((title, i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? 'step' : undefined}
              className={`flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg px-1 text-center text-[13px] leading-tight font-semibold sm:text-[15px] ${step === i ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`}
            >
              <span className="hidden tabular-nums sm:inline">{i + 1}.</span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      {current ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-fg">
              {step + 1}. {current.title}
            </h3>
            <p className="mt-1 text-[16px] text-fg-muted">{current.intro}</p>
          </div>
          {current.questions.map((q) =>
            q.short ? (
              <TextField key={q.field} label={q.label + (q.required ? '' : ' (facultatif)')} hint={q.hint} value={answers[q.field]} onChange={(v) => set(q.field, v)} maxLength={300} autoCapitalize="sentences" />
            ) : (
              <TextArea key={q.field} label={q.label + (q.required ? '' : ' (facultatif)')} hint={q.hint} value={answers[q.field]} onChange={(v) => set(q.field, v)} maxLength={4000} rows={4} />
            ),
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-fg">{total}. Vérifier et produire le plan</h3>
            <p className="mt-1 text-[16px] text-fg-muted">
              Le plan reprend aussi : {counts.map(([l, n]) => `${n} ${l}`).join(', ')}, les seuils de température, les cuissons à cœur, le contrôle des huiles et le tableau des allergènes. Pour les modifier, passez par Gestion : le plan suivant en tiendra compte.
            </p>
          </div>
          {missing.length > 0 ? (
            <Notice tone="warn">
              <span className="font-semibold">À compléter :</span> {missing.map((q) => q.label).join(', ')}. Vous pouvez quand même produire le plan : ces champs y seront marqués « À compléter ».
            </Notice>
          ) : (
            <Notice tone="ok">Toutes les informations obligatoires sont remplies.</Notice>
          )}
          {error && <Notice>{error}</Notice>}
          <div className="flex flex-wrap gap-3">
            {pdf && pdf.key === JSON.stringify(answers) ? (
              <Button icon={<IconShare size={20} />} onClick={() => void shareFile(pdf.bytes, `plan-de-maitrise-sanitaire-v${version}.pdf`, 'application/pdf', 'Plan de maîtrise sanitaire')}>
                Ouvrir le PDF
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void generate()} disabled={!!busy}>
                {busy ?? 'Préparer l’aperçu PDF'}
              </Button>
            )}
            <Button icon={<IconCheck size={20} />} onClick={save} disabled={!manager || !!busy}>
              {busy === 'Enregistrement…' ? busy : `Enregistrer la version ${version}`}
            </Button>
          </div>
          {!manager && (
            <p className="flex items-start gap-2 text-[15px] text-warn">
              <IconWarn size={18} className="mt-0.5 shrink-0" />
              Pour enregistrer le plan dans les documents, connectez-vous (mot de passe gérant) avec Internet. Le brouillon reste sur cet appareil.
            </p>
          )}
          {manager && (
            <p className="flex items-start gap-2 text-[15px] text-fg-muted">
              <IconOk size={18} className="mt-0.5 shrink-0 text-ok" />
              La version enregistrée apparaît dans Documents (catégorie PMS) avec un rappel de relecture dans un an ; la précédente est archivée, jamais supprimée.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-between gap-3 border-t border-line pt-5">
        <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} icon={<IconChevronLeft size={20} />}>
          Précédent
        </Button>
        {step < total - 1 && (
          <Button onClick={() => setStep(step + 1)}>
            Suivant
            <IconChevronRight size={20} />
          </Button>
        )}
      </div>
    </section>
  )
}
