import { useState, type FormEvent } from 'react'
import type { Supplier } from '../../../../shared/payloads.ts'
import { errorText, isManagerError } from '../../manager/api.ts'
import { lastManagerEmail, normalizeSupplierInput, rememberManagerEmail } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { PasswordField } from '../setup/PasswordField.tsx'

type Errors = Partial<Record<'name' | 'phone' | 'email', string>>

/** Champs d'un fournisseur (création et modification, Gestion et Réception). */
export function SupplierFields(props: {
  name: string
  phone: string
  email: string
  set: (patch: Partial<{ name: string; phone: string; email: string }>) => void
  errors: Errors
  autoFocus?: boolean
}) {
  return (
    <div className="space-y-5">
      <TextField label="Nom du fournisseur" value={props.name} onChange={(name) => props.set({ name })} error={props.errors.name} maxLength={80} autoCapitalize="words" autoFocus={props.autoFocus} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Téléphone (facultatif)" type="tel" inputMode="tel" value={props.phone} onChange={(phone) => props.set({ phone })} error={props.errors.phone} maxLength={30} />
        <TextField label="Email (facultatif)" type="email" inputMode="email" value={props.email} onChange={(email) => props.set({ email })} error={props.errors.email} maxLength={254} />
      </div>
    </div>
  )
}

/**
 * Création d'un fournisseur pendant une réception (gérant uniquement). Écrit directement sur le
 * serveur (Internet nécessaire) ; si la session gérant a expiré, le mot de passe est redemandé ici.
 */
export function NewSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Supplier) => void }) {
  const manager = useManager()
  const core = useCore()
  const online = useOnline()
  const [f, setF] = useState({ name: '', phone: '', email: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [needAuth, setNeedAuth] = useState(false)
  const [email, setEmail] = useState(lastManagerEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = normalizeSupplierInput({ name: f.name, phone: f.phone, email: f.email })
    if (!n.ok) return setErrors({ [n.field]: n.message })
    setErrors({})
    setBusy(true)
    setError(null)
    try {
      if (needAuth || (await manager.sessionEmail()) === null) {
        if (!needAuth) {
          setNeedAuth(true)
          setBusy(false)
          return
        }
        await manager.signIn(email.trim(), password)
        rememberManagerEmail(email)
        setNeedAuth(false)
      }
      const s = await manager.addSupplier({ name: n.value.name!, phone: n.value.phone ?? null, email: n.value.email ?? null })
      core.syncNow().catch(() => {})
      onCreated(s)
    } catch (err) {
      if (isManagerError(err, 'unauthorized')) setNeedAuth(true)
      setPassword('')
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title="Nouveau fournisseur" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        {!online && <Notice tone="warn">L’ajout d’un fournisseur nécessite une connexion Internet.</Notice>}
        <SupplierFields name={f.name} phone={f.phone} email={f.email} set={(p) => setF({ ...f, ...p })} errors={errors} autoFocus />
        {needAuth && (
          <div className="space-y-4 rounded-2xl border border-line bg-sunken p-4">
            <p className="text-[15px] text-fg">Confirmez avec votre compte gérant.</p>
            <TextField label="Email gérant" type="email" inputMode="email" autoComplete="username" value={email} onChange={setEmail} />
            <PasswordField label="Mot de passe" autoComplete="current-password" value={password} onChange={setPassword} />
          </div>
        )}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy || !online}>
            {busy ? 'Enregistrement…' : 'Ajouter le fournisseur'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
