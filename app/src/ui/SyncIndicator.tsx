import { useState } from 'react'
import { Button, Modal, useToast } from './components/index.ts'
import { useCore } from './CoreContext.tsx'
import { useNow } from './hooks/useNow.ts'
import { useSyncStatus } from './hooks/useSyncStatus.ts'
import { formatDateTime } from './format.ts'
import { describeSync, type SyncLevel } from './syncState.ts'

const STYLES: Record<SyncLevel, string> = {
  ok: 'bg-emerald-400 text-slate-950',
  pending: 'bg-amber-400 text-slate-950',
  error: 'bg-red-700 text-white ring-2 ring-red-300',
}
const SYMBOL: Record<SyncLevel, string> = { ok: '✓', pending: '⟳', error: '!' }

/** Pastille de synchro toujours visible ; le toucher ouvre le détail. */
export function SyncIndicator({ timeZone, persistentStorage = null }: { timeZone?: string; persistentStorage?: boolean | null }) {
  const core = useCore()
  const status = useSyncStatus()
  const now = useNow(30_000)
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  if (!status) return <div className="h-14 w-48 animate-pulse rounded-2xl bg-slate-800" aria-hidden="true" />
  const view = describeSync(status, now.getTime())

  const syncNow = async () => {
    setSyncing(true)
    try {
      const s = await core.syncNow()
      const v = describeSync(s)
      toast(v.level === 'ok' ? 'Synchronisation réussie' : v.label, v.level === 'ok' ? 'ok' : 'error')
    } catch (e) {
      toast(`Échec de la synchronisation : ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-b border-slate-800 py-2">
      <dt className="text-slate-300">{label}</dt>
      <dd className="text-right font-semibold text-white">{value}</dd>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-sync-level={view.level}
        aria-label={`Synchronisation : ${view.label}. Toucher pour le détail.`}
        className={`inline-flex min-h-14 items-center gap-2 rounded-2xl px-4 text-lg font-bold ${STYLES[view.level]}`}
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          {SYMBOL[view.level]}
        </span>
        <span>{view.label}</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Synchronisation"
        footer={
          <Button onClick={syncNow} disabled={syncing}>
            {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </Button>
        }
      >
        <p className={`mb-4 rounded-2xl px-4 py-3 text-xl font-bold ${STYLES[view.level]}`}>{view.label}</p>
        {view.reasons.length > 0 && (
          <ul className="mb-4 list-disc space-y-1 pl-6 text-slate-100" role={view.level === 'error' ? 'alert' : undefined}>
            {view.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <dl>
          {row('Réseau', status.online ? 'En ligne' : 'Hors-ligne')}
          {row('Saisies en attente', String(status.pending_count))}
          {row('Plus ancienne en attente', status.oldest_pending_at ? formatDateTime(status.oldest_pending_at, timeZone) : '—')}
          {row('Saisies refusées', String(status.rejected_count))}
          {row('Dernière synchro réussie', status.last_success_at ? formatDateTime(status.last_success_at, timeZone) : 'Jamais')}
          {persistentStorage !== null && row('Stockage protégé sur l’appareil', persistentStorage ? 'Oui' : 'Non – installez l’app')}
        </dl>
        <p className="mt-4 text-base text-slate-300">Les saisies sont toujours enregistrées d’abord sur l’appareil, puis envoyées dès que le réseau est disponible.</p>
      </Modal>
    </>
  )
}
