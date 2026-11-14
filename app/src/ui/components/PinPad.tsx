import { useEffect, useRef } from 'react'

export interface PinPadProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  minLength?: number
  maxLength?: number
  disabled?: boolean
  /** Libellé accessible du pavé. */
  label?: string
}

/** Retour haptique léger si disponible (Android ; ignoré sans erreur sur iOS). */
// eslint-disable-next-line react-refresh/only-export-components
export function haptic(pattern: number | number[] = 12) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* sans effet */
  }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** Pavé numérique géant (touches ≥ 72 px), utilisable avec des gants. Le clavier physique fonctionne aussi. */
export function PinPad({ value, onChange, onSubmit, minLength = 4, maxLength = 6, disabled, label = 'Code PIN' }: PinPadProps) {
  const state = useRef({ value, onChange, onSubmit, disabled })
  useEffect(() => {
    state.current = { value, onChange, onSubmit, disabled }
  })

  const press = (digit: string) => {
    if (disabled || value.length >= maxLength) return
    haptic()
    onChange(value + digit)
  }
  const erase = () => {
    if (disabled || value.length === 0) return
    haptic()
    onChange(value.slice(0, -1))
  }
  const submit = () => {
    if (disabled || value.length < minLength) return
    haptic()
    onSubmit(value)
  }

  // Clavier physique (iPad avec clavier, ordinateur) : chiffres, Retour arrière, Entrée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current
      if (s.disabled || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        if (s.value.length < maxLength) s.onChange(s.value + e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        s.onChange(s.value.slice(0, -1))
      } else if (e.key === 'Enter' && s.value.length >= minLength) {
        e.preventDefault()
        s.onSubmit(s.value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maxLength, minLength])

  const keyClass =
    'flex h-16 sm:h-20 items-center justify-center rounded-2xl text-4xl font-bold select-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div role="group" aria-label={label} className="mx-auto w-full max-w-sm">
      <div className="mb-4 flex h-8 items-center justify-center gap-4" aria-live="polite" aria-label={`${value.length} chiffre${value.length > 1 ? 's' : ''} saisi${value.length > 1 ? 's' : ''}`}>
        {Array.from({ length: maxLength }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`h-6 w-6 rounded-full border-2 ${i < value.length ? 'border-sky-300 bg-sky-300' : 'border-slate-400'}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button key={k} type="button" className={`${keyClass} bg-slate-700 text-white active:bg-slate-500`} onClick={() => press(k)} disabled={disabled}>
            {k}
          </button>
        ))}
        <button
          type="button"
          className={`${keyClass} bg-slate-800 text-2xl text-white ring-1 ring-slate-600 active:bg-slate-600`}
          onClick={erase}
          disabled={disabled || value.length === 0}
          aria-label="Effacer le dernier chiffre"
        >
          ⌫
        </button>
        <button type="button" className={`${keyClass} bg-slate-700 text-white active:bg-slate-500`} onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button
          type="button"
          className={`${keyClass} bg-sky-300 text-2xl text-slate-950 active:bg-sky-200`}
          onClick={submit}
          disabled={disabled || value.length < minLength}
          aria-label="Valider le code"
        >
          OK
        </button>
      </div>
    </div>
  )
}
