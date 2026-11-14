import type { ReactNode } from 'react'
import { BrandLogo, BrandStripe } from '../../ui/brand.tsx'
import { IconCheck } from '../../ui/icons.tsx'

export interface SetupLayoutProps {
  title: string
  intro?: ReactNode
  steps?: string[]
  stepIndex?: number
  children: ReactNode
  footer?: ReactNode
}

/** Mise en page des écrans de première configuration : en-tête de marque centré, contenu dans une carte. */
export function SetupLayout({ title, intro, steps, stepIndex = 0, children, footer }: SetupLayoutProps) {
  return (
    <>
      <BrandStripe />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-8 pb-12 sm:px-6 sm:pt-12">
        <div className="flex flex-col items-center text-center">
          <BrandLogo size={96} glow />
          <p className="mt-4 text-[13px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">Registre HACCP · Première configuration</p>
          <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
          {intro && <p className="mt-3 max-w-md text-[17px] leading-relaxed text-fg-muted">{intro}</p>}
        </div>
        {steps && (
          <ol className="mt-8 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Étapes">
            {steps.map((label, i) => {
              const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo'
              return (
                <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
                  <span aria-hidden="true" className={`block h-1 rounded-full ${state === 'todo' ? 'bg-line-strong' : 'bg-accent'}`} />
                  <span className={`mt-2 block truncate text-[13px] font-semibold sm:text-sm ${state === 'current' ? 'text-fg' : 'text-fg-subtle'}`}>
                    <span className="sr-only">Étape {i + 1} sur {steps.length} : </span>
                    {label}
                    {state === 'done' && <span className="sr-only"> (terminée)</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        <div className="mt-6 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-8">{children}</div>
        {footer && <div className="mt-6 flex justify-center">{footer}</div>}
      </main>
    </>
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
    <ol className="divide-y divide-line" aria-live="polite" aria-busy={current !== 'done'}>
      {order.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
        return (
          <li key={s} className="flex min-h-16 items-center gap-4 py-3 text-[17px]">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center">
              {state === 'done' ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <IconCheck size={18} strokeWidth={2.5} />
                </span>
              ) : state === 'current' ? (
                <span className="h-6 w-6 animate-spin rounded-full border-[2.5px] border-accent border-t-transparent" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              )}
            </span>
            <span className={state === 'todo' ? 'text-fg-subtle' : 'font-medium text-fg'}>
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
