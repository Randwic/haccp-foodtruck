import { useCallback, useEffect, useRef, useState } from 'react'
import type { StaffMember } from '../../../../shared/types.ts'
import { Button, PinPad, haptic } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { BrandLogo, BrandStripe } from '../../ui/brand.tsx'
import { formatDuration, formatLongDate, formatTime, initials } from '../../ui/format.ts'
import { IconError, IconWarn } from '../../ui/icons.tsx'

type Feedback = { kind: 'wrong' } | { kind: 'locked'; until: number | null } | { kind: 'error'; message: string } | null

/** Écran de verrouillage : choix de l'équipier puis PIN sur pavé numérique géant. */
export function LockScreen({ establishmentName, timeZone }: { establishmentName?: string; timeZone?: string }) {
  const core = useCore()
  const now = useNow(1000)
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [retrying, setRetrying] = useState(false)
  const alive = useRef(true)

  const loadStaff = useCallback(async () => {
    try {
      const list = await core.listStaff()
      if (!alive.current) return
      setLoadError(null)
      setStaff(list)
      if (list.length === 1) setSelectedId(list[0].id)
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [core])

  useEffect(() => {
    alive.current = true
    loadStaff()
    return () => {
      alive.current = false
    }
  }, [loadStaff])

  // Enrôlement hors-ligne : l'équipe arrive avec la première synchro réussie.
  const staffEmpty = staff !== null && staff.length === 0
  useEffect(() => {
    if (!staffEmpty) return
    return core.onSyncStatusChange(() => {
      loadStaff()
    })
  }, [core, staffEmpty, loadStaff])

  const retry = async () => {
    setRetrying(true)
    try {
      await core.syncNow()
    } catch {
      /* l'indicateur de synchro affiche l'erreur ; on recharge quand même */
    }
    await loadStaff()
    if (alive.current) setRetrying(false)
  }

  const remaining = feedback?.kind === 'locked' && feedback.until !== null ? Math.ceil((feedback.until - now.getTime()) / 1000) : null
  const lockedOut = feedback?.kind === 'locked' && (feedback.until === null || (remaining ?? 0) > 0)

  // Fin du blocage : on efface le message.
  useEffect(() => {
    if (feedback?.kind === 'locked' && remaining !== null && remaining <= 0) setFeedback(null)
  }, [feedback, remaining])

  const selected = staff?.find((s) => s.id === selectedId) ?? null

  const choose = (id: string) => {
    haptic()
    setSelectedId(id)
    setPin('')
    setFeedback(null)
  }

  const submit = async (value: string) => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await core.unlock(selected.id, value)
      if (res.ok) return // le changement de session fait basculer l'écran
      setPin('')
      haptic([60, 40, 60])
      if (res.reason === 'locked_out') {
        setFeedback({ kind: 'locked', until: res.retry_after_seconds ? Date.now() + res.retry_after_seconds * 1000 : null })
      } else setFeedback({ kind: 'wrong' })
    } catch (e) {
      setPin('')
      setFeedback({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  let message: string | null = null
  if (feedback?.kind === 'wrong') message = 'PIN incorrect'
  else if (feedback?.kind === 'locked')
    message = remaining !== null ? `Bloqué, réessayez dans ${formatDuration(remaining)}` : 'Bloqué temporairement, réessayez plus tard'
  else if (feedback?.kind === 'error') message = `Erreur : ${feedback.message}`

  const FeedbackIcon = feedback?.kind === 'locked' ? IconWarn : IconError

  return (
    <>
      <BrandStripe />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-6 pb-8 sm:px-6 sm:pt-10 lg:flex-row lg:items-center lg:gap-16">
        <section className="min-w-0 lg:flex-1" aria-labelledby="who-title">
          <div className="flex items-center gap-4">
            <BrandLogo size={72} glow className="shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold text-fg">{establishmentName ?? 'HACCP'}</p>
              <p className="text-[15px] text-fg-muted first-letter:uppercase">
                {formatLongDate(now, timeZone)} · <span className="font-medium tabular-nums text-fg">{formatTime(now, timeZone)}</span>
              </p>
            </div>
          </div>
          <h1 id="who-title" className="mt-8 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[34px]">
            Qui êtes-vous ?
          </h1>
          {loadError && (
            <p role="alert" className="mt-4 flex items-center gap-2 text-[15px] font-medium text-danger">
              <IconError size={18} className="shrink-0" />
              Impossible de charger l’équipe : {loadError}
            </p>
          )}
          {staffEmpty && (
            <div role="status" className="mt-5 rounded-2xl border border-warn/35 bg-warn-soft p-5">
              <p className="flex items-start gap-2.5 text-[17px] font-semibold text-fg">
                <IconWarn size={22} className="mt-0.5 shrink-0 text-warn" />
                Aucun équipier pour l’instant – connectez l’appareil à Internet pour récupérer l’équipe.
              </p>
              <Button className="mt-4" onClick={retry} disabled={retrying}>
                {retrying ? 'Synchronisation…' : 'Réessayer'}
              </Button>
            </div>
          )}
          <div role="radiogroup" aria-label="Équipier" className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
            {staff?.map((s) => {
              const active = s.id === selectedId
              const role = s.role === 'manager' ? 'Gérant' : 'Équipier'
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => choose(s.id)}
                  className={`flex min-h-20 min-w-0 items-center gap-3 rounded-2xl border p-3 text-left shadow-card transition-[background-color,border-color,transform] duration-100 active:scale-[0.99] sm:min-h-24 sm:gap-4 sm:p-4 ${
                    active ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface active:bg-pressed'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold sm:h-14 sm:w-14 sm:text-lg ${
                      active ? 'bg-accent text-on-accent' : 'border border-line bg-sunken text-fg-muted'
                    }`}
                  >
                    {initials(s.display_name)}
                  </span>
                  <span className="min-w-0 break-words text-[17px] leading-snug font-semibold text-fg sm:text-lg">
                    {s.display_name}
                    {s.display_name !== role && <span className="block text-[14px] font-normal text-fg-muted">{role}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {!staffEmpty && (
          <section className="w-full rounded-3xl border border-line bg-surface px-5 pt-6 pb-5 shadow-card lg:w-[26rem]" aria-labelledby="pin-title">
            <h2 id="pin-title" className="mb-1 text-center text-xl font-semibold tracking-[-0.01em] text-fg">
              {selected ? `Code PIN – ${selected.display_name}` : 'Choisissez votre nom'}
            </h2>
            <div role="alert" aria-live="assertive" className="mb-2 flex min-h-11 items-center justify-center text-center">
              {message && (
                <p
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[15px] font-semibold ${
                    feedback?.kind === 'locked' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'
                  }`}
                >
                  <FeedbackIcon size={18} className="shrink-0" />
                  <span className="tabular-nums">{message}</span>
                </p>
              )}
            </div>
            <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={!selected || busy || lockedOut} label={selected ? `Code PIN – ${selected.display_name}` : 'Code PIN'} />
            {selected && staff && staff.length > 1 && (
              <div className="mt-3 text-center lg:hidden">
                <Button variant="ghost" onClick={() => setSelectedId(null)} className="text-accent">
                  Changer d’équipier
                </Button>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  )
}
