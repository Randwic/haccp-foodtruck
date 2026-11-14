import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ui/theme.css'
import App from './App.tsx'
import type { CoreApi } from './core/api.ts'
import { createFakeCore } from './ui/fakeCore.ts'

// ─────────────────────────────────────────────────────────────────────────────
// POINT DE BRANCHEMENT DU CORE — le seul endroit à modifier.
// Aujourd'hui : core factice en mémoire (démo). Pour le vrai core, remplacer par
//   import { createCore } from './core/index.ts'
//   const core: CoreApi = await createCore()   (ou équivalent)
// Paramètres de démo dans l'URL : ?demo=enrolled | unlocked  et  ?sync=pending | error | stale | rejected | offline
// ─────────────────────────────────────────────────────────────────────────────
function createDemoCore(): CoreApi {
  const params = new URLSearchParams(location.search)
  const demo = params.get('demo')
  const sync = params.get('sync')
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const syncPresets = {
    pending: { pending_count: 3, oldest_pending_at: hoursAgo(1) },
    error: { pending_count: 2, oldest_pending_at: hoursAgo(2), last_error: 'Serveur injoignable (délai dépassé)' },
    stale: { pending_count: 5, oldest_pending_at: hoursAgo(30), online: false },
    rejected: { rejected_count: 1 },
    offline: { online: false, pending_count: 1, oldest_pending_at: hoursAgo(0.2) },
  } as const
  return createFakeCore({
    enrolled: demo === 'enrolled' || demo === 'unlocked',
    unlockedStaffId: demo === 'unlocked' ? 'staff-gerant' : undefined,
    sync: sync && sync in syncPresets ? syncPresets[sync as keyof typeof syncPresets] : undefined,
    autoSyncDelayMs: sync ? null : 1200,
  })
}
const core: CoreApi = createDemoCore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App core={core} />
  </StrictMode>,
)
