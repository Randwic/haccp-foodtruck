import { useState, type FormEvent } from 'react'
import { Button, Notice, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Field = 'name' | 'device_id' | 'device_token'
type Errors = Partial<Record<Field, string>>

function validate(v: Record<Field, string>): Errors {
  const e: Errors = {}
  if (!v.name.trim()) e.name = 'Donnez un nom à cet appareil (ex. « iPad cuisine »).'
  if (!v.device_id.trim()) e.device_id = 'Collez l’identifiant fourni par le gérant.'
  else if (!UUID_RE.test(v.device_id.trim())) e.device_id = 'Format attendu : 8-4-4-4-12 caractères (ex. 3f2a…-…). Vérifiez le copier-coller.'
  if (!v.device_token.trim()) e.device_token = 'Collez le jeton d’appareil fourni par le gérant.'
  return e
}

/**
 * Configuration avancée : enrôlement manuel avec un identifiant + jeton d'appareil déjà créés
 * (dépannage). Le parcours normal est SetupFlow (connexion gérant → enrôlement automatique).
 */
export function EnrollScreen({ onEnrolled, onBack }: { onEnrolled: () => void; onBack?: () => void }) {
  const core = useCore()
  const [values, setValues] = useState<Record<Field, string>>({ name: '', device_id: '', device_token: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (f: Field) => (v: string) => {
    setValues((prev) => ({ ...prev, [f]: v }))
    if (errors[f]) setErrors((prev) => ({ ...prev, [f]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validate(values)
    setErrors(errs)
    setSubmitError(null)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    try {
      await core.enrollDevice({ name: values.name.trim(), device_id: values.device_id.trim(), device_token: values.device_token.trim() })
      onEnrolled()
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : 'Enrôlement impossible. Vérifiez les informations et la connexion.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-12">
      {onBack && (
        <Button variant="ghost" onClick={onBack} className="mb-6">
          ← Retour
        </Button>
      )}
      <h1 className="text-3xl font-bold text-white sm:text-4xl">Configuration avancée</h1>
      <p className="mt-3 text-lg text-slate-200">
        Enregistrement manuel de cet appareil avec un <strong>identifiant</strong> et un <strong>jeton</strong> d’appareil déjà créés par le gérant
        (dépannage). Une connexion Internet est nécessaire.
      </p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-6" aria-describedby={submitError ? 'enroll-error' : undefined}>
        <TextField label="Nom de l’appareil" hint="Ex. « iPad cuisine », « iPhone du gérant »." value={values.name} onChange={set('name')} error={errors.name} />
        <TextField label="Identifiant d’appareil" value={values.device_id} onChange={set('device_id')} error={errors.device_id} mono />
        <TextField label="Jeton d’appareil" hint="Il n’est affiché qu’une fois chez le gérant : ne le partagez pas." value={values.device_token} onChange={set('device_token')} error={errors.device_token} mono />
        {submitError && (
          <Notice id="enroll-error">{submitError}</Notice>
        )}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? 'Vérification…' : 'Enregistrer l’appareil'}
        </Button>
      </form>
    </main>
  )
}
