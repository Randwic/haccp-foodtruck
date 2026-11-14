import { useState, type FormEvent } from 'react'
import { hashPin } from '../../core/index.ts'
import { errorText, isManagerError } from '../../manager/api.ts'
import { rememberManagerEmail } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice, PinSetup, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconChevronLeft } from '../../ui/icons.tsx'
import { enrollThisDevice } from './enrollThisDevice.ts'
import { PasswordField } from './PasswordField.tsx'
import { SetupLayout, SetupProgress, type ProgressStep } from './SetupLayout.tsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Step = 'identity' | 'account' | 'pin' | 'device'
const STEPS: { id: Step; label: string }[] = [
  { id: 'identity', label: 'Vous' },
  { id: 'account', label: 'Compte' },
  { id: 'pin', label: 'Code PIN' },
  { id: 'device', label: 'Appareil' },
]

export interface BootstrapScreenProps {
  defaultDeviceName: string
  /** Un compte gérant existe déjà (409) : passer à la connexion avec ce message. */
  onAlreadyBootstrapped: (message: string, email: string) => void
  /** Compte créé mais connexion/enrôlement à terminer depuis l'écran de connexion. */
  onContinueWithLogin: (message: string, email: string) => void
  onEnrolled: () => void
}

/** Premier lancement : création du compte gérant unique, puis enrôlement automatique de l'appareil. */
export function BootstrapScreen({ defaultDeviceName, onAlreadyBootstrapped, onContinueWithLogin, onEnrolled }: BootstrapScreenProps) {
  const manager = useManager()
  const core = useCore()
  const [step, setStep] = useState<Step>('identity')
  const [v, setV] = useState({ establishment: '', name: '', email: '', password: '', password2: '', device: defaultDeviceName })
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({})
  const [pinHash, setPinHash] = useState<{ pin_salt: string; pin_hash: string } | null>(null)
  const [hashing, setHashing] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressStep | null>(null)

  const set = (k: keyof typeof v) => (value: string) => {
    setV((p) => ({ ...p, [k]: value }))
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }))
  }

  const nextFromIdentity = (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!v.establishment.trim()) errs.establishment = 'Indiquez le nom de votre food truck.'
    if (!v.name.trim()) errs.name = 'Indiquez votre prénom et votre nom.'
    setErrors(errs)
    if (Object.keys(errs).length === 0) setStep('account')
  }

  const nextFromAccount = (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!EMAIL_RE.test(v.email.trim())) errs.email = 'Adresse email invalide (ex. prenom@exemple.fr).'
    if (v.password.length < 12) errs.password = `Au moins 12 caractères (actuellement ${v.password.length}).`
    else if (new TextEncoder().encode(v.password).length > 72) errs.password = 'Mot de passe trop long (72 octets au maximum, les lettres accentuées comptent double).'
    if (!errs.password && v.password2 !== v.password) errs.password2 = 'Les deux mots de passe ne correspondent pas.'
    setErrors(errs)
    if (Object.keys(errs).length === 0) setStep('pin')
  }

  const onPin = async (pin: string) => {
    setHashing(true)
    try {
      setPinHash(await hashPin(pin))
      setStep('device')
    } finally {
      setHashing(false)
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!v.device.trim()) {
      setErrors({ device: 'Donnez un nom à cet appareil.' })
      return
    }
    if (!pinHash) return setStep('pin')
    setSubmitError(null)
    const email = v.email.trim().toLowerCase()
    setProgress('account')
    try {
      await manager.bootstrap({
        email,
        password: v.password,
        display_name: v.name.trim(),
        establishment_name: v.establishment.trim(),
        ...pinHash,
      })
    } catch (err) {
      setProgress(null)
      if (isManagerError(err, 'already_bootstrapped')) return onAlreadyBootstrapped(err.message, email)
      return setSubmitError(errorText(err))
    }
    try {
      setProgress('signin')
      await manager.signIn(email, v.password)
      rememberManagerEmail(email)
      await enrollThisDevice(manager, core, v.device, (p) => setProgress(p))
      setProgress('done')
      onEnrolled()
    } catch (err) {
      setProgress(null)
      onContinueWithLogin(`Votre compte est créé. Connectez-vous pour terminer la configuration de cet appareil. (${errorText(err)})`, email)
    }
  }

  if (progress) {
    return (
      <SetupLayout title="Création de votre compte">
        <SetupProgress current={progress} withAccount />
      </SetupLayout>
    )
  }

  const index = STEPS.findIndex((s) => s.id === step)
  const back = index > 0 ? () => setStep(STEPS[index - 1].id) : undefined

  return (
    <SetupLayout
      title="Créer votre compte gérant"
      intro="Bienvenue ! Quatre étapes rapides pour préparer l’application. Une connexion Internet est nécessaire."
      steps={STEPS.map((s) => s.label)}
      stepIndex={index}
    >
      {step === 'identity' && (
        <form onSubmit={nextFromIdentity} noValidate className="space-y-6">
          <TextField label="Nom de l’établissement" hint="Tel qu’il apparaîtra sur les registres et les étiquettes." value={v.establishment} onChange={set('establishment')} error={errors.establishment} autoCapitalize="words" autoComplete="organization" />
          <TextField label="Votre prénom et nom" hint="Vous serez le gérant : vous seul pourrez modifier l’équipe et les équipements." value={v.name} onChange={set('name')} error={errors.name} autoCapitalize="words" autoComplete="name" />
          <Button type="submit" size="lg" block>
            Continuer
          </Button>
        </form>
      )}

      {step === 'account' && (
        <form onSubmit={nextFromAccount} noValidate className="space-y-6">
          <TextField label="Email" type="email" inputMode="email" autoComplete="username" value={v.email} onChange={set('email')} error={errors.email} />
          <PasswordField label="Mot de passe" hint="12 caractères minimum. Une phrase de plusieurs mots est idéale." autoComplete="new-password" value={v.password} onChange={set('password')} error={errors.password} showStrength />
          <PasswordField label="Confirmez le mot de passe" autoComplete="new-password" value={v.password2} onChange={set('password2')} error={errors.password2} />
          <StepButtons onBack={back} />
        </form>
      )}

      {step === 'pin' && (
        <div className="space-y-6">
          <PinSetup minLength={6} maxLength={6} onComplete={onPin} disabled={hashing} />
          {hashing && <p className="text-center text-[17px] text-fg-muted">Préparation du code…</p>}
          <div className="text-center">
            <Button variant="ghost" onClick={back} icon={<IconChevronLeft size={20} />} className="text-accent">
              Retour
            </Button>
          </div>
        </div>
      )}

      {step === 'device' && (
        <form onSubmit={create} noValidate className="space-y-6">
          <TextField label="Nom de cet appareil" hint="Pour le reconnaître dans la liste des appareils (ex. « iPad cuisine »)." value={v.device} onChange={set('device')} error={errors.device} autoCapitalize="words" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-line bg-sunken p-4 text-[15px] sm:grid-cols-[auto_1fr] sm:gap-y-2">
            <dt className="text-fg-subtle">Établissement</dt>
            <dd className="mb-2 font-medium text-fg sm:mb-0">{v.establishment.trim()}</dd>
            <dt className="text-fg-subtle">Gérant</dt>
            <dd className="mb-2 font-medium text-fg sm:mb-0">{v.name.trim()}</dd>
            <dt className="text-fg-subtle">Email</dt>
            <dd className="break-all font-medium text-fg">{v.email.trim().toLowerCase()}</dd>
          </dl>
          <Notice tone="warn">
            Ce compte sera le <strong>seul compte gérant</strong>. Une fois créé, l’inscription est <strong>fermée définitivement</strong> :
            personne d’autre ne pourra créer de compte. Notez bien votre email et votre mot de passe.
          </Notice>
          {submitError && <Notice>{submitError}</Notice>}
          <StepButtons onBack={back} submitLabel="Créer mon compte" />
        </form>
      )}
    </SetupLayout>
  )
}

function StepButtons({ onBack, submitLabel = 'Continuer' }: { onBack?: () => void; submitLabel?: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {onBack && (
        <Button variant="secondary" size="lg" onClick={onBack} className="sm:w-40" icon={<IconChevronLeft size={20} />}>
          Retour
        </Button>
      )}
      <Button type="submit" size="lg" className="flex-1">
        {submitLabel}
      </Button>
    </div>
  )
}
