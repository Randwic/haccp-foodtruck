// Briques d'interface du module Nettoyage (et réutilisées par le module Huiles).
import { useId } from 'react'
import { Badge } from '../../ui/components/index.ts'
import { IconBan, IconDue, IconEdit, IconError, IconOk, IconWarn } from '../../ui/icons.tsx'
import type { Change } from './model.ts'
import type { ChecklistState } from './schedule.ts'

/** Échéance : icône + texte, jamais la couleur seule. */
export function DueBadge({ state, label }: { state: ChecklistState; label: string }) {
  if (state === 'overdue')
    return (
      <Badge tone="error">
        <IconError size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  if (state === 'late')
    return (
      <Badge tone="warn">
        <IconWarn size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  if (state === 'done')
    return (
      <Badge tone="ok">
        <IconOk size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  if (state === 'due')
    return (
      <Badge tone="info">
        <IconDue size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  return <Badge tone="neutral">{label}</Badge>
}

export const dueBorder = (state: ChecklistState) => (state === 'overdue' ? 'border-danger/55' : state === 'late' ? 'border-warn/55' : 'border-line')

/** Zone de texte multiligne au style des champs de l'application. */
export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; maxLength: number; required?: boolean; hint?: string; rows?: number; invalid?: boolean }) {
  const id = useId()
  const hintId = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-semibold text-fg">
        {props.label}
      </label>
      {props.hint && (
        <p id={hintId} className="mb-2 text-[15px] text-fg-muted">
          {props.hint}
        </p>
      )}
      <textarea
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        maxLength={props.maxLength}
        rows={props.rows ?? 3}
        aria-required={props.required || undefined}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.hint ? hintId : undefined}
        className={`block w-full resize-y rounded-xl border bg-elevated px-4 py-3 text-[17px] text-fg transition-colors focus:border-accent ${props.invalid ? 'border-danger' : 'border-line-strong'}`}
      />
    </div>
  )
}

/** Gros interrupteur Oui / Non (gants) : radios accessibles. */
export function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-3">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 text-[18px] font-semibold transition-colors active:bg-pressed ${
            value === v ? (v ? 'border-ok bg-ok-soft text-ok' : 'border-danger bg-danger-soft text-danger') : 'border-line-strong bg-elevated text-fg'
          }`}
        >
          {v ? <IconOk size={22} /> : <IconBan size={22} />}
          {v ? 'Oui' : 'Non'}
        </button>
      ))}
    </div>
  )
}

/** Correction : motif + valeurs d'origine barrées. */
export function CorrectionTrail({ when, author, reason, changes }: { when: string; author: string; reason?: string; changes: Change[] }) {
  return (
    <div className="mt-3 rounded-xl bg-sunken px-3.5 py-3 text-[15px] text-fg">
      <p className="flex items-start gap-2">
        <IconEdit size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
        <span>
          Corrigé {when} par {author}
          {reason ? <span className="text-fg-muted"> — motif : {reason}</span> : null}
        </span>
      </p>
      {changes.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-6">
          {changes.map((c) => (
            <li key={c.label}>
              <span className="text-fg-muted">{c.label} : </span>
              <s className="text-fg-subtle" aria-label={`ancienne valeur ${c.before}`}>
                {c.before}
              </s>{' '}
              <span className="font-semibold">{c.after}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
