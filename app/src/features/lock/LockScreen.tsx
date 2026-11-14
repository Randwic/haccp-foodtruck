import { useEffect, useState } from 'react'
import type { StaffMember } from '../../../../shared/types.ts'
import { Button, PinPad, haptic } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { formatDuration, formatLongDate, formatTime, initials } from '../../ui/format.ts'

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

  useEffect(() => {
    let alive = true
    core
      .listStaff()
      .then((list) => {
        if (!alive) return
        setStaff(list)
        if (list.length === 1) setSelectedId(list[0].id)
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [core])

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

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-6 lg:flex-row lg:items-center lg:gap-12">
      <section className="lg:flex-1" aria-labelledby="who-title">
        <p className="text-lg text-slate-300">
          {establishmentName ?? 'HACCP'} · {formatLongDate(now, timeZone)} · <span className="tabular-nums">{formatTime(now, timeZone)}</span>
        </p>
        <h1 id="who-title" className="mt-1 text-3xl font-bold text-white sm:text-4xl">
          Qui êtes-vous ?
        </h1>
        {loadError && (
          <p role="alert" className="mt-4 text-lg font-semibold text-red-300">
            Impossible de charger l’équipe : {loadError}
          </p>
        )}
        {staff && staff.length === 0 && <p className="mt-4 text-lg text-amber-300">Aucun équipier actif. Le gérant doit en créer un.</p>}
        <div role="radiogroup" aria-label="Équipier" className="mt-5 grid grid-cols-2 gap-4">
          {staff?.map((s) => {
            const active = s.id === selectedId
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(s.id)}
                className={`flex min-h-28 items-center gap-4 rounded-3xl p-4 text-left transition-colors sm:min-h-36 sm:flex-col sm:items-start sm:justify-between ${
                  active ? 'bg-sky-300 text-slate-950 ring-4 ring-sky-100' : 'bg-slate-800 text-white ring-1 ring-slate-600 active:bg-slate-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-black ${active ? 'bg-slate-950 text-sky-200' : 'bg-slate-600 text-white'}`}
                >
                  {initials(s.display_name)}
                </span>
                <span className="text-xl font-bold leading-tight sm:text-2xl">
                  {s.display_name}
                  <span className={`block text-base font-medium ${active ? 'text-slate-800' : 'text-slate-300'}`}>{s.role === 'manager' ? 'Gérant' : 'Équipier'}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="w-full lg:w-[26rem]" aria-labelledby="pin-title">
        <h2 id="pin-title" className="mb-3 text-center text-2xl font-bold text-white">
          {selected ? `PIN de ${selected.display_name}` : 'Choisissez votre nom'}
        </h2>
        <div role="alert" aria-live="assertive" className="mb-3 min-h-14 text-center">
          {message && (
            <p className={`inline-block rounded-2xl px-5 py-3 text-xl font-bold ${feedback?.kind === 'wrong' ? 'bg-red-700 text-white' : 'bg-amber-400 text-slate-950'}`}>
              <span className="tabular-nums">{message}</span>
            </p>
          )}
        </div>
        <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={!selected || busy || lockedOut} label={selected ? `PIN de ${selected.display_name}` : 'Code PIN'} />
        {selected && staff && staff.length > 1 && (
          <div className="mt-4 text-center lg:hidden">
            <Button variant="ghost" onClick={() => setSelectedId(null)}>
              Changer d’équipier
            </Button>
          </div>
        )}
      </section>
    </main>
  )
}
