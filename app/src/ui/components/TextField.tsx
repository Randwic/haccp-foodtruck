import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { IconError, IconInfo, IconOk, IconWarn } from '../icons.tsx'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string
  hint?: ReactNode
  value: string
  error?: string
  onChange: (v: string) => void
  mono?: boolean
  /** Élément placé à droite du champ (bouton « afficher », signe ±…). */
  addon?: ReactNode
  /** Contenu affiché sous le champ (indicateur de force…). */
  below?: ReactNode
}

/** Champ texte géant, libellé + aide + erreur reliés (aria-describedby). */
export function TextField({ label, hint, value, error, onChange, mono, addon, below, className = '', ...rest }: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-semibold text-fg">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-2 text-[15px] text-fg-muted">
          {hint}
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined}
          className={`min-h-14 w-full min-w-0 rounded-xl border bg-elevated px-4 text-[17px] text-fg transition-colors focus:border-accent ${
            error ? 'border-danger' : 'border-line-strong'
          } ${mono ? 'font-mono' : ''}`}
        />
        {addon}
      </div>
      {below}
      {error && (
        <p id={errId} className="mt-2 flex items-start gap-1.5 text-[15px] font-medium text-danger">
          <IconError size={18} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

const NOTICE = {
  error: { cls: 'border-danger/30 bg-danger-soft', icon: 'text-danger', Icon: IconError },
  ok: { cls: 'border-ok/30 bg-ok-soft', icon: 'text-ok', Icon: IconOk },
  warn: { cls: 'border-warn/35 bg-warn-soft', icon: 'text-warn', Icon: IconWarn },
  info: { cls: 'border-line bg-sunken', icon: 'text-accent', Icon: IconInfo },
} as const

/** Bandeau d'erreur ou de succès (role=alert / status). */
export function Notice({ tone = 'error', children, id }: { tone?: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode; id?: string }) {
  const n = NOTICE[tone]
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 text-[15px] leading-snug text-fg ${n.cls}`}>
      <n.Icon size={20} className={`mt-px shrink-0 ${n.icon}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
