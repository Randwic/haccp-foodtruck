// Champs communs aux fiches Produits et Recettes : 14 allergènes à cocher, conservation, durée de vie conviviale.
import { useId } from 'react'
import { ALLERGEN_LABELS, ALLERGENS, type Allergen, type StorageMode } from '../../../../shared/payloads.ts'
import { IconCheck, IconFridge, IconInfo, IconSnowflake, IconBox } from '../../ui/icons.tsx'
import { STORAGE_LABELS, formatShelfLife, shelfLifeHours, type ShelfUnit } from '../labels/model.ts'

/** Les 14 allergènes (annexe II INCO) en grandes cases à cocher. `locked` : déjà apportés (recette), cochés et grisés. */
export function AllergenChecklist({
  value,
  onChange,
  legend,
  locked = [],
}: {
  value: readonly Allergen[]
  onChange: (v: Allergen[]) => void
  legend: string
  locked?: readonly Allergen[]
}) {
  const toggle = (a: Allergen) => onChange(value.includes(a) ? value.filter((x) => x !== a) : ALLERGENS.filter((x) => x === a || value.includes(x)))
  return (
    <fieldset>
      <legend className="mb-1.5 text-[15px] font-semibold text-fg">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {ALLERGENS.map((a) => {
          const isLocked = locked.includes(a)
          const checked = isLocked || value.includes(a)
          return (
            <label
              key={a}
              className={`flex min-h-14 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[15px] transition-colors sm:gap-3 sm:px-3.5 sm:text-[16px] ${
                checked ? 'border-accent bg-accent-soft font-semibold text-fg' : 'border-line-strong bg-elevated text-fg'
              } ${isLocked ? 'cursor-default opacity-80' : 'active:bg-pressed'}`}
            >
              <input type="checkbox" className="sr-only" checked={checked} disabled={isLocked} onChange={() => toggle(a)} />
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${checked ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-surface'}`}
              >
                {checked && <IconCheck size={18} strokeWidth={3} />}
              </span>
              <span className="min-w-0 leading-snug">
                {ALLERGEN_LABELS[a]}
                {isLocked && <span className="block text-[13px] font-normal text-fg-muted">apporté par un ingrédient</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const STORAGE_ICON = { fridge: IconFridge, freezer: IconSnowflake, ambient: IconBox } as const

export function StoragePicker({ value, onChange, label = 'Conservation' }: { value: StorageMode; onChange: (v: StorageMode) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className="mb-1.5 text-[15px] font-semibold text-fg">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {(['fridge', 'freezer', 'ambient'] as const).map((s) => {
          const Icon = STORAGE_ICON[s]
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value === s}
              onClick={() => onChange(s)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 text-[15px] font-semibold active:bg-pressed sm:min-h-14 sm:flex-row sm:gap-2 sm:text-[16px] ${value === s ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-elevated text-fg'}`}
            >
              <Icon size={18} className={value === s ? 'text-accent' : 'text-fg-subtle'} />
              {STORAGE_LABELS[s]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface ShelfLifeValue {
  /** Non applicable (null en base) — seulement pour les produits. */
  none: boolean
  value: string
  unit: ShelfUnit
}

/** Heures saisies (null si « non applicable »), NaN si invalide. */
export function shelfValueHours(v: ShelfLifeValue): number | null {
  if (v.none) return null
  const h = shelfLifeHours(v.value, v.unit)
  return h === null ? Number.NaN : h
}

const QUICK: { label: string; value: string; unit: ShelfUnit }[] = [
  { label: '24 h', value: '24', unit: 'hours' },
  { label: '2 jours', value: '2', unit: 'days' },
  { label: '3 jours', value: '3', unit: 'days' },
  { label: '7 jours', value: '7', unit: 'days' },
]

/** Durée de vie : nombre + jours / heures, raccourcis, option « non applicable ». */
export function ShelfLifeField({
  label,
  hint,
  value,
  onChange,
  nullable,
  error,
}: {
  label: string
  hint?: string
  value: ShelfLifeValue
  onChange: (v: ShelfLifeValue) => void
  nullable?: boolean
  error?: string
}) {
  const id = useId()
  const hours = shelfValueHours(value)
  const seg = (active: boolean) =>
    `min-h-14 flex-1 rounded-lg px-3 text-[16px] font-semibold transition-colors ${active ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`
  return (
    <fieldset aria-describedby={`${id}-sum`}>
      <legend className="mb-1.5 text-[15px] font-semibold text-fg">{label}</legend>
      {hint && <p className="mb-2 text-[15px] text-fg-muted">{hint}</p>}
      {nullable && (
        <label className="mb-2.5 flex min-h-11 cursor-pointer items-center gap-3 text-[16px] text-fg">
          <input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={value.none} onChange={(e) => onChange({ ...value, none: e.target.checked, value: e.target.checked ? '' : value.value })} />
          Non applicable
        </label>
      )}
      {!value.none && (
        <>
          <div className="flex items-stretch gap-2">
            <input
              aria-label={`${label} — nombre`}
              inputMode="numeric"
              value={value.value}
              onChange={(e) => onChange({ ...value, value: e.target.value.replace(/[^\d,.]/g, '') })}
              placeholder="—"
              className={`min-h-14 w-24 shrink-0 rounded-xl border bg-elevated px-4 text-center text-[19px] font-semibold text-fg tabular-nums focus:border-accent ${error ? 'border-danger' : 'border-line-strong'}`}
            />
            <div role="radiogroup" aria-label={`${label} — unité`} className="flex flex-1 gap-1 rounded-xl bg-sunken p-1">
              <button type="button" role="radio" aria-checked={value.unit === 'days'} className={seg(value.unit === 'days')} onClick={() => onChange({ ...value, unit: 'days' })}>
                jours
              </button>
              <button type="button" role="radio" aria-checked={value.unit === 'hours'} className={seg(value.unit === 'hours')} onClick={() => onChange({ ...value, unit: 'hours' })}>
                heures
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK.map((q) => {
              const on = value.value === q.value && value.unit === q.unit
              return (
                <button
                  key={q.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ none: false, value: q.value, unit: q.unit })}
                  className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold active:bg-pressed ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg'}`}
                >
                  {q.label}
                </button>
              )
            })}
          </div>
        </>
      )}
      <p id={`${id}-sum`} className={`mt-2 text-[15px] ${error ? 'font-medium text-danger' : 'text-fg-muted'}`}>
        {error ?? (value.none ? 'Pas de DLC proposée pour ce cas.' : hours !== null && !Number.isNaN(hours) ? `Soit ${formatShelfLife(hours)}.` : '')}
      </p>
    </fieldset>
  )
}

/** Rappel réglementaire, sur chaque fiche. */
export function VerifyNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-sunken px-4 py-3 text-[15px] leading-snug text-fg">
      <IconInfo size={20} className="mt-px shrink-0 text-accent" />
      <span>
        Allergènes et durées de vie <span className="font-semibold">à vérifier sur vos fiches fournisseurs / votre PMS</span>. Ils sont imprimés sur les étiquettes et repris dans le tableau des allergènes de la clientèle.
      </span>
    </p>
  )
}
