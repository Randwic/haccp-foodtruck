import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { IconDelete, IconInfo, IconOk, IconWarn } from '../icons.tsx'
import {
  applyTemperatureKey,
  describeThreshold,
  isInRange,
  temperatureToText,
  TEMPERATURE_MAX_C,
  TEMPERATURE_MIN_C,
  textToTemperature,
  type TemperatureKey,
  type TemperatureThreshold,
} from '../temperature.ts'
import { haptic } from './PinPad.tsx'

/**
 * Saisie d'une température au pavé numérique intégré (jamais le clavier iOS), utilisable avec des gants.
 *
 * Interface STABLE, réutilisée par les procédés (refroidissement, remise en température, cuisson…) :
 * - `value` / `onChange` : valeur en °C (1 décimale max, −50..300) ou `null` tant que rien n'est saisi
 *   (ou saisie incomplète : « − » seul). La saisie intermédiaire « 3, » donne 3.
 * - `label` : libellé visible et accessible (ex. « Température de Frigo 1 »).
 * - `threshold` : seuil du contrôle ; affiche en direct « Conforme » / « Hors seuil » (couleur + icône + texte).
 *   Le calcul est celui de `isInRange` (ui/temperature.ts), à réutiliser pour `in_range` du payload.
 * - `autoFocus` : met le focus sur le composant (clavier physique : chiffres, « , » ou « . », « - »,
 *   Retour arrière, Échap pour tout effacer).
 */
export interface TemperatureInputProps {
  value: number | null
  onChange: (v: number | null) => void
  label: string
  threshold?: TemperatureThreshold
  autoFocus?: boolean
  className?: string
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function TemperatureInput({ value, onChange, label, threshold, autoFocus, className = '' }: TemperatureInputProps) {
  const labelId = useId()
  const statusId = useId()
  const [text, setText] = useState(() => temperatureToText(value))
  const [syncedValue, setSyncedValue] = useState(value)
  const [refused, setRefused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  // Valeur changée par le parent (réinitialisation, valeur initiale…) : on réaligne le texte affiché.
  if (value !== syncedValue) {
    setSyncedValue(value)
    if (textToTemperature(text) !== value) setText(temperatureToText(value))
  }

  const press = (key: TemperatureKey) => {
    const next = applyTemperatureKey(text, key)
    if (next === null) {
      haptic([40, 30, 40])
      setRefused(true)
      return
    }
    haptic()
    setRefused(false)
    setText(next)
    const v = textToTemperature(next)
    setSyncedValue(v)
    if (v !== value) onChange(v)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const map: Record<string, TemperatureKey> = { ',': ',', '.': ',', '-': '-', Backspace: 'backspace', Escape: 'clear', Delete: 'clear' }
    const key = /^[0-9]$/.test(e.key) ? (e.key as TemperatureKey) : map[e.key]
    if (!key) return
    e.preventDefault()
    press(key)
  }

  const status = value === null || !threshold ? null : isInRange(value, threshold) ? 'ok' : 'out'
  const shown = text === '' ? null : text.replace('-', '−')

  const keyBase =
    'flex h-16 [@media(min-height:960px)]:h-[72px] items-center justify-center rounded-2xl text-[30px] font-medium tabular-nums select-none transition-[background-color,transform] duration-75 active:scale-[0.96]'
  const digitKey = `${keyBase} border border-line-strong bg-elevated text-fg shadow-card active:bg-pressed`
  const sideKey = `${keyBase} border border-line bg-sunken text-fg active:bg-pressed`

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
      <div
        className={`flex min-h-22 items-center gap-2 rounded-2xl border-2 bg-elevated py-2 pr-2 pl-5 transition-colors ${
          status === 'ok' ? 'border-ok' : status === 'out' ? 'border-danger' : 'border-line-strong'
        }`}
      >
        <output
          aria-live="polite"
          aria-label={shown === null ? 'Aucune valeur saisie' : `Valeur saisie : ${shown} degrés`}
          className="flex min-w-0 flex-1 items-baseline gap-2 tabular-nums"
        >
          <span className={`text-[52px] leading-none font-semibold tracking-[-0.03em] sm:text-[60px] ${shown === null ? 'text-fg-subtle' : 'text-fg'}`}>
            {shown ?? '––'}
          </span>
          <span className="text-[26px] font-medium text-fg-muted">°C</span>
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
        {status === 'ok' && threshold ? (
          <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-3.5 py-2.5 text-[16px] font-semibold text-ok">
            <IconOk size={20} className="shrink-0" />
            Conforme
            <span className="font-normal text-fg-muted">· seuil {describeThreshold(threshold)}</span>
          </p>
        ) : status === 'out' && threshold ? (
          <p className="flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[16px] font-semibold text-danger">
            <IconWarn size={20} className="shrink-0" />
            Hors seuil
            <span className="font-normal text-fg">· seuil {describeThreshold(threshold)}</span>
          </p>
        ) : threshold ? (
          <p className="px-1 py-2.5 text-[15px] text-fg-muted">Seuil : {describeThreshold(threshold)}</p>
        ) : null}
        {refused && (
          <p className="flex items-center gap-2 px-1 pt-2 text-[15px] text-fg-muted">
            <IconInfo size={18} className="shrink-0 text-accent" />
            Entre {TEMPERATURE_MIN_C.toString().replace('-', '−')} et {TEMPERATURE_MAX_C} °C, une décimale au plus.
          </p>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-3">
        {DIGITS.map((d) => (
          <button key={d} type="button" className={digitKey} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={sideKey} onClick={() => press('-')} aria-label="Moins (changer le signe)">
          <span aria-hidden="true">−</span>
        </button>
        <button type="button" className={digitKey} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className={sideKey} onClick={() => press(',')} aria-label="Virgule">
          <span aria-hidden="true">,</span>
        </button>
      </div>
    </div>
  )
}
