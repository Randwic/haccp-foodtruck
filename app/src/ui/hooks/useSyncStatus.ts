import { useEffect, useState } from 'react'
import type { SyncStatus } from '../../core/api.ts'
import { useCore } from '../CoreContext.tsx'

/** État de synchro courant, mis à jour en direct. `null` tant qu'il n'est pas chargé. */
export function useSyncStatus(): SyncStatus | null {
  const core = useCore()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  useEffect(() => {
    let alive = true
    const off = core.onSyncStatusChange((s) => alive && setStatus(s))
    core.getSyncStatus().then((s) => alive && setStatus((prev) => prev ?? s))
    return () => {
      alive = false
      off()
    }
  }, [core])
  return status
}
