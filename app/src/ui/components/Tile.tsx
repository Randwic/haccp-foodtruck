import type { ReactNode } from 'react'
import { IconChevronRight } from '../icons.tsx'
import { Badge } from './Badge.tsx'

export interface TileProps {
  title: string
  description?: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Mention affichée sur une tuile désactivée (ex. « Bientôt »). */
  disabledLabel?: string
  /** `row` : tuile horizontale compacte (outils), `card` : tuile de module. */
  layout?: 'card' | 'row'
  className?: string
}

/** Tuile tactile (accueil) : icône dans un carré teinté, titre, sous-titre. */
export function Tile({ title, description, icon, onClick, disabled, disabledLabel = 'Bientôt', layout = 'card', className = '' }: TileProps) {
  const iconBox = icon && (
    <span
      aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${disabled ? 'bg-sunken text-fg-subtle' : 'bg-accent-soft text-accent'}`}
    >
      {icon}
    </span>
  )
  const text = (
    <div className="w-full min-w-0 flex-1">
      <div className={`hyphens-auto break-words text-[17px] leading-snug font-semibold tracking-[-0.01em] ${disabled ? 'text-fg-muted' : 'text-fg'}`}>{title}</div>
      {description && <div className="mt-0.5 text-[15px] leading-snug text-fg-subtle">{description}</div>}
    </div>
  )
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled ? `${title} (${disabledLabel})` : undefined}
      className={`relative flex w-full min-w-0 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-[background-color,transform] duration-100 sm:p-5 ${
        disabled ? 'cursor-default' : 'active:scale-[0.99] active:bg-pressed'
      } ${layout === 'row' ? 'min-h-20 items-center gap-4' : 'min-h-36 flex-col items-start justify-between gap-4'} ${className}`}
    >
      {layout === 'row' ? (
        <>
          {iconBox}
          {text}
          {!disabled && <IconChevronRight size={20} className="shrink-0 text-fg-subtle" />}
        </>
      ) : (
        <>
          <div className="flex w-full items-start justify-between gap-2">
            {iconBox}
            {disabled && <Badge tone="neutral">{disabledLabel}</Badge>}
          </div>
          {text}
        </>
      )}
    </button>
  )
}
