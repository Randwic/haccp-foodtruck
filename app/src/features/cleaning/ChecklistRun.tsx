// Remplissage d'une checklist : un gros Oui / Non par point, commentaire obligatoire pour tout « Non »,
// points critiques (`required`) signalés ; `all_ok` = toutes les réponses ok → `checklist_done`.
// En correction : réponses pré-remplies + motif obligatoire → `correction`.
import { useState } from 'react'
import type { Checklist, ChecklistDonePayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Badge, Button, Notice, useToast } from '../../ui/components/index.ts'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconChecklist, IconWarn } from '../../ui/icons.tsx'
import { ErrorNotice, ReasonField, useRecordSaver } from '../processes/common.tsx'
import { plural } from '../temperatures/schedule.ts'
import { CHECKLIST_KIND_LABELS, checklistPayload, itemLabel, type ChecklistEntry } from './model.ts'
import { DueBadge, TextArea, YesNo } from './parts.tsx'
import type { ChecklistStatus } from './schedule.ts'

type Answer = { ok: boolean | null; comment: string }

export function ChecklistRun(props: {
  checklist: Checklist
  status?: ChecklistStatus
  timeZone: string
  correcting?: ChecklistEntry
  onSaved: (rec: HaccpRecord, payload: ChecklistDonePayload) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const { checklist: cl, correcting: c } = props
  // Points : ceux de la checklist actuelle ; en correction, ceux réellement répondus (la checklist a pu changer).
  const items = c
    ? c.payload.answers.map((a) => cl.items.find((i) => i.id === a.item_id) ?? { id: a.item_id, label: itemLabel(cl, a.item_id), required: false })
    : cl.items
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(items.map((i) => {
      const prev = c?.payload.answers.find((a) => a.item_id === i.id)
      return [i.id, { ok: prev ? prev.ok : null, comment: prev?.comment ?? '' }]
    })),
  )
  const [reason, setReason] = useState('')
  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))

  const unanswered = items.filter((i) => answers[i.id].ok === null)
  const noComment = items.filter((i) => answers[i.id].ok === false && !answers[i.id].comment.trim())
  const noCount = items.filter((i) => answers[i.id].ok === false).length
  const payload = (): ChecklistDonePayload =>
    checklistPayload(
      cl.id,
      items.map((i) => ({ item_id: i.id, ok: answers[i.id].ok === true, comment: answers[i.id].ok === false ? answers[i.id].comment : undefined })),
    )
  const unchanged = c ? JSON.stringify(payload()) === JSON.stringify(c.payload) : false
  const missing: string[] = []
  if (unanswered.length) missing.push(plural(unanswered.length, 'point sans réponse', 'points sans réponse'))
  if (noComment.length) missing.push(plural(noComment.length, 'commentaire pour un « Non »', 'commentaires pour les « Non »'))
  if (c && !reason.trim()) missing.push('le motif de la correction')
  const canSave = !busy && missing.length === 0 && !unchanged

  const submit = async () => {
    if (!canSave) return
    const p = payload()
    const rec = c
      ? await save('correction', { reason: reason.trim(), replacement: structuredClone(p) }, { supersedes_id: c.latest.id, ctx: { supersededType: 'checklist_done' } })
      : await save('checklist_done', structuredClone(p) as unknown as Record<string, unknown>)
    if (!rec) return
    const nc = p.answers.filter((a) => !a.ok).length
    toast(c ? 'Correction enregistrée' : nc ? `Checklist « ${cl.name} » enregistrée : ${plural(nc, 'point non conforme', 'points non conformes')}` : `Checklist « ${cl.name} » enregistrée : tout est conforme`, nc && !c ? 'error' : 'ok')
    props.onSaved(rec, p)
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <IconChecklist size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{c ? `Corriger : ${cl.name}` : cl.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">Checklist · {CHECKLIST_KIND_LABELS[cl.kind]}</Badge>
              <span className="text-[15px] text-fg-muted">{plural(items.length, 'point', 'points')}</span>
              {!c && props.status && props.status.state !== 'none' && <DueBadge state={props.status.state} label={props.status.label} />}
            </div>
          </div>
        </div>
      </div>
      {c && (
        <div className="mb-6 max-w-3xl space-y-4">
          <p className="text-[16px] text-fg-muted">Checklist remplie {formatDateTime(c.time, props.timeZone)}.</p>
          <ReasonField value={reason} onChange={setReason} quick={['Mauvaise réponse cochée', 'Commentaire à compléter']} />
        </div>
      )}

      <ol className="grid items-start gap-3 lg:grid-cols-2">
        {items.map((item, k) => {
          const a = answers[item.id]
          const no = a.ok === false
          return (
            <li
              key={item.id}
              className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${no ? (item.required ? 'border-danger/55' : 'border-warn/55') : a.ok ? 'border-ok/40' : 'border-line'}`}
            >
              <div className="mb-3 flex items-start gap-3">
                <span className="mt-0.5 w-7 shrink-0 text-[16px] font-semibold text-fg-subtle tabular-nums">{k + 1}.</span>
                <p id={`item-${item.id}`} className="min-w-0 flex-1 text-[18px] leading-snug font-semibold text-fg">
                  {item.label}
                </p>
                {item.required && (
                  <Badge tone="warn" className="shrink-0">
                    <IconWarn size={13} strokeWidth={2.25} />
                    Point critique
                  </Badge>
                )}
              </div>
              <YesNo label={item.label} value={a.ok} onChange={(ok) => set(item.id, { ok })} />
              {no && (
                <div className="mt-3">
                  <TextArea
                    label="Commentaire (obligatoire)"
                    hint="Ce qui n’est pas conforme et ce qui a été fait."
                    value={a.comment}
                    onChange={(comment) => set(item.id, { comment })}
                    maxLength={LIMITS.checklistCommentMax}
                    required
                    invalid={!a.comment.trim()}
                    rows={2}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="sticky bottom-0 z-10 -mx-4 mt-5 bg-canvas/95 px-4 pt-3 pb-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <p className="min-w-0 flex-1 text-[16px] text-fg" aria-live="polite">
            <span className="font-semibold tabular-nums">
              {items.length - unanswered.length}/{items.length}
            </span>{' '}
            points renseignés
            {noCount > 0 && <span className="font-semibold text-danger"> · {plural(noCount, 'non-conformité', 'non-conformités')}</span>}
            {missing.length > 0 && <span className="block text-[14px] text-fg-subtle">À compléter : {missing.join(', ')}.</span>}
          </p>
          <Button variant="ghost" onClick={props.onCancel}>
            Annuler
          </Button>
          <Button size="lg" onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
            {busy ? 'Enregistrement…' : c ? 'Enregistrer la correction' : 'Enregistrer la checklist'}
          </Button>
        </div>
        <ErrorNotice error={error} />
        {noCount > 0 && !c && (
          <div className="mt-3 max-w-2xl">
            <Notice tone="warn">Une checklist avec des « Non » est enregistrée telle quelle : le registre garde la trace de la non-conformité et de votre commentaire.</Notice>
          </div>
        )}
      </div>
    </div>
  )
}
