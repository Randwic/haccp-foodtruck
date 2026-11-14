import type { ReactNode } from 'react'
import { Badge } from './Badge.tsx'

export interface TileProps {
  title: string
  description?: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Mention affichée sur une tuile désactivée (ex. « Bientôt »). */
  disabledLabel?: string
  className?: string
}

/** Grande tuile tactile (accueil, choix d'équipier…). */
export function Tile({ title, description, icon, onClick, disabled, disabledLabel = 'Bientôt', className = '' }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled ? `${title} (${disabledLabel})` : undefined}
      className={`relative flex min-h-32 w-full min-w-0 flex-col items-start justify-between gap-3 rounded-3xl p-4 sm:p-5 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-900 text-slate-300 ring-1 ring-slate-700'
          : 'bg-slate-800 text-white ring-2 ring-sky-300 active:bg-slate-700'
      } ${className}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        {icon && <span aria-hidden="true" className="text-4xl leading-none">{icon}</span>}
        {disabled && <Badge tone="neutral">{disabledLabel}</Badge>}
      </div>
      <div className="min-w-0 w-full">
        <div className="hyphens-auto break-words text-lg font-bold leading-tight sm:text-xl">{title}</div>
        {description && <div className={`mt-1 text-base ${disabled ? 'text-slate-400' : 'text-slate-200'}`}>{description}</div>}
      </div>
    </button>
  )
}
