import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

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
      <label htmlFor={id} className="mb-2 block text-xl font-semibold text-white">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-2 text-base text-slate-300">
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
          className={`min-h-16 w-full min-w-0 rounded-2xl bg-slate-800 px-4 text-xl text-white ring-2 placeholder:text-slate-500 ${
            error ? 'ring-red-400' : 'ring-slate-600'
          } ${mono ? 'font-mono text-lg' : ''}`}
        />
        {addon}
      </div>
      {below}
      {error && (
        <p id={errId} className="mt-2 text-lg font-semibold text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

/** Bandeau d'erreur ou de succès (role=alert / status). */
export function Notice({ tone = 'error', children, id }: { tone?: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode; id?: string }) {
  const cls = {
    error: 'bg-red-950 text-red-100 ring-red-400',
    ok: 'bg-emerald-950 text-emerald-100 ring-emerald-400',
    warn: 'bg-amber-950 text-amber-100 ring-amber-400',
    info: 'bg-slate-900 text-slate-100 ring-sky-300',
  }[tone]
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl px-5 py-4 text-lg font-semibold ring-2 ${cls}`}>
      {children}
    </div>
  )
}
