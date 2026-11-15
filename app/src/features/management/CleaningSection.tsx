// Gestion › Nettoyage : tâches du plan de nettoyage et de désinfection (zone / équipement, fréquence, produit,
// mode opératoire). Ajout, modification, désactivation / réactivation : jamais de suppression.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { CleaningFrequency, CleaningTask } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { CLEANING_FREQUENCIES, normalizeCleaningTaskInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconCleaning, IconPlus } from '../../ui/icons.tsx'
import { FREQUENCY_LABELS } from '../cleaning/model.ts'
import { TextArea } from '../cleaning/parts.tsx'
import { chipClass } from '../processes/common.tsx'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'

type Dialog = { kind: 'add' } | { kind: 'edit'; t: CleaningTask } | { kind: 'deactivate'; t: CleaningTask } | { kind: 'reactivate'; t: CleaningTask } | null

export function CleaningSection() {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<CleaningTask[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      setItems(await manager.listCleaningTasks())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const order = (a: CleaningTask, b: CleaningTask) => CLEANING_FREQUENCIES.indexOf(a.frequency) - CLEANING_FREQUENCIES.indexOf(b.frequency) || a.name.localeCompare(b.name, 'fr')
  const active = (items ?? []).filter((t) => t.active).sort(order)
  const inactive = (items ?? []).filter((t) => !t.active).sort(order)
  const close = () => setDialog(null)

  return (
    <section aria-labelledby="clean-title">
      <h2 id="clean-title" className="sr-only">
        Plan de nettoyage
      </h2>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[17px] text-fg-muted">Plan de nettoyage et de désinfection de votre PMS : chaque tâche apparaît « à faire » selon sa fréquence.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter une tâche
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actives</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucune tâche active.</p>
          ) : (
            <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {active.map((t) => (
                <TaskCard key={t.id} t={t}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', t })} aria-label={`Modifier – ${t.name}`}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', t })} aria-label={`Désactiver – ${t.name}`}>
                    Désactiver
                  </Button>
                </TaskCard>
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivées</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((t) => (
                  <TaskCard key={t.id} t={t} inactive>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', t })} aria-label={`Réactiver – ${t.name}`}>
                      Réactiver
                    </Button>
                  </TaskCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <TaskModal
          task={dialog.kind === 'edit' ? dialog.t : null}
          onClose={close}
          onDone={async () => {
            close()
            await load()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal open title="Désactiver cette tâche ?" confirmLabel="Désactiver" danger onClose={close} onConfirm={() => run(() => manager.updateCleaningTask(dialog.t.id, { active: false }), `« ${dialog.t.name} » désactivée`).then(load)}>
          <p>
            <strong>{dialog.t.name}</strong> ne sera plus proposée à faire. Les nettoyages déjà enregistrés restent dans l’historique ; vous pourrez la réactiver.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal open title="Réactiver cette tâche ?" confirmLabel="Réactiver" onClose={close} onConfirm={() => run(() => manager.updateCleaningTask(dialog.t.id, { active: true }), `« ${dialog.t.name} » réactivée`).then(load)}>
          <p>
            <strong>{dialog.t.name}</strong> sera de nouveau proposée selon sa fréquence.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function TaskCard({ t, inactive, children }: { t: CleaningTask; inactive?: boolean; children: ReactNode }) {
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconCleaning size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{t.name}</h3>
            <Badge tone="neutral">{FREQUENCY_LABELS[t.frequency]}</Badge>
            {inactive && <Badge tone="neutral">Désactivée</Badge>}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            Produit : <span className="text-fg">{t.product || '—'}</span>
          </p>
          {t.method && <p className="mt-0.5 line-clamp-2 text-[15px] text-fg-muted">{t.method}</p>}
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

function TaskModal({ task, onClose, onDone }: { task: CleaningTask | null; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(task?.name ?? '')
  const [frequency, setFrequency] = useState<CleaningFrequency>(task?.frequency ?? 'daily')
  const [product, setProduct] = useState(task?.product ?? '')
  const [method, setMethod] = useState(task?.method ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const input = { name, frequency, product, method }
    const n = normalizeCleaningTaskInput(input)
    setErrors(n.ok ? {} : { [n.field]: n.message })
    if (!n.ok) return
    setBusy(true)
    setError(null)
    try {
      const value = { name: n.value.name!, frequency, product: n.value.product ?? null, method: n.value.method ?? null }
      if (task) await run(() => manager.updateCleaningTask(task.id, value), 'Tâche modifiée')
      else await run(() => manager.addCleaningTask(value), `« ${value.name} » ajoutée`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={task ? `Modifier « ${task.name} »` : 'Ajouter une tâche'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <TextField label="Zone ou équipement" value={name} onChange={setName} error={errors.name} maxLength={80} autoCapitalize="sentences" placeholder="Ex. : Plans de travail" />
        <div role="radiogroup" aria-label="Fréquence">
          <p className="mb-2 text-[15px] font-semibold text-fg">Fréquence</p>
          <div className="flex flex-wrap gap-2">
            {CLEANING_FREQUENCIES.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={frequency === f} className={chipClass(frequency === f)} onClick={() => setFrequency(f)}>
                {FREQUENCY_LABELS[f]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[14px] text-fg-subtle">
            « Après chaque service » : une fois par jour d’activité. Hebdomadaire et mensuelle : 7 et 30 jours après la dernière fois.
          </p>
        </div>
        <TextField label="Produit utilisé (facultatif)" value={product} onChange={setProduct} error={errors.product} maxLength={80} autoCapitalize="sentences" placeholder="Ex. : Détergent-désinfectant contact alimentaire" />
        <TextArea label="Mode opératoire (facultatif)" value={method} onChange={setMethod} maxLength={500} rows={4} hint="Étapes, dosage, temps de contact : tels que décrits dans votre PMS." invalid={!!errors.method} />
        {errors.method && <Notice>{errors.method}</Notice>}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : task ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
