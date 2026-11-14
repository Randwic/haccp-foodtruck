import { useState } from 'react'
import { passwordStrength } from '../../manager/helpers.ts'
import { TextField, type TextFieldProps } from '../../ui/components/index.ts'

const BAR = ['bg-slate-700', 'bg-red-500', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-300']
const TEXT = ['text-slate-300', 'text-red-300', 'text-amber-200', 'text-emerald-300', 'text-emerald-200']

/** Mot de passe avec bouton « Afficher » et, en option, indicateur de force. */
export function PasswordField({ showStrength, ...props }: Omit<TextFieldProps, 'type' | 'addon' | 'below'> & { showStrength?: boolean }) {
  const [visible, setVisible] = useState(false)
  const strength = passwordStrength(props.value)
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      addon={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? `Masquer – ${props.label}` : `Afficher – ${props.label}`}
          className="min-h-16 shrink-0 rounded-2xl bg-slate-700 px-4 text-base font-semibold text-white ring-1 ring-slate-500 active:bg-slate-600"
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      }
      below={
        showStrength && props.value.length > 0 ? (
          <div className="mt-3" aria-live="polite">
            <div className="flex gap-2" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`h-2.5 flex-1 rounded-full ${i <= strength.score ? BAR[strength.score] : 'bg-slate-700'}`} />
              ))}
            </div>
            <p className={`mt-2 text-base font-semibold ${TEXT[strength.score]}`}>Force du mot de passe : {strength.label}</p>
          </div>
        ) : undefined
      }
    />
  )
}
