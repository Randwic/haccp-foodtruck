import { useState } from 'react'
import { Button, Modal, useToast } from './components/index.ts'
import { useCore } from './CoreContext.tsx'
import { useNow } from './hooks/useNow.ts'
import { useSyncStatus } from './hooks/useSyncStatus.ts'
import { formatDateTime } from './format.ts'
import { IconSynced, IconSyncError, IconSyncPending } from './icons.tsx'
import { describeSync, type SyncLevel } from './syncState.ts'

// Badges discrets : fond teinté, texte et icône de la couleur d'état (vert / ambre / rouge).
const STYLES: Record<SyncLevel, string> = {
  ok: 'bg-ok-soft text-ok border-ok/25',
  pending: 'bg-warn-soft text-warn border-warn/35',
  error: 'bg-danger-soft text-danger border-danger/40',
}
const ICONS: Record<SyncLevel, typeof IconSynced> = { ok: IconSynced, pending: IconSyncPending, error: IconSyncError }

/** Pastille de synchro toujours visible ; le toucher ouvre le détail. */
export function SyncIndicator({ timeZone, persistentStorage = null }: { timeZone?: string; persistentStorage?: boolean | null }) {
  const core = useCore()
  const status = useSyncStatus()
  const now = useNow(30_000)
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  if (!status) return <div className="h-12 w-48 animate-pulse rounded-full bg-sunken" aria-hidden="true" />
  const view = describeSync(status, now.getTime())
  const Icon = ICONS[view.level]

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
    <div className="flex justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-fg">{value}</dd>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-sync-level={view.level}
        aria-label={`Synchronisation : ${view.label}. Toucher pour le détail.`}
        className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition-transform active:scale-[0.98] ${STYLES[view.level]}`}
      >
        <Icon size={20} />
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
        <p className={`mb-4 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[17px] font-semibold ${STYLES[view.level]}`}>
          <Icon size={22} />
          {view.label}
        </p>
        {view.reasons.length > 0 && (
          <ul className="mb-4 list-disc space-y-1 pl-6 text-fg" role={view.level === 'error' ? 'alert' : undefined}>
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
          {status.photos_pending !== undefined && row('Photos en attente d’envoi', String(status.photos_pending))}
          {(status.photos_failed ?? 0) > 0 && row('Photos refusées', String(status.photos_failed))}
          {row('Dernière synchro réussie', status.last_success_at ? formatDateTime(status.last_success_at, timeZone) : 'Jamais')}
          {persistentStorage !== null && row('Stockage protégé sur l’appareil', persistentStorage ? 'Oui' : 'Non – installez l’app')}
        </dl>
        <p className="mt-4 text-[15px] text-fg-muted">Les saisies sont toujours enregistrées d’abord sur l’appareil, puis envoyées dès que le réseau est disponible.</p>
      </Modal>
    </>
  )
}
