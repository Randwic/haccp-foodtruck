import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { CoreApi } from './core/api.ts'
import { setActivityNotifier } from './ui/activity.ts'
import { createFakeCore } from './ui/fakeCore.ts'
import { demoTemperatureRecords } from './features/temperatures/demoData.ts'
import { demoProcessAlerts, demoProcessRecords } from './features/processes/demoData.ts'
import { createCore, createHttpTransport, createMockTransport, notifyActivity } from './core/index.ts'
import { createMockManagerApi, createSupabaseManagerApi, withEstablishmentName, type ManagerApi } from './manager/index.ts'

// ─────────────────────────────────────────────────────────────────────────────
// POINT DE BRANCHEMENT DU CORE ET DE L'ESPACE GÉRANT — le seul endroit à modifier.
//  • URL avec ?demo=… / ?sync=… / ?staff=… → core factice de l'interface (captures, démo visuelle) ;
//    &releves=demo : 7 jours de relevés de températures (avec correction et action corrective),
//    &releves=alerte : idem + un relevé hors seuil sans action corrective ce matin.
//    &procedes=demo : lots de refroidissement / remise en température en cours, cuissons, décongélations ;
//    &procedes=alerte : idem + un refroidissement en retard et une cuisson hors seuil sans action.
//    + espace gérant simulé, déjà connecté (gerant@demo.fr / demo-demo-demo).
//  • VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY définis → vrai core + vrai Supabase (fonctions + REST/RLS).
//  • sinon → vrai core + serveur simulé en mémoire ; espace gérant simulé branché sur ce serveur :
//      - par défaut : premier lancement (« Créer votre compte gérant ») ;
//      - ?mock=seeded : compte existant gerant@demo.fr / demo-demo-demo, équipe de démo
//        (PIN Gérant 123456, Équipier 654321) → écran « Connexion gérant ».
// ─────────────────────────────────────────────────────────────────────────────
function createDemoCore(): CoreApi {
  const params = new URLSearchParams(location.search)
  const demo = params.get('demo')
  const sync = params.get('sync')
  const releves = params.get('releves')
  const procedes = params.get('procedes')
  const now = new Date()
  const seeds = [
    ...(releves === 'demo' || releves === 'alerte' ? demoTemperatureRecords(now, releves) : []),
    ...(procedes === 'demo' || procedes === 'alerte' ? demoProcessRecords(now) : []),
    ...(procedes === 'alerte' ? demoProcessAlerts(now) : []),
  ].sort((a, b) => a.device_time.localeCompare(b.device_time))
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
    initialRecords: seeds.length ? seeds : undefined,
  })
}
const TRIAL_DB_PREFIX = 'haccp-essai-'
async function cleanOldTrialDatabases() {
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      if (db.name?.startsWith(TRIAL_DB_PREFIX)) indexedDB.deleteDatabase(db.name)
    }
  } catch {
    /* sans importance */
  }
}

function TrialBanner() {
  return (
    <div role="status" className="sticky top-0 z-50 border-b border-warn/35 bg-warn-soft px-4 py-2 text-center text-[13px] font-semibold text-warn">
      MODE ESSAI — rien n'est enregistré sur votre vrai serveur. Recharger la page = tout recommencer.
    </div>
  )
}

function createApp(): { core: CoreApi; manager: ManagerApi } {
  const params = new URLSearchParams(location.search)
  if (params.has('demo') || params.has('sync') || params.has('staff')) {
    setActivityNotifier(null)
    return { core: createDemoCore(), manager: createMockManagerApi({ seeded: true, signedIn: true, enrollAs: 'demo', latencyMs: 300 }) }
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  setActivityNotifier(notifyActivity)
  // MODE ESSAI (?essai) : tout le parcours réel (création du compte gérant, PIN, Gestion…) contre un
  // serveur simulé. Rien n'est envoyé au vrai serveur ; chaque ouverture repart de zéro.
  if (params.has('essai')) {
    void cleanOldTrialDatabases()
    const server = createMockTransport({ seed: false, latencyMs: 150 })
    const manager = createMockManagerApi({ transport: server, seeded: false, enrollAs: 'demo', latencyMs: 400 })
    const named = withEstablishmentName(server, () => manager.simulate.state().establishment_name)
    return { core: createCore({ transport: named, dbName: TRIAL_DB_PREFIX + Date.now() }), manager }
  }
  if (url && anonKey) {
    return {
      core: createCore({ transport: createHttpTransport({ baseUrl: url, anonKey }) }),
      manager: createSupabaseManagerApi({ url, anonKey }),
    }
  }
  const seeded = params.get('mock') === 'seeded'
  const server = createMockTransport({ seed: seeded, latencyMs: 150 })
  const manager = createMockManagerApi({
    transport: server,
    seeded,
    enrollAs: 'demo',
    latencyMs: 400,
    storageKey: seeded ? 'haccp.mock-manager.seeded' : 'haccp.mock-manager',
  })
  const named = withEstablishmentName(server, () => manager.simulate.state().establishment_name)
  return { core: createCore({ transport: named }), manager }
}
const { core, manager } = createApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('essai') && <TrialBanner />}
    <App core={core} manager={manager} />
  </StrictMode>,
)
