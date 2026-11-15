// Fiche d'une tâche du plan de nettoyage : produit, mode opératoire → « Fait » (commentaire et photos
// facultatifs) → `cleaning_done`. En correction : même fiche pré-remplie + motif obligatoire → `correction`.
import { useState } from 'react'
import type { CleaningDonePayload, CleaningTask } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Badge, Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconCleaning } from '../../ui/icons.tsx'
import { PhotoPicker } from '../../ui/photos/Photos.tsx'
import { chipClass, EntryLayout, ErrorNotice, ReasonField, StickyActions, useRecordSaver } from '../processes/common.tsx'
import { whenLabel } from '../temperatures/format.ts'
import { CLEANING_PHOTOS_MAX, FREQUENCY_LABELS, type CleaningEntry } from './model.ts'
import { DueBadge, TextArea } from './parts.tsx'
import type { TaskStatus } from './schedule.ts'

const QUICK_REASONS = ['Mauvaise tâche cochée', 'Commentaire à compléter'] as const

export function TaskSheet(props: {
  task: CleaningTask
  status?: TaskStatus
  /** Tâches actives (correction : changer de tâche). */
  tasks: readonly CleaningTask[]
  timeZone: string
  now: Date
  correcting?: CleaningEntry
  onSaved: (rec: HaccpRecord, payload: CleaningDonePayload) => void
  onCancel: () => void
}) {
  const core = useCore()
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const c = props.correcting
  const [taskId, setTaskId] = useState(c ? c.payload.task_id : props.task.id)
  const [comment, setComment] = useState(c?.payload.comment ?? '')
  const [photos, setPhotos] = useState<string[]>(c?.payload.photo_paths ?? [])
  const [reason, setReason] = useState('')
  const task = props.tasks.find((t) => t.id === taskId) ?? props.task
  const initialPhotos = c?.payload.photo_paths ?? []

  const payload = (): CleaningDonePayload => {
    const p: CleaningDonePayload = { task_id: taskId }
    if (comment.trim()) p.comment = comment.trim()
    if (photos.length) p.photo_paths = photos
    return p
  }
  const unchanged = c ? JSON.stringify(payload()) === JSON.stringify(c.payload) : false
  const canSave = !busy && (!c || (reason.trim() !== '' && !unchanged))

  const submit = async () => {
    const p = payload()
    const rec = c
      ? await save('correction', { reason: reason.trim(), replacement: { ...p } }, { supersedes_id: c.latest.id, ctx: { supersededType: 'cleaning_done' } })
      : await save('cleaning_done', { ...p })
    if (!rec) return
    toast(c ? 'Correction enregistrée' : `Nettoyage enregistré : ${task.name}`, 'ok')
    props.onSaved(rec, p)
  }
  const cancel = () => {
    for (const p of photos) if (!initialPhotos.includes(p)) void core.discardPhoto(p).catch(() => false)
    props.onCancel()
  }

  return (
    <EntryLayout
      left={
        <>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <IconCleaning size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{c ? 'Corriger un nettoyage' : task.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{FREQUENCY_LABELS[task.frequency]}</Badge>
                {!c && props.status && <DueBadge state={props.status.state} label={props.status.label} />}
              </div>
            </div>
          </div>

          {c && (
            <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p className="text-[16px] text-fg">
                Nettoyage enregistré {formatDateTime(c.time, props.timeZone)} : <span className="font-semibold">{props.task.name}</span>
              </p>
            </div>
          )}

          <dl className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <dt className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Produit</dt>
              <dd className="mt-1 text-[18px] font-semibold text-fg">{task.product || 'Non précisé dans le plan'}</dd>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <dt className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Mode opératoire</dt>
              <dd className="mt-1 text-[17px] leading-relaxed whitespace-pre-line text-fg">{task.method || 'Non précisé dans le plan'}</dd>
            </div>
          </dl>
          {!c && props.status?.lastAt && <p className="mt-4 text-[15px] text-fg-muted">Dernière fois : {whenLabel(props.status.lastAt, props.now, props.timeZone)}</p>}

          {c && (
            <div className="mt-6 space-y-5">
              <div role="radiogroup" aria-label="Tâche réalisée">
                <p className="mb-2 text-[15px] font-semibold text-fg">Tâche réalisée</p>
                <div className="flex flex-wrap gap-2">
                  {props.tasks.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={taskId === t.id} className={chipClass(taskId === t.id)} onClick={() => setTaskId(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              <ReasonField value={reason} onChange={setReason} quick={QUICK_REASONS} />
              <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
            </div>
          )}
        </>
      }
      right={
        <div className="space-y-6">
          <TextArea label="Commentaire (facultatif)" value={comment} onChange={setComment} maxLength={LIMITS.cleaningCommentMax} hint="Anomalie constatée, produit remplacé…" />
          <PhotoPicker label="Photos" hint="Facultatif : jusqu’à 3 photos (après nettoyage, anomalie)." paths={photos} onChange={setPhotos} max={CLEANING_PHOTOS_MAX} keep={initialPhotos} />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : c ? 'Enregistrer la correction' : 'Fait'}
            </Button>
            {c && !canSave && !busy && <p className="text-[14px] text-fg-subtle">{reason.trim() ? 'Modifiez au moins un élément.' : 'Indiquez le motif de la correction.'}</p>}
            <Button variant="ghost" block onClick={cancel}>
              Annuler
            </Button>
          </StickyActions>
        </div>
      }
    />
  )
}
