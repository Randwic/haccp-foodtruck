import type { ReactNode } from 'react'

export type BadgeTone = 'ok' | 'warn' | 'error' | 'neutral' | 'info'

// Badges discrets : fond teinté + texte de la couleur d'état (AA dans les deux thèmes).
const TONES: Record<BadgeTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  error: 'bg-danger-soft text-danger',
  neutral: 'bg-sunken text-fg-muted',
  info: 'bg-accent-soft text-accent',
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
