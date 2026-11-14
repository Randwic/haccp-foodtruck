import { useEffect, useState, type FormEvent } from 'react'
import { errorText } from '../../manager/api.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { IconLogOut, IconMinus, IconPlus } from '../../ui/icons.tsx'
import { ConfirmModal, useManagement } from './common.tsx'

const MIN_LOCK = 1
const MAX_LOCK = 30

/** Gestion › Réglages : nom de l'établissement, délai de verrouillage automatique, déconnexion gérant. */
export function SettingsSection({ onSignedOut }: { onSignedOut: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(5)
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
    setBusy(true)
    setError(null)
    try {
      const s = await run(() => manager.saveSettings({ establishment_name: name.trim(), auto_lock_minutes: minutes }), 'Réglages enregistrés')
      setName(s.establishment_name)
      setMinutes(s.auto_lock_minutes)
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
