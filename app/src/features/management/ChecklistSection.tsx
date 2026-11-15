// Gestion › Checklists : ouverture, fermeture, nuisibles… Points ordonnés (ajouter, retirer, réordonner),
// libellé, point critique (`required`). Identifiants de points STABLES : un point existant garde son id même
// si son libellé change ; un nouveau point reçoit un slug unique tiré de son libellé. Jamais de suppression.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Checklist } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { CHECKLIST_ITEMS_MAX, CHECKLIST_KINDS, checklistItemId, normalizeChecklistInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField } from '../../ui/components/index.ts'
import { IconChecklist, IconClose, IconMoveDown, IconMoveUp, IconPlus, IconWarn } from '../../ui/icons.tsx'
import { CHECKLIST_KIND_LABELS } from '../cleaning/model.ts'
import { chipClass } from '../processes/common.tsx'
import { plural } from '../temperatures/schedule.ts'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'

type Dialog = { kind: 'add' } | { kind: 'edit'; c: Checklist } | { kind: 'deactivate'; c: Checklist } | { kind: 'reactivate'; c: Checklist } | null

const KIND_HINTS: Record<Checklist['kind'], string> = {
  opening: 'Rappelée chaque jour avant le premier relevé de températures.',
  closing: 'Rappelée après le dernier relevé de la journée.',
  pest_control: 'Rappelée une fois par semaine.',
  other: 'Disponible sur demande, sans rappel.',
}

export function ChecklistSection() {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<Checklist[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      setItems(await manager.listChecklists())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const order = (a: Checklist, b: Checklist) => CHECKLIST_KINDS.indexOf(a.kind) - CHECKLIST_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, 'fr')
  const active = (items ?? []).filter((c) => c.active).sort(order)
  const inactive = (items ?? []).filter((c) => !c.active).sort(order)
  const close = () => setDialog(null)

  return (
    <section aria-labelledby="chk-title">
      <h2 id="chk-title" className="sr-only">
        Checklists
      </h2>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[17px] text-fg-muted">Points à contrôler à l’ouverture, à la fermeture, pour les nuisibles… Un « Non » exige toujours un commentaire.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter une checklist
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actives</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucune checklist active.</p>
          ) : (
            <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {active.map((c) => (
                <ChecklistCard key={c.id} c={c}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', c })} aria-label={`Modifier – ${c.name}`}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', c })} aria-label={`Désactiver – ${c.name}`}>
                    Désactiver
                  </Button>
                </ChecklistCard>
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivées</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((c) => (
                  <ChecklistCard key={c.id} c={c} inactive>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', c })} aria-label={`Réactiver – ${c.name}`}>
                      Réactiver
                    </Button>
                  </ChecklistCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <ChecklistModal
          checklist={dialog.kind === 'edit' ? dialog.c : null}
          onClose={close}
          onDone={async () => {
            close()
            await load()
          }}
        />
      )}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal open title="Désactiver cette checklist ?" confirmLabel="Désactiver" danger onClose={close} onConfirm={() => run(() => manager.updateChecklist(dialog.c.id, { active: false }), `« ${dialog.c.name} » désactivée`).then(load)}>
          <p>
            <strong>{dialog.c.name}</strong> ne sera plus proposée ni rappelée. Les checklists déjà remplies restent dans l’historique ; vous pourrez la réactiver.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal open title="Réactiver cette checklist ?" confirmLabel="Réactiver" onClose={close} onConfirm={() => run(() => manager.updateChecklist(dialog.c.id, { active: true }), `« ${dialog.c.name} » réactivée`).then(load)}>
          <p>
            <strong>{dialog.c.name}</strong> sera de nouveau proposée.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function ChecklistCard({ c, inactive, children }: { c: Checklist; inactive?: boolean; children: ReactNode }) {
  const critical = c.items.filter((i) => i.required).length
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconChecklist size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{c.name}</h3>
            <Badge tone="neutral">{CHECKLIST_KIND_LABELS[c.kind]}</Badge>
            {inactive && <Badge tone="neutral">Désactivée</Badge>}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            {plural(c.items.length, 'point', 'points')}
            {critical ? ` · ${plural(critical, 'point critique', 'points critiques')}` : ''}
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[15px] text-fg">
            {c.items.slice(0, 4).map((i) => (
              <li key={i.id}>{i.label}</li>
            ))}
          </ol>
          {c.items.length > 4 && <p className="mt-0.5 text-[14px] text-fg-subtle">et {plural(c.items.length - 4, 'autre point', 'autres points')}</p>}
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

interface DraftItem {
  key: string
  /** Identifiant existant (stable) ; absent pour un nouveau point. */
  id?: string
  label: string
  required: boolean
}

// eslint-disable-next-line react-refresh/only-export-components
/** Points du brouillon → points du contrat : ids existants conservés, nouveaux ids uniques. */
export function draftToItems(draft: readonly DraftItem[]): { id: string; label: string; required: boolean }[] {
  const taken = new Set(draft.flatMap((d) => (d.id ? [d.id] : [])))
  return draft.map((d) => {
    let id = d.id
    if (!id) {
      id = checklistItemId(d.label, taken)
      taken.add(id)
    }
    return { id, label: d.label, required: d.required }
  })
}

const iconBtn = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-elevated text-fg active:bg-pressed disabled:opacity-35'

function ChecklistModal({ checklist, onClose, onDone }: { checklist: Checklist | null; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [name, setName] = useState(checklist?.name ?? '')
  const [kind, setKind] = useState<Checklist['kind']>(checklist?.kind ?? 'other')
  const [items, setItems] = useState<DraftItem[]>(() =>
    checklist ? checklist.items.map((i) => ({ key: i.id, id: i.id, label: i.label, required: i.required })) : [{ key: crypto.randomUUID(), label: '', required: true }],
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const update = (k: number, patch: Partial<DraftItem>) => setItems((list) => list.map((it, i) => (i === k ? { ...it, ...patch } : it)))
  const move = (k: number, d: -1 | 1) =>
    setItems((list) => {
      const next = [...list]
      ;[next[k], next[k + d]] = [next[k + d], next[k]]
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const input = { name, kind, items: draftToItems(items.map((i) => ({ ...i, label: i.label.trim() }))) }
    const n = normalizeChecklistInput(input)
    setErrors(n.ok ? {} : { [n.field]: n.message })
    if (!n.ok) return
    setBusy(true)
    setError(null)
    try {
      const value = { name: n.value.name!, kind, items: n.value.items! }
      if (checklist) await run(() => manager.updateChecklist(checklist.id, value), 'Checklist modifiée')
      else await run(() => manager.addChecklist(value), `« ${value.name} » ajoutée`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={checklist ? `Modifier « ${checklist.name} »` : 'Ajouter une checklist'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <TextField label="Nom de la checklist" value={name} onChange={setName} error={errors.name} maxLength={80} autoCapitalize="sentences" placeholder="Ex. : Ouverture" />
        <div role="radiogroup" aria-label="Nature">
          <p className="mb-2 text-[15px] font-semibold text-fg">Nature</p>
          <div className="flex flex-wrap gap-2">
            {CHECKLIST_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={chipClass(kind === k)} onClick={() => setKind(k)}>
                {CHECKLIST_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[14px] text-fg-subtle">{KIND_HINTS[kind]}</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold text-fg">
            Points à contrôler <span className="font-normal text-fg-muted tabular-nums">({items.length}/{CHECKLIST_ITEMS_MAX})</span>
          </legend>
          <ol className="space-y-3">
            {items.map((it, k) => (
              <li key={it.key} className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-4 w-6 shrink-0 text-[15px] font-semibold text-fg-subtle tabular-nums">{k + 1}.</span>
                  <TextField className="min-w-0 flex-1" label={`Point ${k + 1}`} value={it.label} onChange={(label) => update(k, { label })} maxLength={120} autoCapitalize="sentences" placeholder="Ex. : Lave-mains approvisionné" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={it.required}
                    onClick={() => update(k, { required: !it.required })}
                    aria-label={`Point critique – point ${k + 1}`}
                    className={`flex min-h-12 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold active:bg-pressed ${it.required ? 'border-warn/60 bg-warn-soft text-warn' : 'border-line-strong bg-elevated text-fg-muted'}`}
                  >
                    <IconWarn size={18} />
                    {it.required ? 'Point critique' : 'Point normal'}
                  </button>
                  <span className="flex-1" />
                  <button type="button" className={iconBtn} onClick={() => move(k, -1)} disabled={k === 0} aria-label={`Monter le point ${k + 1}`}>
                    <IconMoveUp size={20} />
                  </button>
                  <button type="button" className={iconBtn} onClick={() => move(k, 1)} disabled={k === items.length - 1} aria-label={`Descendre le point ${k + 1}`}>
                    <IconMoveDown size={20} />
                  </button>
                  <button type="button" className={iconBtn} onClick={() => setItems((list) => list.filter((_, i) => i !== k))} disabled={items.length <= 1} aria-label={`Retirer le point ${k + 1}`}>
                    <IconClose size={20} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Button variant="secondary" className="mt-3" icon={<IconPlus size={20} />} disabled={items.length >= CHECKLIST_ITEMS_MAX} onClick={() => setItems((list) => [...list, { key: crypto.randomUUID(), label: '', required: true }])}>
            Ajouter un point
          </Button>
          {errors.items && (
            <div className="mt-3">
              <Notice>{errors.items}</Notice>
            </div>
          )}
          {checklist && <p className="mt-3 text-[14px] text-fg-subtle">Les checklists déjà remplies gardent les réponses données, même si un point est modifié ou retiré.</p>}
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : checklist ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
