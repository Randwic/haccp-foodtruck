import { useCallback, useEffect, useState } from 'react'
import type { HaccpRecord, StaffMember } from '../../../../shared/types.ts'
import { Badge, Button, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconChevronLeft, IconError, IconSyncPending } from '../../ui/icons.tsx'

const LIMIT = 20

/** Tuile active du lot 1 : crée un enregistrement `system_test` et liste les derniers enregistrements. */
export function SystemTestPanel({ onBack, timeZone }: { onBack: () => void; timeZone?: string }) {
  const core = useCore()
  const toast = useToast()
  const [records, setRecords] = useState<HaccpRecord[] | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRecords(await core.listRecords({ limit: LIMIT }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [core])

  useEffect(() => {
    refresh()
    core.listStaff().then(setStaff, () => {})
    // Le statut d'un enregistrement change quand la synchro avance.
    return core.onSyncStatusChange(() => {
      refresh()
    })
  }, [core, refresh])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await core.addRecord('system_test', { note: 'Test d’enregistrement depuis l’interface', ua: navigator.userAgent.slice(0, 120) })
      toast('Enregistrement test créé', 'ok')
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast(`Échec : ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const author = (id: string) => staff.find((s) => s.id === id)?.display_name ?? 'Inconnu'

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
      <Button variant="ghost" onClick={onBack} aria-label="Retour à l’accueil" icon={<IconChevronLeft size={22} />} className="-ml-3 px-3 text-accent">
        Accueil
      </Button>
      <h1 className="mt-2 mb-2 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Test d’enregistrement</h1>
      <p className="mb-6 max-w-2xl text-[17px] text-fg-muted">
        Crée une saisie de test signée par vous, enregistrée sur l’appareil puis envoyée au serveur. Sert à vérifier que tout fonctionne, y compris hors-ligne.
      </p>
      <Button size="lg" block onClick={create} disabled={busy}>
        {busy ? 'Enregistrement…' : 'Créer un enregistrement test'}
      </Button>
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3.5 text-[15px] text-fg">
          <IconError size={20} className="mt-px shrink-0 text-danger" />
          {error}
        </p>
      )}

      <h2 className="mt-10 mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Derniers enregistrements</h2>
      {records === null ? (
        <p className="text-[17px] text-fg-muted">Chargement…</p>
      ) : records.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-[17px] text-fg-muted shadow-card">Aucun enregistrement pour l’instant.</p>
      ) : (
        <ul aria-label="Derniers enregistrements" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold tabular-nums text-fg">
                  {formatDateTime(r.device_time, timeZone)} · {author(r.author_id)}
                </div>
                <div className="text-[15px] text-fg-muted">
                  {r.type === 'system_test' ? 'Test système' : r.type} · n° {r.device_seq}
                </div>
              </div>
              {r.server_time ? (
                <Badge tone="ok">
                  <IconCheck size={14} strokeWidth={2.5} />
                  Synchronisé
                </Badge>
              ) : (
                <Badge tone="warn">
                  <IconSyncPending size={14} strokeWidth={2.25} />
                  En attente
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
