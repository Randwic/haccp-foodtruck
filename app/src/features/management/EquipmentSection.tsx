import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Equipment, EquipmentKind, Threshold } from '../../../../shared/types.ts'
import { errorText } from '../../manager/api.ts'
import { checkTypeFor, defaultThreshold, EQUIPMENT_KINDS, kindLabel, parseTemperature, thresholdSummary } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconBox, IconFlame, IconFridge, IconFryer, IconPlus, IconSnowflake, type IconProps } from '../../ui/icons.tsx'

const KIND_ICONS: Record<EquipmentKind, (p: IconProps) => ReactNode> = {
  fridge: IconFridge,
  freezer: IconSnowflake,
  fryer_vat: IconFryer,
  hot_holding: IconFlame,
  other: IconBox,
}
function KindIcon({ kind, ...p }: IconProps & { kind: EquipmentKind }) {
  const I = KIND_ICONS[kind]
  return <I {...p} />
}
import { ConfirmModal, SectionTitle, TemperatureField, useManagement } from './common.tsx'

const PMS_NOTE = 'Valeurs proposées (réglementation courante) : à confirmer selon votre PMS.'

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; eq: Equipment }
  | { kind: 'threshold'; eq: Equipment }
  | { kind: 'retire'; eq: Equipment }
  | { kind: 'restore'; eq: Equipment }
  | null

/** Gestion › Équipements : liste, ajout, renommage, retrait/remise en service, seuils. */
export function EquipmentSection() {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<Equipment[] | null>(null)
  const [thresholds, setThresholds] = useState<Threshold[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      const [e, t] = await Promise.all([manager.listEquipment(), manager.listThresholds()])
      setItems(e)
      setThresholds(t)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const thresholdOf = (eq: Equipment) => thresholds.find((t) => t.equipment_id === eq.id && t.check_type === checkTypeFor(eq.kind))
  const active = items?.filter((e) => e.active) ?? []
  const retired = items?.filter((e) => !e.active) ?? []
  const close = () => setDialog(null)
  const after = async () => {
    close()
    await load()
  }

  return (
    <section aria-labelledby="eq-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="eq-title" className="sr-only">
          Équipements
        </h2>
        <p className="max-w-xl text-lg text-slate-300">Frigos, congélateur, friteuses… Chaque équipement a ses seuils de température.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus />}>
          Ajouter un équipement
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-lg text-slate-300">Chargement…</p>}

      {items !== null && (
        <>
          <SectionTitle count={active.length}>En service</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl bg-slate-900 p-5 text-lg text-slate-300 ring-1 ring-slate-700">Aucun équipement en service. Ajoutez vos frigos et votre congélateur.</p>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {active.map((eq) => (
                <EquipmentCard key={eq.id} eq={eq} threshold={thresholdOf(eq)}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'threshold', eq })} aria-label={`Seuils – ${eq.name}`}>
                    Seuils
                  </Button>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'rename', eq })} aria-label={`Renommer – ${eq.name}`}>
                    Renommer
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'retire', eq })} aria-label={`Retirer du service – ${eq.name}`}>
                    Retirer
                  </Button>
                </EquipmentCard>
              ))}
            </ul>
          )}

          {retired.length > 0 && (
            <>
              <SectionTitle count={retired.length}>Retirés du service</SectionTitle>
              <ul className="grid gap-4 lg:grid-cols-2">
                {retired.map((eq) => (
                  <EquipmentCard key={eq.id} eq={eq} threshold={thresholdOf(eq)} retired>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'restore', eq })} aria-label={`Remettre en service – ${eq.name}`}>
                      Remettre en service
                    </Button>
                  </EquipmentCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'add' && <AddEquipmentModal onClose={close} onDone={after} />}
      {dialog?.kind === 'rename' && <RenameModal eq={dialog.eq} onClose={close} onDone={after} />}
      {dialog?.kind === 'threshold' && <ThresholdModal eq={dialog.eq} current={thresholdOf(dialog.eq)} onClose={close} onDone={after} />}
      {dialog?.kind === 'retire' && (
        <ConfirmModal
          open
          title="Retirer du service ?"
          confirmLabel="Retirer du service"
          danger
          onClose={close}
          onConfirm={() => run(() => manager.updateEquipment(dialog.eq.id, { active: false }), `« ${dialog.eq.name} » retiré du service`).then(load)}
        >
          <p>
            <strong>{dialog.eq.name}</strong> ne sera plus proposé pour les relevés. L’historique est conservé, et vous pourrez le remettre en service à tout moment.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'restore' && (
        <ConfirmModal
          open
          title="Remettre en service ?"
          confirmLabel="Remettre en service"
          onClose={close}
          onConfirm={() => run(() => manager.updateEquipment(dialog.eq.id, { active: true }), `« ${dialog.eq.name} » remis en service`).then(load)}
        >
          <p>
            <strong>{dialog.eq.name}</strong> sera de nouveau proposé pour les relevés.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function EquipmentCard({ eq, threshold, retired, children }: { eq: Equipment; threshold?: Threshold; retired?: boolean; children: ReactNode }) {
  return (
    <li className={`flex flex-col gap-4 rounded-3xl p-5 ring-1 ${retired ? 'bg-slate-900 ring-slate-800' : 'bg-slate-800 ring-slate-600'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${retired ? 'bg-slate-800 text-slate-500' : 'bg-slate-700 text-sky-200'}`}>
          <KindIcon kind={eq.kind} size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`break-words text-xl font-bold ${retired ? 'text-slate-300' : 'text-white'}`}>{eq.name}</h3>
            {retired && <Badge tone="neutral">Retiré</Badge>}
          </div>
          <p className="text-base text-slate-300">{kindLabel(eq.kind)}</p>
          <p className={`mt-1 text-lg font-semibold ${threshold && !retired ? 'text-sky-200' : 'text-slate-400'}`}>
            <span className="sr-only">Seuil : </span>
            {thresholdSummary(threshold)}
          </p>
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${retired ? 'grid-cols-1' : 'grid-cols-3'} [&>button]:px-2 [&>button]:text-base sm:[&>button]:px-5 sm:[&>button]:text-lg`}>{children}</div>
    </li>
  )
}

interface ThresholdDraft {
  min: string
  max: string
  tolerance: string
}
const toDraft = (t: { min_c: number | null; max_c: number | null; tolerance_minutes: number } | null | undefined): ThresholdDraft => ({
  min: t?.min_c === null || t?.min_c === undefined ? '' : String(t.min_c).replace('.', ','),
  max: t?.max_c === null || t?.max_c === undefined ? '' : String(t.max_c).replace('.', ','),
  tolerance: t ? String(t.tolerance_minutes) : '20',
})

/** Valide un brouillon de seuil. `empty` : aucune limite saisie (autorisé à l'ajout). */
function parseDraft(d: ThresholdDraft): { ok: true; empty: boolean; min_c: number | null; max_c: number | null; tolerance_minutes: number } | { ok: false; errors: Partial<ThresholdDraft> } {
  const errors: Partial<ThresholdDraft> = {}
  const min = parseTemperature(d.min)
  const max = parseTemperature(d.max)
  if (min !== null && Number.isNaN(min)) errors.min = 'Nombre attendu, ex. 0 ou 2,5.'
  if (max !== null && Number.isNaN(max)) errors.max = 'Nombre attendu, ex. 4 ou −18.'
  for (const [k, v] of [['min', min], ['max', max]] as const) {
    if (v !== null && !Number.isNaN(v) && (v < -80 || v > 300)) errors[k] = 'Entre −80 et 300 °C.'
  }
  if (!errors.min && !errors.max && min !== null && max !== null && min > max) errors.max = 'Le maximum doit être supérieur ou égal au minimum.'
  const tolStr = d.tolerance.trim() === '' ? '0' : d.tolerance.trim()
  const tol = Number(tolStr)
  if (!/^\d+$/.test(tolStr) || tol > 1440) errors.tolerance = 'Nombre entier de minutes (0 à 1440).'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, empty: min === null && max === null, min_c: min, max_c: max, tolerance_minutes: tol }
}

function ThresholdFields({ draft, setDraft, errors }: { draft: ThresholdDraft; setDraft: (d: ThresholdDraft) => void; errors: Partial<ThresholdDraft> }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <p className="text-base text-slate-300 sm:col-span-2">Laissez une case vide s’il n’y a pas de limite de ce côté. Le bouton ± change le signe (−18).</p>
      <TemperatureField label="Minimum" value={draft.min} onChange={(min) => setDraft({ ...draft, min })} error={errors.min} />
      <TemperatureField label="Maximum" value={draft.max} onChange={(max) => setDraft({ ...draft, max })} error={errors.max} />
      <TextField
        className="sm:col-span-2"
        label="Tolérance (minutes)"
        hint="Durée hors seuil avant alerte (ouverture de porte, livraison…)."
        inputMode="numeric"
        value={draft.tolerance}
        onChange={(tolerance) => setDraft({ ...draft, tolerance })}
        error={errors.tolerance}
      />
    </div>
  )
}

function AddEquipmentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<EquipmentKind>('fridge')
  const [draft, setDraft] = useState<ThresholdDraft>(toDraft(defaultThreshold('fridge')))
  const [errors, setErrors] = useState<Partial<ThresholdDraft> & { name?: string }>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseKind = (k: EquipmentKind) => {
    setKind(k)
    const def = defaultThreshold(k)
    setDraft(def ? toDraft(def) : { min: '', max: '', tolerance: '0' })
    setErrors({})
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseDraft(draft)
    const errs: typeof errors = parsed.ok ? {} : { ...parsed.errors }
    if (!name.trim()) errs.name = 'Donnez un nom (ex. « Frigo 3 »).'
    setErrors(errs)
    if (Object.keys(errs).length > 0 || !parsed.ok) return
    setBusy(true)
    setError(null)
    try {
      await run(async () => {
        const eq = await manager.addEquipment({ name: name.trim(), kind })
        if (!parsed.empty) {
          await manager.saveThreshold({ equipment_id: eq.id, check_type: checkTypeFor(kind), min_c: parsed.min_c, max_c: parsed.max_c, tolerance_minutes: parsed.tolerance_minutes })
        }
        return eq
      }, `« ${name.trim()} » ajouté`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title="Ajouter un équipement" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <TextField label="Nom" hint="Ex. « Frigo 3 », « Saladette »." value={name} onChange={(v) => { setName(v); setErrors((p) => ({ ...p, name: undefined })) }} error={errors.name} autoCapitalize="sentences" autoFocus />
        <fieldset>
          <legend className="mb-2 text-xl font-semibold text-white">Type</legend>
          <div role="radiogroup" aria-label="Type d’équipement" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {EQUIPMENT_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                onClick={() => chooseKind(k.kind)}
                className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center text-base leading-tight font-semibold sm:flex-row sm:justify-start sm:gap-3 sm:px-4 sm:text-left sm:text-lg ${
                  kind === k.kind ? 'bg-sky-300 text-slate-950 ring-4 ring-sky-100' : 'bg-slate-800 text-white ring-1 ring-slate-600 active:bg-slate-700'
                }`}
              >
                <KindIcon kind={k.kind} size={26} />
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-2xl bg-slate-950/60 p-4 ring-1 ring-slate-700">
          <legend className="px-2 text-xl font-semibold text-white">Seuil de température</legend>
          {defaultThreshold(kind) ? <p className="text-base text-amber-200">{PMS_NOTE}</p> : <p className="text-base text-slate-300">Facultatif pour ce type d’équipement.</p>}
          <ThresholdFields draft={draft} setDraft={setDraft} errors={errors} />
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RenameModal({ eq, onClose, onDone }: { eq: Equipment; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(eq.name)
  const [fieldError, setFieldError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setFieldError('Le nom ne peut pas être vide.')
    setBusy(true)
    setError(null)
    try {
      await run(() => manager.updateEquipment(eq.id, { name: name.trim() }), 'Nom modifié')
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Modal open title={`Renommer « ${eq.name} »`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <TextField label="Nouveau nom" value={name} onChange={(v) => { setName(v); setFieldError(undefined) }} error={fieldError} autoFocus autoCapitalize="sentences" />
        <p className="text-base text-slate-300">Les anciens relevés gardent le lien avec cet équipement.</p>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ThresholdModal({ eq, current, onClose, onDone }: { eq: Equipment; current?: Threshold; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const def = defaultThreshold(eq.kind)
  const [draft, setDraft] = useState<ThresholdDraft>(toDraft(current ?? def))
  const [errors, setErrors] = useState<Partial<ThresholdDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseDraft(draft)
    if (!parsed.ok) return setErrors(parsed.errors)
    if (parsed.empty) return setErrors({ max: 'Indiquez au moins un minimum ou un maximum.' })
    setErrors({})
    setBusy(true)
    setError(null)
    try {
      await run(
        () => manager.saveThreshold({ equipment_id: eq.id, check_type: checkTypeFor(eq.kind), min_c: parsed.min_c, max_c: parsed.max_c, tolerance_minutes: parsed.tolerance_minutes }),
        `Seuil de « ${eq.name} » enregistré`,
      )
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={`Seuils – ${eq.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <p className="text-lg text-slate-200">
          {kindLabel(eq.kind)} · actuellement : <strong>{thresholdSummary(current)}</strong>
        </p>
        {def && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-950/60 p-4 ring-1 ring-amber-500">
            <p className="flex-1 text-base text-amber-100">
              Proposé : {thresholdSummary(def)}. {PMS_NOTE}
            </p>
            <Button variant="secondary" onClick={() => setDraft(toDraft(def))}>
              Utiliser ces valeurs
            </Button>
          </div>
        )}
        <ThresholdFields draft={draft} setDraft={setDraft} errors={errors} />
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer le seuil'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
