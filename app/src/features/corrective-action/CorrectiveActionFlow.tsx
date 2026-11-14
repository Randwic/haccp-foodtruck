import { useId, useState, type ReactNode } from 'react'
import type { CorrectiveActionPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS, validatePayload } from '../../../../shared/validation.ts'
import { Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck, IconDiscard, IconFlame, IconMore, IconMove, IconPhone, IconWarn, IconWrench, type IconProps } from '../../ui/icons.tsx'
import { CORRECTIVE_ACTION_LABELS, CORRECTIVE_ACTION_ORDER, type CorrectiveActionKind } from './actions.ts'

const ICONS: Record<CorrectiveActionKind, (p: IconProps) => ReactNode> = {
  adjust_equipment: IconWrench,
  move_product: IconMove,
  discard: IconDiscard,
  reheat: IconFlame,
  call_technician: IconPhone,
  other: IconMore,
}

/**
 * Écran BLOQUANT d'action corrective, à afficher juste après l'enregistrement d'une mesure hors seuil.
 * Réutilisable par tous les modules (enceintes, refroidissement, cuisson…) :
 * - `relatedRecordId` : id de l'enregistrement hors seuil (relevé, étape de procédé ou correction) ;
 * - `subject` : ce qui est concerné (« Frigo 1 », « Refroidissement — bolognaise ») ;
 * - `detail` : mesure et seuil (« 7,5 °C à 14:05 · seuil ≤ 4 °C ») ;
 * - `onDone(record)` : appelé une fois l'action `corrective_action` enregistrée.
 * Pas de bouton « annuler » : tant que l'action n'est pas faite, la mesure reste signalée
 * « Action corrective manquante » (voir features/temperatures/readings.ts).
 */
export interface CorrectiveActionFlowProps {
  relatedRecordId: string
  subject: string
  detail?: ReactNode
  onDone: (record: HaccpRecord) => void
}

export function CorrectiveActionFlow({ relatedRecordId, subject, detail, onDone }: CorrectiveActionFlowProps) {
  const core = useCore()
  const toast = useToast()
  const commentId = useId()
  const commentHintId = useId()
  const [action, setAction] = useState<CorrectiveActionKind | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const commentRequired = action === 'other'
  const canSubmit = action !== null && (!commentRequired || comment.trim() !== '') && !busy

  const submit = async () => {
    if (!action) return
    const payload: CorrectiveActionPayload = { related_record_id: relatedRecordId, action, comment: comment.trim() }
    const check = validatePayload('corrective_action', payload)
    if (!check.ok) {
      setError(`Saisie refusée : ${check.detail}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const rec = await core.addRecord('corrective_action', { ...payload })
      toast('Action corrective enregistrée', 'ok')
      onDone(rec)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:pt-7">
      <div className="flex items-start gap-4 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface text-danger">
          <IconWarn size={26} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[28px]">Action corrective obligatoire</h1>
          <p className="mt-1 text-[17px] font-semibold text-fg">{subject}</p>
          {detail && <div className="mt-0.5 text-[16px] text-fg-muted">{detail}</div>}
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="mb-3 text-[19px] font-semibold text-fg">Qu’avez-vous fait ?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CORRECTIVE_ACTION_ORDER.map((a) => {
            const Icon = ICONS[a]
            const selected = action === a
            return (
              <label
                key={a}
                className={`relative flex min-h-20 cursor-pointer items-center gap-4 rounded-2xl border-2 bg-surface p-4 shadow-card transition-[background-color,border-color] active:bg-pressed has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  selected ? 'border-accent' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="corrective-action"
                  value={a}
                  checked={selected}
                  onChange={() => {
                    setAction(a)
                    setError(null)
                  }}
                  className="sr-only"
                />
                <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'}`}>
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] leading-snug font-semibold text-fg">{CORRECTIVE_ACTION_LABELS[a].label}</span>
                  <span className="mt-0.5 block text-[14px] leading-snug text-fg-muted">{CORRECTIVE_ACTION_LABELS[a].hint}</span>
                </span>
                {selected && <IconCheck size={22} strokeWidth={2.5} className="shrink-0 text-accent" />}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6">
        <label htmlFor={commentId} className="mb-1.5 block text-[15px] font-semibold text-fg">
          Commentaire {commentRequired ? '(obligatoire)' : '(facultatif)'}
        </label>
        <p id={commentHintId} className="mb-2 text-[15px] text-fg-muted">
          {commentRequired ? 'Décrivez précisément ce qui a été fait.' : 'Précisions utiles en cas de contrôle (produits concernés, nouvelle mesure…).'}
        </p>
        <textarea
          id={commentId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={LIMITS.commentMax}
          rows={3}
          aria-describedby={commentHintId}
          aria-required={commentRequired || undefined}
          className="block w-full resize-y rounded-xl border border-line-strong bg-elevated px-4 py-3 text-[17px] text-fg transition-colors focus:border-accent"
        />
      </div>

      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}

      <Button size="lg" block className="mt-6" onClick={submit} disabled={!canSubmit} icon={<IconCheck size={22} strokeWidth={2.25} />}>
        {busy ? 'Enregistrement…' : 'Enregistrer l’action corrective'}
      </Button>
      <p className="mt-3 text-[14px] text-fg-subtle">
        Tant qu’aucune action n’est enregistrée, la mesure reste signalée « Action corrective manquante ».
      </p>
    </main>
  )
}
