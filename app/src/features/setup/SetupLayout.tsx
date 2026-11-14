import type { ReactNode } from 'react'
import { IconCheck } from '../../ui/icons.tsx'

export interface SetupLayoutProps {
  title: string
  intro?: ReactNode
  steps?: string[]
  stepIndex?: number
  children: ReactNode
  footer?: ReactNode
}

/** Mise en page des écrans de première configuration (colonne centrée, lisible sur iPhone et iPad). */
export function SetupLayout({ title, intro, steps, stepIndex = 0, children, footer }: SetupLayoutProps) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6 sm:py-10">
      <p className="text-base font-semibold tracking-wide text-sky-300 uppercase">HACCP Food Truck · Première configuration</p>
      <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{title}</h1>
      {intro && <p className="mt-3 text-lg text-slate-200">{intro}</p>}
      {steps && (
        <ol className="mt-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Étapes">
          {steps.map((label, i) => {
            const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo'
            return (
              <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full ${state === 'todo' ? 'bg-slate-700' : state === 'current' ? 'bg-sky-300' : 'bg-emerald-400'}`}
                />
                <span className={`mt-2 block truncate text-sm font-semibold sm:text-base ${state === 'current' ? 'text-white' : 'text-slate-400'}`}>
                  <span className="sr-only">Étape {i + 1} sur {steps.length} : </span>
                  {label}
                  {state === 'done' && <span className="sr-only"> (terminée)</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-10 border-t border-slate-800 pt-6">{footer}</div>}
    </main>
  )
}

export type ProgressStep = 'account' | 'signin' | 'enroll' | 'sync' | 'done'

const LABELS: Record<Exclude<ProgressStep, 'done'>, string> = {
  account: 'Création du compte gérant',
  signin: 'Connexion',
  enroll: 'Enregistrement de cet appareil',
  sync: 'Récupération de l’équipe et des équipements',
}

/** Avancement de la configuration automatique. */
export function SetupProgress({ current, withAccount }: { current: ProgressStep; withAccount?: boolean }) {
  const order: Exclude<ProgressStep, 'done'>[] = withAccount ? ['account', 'signin', 'enroll', 'sync'] : ['signin', 'enroll', 'sync']
  const idx = current === 'done' ? order.length : order.indexOf(current)
  return (
    <ol className="space-y-4" aria-live="polite" aria-busy={current !== 'done'}>
      {order.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
        return (
          <li key={s} className={`flex min-h-16 items-center gap-4 rounded-2xl px-5 py-3 text-xl ${state === 'current' ? 'bg-slate-800 ring-2 ring-sky-300' : 'bg-slate-900'}`}>
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
              {state === 'done' ? (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-slate-950">
                  <IconCheck size={24} strokeWidth={3} />
                </span>
              ) : state === 'current' ? (
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-sky-300 border-t-transparent" />
              ) : (
                <span className="h-4 w-4 rounded-full bg-slate-600" />
              )}
            </span>
            <span className={state === 'todo' ? 'text-slate-400' : 'font-semibold text-white'}>
              {LABELS[s]}
              {state === 'current' && '…'}
              {state === 'done' && <span className="sr-only"> : terminé</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
