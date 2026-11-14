import { useState } from 'react'
import { Button } from './Button.tsx'
import { PinPad, haptic } from './PinPad.tsx'

export interface PinSetupProps {
  /** Longueur exacte (ex. 6) ou plage. */
  minLength?: number
  maxLength?: number
  /** Appelé avec le PIN une fois saisi deux fois à l'identique. */
  onComplete: (pin: string) => void
  disabled?: boolean
  /** Prénom de la personne concernée (« Code PIN de Léa »). */
  who?: string
}

/** PIN évident (000000, 123456…) : refusé pour un nouveau code. */
// eslint-disable-next-line react-refresh/only-export-components
export function isTrivialPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  const asc = '01234567890'
  const desc = '09876543210'
  return asc.includes(pin) || desc.includes(pin)
}

/** Choix d'un nouveau PIN : saisie puis confirmation, sur le pavé numérique géant. */
export function PinSetup({ minLength = 6, maxLength = 6, onComplete, disabled, who }: PinSetupProps) {
  const [step, setStep] = useState<'first' | 'confirm'>('first')
  const [first, setFirst] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const lengthText = minLength === maxLength ? `${maxLength} chiffres` : `${minLength} à ${maxLength} chiffres`

  const submit = (v: string) => {
    if (step === 'first') {
      if (isTrivialPin(v)) {
        haptic([60, 40, 60])
        setError('Code trop facile à deviner : évitez les suites et les chiffres répétés.')
        setValue('')
        return
      }
      setFirst(v)
      setValue('')
      setError(null)
      setStep('confirm')
      return
    }
    if (v !== first) {
      haptic([60, 40, 60])
      setError('Les deux codes ne correspondent pas. Recommencez.')
      setFirst('')
      setValue('')
      setStep('first')
      return
    }
    setError(null)
    onComplete(v)
  }

  const title = step === 'first' ? `Choisissez un code PIN${who ? ` pour ${who}` : ''}` : 'Confirmez le code PIN'
  return (
    <div>
      <p className="text-center text-2xl font-bold text-white">{title}</p>
      <p className="mb-3 text-center text-base text-slate-300">
        {step === 'first' ? `${lengthText}, pour déverrouiller l’app chaque jour.` : 'Saisissez le même code une seconde fois.'}
      </p>
      <div role="alert" aria-live="assertive" className="mb-2 min-h-8 text-center">
        {error && <p className="inline-block rounded-2xl bg-red-700 px-4 py-2 text-lg font-bold text-white">{error}</p>}
      </div>
      <PinPad
        value={value}
        onChange={(v) => {
          setValue(v)
          if (error && v.length > 0) setError(null)
        }}
        onSubmit={submit}
        minLength={minLength}
        maxLength={maxLength}
        disabled={disabled}
        label={title}
      />
      {step === 'confirm' && (
        <div className="mt-3 text-center">
          <Button
            variant="ghost"
            onClick={() => {
              setStep('first')
              setFirst('')
              setValue('')
            }}
          >
            Recommencer
          </Button>
        </div>
      )}
    </div>
  )
}
