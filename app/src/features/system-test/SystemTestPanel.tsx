import { useCallback, useEffect, useState } from 'react'
import type { HaccpRecord, StaffMember } from '../../../../shared/types.ts'
import { Badge, Button, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatDateTime } from '../../ui/format.ts'

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
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack} aria-label="Retour à l’accueil">
          ← Accueil
        </Button>
        <h1 className="flex-1 text-3xl font-bold text-white">Test d’enregistrement</h1>
      </div>
      <p className="mb-5 text-lg text-slate-200">
        Crée une saisie de test signée par vous, enregistrée sur l’appareil puis envoyée au serveur. Sert à vérifier que tout fonctionne, y compris hors-ligne.
      </p>
      <Button size="lg" block onClick={create} disabled={busy}>
        {busy ? 'Enregistrement…' : 'Créer un enregistrement test'}
      </Button>
      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-red-950 px-5 py-3 text-lg font-semibold text-red-100 ring-2 ring-red-400">
          {error}
        </p>
      )}

      <h2 className="mt-8 mb-3 text-2xl font-bold text-white">Derniers enregistrements</h2>
      {records === null ? (
        <p className="text-lg text-slate-300">Chargement…</p>
      ) : records.length === 0 ? (
        <p className="text-lg text-slate-300">Aucun enregistrement pour l’instant.</p>
      ) : (
        <ul aria-label="Derniers enregistrements" className="divide-y divide-slate-800 overflow-hidden rounded-3xl bg-slate-900 ring-1 ring-slate-700">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold tabular-nums text-white">
                  {formatDateTime(r.device_time, timeZone)} · {author(r.author_id)}
                </div>
                <div className="text-base text-slate-300">
                  {r.type === 'system_test' ? 'Test système' : r.type} · n° {r.device_seq}
                </div>
              </div>
              {r.server_time ? <Badge tone="ok">✓ Synchronisé</Badge> : <Badge tone="warn">En attente</Badge>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
