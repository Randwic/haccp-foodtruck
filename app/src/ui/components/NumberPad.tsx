import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconDelete, IconInfo } from '../icons.tsx'
import { applyNumberKey, formatNumber, numberToText, textToNumber, type NumberKey } from '../numberPad.ts'
import { haptic } from './PinPad.tsx'

/**
 * Saisie générique d'un nombre positif au pavé numérique intégré (jamais le clavier iOS), avec des gants.
 * Même apparence que `TemperatureInput`, réutilisable pour tout pourcentage / quantité :
 * - `value` / `onChange` : valeur (arrondie à `decimals`) ou `null` tant que rien n'est saisi ;
 * - `min`, `max`, `decimals` : bornes de la saisie (une touche qui dépasserait `max` est refusée) ;
 * - `unit` : unité affichée (« % ») ; `label` : libellé visible et accessible ;
 * - `status` : contenu affiché sous la valeur (conformité en direct, jauge…) ; `tone` colore le cadre.
 * Clavier physique : chiffres, « , » ou « . », Retour arrière, Échap pour tout effacer.
 */
export interface NumberPadProps {
  value: number | null
  onChange: (v: number | null) => void
  label: string
  min: number
  max: number
  decimals?: number
  unit?: string
  /** Mot lu par les lecteurs d'écran après la valeur (« pour cent »). */
  unitSpoken?: string
  status?: ReactNode
  tone?: 'ok' | 'warn' | 'danger'
  autoFocus?: boolean
  className?: string
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function NumberPad({ value, onChange, label, min, max, decimals = 1, unit, unitSpoken, status, tone, autoFocus, className = '' }: NumberPadProps) {
  const labelId = useId()
  const statusId = useId()
  const rules = { min, max, decimals }
  const [text, setText] = useState(() => numberToText(value))
  const [syncedValue, setSyncedValue] = useState(value)
  const [refused, setRefused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  if (value !== syncedValue) {
    setSyncedValue(value)
    if (textToNumber(text, decimals) !== value) setText(numberToText(value))
  }

  const press = (key: NumberKey) => {
    const next = applyNumberKey(text, key, rules)
    if (next === null) {
      haptic([40, 30, 40])
      setRefused(true)
      return
    }
    haptic()
    setRefused(false)
    setText(next)
    const v = textToNumber(next, decimals)
    setSyncedValue(v)
    if (v !== value) onChange(v)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const map: Record<string, NumberKey> = { ',': ',', '.': ',', Backspace: 'backspace', Escape: 'clear', Delete: 'clear' }
    const key = /^[0-9]$/.test(e.key) ? (e.key as NumberKey) : map[e.key]
    if (!key) return
    e.preventDefault()
    press(key)
  }

  const shown = text === '' ? null : text
  const border = tone === 'ok' ? 'border-ok' : tone === 'warn' ? 'border-warn' : tone === 'danger' ? 'border-danger' : 'border-line-strong'
  const keyBase =
    'flex h-16 [@media(min-height:960px)]:h-[72px] items-center justify-center rounded-2xl text-[30px] font-medium tabular-nums select-none transition-[background-color,transform] duration-75 active:scale-[0.96]'
  const digitKey = `${keyBase} border border-line-strong bg-elevated text-fg shadow-card active:bg-pressed`
  const sideKey = `${keyBase} border border-line bg-sunken text-fg active:bg-pressed disabled:opacity-35`

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={statusId}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`w-full max-w-sm rounded-2xl outline-none focus-visible:outline-none ${className}`}
    >
      <p id={labelId} className="mb-2 text-[15px] font-semibold text-fg">
        {label}
      </p>
      <div className={`flex min-h-22 items-center gap-2 rounded-2xl border-2 bg-elevated py-2 pr-2 pl-5 transition-colors ${border}`}>
        <output
          aria-live="polite"
          aria-label={shown === null ? 'Aucune valeur saisie' : `Valeur saisie : ${shown}${unitSpoken ? ` ${unitSpoken}` : ''}`}
          className="flex min-w-0 flex-1 items-baseline gap-2 tabular-nums"
        >
          <span className={`text-[52px] leading-none font-semibold tracking-[-0.03em] sm:text-[60px] ${shown === null ? 'text-fg-subtle' : 'text-fg'}`}>{shown ?? '––'}</span>
          {unit && <span className="text-[26px] font-medium text-fg-muted">{unit}</span>}
        </output>
        <button
          type="button"
          onClick={() => press('backspace')}
          disabled={text === ''}
          aria-label="Effacer le dernier caractère"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-fg-muted transition-[background-color,transform] active:scale-[0.96] active:bg-pressed disabled:opacity-35"
        >
          <IconDelete size={28} />
        </button>
      </div>

      <div id={statusId} className="mt-2 min-h-11">
        {status}
        {refused && (
          <p className="flex items-center gap-2 px-1 pt-2 text-[15px] text-fg-muted">
            <IconInfo size={18} className="shrink-0 text-accent" />
            Entre {formatNumber(min)} et {formatNumber(max)}
            {unit ? ` ${unit}` : ''}
            {decimals > 0 ? `, ${decimals === 1 ? 'une décimale' : `${decimals} décimales`} au plus` : ', sans décimale'}.
          </p>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-3">
        {DIGITS.map((d) => (
          <button key={d} type="button" className={digitKey} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={sideKey} onClick={() => press('clear')} disabled={text === ''} aria-label="Tout effacer">
          <span aria-hidden="true" className="text-[18px] font-semibold">
            Effacer
          </span>
        </button>
        <button type="button" className={digitKey} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className={sideKey} onClick={() => press(',')} disabled={decimals === 0} aria-label="Virgule">
          <span aria-hidden="true">,</span>
        </button>
      </div>
    </div>
  )
}
