import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ui/theme.css'
import App from './App.tsx'
import type { CoreApi } from './core/api.ts'
import { setActivityNotifier } from './ui/activity.ts'
import { createFakeCore } from './ui/fakeCore.ts'
import { createCore, createHttpTransport, createMockTransport, notifyActivity } from './core/index.ts'

// ─────────────────────────────────────────────────────────────────────────────
// POINT DE BRANCHEMENT DU CORE — le seul endroit à modifier.
//  • URL avec ?demo=… / ?sync=… / ?staff=… → core factice de l'interface (captures, démo visuelle).
//  • VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY définis → vrai core, vrai serveur Supabase.
//  • sinon → vrai core + serveur simulé en mémoire (appareil de démo : voir DEMO_DEVICE,
//    PIN Gérant 123456, Équipier 654321).
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
    noStaffUntilSync: params.get('staff') === 'empty',
  })
}
function createAppCore(): CoreApi {
  const params = new URLSearchParams(location.search)
  if (params.has('demo') || params.has('sync') || params.has('staff')) {
    setActivityNotifier(null)
    return createDemoCore()
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  const transport = url && anonKey ? createHttpTransport({ baseUrl: url, anonKey }) : createMockTransport()
  setActivityNotifier(notifyActivity)
  return createCore({ transport })
}
const core: CoreApi = createAppCore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App core={core} />
  </StrictMode>,
)
