import { useState } from 'react'
import { passwordStrength } from '../../manager/helpers.ts'
import { TextField, type TextFieldProps } from '../../ui/components/index.ts'
import { IconEye, IconEyeOff } from '../../ui/icons.tsx'

const BAR = ['bg-line-strong', 'bg-danger', 'bg-warn', 'bg-ok', 'bg-ok']
const TEXT = ['text-fg-muted', 'text-danger', 'text-warn', 'text-ok', 'text-ok']

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
          className="flex min-h-14 shrink-0 items-center gap-2 rounded-xl border border-line-strong bg-elevated px-3.5 text-[15px] font-semibold text-fg shadow-card active:bg-pressed"
        >
          {visible ? <IconEyeOff size={20} className="text-fg-muted" /> : <IconEye size={20} className="text-fg-muted" />}
          <span className="hidden sm:inline">{visible ? 'Masquer' : 'Afficher'}</span>
        </button>
      }
      below={
        showStrength && props.value.length > 0 ? (
          <div className="mt-3" aria-live="polite">
            <div className="flex gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= strength.score ? BAR[strength.score] : 'bg-line-strong'}`} />
              ))}
            </div>
            <p className={`mt-2 text-[14px] font-semibold ${TEXT[strength.score]}`}>Force du mot de passe : {strength.label}</p>
          </div>
        ) : undefined
      }
    />
  )
}
