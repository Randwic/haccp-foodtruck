import { useEffect, useState, type FormEvent } from 'react'
import { errorText } from '../../manager/api.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { IconClose, IconLogOut, IconMinus, IconPlus } from '../../ui/icons.tsx'
import { isValidCheckTime, MAX_CHECK_TIMES, MIN_CHECK_TIMES } from '../temperatures/schedule.ts'
import { ConfirmModal, useManagement } from './common.tsx'

const MIN_LOCK = 1
const MAX_LOCK = 30

/** Première heure ronde libre, pour « Ajouter une heure ». */
function nextFreeTime(times: string[]): string {
  for (const h of [12, 14, 10, 16, 20, 6, 22, 8, 18]) {
    const t = `${String(h).padStart(2, '0')}:00`
    if (!times.includes(t)) return t
  }
  return '12:30'
}

/** Gestion › Réglages : nom de l'établissement, heures de relevé, verrouillage automatique, déconnexion gérant. */
export function SettingsSection({ onSignedOut }: { onSignedOut: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(5)
  const [times, setTimes] = useState<string[]>([])
  const [timesError, setTimesError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  useEffect(() => {
    let alive = true
    manager.getSettings().then(
      (s) => {
        if (!alive) return
        setName(s.establishment_name)
        setMinutes(s.auto_lock_minutes)
        setTimes(s.daily_check_times)
        setLoaded(true)
      },
      (e) => alive && setLoadError(errorText(e)),
    )
    return () => {
      alive = false
    }
  }, [manager])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setNameError('Le nom de l’établissement est obligatoire.')
    if (times.length < MIN_CHECK_TIMES || times.length > MAX_CHECK_TIMES || !times.every(isValidCheckTime)) {
      return setTimesError(`Indiquez de ${MIN_CHECK_TIMES} à ${MAX_CHECK_TIMES} heures complètes (heures et minutes).`)
    }
    if (new Set(times).size !== times.length) return setTimesError('Chaque heure ne doit apparaître qu’une fois.')
    setBusy(true)
    setError(null)
    try {
      const s = await run(
        () => manager.saveSettings({ establishment_name: name.trim(), auto_lock_minutes: minutes, daily_check_times: [...times].sort() }),
        'Réglages enregistrés',
      )
      setName(s.establishment_name)
      setMinutes(s.auto_lock_minutes)
      setTimes(s.daily_check_times)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Notice>{loadError}</Notice>
  if (!loaded) return <p className="text-[17px] text-fg-muted">Chargement…</p>

  const step = (d: number) => setMinutes((m) => Math.min(MAX_LOCK, Math.max(MIN_LOCK, m + d)))
  const stepBtn = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-elevated text-fg shadow-card transition-transform active:scale-[0.96] active:bg-pressed disabled:opacity-40'

  return (
    <section aria-labelledby="settings-title" className="max-w-2xl">
      <h2 id="settings-title" className="sr-only">
        Réglages
      </h2>
      <form onSubmit={submit} noValidate className="space-y-8 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <TextField label="Nom de l’établissement" hint="Affiché en haut de l’écran et sur les registres." value={name} onChange={(v) => { setName(v); setNameError(undefined) }} error={nameError} autoCapitalize="words" />
        <div>
          <p id="check-times-label" className="mb-1.5 text-[15px] font-semibold text-fg">
            Heures des relevés de températures
          </p>
          <p className="mb-3 text-[15px] text-fg-muted">
            Frigos et congélateurs à relever chaque jour à ces heures (heure locale), de {MIN_CHECK_TIMES} à {MAX_CHECK_TIMES} fois par jour.
          </p>
          <ul role="group" aria-labelledby="check-times-label" className="flex flex-wrap gap-3">
            {times.map((t, i) => (
              <li key={i} className="flex items-center gap-1 rounded-xl border border-line-strong bg-elevated py-1 pr-1 pl-3 shadow-card">
                <input
                  type="time"
                  step={60}
                  required
                  value={t}
                  aria-label={`Heure de relevé ${i + 1}`}
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 5)
                    setTimes((list) => list.map((x, j) => (j === i ? v : x)))
                    setTimesError(undefined)
                  }}
                  className="min-h-12 w-[6.5rem] bg-transparent text-[20px] font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    setTimes((list) => list.filter((_, j) => j !== i))
                    setTimesError(undefined)
                  }}
                  disabled={times.length <= MIN_CHECK_TIMES}
                  aria-label={`Retirer l’heure ${t || i + 1}`}
                  className="flex h-12 w-12 items-center justify-center rounded-lg text-fg-muted active:bg-pressed disabled:opacity-35"
                >
                  <IconClose size={20} />
                </button>
              </li>
            ))}
            <li>
              <Button
                variant="secondary"
                onClick={() => {
                  setTimes((list) => [...list, nextFreeTime(list)])
                  setTimesError(undefined)
                }}
                disabled={times.length >= MAX_CHECK_TIMES}
                icon={<IconPlus size={20} />}
              >
                Ajouter une heure
              </Button>
            </li>
          </ul>
          {timesError && (
            <div className="mt-3">
              <Notice>{timesError}</Notice>
            </div>
          )}
        </div>
        <div>
          <p id="lock-label" className="mb-1.5 text-[15px] font-semibold text-fg">
            Verrouillage automatique
          </p>
          <p className="mb-3 text-[15px] text-fg-muted">L’app revient à l’écran des codes PIN après ce délai sans activité.</p>
          <div className="flex items-center gap-4" role="group" aria-labelledby="lock-label">
            <button type="button" className={stepBtn} onClick={() => step(-1)} disabled={minutes <= MIN_LOCK} aria-label="Diminuer d’une minute">
              <IconMinus size={22} />
            </button>
            <output aria-live="polite" className="min-w-28 text-center text-[28px] font-semibold tracking-[-0.02em] text-fg tabular-nums">
              {minutes} min
            </output>
            <button type="button" className={stepBtn} onClick={() => step(1)} disabled={minutes >= MAX_LOCK} aria-label="Augmenter d’une minute">
              <IconPlus size={22} />
            </button>
          </div>
          <p className="mt-2 text-[15px] text-fg-subtle">
            Entre {MIN_LOCK} et {MAX_LOCK} minutes.
          </p>
        </div>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer les réglages'}
        </Button>
      </form>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <h3 className="text-[17px] font-semibold text-fg">Compte gérant</h3>
        <p className="mt-1 text-[15px] text-fg-muted">Sur un appareil partagé, déconnectez-vous après vos réglages : le mot de passe sera redemandé la prochaine fois.</p>
        <Button variant="secondary" className="mt-4" onClick={() => setConfirmSignOut(true)} icon={<IconLogOut size={20} />}>
          Se déconnecter du compte gérant
        </Button>
      </div>
      <ConfirmModal
        open={confirmSignOut}
        title="Se déconnecter ?"
        confirmLabel="Se déconnecter"
        onClose={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          await manager.signOut()
          onSignedOut()
        }}
      >
        <p>Les saisies et la synchronisation de l’appareil continuent normalement. Seul l’accès à la Gestion demandera à nouveau le mot de passe.</p>
      </ConfirmModal>
    </section>
  )
}
