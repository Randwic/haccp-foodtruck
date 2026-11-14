import { useState, type FormEvent } from 'react'
import { errorText } from '../../manager/api.ts'
import { rememberManagerEmail } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { enrollThisDevice } from './enrollThisDevice.ts'
import { PasswordField } from './PasswordField.tsx'
import { SetupLayout, SetupProgress, type ProgressStep } from './SetupLayout.tsx'

export interface ManagerLoginScreenProps {
  defaultDeviceName: string
  establishmentName?: string
  initialEmail?: string
  /** Message affiché en tête (ex. « Un compte gérant existe déjà »). */
  notice?: string
  onEnrolled: () => void
  onAdvanced?: () => void
}

/** Appareil supplémentaire (ou compte déjà créé) : connexion du gérant puis enrôlement automatique. */
export function ManagerLoginScreen({ defaultDeviceName, establishmentName, initialEmail = '', notice, onEnrolled, onAdvanced }: ManagerLoginScreenProps) {
  const manager = useManager()
  const core = useCore()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [device, setDevice] = useState(defaultDeviceName)
  const [errors, setErrors] = useState<{ email?: string; password?: string; device?: string }>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressStep | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!email.trim()) errs.email = 'Indiquez l’email du compte gérant.'
    if (!password) errs.password = 'Indiquez le mot de passe.'
    if (!device.trim()) errs.device = 'Donnez un nom à cet appareil.'
    setErrors(errs)
    setSubmitError(null)
    if (Object.keys(errs).length > 0) return
    setProgress('signin')
    try {
      await manager.signIn(email.trim(), password)
      rememberManagerEmail(email)
      await enrollThisDevice(manager, core, device, (p) => setProgress(p))
      setProgress('done')
      onEnrolled()
    } catch (err) {
      setProgress(null)
      setPassword('')
      setSubmitError(errorText(err))
    }
  }

  if (progress) {
    return (
      <SetupLayout title="Configuration de cet appareil">
        <SetupProgress current={progress} />
      </SetupLayout>
    )
  }

  return (
    <SetupLayout
      title="Connexion gérant"
      intro={
        <>
          {establishmentName ? (
            <>
              Cet appareil va être ajouté à <strong>{establishmentName}</strong>.{' '}
            </>
          ) : null}
          Connectez-vous avec le compte gérant : l’appareil sera enregistré automatiquement.
        </>
      }
      footer={
        onAdvanced && (
          <Button variant="ghost" onClick={onAdvanced}>
            Configuration avancée
          </Button>
        )
      }
    >
      <form onSubmit={submit} noValidate className="space-y-6">
        {notice && <Notice tone="info">{notice}</Notice>}
        <TextField label="Email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(x) => { setEmail(x); setErrors((p) => ({ ...p, email: undefined })) }} error={errors.email} />
        <PasswordField label="Mot de passe" autoComplete="current-password" value={password} onChange={(x) => { setPassword(x); setErrors((p) => ({ ...p, password: undefined })) }} error={errors.password} />
        <TextField label="Nom de cet appareil" hint="Modifiable : ex. « iPad cuisine »." value={device} onChange={(x) => { setDevice(x); setErrors((p) => ({ ...p, device: undefined })) }} error={errors.device} autoCapitalize="words" />
        {submitError && <Notice>{submitError}</Notice>}
        <Button type="submit" size="lg" block>
          Se connecter et enregistrer l’appareil
        </Button>
      </form>
    </SetupLayout>
  )
}
