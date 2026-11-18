import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { hashPin } from '../../core/index.ts'
import { errorText, type ManagedStaff } from '../../manager/api.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, PinSetup, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { initials } from '../../ui/format.ts'
import { IconChevronLeft, IconPlus, IconShare } from '../../ui/icons.tsx'
import { downloadFile, shareFile } from '../documents/files.ts'
import { ConfirmModal, SectionTitle, useManagement } from './common.tsx'
import { buildStaffExport } from './staffExport.ts'

type Dialog = { kind: 'add' } | { kind: 'pin'; s: ManagedStaff } | { kind: 'deactivate'; s: ManagedStaff } | { kind: 'reactivate'; s: ManagedStaff } | { kind: 'forget'; s: ManagedStaff } | null

/** Gestion › Équipe : liste, ajout avec PIN, désactivation/réactivation, changement de PIN ; RGPD : export des données, effacement du nom. */
export function StaffSection() {
  const manager = useManager()
  const core = useCore()
  const toast = useToast()
  const { run, meId } = useManagement()
  const [exporting, setExporting] = useState<string | null>(null)
  const [items, setItems] = useState<ManagedStaff[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      setItems(await manager.listStaff())
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
  const activeManagers = active.filter((s) => s.role === 'manager').length
  const close = () => setDialog(null)
  const after = async () => {
    close()
    await load()
  }

  // Deux temps : préparer le fichier (lecture de tout le registre), puis le partager d'un toucher
  // (la feuille de partage de l'iPhone / iPad exige un geste direct de l'utilisateur).
  const [ready, setReady] = useState<{ id: string; name: string; csv: string } | null>(null)
  const prepare = async (s: ManagedStaff) => {
    setExporting(s.id)
    try {
      setReady({ id: s.id, ...(await buildStaffExport(core, manager, s)) })
    } catch (err) {
      toast(`Export impossible : ${errorText(err)}`, 'error')
    } finally {
      setExporting(null)
    }
  }
  const share = (s: ManagedStaff, file: { name: string; csv: string }) => {
    const blob = new Blob([file.csv], { type: 'text/csv;charset=utf-8' })
    void shareFile(blob, file.name, 'text/csv', `Données de ${s.display_name}`).catch(() => downloadFile(blob, file.name))
  }
  const exportButton = (s: ManagedStaff) =>
    ready?.id === s.id ? (
      <Button variant="secondary" icon={<IconShare size={18} />} onClick={() => share(s, ready)} aria-label={`Partager le fichier – ${s.display_name}`}>
        Partager le fichier
      </Button>
    ) : (
      <Button variant="ghost" onClick={() => void prepare(s)} disabled={exporting !== null} aria-label={`Exporter ses données – ${s.display_name}`}>
        {exporting === s.id ? 'Préparation…' : 'Exporter ses données'}
      </Button>
    )

  const card = (s: ManagedStaff) => {
    const me = s.id === meId
    const lastManager = s.role === 'manager' && activeManagers <= 1
    return (
      <li key={s.id} className={`flex flex-col gap-4 rounded-2xl border border-line p-4 sm:flex-row sm:items-center sm:p-5 ${s.active ? 'bg-surface shadow-card' : 'bg-sunken'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line text-[15px] font-semibold ${s.active ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-subtle'}`}>
            {initials(s.display_name)}
          </span>
          <div className="min-w-0">
            <h3 className={`break-words text-lg leading-snug font-semibold tracking-[-0.01em] ${s.active ? 'text-fg' : 'text-fg-muted'}`}>
              {s.display_name}
              {me && <span className="ml-2 text-[15px] font-medium text-accent">(vous)</span>}
            </h3>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge tone={s.role === 'manager' ? 'info' : 'neutral'}>{s.role === 'manager' ? 'Gérant' : 'Équipier'}</Badge>
              {!s.active && !s.forgotten_at && <Badge tone="warn">Désactivé</Badge>}
              {s.forgotten_at && <Badge tone="neutral">Nom effacé (RGPD)</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {s.active ? (
            <>
              <Button variant="secondary" onClick={() => setDialog({ kind: 'pin', s })} aria-label={`Changer le PIN – ${s.display_name}`}>
                Changer le PIN
              </Button>
              {!me && !lastManager && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'deactivate', s })} aria-label={`Désactiver – ${s.display_name}`}>
                  Désactiver
                </Button>
              )}
              {exportButton(s)}
            </>
          ) : s.forgotten_at ? (
            exportButton(s)
          ) : (
            <>
              <Button variant="secondary" onClick={() => setDialog({ kind: 'reactivate', s })} aria-label={`Réactiver – ${s.display_name}`}>
                Réactiver
              </Button>
              {exportButton(s)}
              <Button variant="ghost" onClick={() => setDialog({ kind: 'forget', s })} aria-label={`Effacer son nom – ${s.display_name}`} className="text-danger">
                Effacer son nom
              </Button>
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <section aria-labelledby="staff-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="staff-title" className="sr-only">
          Équipe
        </h2>
        <p className="max-w-xl text-[17px] text-fg-muted">Chaque personne déverrouille l’app avec son code PIN : ses saisies portent son nom. Au départ d’un employé : désactivez son compte, donnez-lui ses données s’il les demande, puis effacez son nom.</p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter un employé
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {items === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {items !== null && (
        <>
          <SectionTitle count={active.length}>Actifs</SectionTitle>
          <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">{active.map(card)}</ul>
          {inactive.length > 0 && (
            <>
              <SectionTitle count={inactive.length}>Désactivés</SectionTitle>
              <ul className="grid gap-3 sm:gap-4 lg:grid-cols-2">{inactive.map(card)}</ul>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'add' && <AddStaffModal onClose={close} onDone={after} />}
      {dialog?.kind === 'pin' && <ChangePinModal s={dialog.s} me={dialog.s.id === meId} onClose={close} onDone={after} />}
      {dialog?.kind === 'deactivate' && (
        <ConfirmModal
          open
          title="Désactiver ce compte ?"
          confirmLabel="Désactiver"
          danger
          onClose={close}
          onConfirm={() => run(() => manager.updateStaff(dialog.s.id, { active: false }), `${dialog.s.display_name} est désactivé`).then(load)}
        >
          <p>
            <strong>{dialog.s.display_name}</strong> ne pourra plus déverrouiller l’app. Ses saisies passées restent dans le registre, à son nom. Vous pourrez le réactiver.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'forget' && (
        <ConfirmModal
          open
          title="Effacer le nom de cet ancien membre ?"
          confirmLabel="Effacer son nom"
          danger
          onClose={close}
          onConfirm={() => run(() => manager.forgetStaff(dialog.s.id), 'Nom effacé : ses saisies restent dans le registre').then(() => {
            setReady(null)
            return load()
          })}
        >
          <p>
            Le nom <strong>{dialog.s.display_name}</strong> sera remplacé partout par « Ancien membre … » et son code PIN ne fonctionnera plus. Ses saisies restent dans le registre HACCP (obligation légale de traçabilité).
          </p>
          <p className="mt-3 font-semibold">C’est définitif : le compte ne pourra plus être réactivé. Pensez à exporter ses données avant s’il les a demandées.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'reactivate' && (
        <ConfirmModal
          open
          title="Réactiver ce compte ?"
          confirmLabel="Réactiver"
          onClose={close}
          onConfirm={() => run(() => manager.updateStaff(dialog.s.id, { active: true }), `${dialog.s.display_name} est réactivé`).then(load)}
        >
          <p>
            <strong>{dialog.s.display_name}</strong> pourra de nouveau déverrouiller l’app avec son ancien code PIN.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function AddStaffModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [step, setStep] = useState<'name' | 'pin'>('name')
  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const next = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setFieldError('Indiquez le prénom (et le nom si besoin).')
    setStep('pin')
  }
  const save = async (pin: string) => {
    setBusy(true)
    setError(null)
    try {
      const hashed = await hashPin(pin)
      await run(() => manager.addStaff({ display_name: name.trim(), role: 'staff', ...hashed }), `${name.trim()} a été ajouté à l’équipe`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
      setStep('pin')
    }
  }

  return (
    <Modal open title="Ajouter un employé" onClose={onClose}>
      {step === 'name' ? (
        <form onSubmit={next} noValidate className="space-y-6">
          <TextField label="Prénom et nom" hint="Tel qu’il apparaîtra sur l’écran de verrouillage et les registres." value={name} onChange={(v) => { setName(v); setFieldError(undefined) }} error={fieldError} autoCapitalize="words" autoFocus />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">Continuer</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <PinSetup minLength={4} maxLength={6} onComplete={save} disabled={busy} who={name.trim()} />
          {busy && <p className="text-center text-[17px] text-fg-muted">Enregistrement…</p>}
          {error && <Notice>{error}</Notice>}
          <div className="text-center">
            <Button variant="ghost" onClick={() => setStep('name')} disabled={busy} icon={<IconChevronLeft size={20} />} className="text-accent">
              Modifier le nom
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ChangePinModal({ s, me, onClose, onDone }: { s: ManagedStaff; me: boolean; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isManager = s.role === 'manager'
  const save = async (pin: string) => {
    setBusy(true)
    setError(null)
    try {
      const hashed = await hashPin(pin)
      await run(() => manager.updateStaff(s.id, hashed), me ? 'Votre code PIN a été changé' : `Code PIN de ${s.display_name} changé`)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Modal open title={me ? 'Changer mon code PIN' : `Changer le PIN – ${s.display_name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[15px] text-fg-muted">L’ancien code ne fonctionnera plus sur les appareils dès leur prochaine synchronisation.</p>
        <PinSetup minLength={isManager ? 6 : 4} maxLength={6} onComplete={save} disabled={busy} who={me ? undefined : s.display_name} />
        {busy && <p className="text-center text-[17px] text-fg-muted">Enregistrement…</p>}
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
