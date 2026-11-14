import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { errorText, isManagerError, type ManagerApi } from '../../manager/api.ts'
import { lastManagerEmail, rememberManagerEmail } from '../../manager/helpers.ts'
import { ManagerProvider, useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { IconChevronLeft, IconFridge, IconOffline, IconSettings, IconSupplier, IconUsers, type IconProps } from '../../ui/icons.tsx'
import { PasswordField } from '../setup/PasswordField.tsx'
import { ManagementContext, type ManagementTools, type RunWrite } from './common.tsx'
import { EquipmentSection } from './EquipmentSection.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { StaffSection } from './StaffSection.tsx'
import { SupplierSection } from './SupplierSection.tsx'

type Tab = 'equipment' | 'staff' | 'suppliers' | 'settings'
const TABS: { id: Tab; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: 'equipment', label: 'Équipements', Icon: IconFridge },
  { id: 'staff', label: 'Équipe', Icon: IconUsers },
  { id: 'suppliers', label: 'Fournisseurs', Icon: IconSupplier },
  { id: 'settings', label: 'Réglages', Icon: IconSettings },
]

type Auth = { kind: 'checking' } | { kind: 'needed'; notice?: string } | { kind: 'ok' }

/** Espace Gestion (gérant uniquement) : exige Internet et une session gérant valide. */
export function ManagementScreen({ onBack, meId }: { onBack: () => void; meId: string | null }) {
  const manager = useManager()
  const core = useCore()
  const toast = useToast()
  const online = useOnline()
  const [auth, setAuth] = useState<Auth>({ kind: 'checking' })
  const [tab, setTab] = useState<Tab>('equipment')

  useEffect(() => {
    let alive = true
    manager.sessionEmail().then(
      (email) => alive && setAuth(email === null ? { kind: 'needed' } : { kind: 'ok' }),
      () => alive && setAuth({ kind: 'needed' }),
    )
    return () => {
      alive = false
    }
  }, [manager])

  // Toute réponse « session expirée » (lecture ou écriture) renvoie vers la saisie du mot de passe.
  const guarded = useMemo<ManagerApi>(
    () =>
      new Proxy(manager, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver) as unknown
          if (typeof v !== 'function') return v
          return (...args: unknown[]) => {
            const out = (v as (...a: unknown[]) => unknown).apply(target, args)
            if (out instanceof Promise) {
              return out.catch((e: unknown) => {
                if (isManagerError(e, 'unauthorized')) setAuth({ kind: 'needed', notice: e.message })
                throw e
              })
            }
            return out
          }
        },
      }),
    [manager],
  )

  const run = useCallback<RunWrite>(
    async (fn, success) => {
      const r = await fn()
      if (success) toast(success, 'ok')
      // La base locale de l'appareil se met à jour par sync-pull.
      core.syncNow().catch(() => {})
      return r
    },
    [core, toast],
  )
  const tools = useMemo<ManagementTools>(() => ({ run, meId }), [run, meId])

  let body
  if (!online) {
    body = (
      <div role="alert" className="flex items-start gap-4 rounded-2xl border border-warn/35 bg-warn-soft p-5 sm:p-6">
        <IconOffline size={24} className="mt-0.5 shrink-0 text-warn" />
        <div>
        <p className="text-xl font-semibold text-fg">La gestion nécessite une connexion Internet.</p>
        <p className="mt-1.5 text-[17px] text-fg-muted">Les modifications sont faites directement sur le serveur. Les relevés, eux, continuent de fonctionner hors-ligne.</p>
        </div>
      </div>
    )
  } else if (auth.kind === 'checking') {
    body = <p className="text-[17px] text-fg-muted">Vérification de la session…</p>
  } else if (auth.kind === 'needed') {
    body = <ManagerReauth notice={auth.notice} onDone={() => setAuth({ kind: 'ok' })} />
  } else {
    body = (
      <>
        <div role="tablist" aria-label="Rubriques de gestion" className="mb-8 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 sm:max-w-2xl sm:grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg px-1 text-[15px] font-semibold transition-colors sm:px-2 ${
                tab === t.id ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'
              }`}
            >
              <t.Icon className={`hidden sm:inline ${tab === t.id ? 'text-accent' : ''}`} size={18} />
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'equipment' && <EquipmentSection />}
          {tab === 'staff' && <StaffSection />}
          {tab === 'suppliers' && <SupplierSection />}
          {tab === 'settings' && <SettingsSection onSignedOut={() => setAuth({ kind: 'needed' })} />}
        </div>
      </>
    )
  }

  return (
    <ManagerProvider manager={guarded}>
      <ManagementContext.Provider value={tools}>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
          <Button variant="ghost" onClick={onBack} icon={<IconChevronLeft size={22} />} className="-ml-3 px-3 text-accent">
            Accueil
          </Button>
          <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Gestion</h1>
            {manager.mode === 'mock' && (
              <span title="Aucun serveur configuré : données simulées">
                <Badge tone="warn">Serveur simulé</Badge>
              </span>
            )}
          </div>
          {body}
        </main>
      </ManagementContext.Provider>
    </ManagerProvider>
  )
}

/** Session gérant absente ou expirée : redemande le mot de passe. */
function ManagerReauth({ notice, onDone }: { notice?: string; onDone: () => void }) {
  const manager = useManager()
  const [email, setEmail] = useState(lastManagerEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return setError('Indiquez votre email et votre mot de passe gérant.')
    setBusy(true)
    setError(null)
    try {
      await manager.signIn(email.trim(), password)
      rememberManagerEmail(email)
      onDone()
    } catch (err) {
      setPassword('')
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-6">
      <h2 className="text-xl font-semibold text-fg">Mot de passe gérant</h2>
      <p className="text-[17px] text-fg-muted">Par sécurité, la gestion demande le mot de passe de votre compte gérant.</p>
      {notice && <Notice tone="info">{notice}</Notice>}
      <TextField label="Email" type="email" inputMode="email" autoComplete="username" value={email} onChange={setEmail} />
      <PasswordField label="Mot de passe" autoComplete="current-password" value={password} onChange={setPassword} autoFocus />
      {error && <Notice>{error}</Notice>}
      <Button type="submit" size="lg" block disabled={busy}>
        {busy ? 'Connexion…' : 'Continuer'}
      </Button>
    </form>
  )
}
