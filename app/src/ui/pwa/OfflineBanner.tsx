import { useOnline } from '../hooks/useOnline.ts'
import { useSyncStatus } from '../hooks/useSyncStatus.ts'

/** Bandeau persistant quand l'appareil est hors-ligne (navigateur ou core). */
export function OfflineBanner() {
  const browserOnline = useOnline()
  const status = useSyncStatus()
  const offline = !browserOnline || status?.online === false
  if (!offline) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-center text-base font-semibold sm:text-lg text-slate-950">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M3 3l18 18" />
      </svg>
      Hors-ligne – vos saisies sont enregistrées sur l’appareil
    </div>
  )
}
