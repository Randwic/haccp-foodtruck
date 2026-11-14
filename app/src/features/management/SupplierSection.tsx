import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Supplier } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { normalizeSupplierInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice } from '../../ui/components/index.ts'
import { IconMail, IconPhone, IconPlus, IconSupplier } from '../../ui/icons.tsx'
import { SupplierFields } from '../reception/NewSupplierModal.tsx'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'

type Dialog = { kind: 'add' } | { kind: 'edit'; s: Supplier } | { kind: 'deactivate'; s: Supplier } | { kind: 'reactivate'; s: Supplier } | null

/** Gestion › Fournisseurs : ajout, modification, désactivation / réactivation (jamais de suppression). */
export function SupplierSection() {
  const manager = useManager()
  const { run } = useManagement()
  const [items, setItems] = useState<Supplier[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      setItems(await manager.listSuppliers())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  const active = items?.filter((s) => s.active) ?? []
  const inactive = items?.filter((s) => !s.active) ?? []
  const close = () => setDialog(null)
  const after = async () => {
    close()
    await load()
  }

  return (
    <section aria-labelledby="sup-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="sup-title" className="sr-only">
          Fournisseurs
        </h2>
        <p className="max-w-xl text-[17px] text-fg-muted">Fournisseurs proposés à la réception des livraisons. Un fournisseur désactivé reste dans l’historique.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter un fournisseur
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actifs</SectionTitle>
          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucun fournisseur actif. Ajoutez vos fournisseurs habituels.</p>
          ) : (
            <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              {active.map((s) => (
                <SupplierCard key={s.id} s={s}>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', s })} aria-label={`Modifier – ${s.name}`}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', s })} aria-label={`Désactiver – ${s.name}`}>
                    Désactiver
                  </Button>
                </SupplierCard>
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivés</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                {inactive.map((s) => (
                  <SupplierCard key={s.id} s={s} inactive>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', s })} aria-label={`Réactiver – ${s.name}`}>
                      Réactiver
                    </Button>
                  </SupplierCard>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && <SupplierModal supplier={dialog.kind === 'edit' ? dialog.s : null} onClose={close} onDone={after} />}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal
          open
          title="Désactiver ce fournisseur ?"
          confirmLabel="Désactiver"
          danger
          onClose={close}
          onConfirm={() => run(() => manager.updateSupplier(dialog.s.id, { active: false }), `« ${dialog.s.name} » désactivé`).then(load)}
        >
          <p>
            <strong>{dialog.s.name}</strong> ne sera plus proposé à la réception. Les réceptions passées sont conservées ; vous pourrez le réactiver à tout moment.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal
          open
          title="Réactiver ce fournisseur ?"
          confirmLabel="Réactiver"
          onClose={close}
          onConfirm={() => run(() => manager.updateSupplier(dialog.s.id, { active: true }), `« ${dialog.s.name} » réactivé`).then(load)}
        >
          <p>
            <strong>{dialog.s.name}</strong> sera de nouveau proposé à la réception.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function SupplierCard({ s, inactive, children }: { s: Supplier; inactive?: boolean; children: ReactNode }) {
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-5 ${inactive ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${inactive ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          <IconSupplier size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{s.name}</h3>
            {inactive && <Badge tone="neutral">Désactivé</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-fg-muted">
            {s.phone ? (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <IconPhone size={16} className="text-fg-subtle" />
                {s.phone}
              </span>
            ) : null}
            {s.email ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 break-all">
                <IconMail size={16} className="shrink-0 text-fg-subtle" />
                {s.email}
              </span>
            ) : null}
            {!s.phone && !s.email && <span className="text-fg-subtle">Aucun contact enregistré</span>}
          </div>
        </div>
      </div>
      <div className={`grid gap-2 sm:flex sm:flex-wrap sm:gap-3 ${inactive ? 'grid-cols-1' : 'grid-cols-2'}`}>{children}</div>
    </li>
  )
}

function SupplierModal({ supplier, onClose, onDone }: { supplier: Supplier | null; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [f, setF] = useState({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '' })
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'email', string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = normalizeSupplierInput(f)
    if (!n.ok) return setErrors({ [n.field]: n.message })
    setErrors({})
    setBusy(true)
    setError(null)
    try {
      const input = { name: n.value.name!, phone: n.value.phone ?? null, email: n.value.email ?? null }
      if (supplier) await run(() => manager.updateSupplier(supplier.id, input), 'Fournisseur modifié')
      else await run(() => manager.addSupplier(input), `« ${input.name} » ajouté`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={supplier ? `Modifier « ${supplier.name} »` : 'Ajouter un fournisseur'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <SupplierFields name={f.name} phone={f.phone} email={f.email} set={(p) => setF({ ...f, ...p })} errors={errors} autoFocus />
        {supplier && <p className="text-[15px] text-fg-muted">Les réceptions passées gardent le lien avec ce fournisseur.</p>}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : supplier ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
