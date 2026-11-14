import { useOnline } from '../hooks/useOnline.ts'
import { IconOffline } from '../icons.tsx'
import { useSyncStatus } from '../hooks/useSyncStatus.ts'

/** Bandeau persistant quand l'appareil est hors-ligne (navigateur ou core). */
export function OfflineBanner() {
  const browserOnline = useOnline()
  const status = useSyncStatus()
  const offline = !browserOnline || status?.online === false
  if (!offline) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 border-b border-warn/30 bg-warn-soft px-4 py-2.5 text-center text-[15px] font-semibold text-warn">
      <IconOffline size={20} className="shrink-0" />
      Hors-ligne – vos saisies sont enregistrées sur l’appareil
    </div>
  )
}
