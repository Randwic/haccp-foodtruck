import { createContext, useContext, useState, type ReactNode } from 'react'
import { Button, Modal, Notice, TextField } from '../../ui/components/index.ts'

/** Exécute une écriture gérant : gère session expirée, erreurs, puis resynchronise l'appareil. */
export type RunWrite = <T>(fn: () => Promise<T>, success?: string) => Promise<T>

export interface ManagementTools {
  run: RunWrite
  /** Équipier déverrouillé (le gérant) : pour « (vous) » et l'interdiction de se désactiver. */
  meId: string | null
}

// eslint-disable-next-line react-refresh/only-export-components
export const ManagementContext =createContext<ManagementTools | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useManagement(): ManagementTools {
  const v = useContext(ManagementContext)
  if (!v) throw new Error('useManagement() hors de <ManagementScreen>')
  return v
}

/** Demande de confirmation pour une action sensible. */
export function ConfirmModal(props: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<unknown> | void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant={props.danger ? 'danger' : 'primary'} onClick={confirm} disabled={busy}>
            {busy ? 'Enregistrement…' : props.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {props.children}
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}

/** Champ de température : clavier décimal + bouton ± (le clavier numérique d'iOS n'a pas de signe moins). */
export function TemperatureField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  const toggleSign = () => {
    const v = value.trim().replace(/^[−–]/, '-')
    if (v === '') onChange('-')
    else onChange(v.startsWith('-') ? v.slice(1) : `-${v.replace(/^\+/, '')}`)
  }
  return (
    <TextField
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
      error={error}
      inputMode="decimal"
      placeholder="—"
      addon={
        <>
          <button
            type="button"
            onClick={toggleSign}
            aria-label={`Changer le signe – ${label}`}
            className="min-h-16 w-16 shrink-0 rounded-2xl bg-slate-700 text-2xl font-bold text-white ring-1 ring-slate-500 active:bg-slate-600"
          >
            ±
          </button>
          <span aria-hidden="true" className="flex min-h-16 items-center pl-1 text-xl text-slate-300">
            °C
          </span>
        </>
      }
    />
  )
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="mt-8 mb-3 text-xl font-bold text-slate-200 first:mt-0">
      {children}
      {count !== undefined && <span className="ml-2 font-semibold text-slate-400">({count})</span>}
    </h2>
  )
}
