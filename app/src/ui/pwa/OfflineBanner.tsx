import { useOnline } from '../hooks/useOnline.ts'
import { useSyncStatus } from '../hooks/useSyncStatus.ts'

/** Bandeau persistant quand l'appareil est hors-ligne (navigateur ou core). */
export function OfflineBanner() {
  const browserOnline = useOnline()
  const status = useSyncStatus()
  const offline = !browserOnline || status?.online === false
  if (!offline) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-center text-lg font-semibold text-slate-950">
      <span aria-hidden="true">⚡</span>
      Hors-ligne – vos saisies sont enregistrées sur l’appareil
    </div>
  )
}
