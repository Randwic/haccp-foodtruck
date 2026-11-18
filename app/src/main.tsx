import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { CoreApi } from './core/api.ts'
import { setActivityNotifier } from './ui/activity.ts'
import { createFakeCore, type FakeCore } from './ui/fakeCore.ts'
import { demoTemperatureRecords } from './features/temperatures/demoData.ts'
import { demoProcessAlerts, demoProcessRecords } from './features/processes/demoData.ts'
import { demoReceptions } from './features/reception/demoData.ts'
import { DEMO_MENU_PRODUCTS, DEMO_MENU_RECIPES, demoLabels } from './features/labels/demoData.ts'
import { demoCleaningRecords, demoOilRecords, demoWasteRecords } from './features/cleaning/demoData.ts'
import { demoDocuments } from './features/documents/demoData.ts'
import { demoThermometerRecords } from './features/thermometer/demoData.ts'
import { createCore, createHttpTransport, createMockTransport, notifyActivity } from './core/index.ts'
import { registerLabelScanning } from './features/reception/scan/register.tsx'
import { createMockManagerApi, createSupabaseManagerApi, withEstablishmentName, type ManagerApi } from './manager/index.ts'
import { demoAlerts } from './features/alerts/demoData.ts'

// ─────────────────────────────────────────────────────────────────────────────
// POINT DE BRANCHEMENT DU CORE ET DE L'ESPACE GÉRANT — le seul endroit à modifier.
//  • URL avec ?demo=… / ?sync=… / ?staff=… → core factice de l'interface (captures, démo visuelle) ;
//    &releves=demo : 7 jours de relevés de températures (avec correction et action corrective),
//    &releves=alerte : idem + un relevé hors seuil sans action corrective ce matin.
//    &procedes=demo : lots de refroidissement / remise en température en cours, cuissons, décongélations ;
//    &procedes=alerte : idem + un refroidissement en retard et une cuisson hors seuil sans action.
//    &receptions=demo : réceptions (refus, photos, correction, action corrective) et une perte ;
//    &receptions=alerte : idem + un produit accepté hors température sans action corrective.
//    &etiquettes=demo : étiquettes (DLC dépassée, aujourd'hui, demain, correction, perte), décongélation
//      terminée à reprendre, lots reçus, et plats de la carte pour le tableau des allergènes.
//    &nettoyage=demo : 10 jours de nettoyages (tâches à jour, à faire, en retard), checklists (dont un « Non »), correction ;
//    &huiles=demo : contrôles depuis le dernier changement (bac 2 à surveiller) ; &huiles=alerte : bac 2 hors limite sans action ;
//    &pertes=demo : produits jetés de la semaine.
//    &thermometres=demo : vérifications des sondes (dont une en retard) ; &thermometres=alerte : sonde hors tolérance sans action.
//    + espace gérant simulé, déjà connecté (gerant@demo.fr / demo-demo-demo).
//  • VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY définis → vrai core + vrai Supabase (fonctions + REST/RLS).
//  • sinon → vrai core + serveur simulé en mémoire ; espace gérant simulé branché sur ce serveur :
//      - par défaut : premier lancement (« Créer votre compte gérant ») ;
//      - ?mock=seeded : compte existant gerant@demo.fr / demo-demo-demo, équipe de démo
//        (PIN Gérant 123456, Équipier 654321) → écran « Connexion gérant ».
// ─────────────────────────────────────────────────────────────────────────────
function createDemoCore(): FakeCore {
  const params = new URLSearchParams(location.search)
  const demo = params.get('demo')
  const sync = params.get('sync')
  const releves = params.get('releves')
  const procedes = params.get('procedes')
  const receptions = params.get('receptions')
  const etiquettes = params.get('etiquettes') === 'demo'
  const huiles = params.get('huiles')
  const thermometres = params.get('thermometres')
  const now = new Date()
  const rc = receptions === 'demo' || receptions === 'alerte' ? demoReceptions(now, receptions) : null
  const seeds = [
    ...(releves === 'demo' || releves === 'alerte' ? demoTemperatureRecords(now, releves) : []),
    ...(procedes === 'demo' || procedes === 'alerte' ? demoProcessRecords(now) : []),
    ...(procedes === 'alerte' ? demoProcessAlerts(now) : []),
    ...(rc?.records ?? []),
    ...(etiquettes ? demoLabels(now) : []),
    ...(params.get('nettoyage') === 'demo' ? demoCleaningRecords(now) : []),
    ...(huiles === 'demo' || huiles === 'alerte' ? demoOilRecords(now, huiles) : []),
    ...(params.get('pertes') === 'demo' ? demoWasteRecords(now) : []),
    ...(thermometres === 'demo' || thermometres === 'alerte' ? demoThermometerRecords(now, thermometres) : []),
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
    initialPhotos: rc?.initialPhotos,
    // Lot 4 bis : catalogue réel (menu Space Diner) dans toute la démo, partagé avec l'espace gérant simulé.
    products: DEMO_MENU_PRODUCTS,
    recipes: DEMO_MENU_RECIPES,
    alerts: params.get('alertes') === 'demo' ? demoAlerts(now) : undefined,
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
    // Gestion et core factice partagent le même catalogue : un produit / une recette créés dans Gestion
    // apparaissent aussitôt dans Étiquettes, Cuisson, Nettoyage… (fakeCore.simulate = « sync-pull » simulé).
    const core = createDemoCore()
    const manager = createMockManagerApi({
      seeded: true,
      signedIn: true,
      enrollAs: 'demo',
      latencyMs: 300,
      catalog: { products: DEMO_MENU_PRODUCTS, recipes: DEMO_MENU_RECIPES },
      referenceSink: core.simulate,
      // Lot 7 : documents de démonstration, registre « du serveur » = saisies du core factice.
      documents: demoDocuments(new Date()),
      registrySource: () => core.listRecords(),
      devices: [{ id: '00000000-0000-4000-8000-000000000001', name: 'iPad cuisine', revoked_at: null }],
    })
    return { core, manager }
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  // Nouvelle clé « publishable » si elle est fournie, sinon l'ancienne clé « anon » (retirée début 2027).
  const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
  setActivityNotifier(notifyActivity)
  // MODE ESSAI (?essai) : tout le parcours réel (création du compte gérant, PIN, Gestion…) contre un
  // serveur simulé. Rien n'est envoyé au vrai serveur ; chaque ouverture repart de zéro.
  if (params.has('essai')) {
    void cleanOldTrialDatabases()
    const server = createMockTransport({ seed: false, latencyMs: 150 })
    const manager = createMockManagerApi({ transport: server, seeded: false, enrollAs: 'demo', latencyMs: 400, catalog: { products: DEMO_MENU_PRODUCTS, recipes: DEMO_MENU_RECIPES } })
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
    catalog: { products: DEMO_MENU_PRODUCTS, recipes: DEMO_MENU_RECIPES },
    storageKey: seeded ? 'haccp.mock-manager.seeded' : 'haccp.mock-manager',
  })
  const named = withEstablishmentName(server, () => manager.simulate.state().establishment_name)
  return { core: createCore({ transport: named }), manager }
}
const { core, manager } = createApp()
// Achats : lecture automatique de l'étiquette (lot, DLC/DDM) et scan du code-barres, sur l'appareil.
registerLabelScanning()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('essai') && <TrialBanner />}
    <App core={core} manager={manager} />
  </StrictMode>,
)
