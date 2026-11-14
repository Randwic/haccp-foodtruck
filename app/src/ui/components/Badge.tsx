import type { ReactNode } from 'react'

export type BadgeTone = 'ok' | 'warn' | 'error' | 'neutral' | 'info'

const TONES: Record<BadgeTone, string> = {
  ok: 'bg-emerald-400 text-slate-950',
  warn: 'bg-amber-400 text-slate-950',
  error: 'bg-red-700 text-white',
  neutral: 'bg-slate-600 text-white',
  info: 'bg-sky-300 text-slate-950',
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-base font-bold whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
