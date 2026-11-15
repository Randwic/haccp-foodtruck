import { useEffect, useState, type FormEvent } from 'react'
import { errorText } from '../../manager/api.ts'
import { oilSettingsError } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { formatNumber } from '../../ui/numberPad.ts'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { IconClose, IconLogOut, IconMinus, IconPlus } from '../../ui/icons.tsx'
import { isValidCheckTime, MAX_CHECK_TIMES, MIN_CHECK_TIMES } from '../temperatures/schedule.ts'
import { ConfirmModal, useManagement } from './common.tsx'

const MIN_LOCK = 1
const MAX_LOCK = 30
const MIN_DLC_DAYS = 0
const MAX_DLC_DAYS = 30
const OIL_MAX_MIN = 10
const OIL_MAX_MAX = 30
const OIL_STEP = 0.5
const round1 = (v: number) => Math.round(v * 10) / 10

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
  const [carryOver, setCarryOver] = useState(true)
  const [dlcDays, setDlcDays] = useState(3)
  const [oilMax, setOilMax] = useState(25)
  const [oilWarn, setOilWarn] = useState(22)
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
        setCarryOver(s.missed_slot_carry_over)
        setDlcDays(s.thaw_dlc_days)
        setOilMax(s.oil_polar_max)
        setOilWarn(s.oil_polar_warn)
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
    const oilError = oilSettingsError(oilMax, oilWarn)
    if (oilError) return setError(oilError)
    setBusy(true)
    setError(null)
    try {
      const s = await run(
        () => manager.saveSettings({
            establishment_name: name.trim(),
            auto_lock_minutes: minutes,
            daily_check_times: [...times].sort(),
            missed_slot_carry_over: carryOver,
            thaw_dlc_days: dlcDays,
            oil_polar_max: oilMax,
            oil_polar_warn: oilWarn,
          }),
        'Réglages enregistrés',
      )
      setName(s.establishment_name)
      setMinutes(s.auto_lock_minutes)
      setTimes(s.daily_check_times)
      setCarryOver(s.missed_slot_carry_over)
      setDlcDays(s.thaw_dlc_days)
      setOilMax(s.oil_polar_max)
      setOilWarn(s.oil_polar_warn)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Notice>{loadError}</Notice>
  if (!loaded) return <p className="text-[17px] text-fg-muted">Chargement…</p>

  const step = (d: number) => setMinutes((m) => Math.min(MAX_LOCK, Math.max(MIN_LOCK, m + d)))
  const stepDlc = (d: number) => setDlcDays((m) => Math.min(MAX_DLC_DAYS, Math.max(MIN_DLC_DAYS, m + d)))
  const stepOilMax = (d: number) => {
    const next = round1(Math.min(OIL_MAX_MAX, Math.max(OIL_MAX_MIN, oilMax + d)))
    setOilMax(next)
    if (oilWarn >= next) setOilWarn(round1(next - OIL_STEP))
  }
  const stepOilWarn = (d: number) => setOilWarn((w) => round1(Math.min(oilMax - OIL_STEP, Math.max(OIL_STEP, w + d))))
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id="carry-over-label" className="mb-1.5 text-[15px] font-semibold text-fg">
              Créneau oublié la veille reste à faire
            </p>
            <p id="carry-over-hint" className="text-[15px] text-fg-muted">
              {carryOver
                ? 'Activé : si le dernier relevé de la veille manque, il est demandé dès l’ouverture, avant le premier créneau du jour.'
                : 'Désactivé : rien n’est « à faire » avant le premier créneau du jour.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={carryOver}
            aria-labelledby="carry-over-label"
            aria-describedby="carry-over-hint"
            onClick={() => setCarryOver((v) => !v)}
            className={`relative mt-1 h-10 w-[4.25rem] shrink-0 rounded-full border transition-colors ${carryOver ? 'border-accent bg-accent' : 'border-line-strong bg-sunken'}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-1 left-1 h-[1.875rem] w-[1.875rem] rounded-full shadow-card transition-transform ${carryOver ? 'translate-x-7 bg-on-accent' : 'bg-fg-subtle'}`}
            />
          </button>
        </div>
        <div>
          <p id="dlc-label" className="mb-1.5 text-[15px] font-semibold text-fg">
            DLC après décongélation (jours)
          </p>
          <p className="mb-3 text-[15px] text-fg-muted">DLC proposée à la fin d’une décongélation : date de fin + ce nombre de jours (modifiable à chaque saisie). À fixer selon votre PMS.</p>
          <div className="flex items-center gap-4" role="group" aria-labelledby="dlc-label">
            <button type="button" className={stepBtn} onClick={() => stepDlc(-1)} disabled={dlcDays <= MIN_DLC_DAYS} aria-label="Diminuer d’un jour">
              <IconMinus size={22} />
            </button>
            <output aria-live="polite" className="min-w-28 text-center text-[28px] font-semibold tracking-[-0.02em] text-fg tabular-nums">
              J+{dlcDays}
            </output>
            <button type="button" className={stepBtn} onClick={() => stepDlc(1)} disabled={dlcDays >= MAX_DLC_DAYS} aria-label="Augmenter d’un jour">
              <IconPlus size={22} />
            </button>
          </div>
          <p className="mt-2 text-[15px] text-fg-subtle">
            Entre {MIN_DLC_DAYS} et {MAX_DLC_DAYS} jours.
          </p>
        </div>
        <div>
          <p id="oil-label" className="mb-1.5 text-[15px] font-semibold text-fg">
            Huiles de friture : composés polaires
          </p>
          <p className="mb-3 text-[15px] text-fg-muted">
            Limite réglementaire : 25 % (décret n° 2008-184). Au-delà de la limite, le contrôle est hors limite et une action corrective est exigée ; à partir du seuil d’alerte, il est signalé « à surveiller ».
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div role="group" aria-labelledby="oil-max-label">
              <p id="oil-max-label" className="mb-2 text-[15px] text-fg">
                Limite
              </p>
              <div className="flex items-center gap-3">
                <button type="button" className={stepBtn} onClick={() => stepOilMax(-OIL_STEP)} disabled={oilMax <= OIL_MAX_MIN} aria-label="Diminuer la limite">
                  <IconMinus size={22} />
                </button>
                <output aria-live="polite" aria-label={`Limite : ${formatNumber(oilMax)} %`} className="min-w-24 text-center text-[28px] font-semibold tracking-[-0.02em] text-fg tabular-nums">
                  {formatNumber(oilMax)} %
                </output>
                <button type="button" className={stepBtn} onClick={() => stepOilMax(OIL_STEP)} disabled={oilMax >= OIL_MAX_MAX} aria-label="Augmenter la limite">
                  <IconPlus size={22} />
                </button>
              </div>
              <p className="mt-2 text-[14px] text-fg-subtle">
                Entre {OIL_MAX_MIN} et {OIL_MAX_MAX} %.
              </p>
            </div>
            <div role="group" aria-labelledby="oil-warn-label">
              <p id="oil-warn-label" className="mb-2 text-[15px] text-fg">
                Seuil d’alerte
              </p>
              <div className="flex items-center gap-3">
                <button type="button" className={stepBtn} onClick={() => stepOilWarn(-OIL_STEP)} disabled={oilWarn <= OIL_STEP} aria-label="Diminuer le seuil d’alerte">
                  <IconMinus size={22} />
                </button>
                <output aria-live="polite" aria-label={`Seuil d’alerte : ${formatNumber(oilWarn)} %`} className="min-w-24 text-center text-[28px] font-semibold tracking-[-0.02em] text-fg tabular-nums">
                  {formatNumber(oilWarn)} %
                </output>
                <button type="button" className={stepBtn} onClick={() => stepOilWarn(OIL_STEP)} disabled={oilWarn >= oilMax - OIL_STEP} aria-label="Augmenter le seuil d’alerte">
                  <IconPlus size={22} />
                </button>
              </div>
              <p className="mt-2 text-[14px] text-fg-subtle">Inférieur à la limite.</p>
            </div>
          </div>
          {oilMax > 25 && (
            <div className="mt-3">
              <Notice tone="warn">Une limite au-delà de 25 % dépasse la limite réglementaire.</Notice>
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
