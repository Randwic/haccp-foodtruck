import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../ui/components/index.ts'
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

function TextField(props: {
  label: string
  hint?: string
  value: string
  error?: string
  onChange: (v: string) => void
  mono?: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xl font-semibold text-white">
        {props.label}
      </label>
      {props.hint && (
        <p id={hintId} className="mb-2 text-base text-slate-300">
          {props.hint}
        </p>
      )}
      <input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoFocus={props.autoFocus}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={[props.hint ? hintId : '', props.error ? errId : ''].filter(Boolean).join(' ') || undefined}
        className={`min-h-16 w-full rounded-2xl bg-slate-800 px-4 text-xl text-white ring-2 placeholder:text-slate-400 ${
          props.error ? 'ring-red-400' : 'ring-slate-600'
        } ${props.mono ? 'font-mono text-lg' : ''}`}
      />
      {props.error && (
        <p id={errId} className="mt-2 text-lg font-semibold text-red-300">
          {props.error}
        </p>
      )}
    </div>
  )
}

/** Enrôlement de l'appareil : à faire une seule fois, avec les informations fournies par le gérant. */
export function EnrollScreen({ onEnrolled }: { onEnrolled: () => void }) {
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
      <h1 className="text-3xl font-bold text-white sm:text-4xl">Enregistrer cet appareil</h1>
      <p className="mt-3 text-lg text-slate-200">
        À faire une seule fois. Le gérant crée l’appareil depuis son compte et vous donne un <strong>identifiant</strong> et un <strong>jeton</strong> à coller ici.
        Une connexion Internet est nécessaire.
      </p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-6" aria-describedby={submitError ? 'enroll-error' : undefined}>
        <TextField label="Nom de l’appareil" hint="Ex. « iPad cuisine », « iPhone du gérant »." value={values.name} onChange={set('name')} error={errors.name} />
        <TextField label="Identifiant d’appareil" value={values.device_id} onChange={set('device_id')} error={errors.device_id} mono />
        <TextField label="Jeton d’appareil" hint="Il n’est affiché qu’une fois chez le gérant : ne le partagez pas." value={values.device_token} onChange={set('device_token')} error={errors.device_token} mono />
        {submitError && (
          <div id="enroll-error" role="alert" className="rounded-2xl bg-red-950 px-5 py-4 text-lg font-semibold text-red-100 ring-2 ring-red-400">
            {submitError}
          </div>
        )}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? 'Vérification…' : 'Enregistrer l’appareil'}
        </Button>
      </form>
    </main>
  )
}
