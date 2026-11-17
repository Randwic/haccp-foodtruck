// Session gérant (email + mot de passe) pour les espaces qui écrivent sur le serveur : Gestion, Documents & PMS.
// Vérifie la session au montage ; toute réponse « session expirée » renvoie vers la saisie du mot de passe.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { errorText, isManagerError, type ManagerApi } from '../../manager/api.ts'
import { lastManagerEmail, rememberManagerEmail } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { PasswordField } from '../setup/PasswordField.tsx'

export type ManagerAuth = { kind: 'checking' } | { kind: 'needed'; notice?: string } | { kind: 'ok' }

export function useManagerSession(): { auth: ManagerAuth; setAuth: (a: ManagerAuth) => void; guarded: ManagerApi } {
  const manager = useManager()
  const [auth, setAuth] = useState<ManagerAuth>({ kind: 'checking' })

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
  return { auth, setAuth, guarded }
}

/** Session gérant absente ou expirée : redemande le mot de passe. */
export function ManagerReauth({ notice, onDone, intro = 'Par sécurité, la gestion demande le mot de passe de votre compte gérant.' }: { notice?: string; onDone: () => void; intro?: string }) {
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
      <p className="text-[17px] text-fg-muted">{intro}</p>
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
