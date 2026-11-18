import { useCallback, useEffect, useState } from 'react'
import type { Establishment, Settings, StaffMember } from '../../../shared/types.ts'
import type { DeviceInfo } from '../core/api.ts'
import { LockScreen } from '../features/lock/LockScreen.tsx'
import { ManagementScreen } from '../features/management/ManagementScreen.tsx'
import { SetupFlow } from '../features/setup/SetupFlow.tsx'
import { SystemTestPanel } from '../features/system-test/SystemTestPanel.tsx'
import { TemperaturesScreen } from '../features/temperatures/TemperaturesScreen.tsx'
import { ReceptionScreen } from '../features/reception/ReceptionScreen.tsx'
import { CookingScreen } from '../features/processes/CookingScreen.tsx'
import { DeadlineWatcher } from '../features/processes/DeadlineWatcher.tsx'
import { ThawingScreen } from '../features/processes/ThawingScreen.tsx'
import { TimedProcessScreen } from '../features/processes/TimedProcessScreen.tsx'
import { TodayScreen, type ProcessView } from '../features/today/TodayScreen.tsx'
import { AllergenTableScreen } from '../features/labels/AllergenTableScreen.tsx'
import { LabelsScreen } from '../features/labels/LabelsScreen.tsx'
import { CleaningScreen } from '../features/cleaning/CleaningScreen.tsx'
import { OilScreen } from '../features/oil/OilScreen.tsx'
import { WasteScreen } from '../features/reception/WasteScreen.tsx'
import { DocumentsScreen } from '../features/documents/DocumentsScreen.tsx'
import { AppHeader } from './AppHeader.tsx'
import { useCore } from './CoreContext.tsx'
import { useAutoLock } from './hooks/useAutoLock.ts'
import { InstallBanner } from './pwa/InstallBanner.tsx'
import { OfflineBanner } from './pwa/OfflineBanner.tsx'

export const DEFAULT_AUTO_LOCK_MINUTES = 5

type Boot = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; device: DeviceInfo | null }
type View = 'today' | 'system_test' | 'management' | 'temperatures' | 'reception' | 'labels' | 'allergens' | 'cleaning' | 'oil' | 'waste' | 'documents' | ProcessView

/** Enchaînement des écrans : première configuration → verrouillage (PIN) → accueil / Gestion. */
export function AppShell() {
  const core = useCore()
  const [boot, setBoot] = useState<Boot>({ state: 'loading' })
  const [staff, setStaff] = useState<StaffMember | null>(() => core.currentStaff())
  const [establishment, setEstablishment] = useState<Establishment | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [view, setView] = useState<View>('today')
  // Rappel d'une checklist sur l'accueil : ouverture directe de la checklist.
  const [checklistToOpen, setChecklistToOpen] = useState<string | undefined>(undefined)
  // Tableau des allergènes : ouvert depuis l'accueil, les étiquettes ou la gestion (retour au même endroit).
  const [allergensFrom, setAllergensFrom] = useState<'today' | 'labels' | 'management'>('today')
  const openAllergens = (from: 'today' | 'labels' | 'management') => {
    setAllergensFrom(from)
    setView('allergens')
  }

  const loadDevice = useCallback(async () => {
    try {
      const device = await core.getDevice()
      setBoot({ state: 'ready', device })
      if (device) {
        const [e, s] = await Promise.all([core.getEstablishment(), core.getSettings()])
        setEstablishment(e)
        setSettings(s)
      }
    } catch (e) {
      setBoot({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [core])

  useEffect(() => {
    loadDevice()
  }, [loadDevice])

  useEffect(() => {
    setStaff(core.currentStaff())
    return core.onSessionChange((s) => {
      setStaff(s)
      if (!s) setView('today')
    })
  }, [core])

  const enrolled = boot.state === 'ready' && boot.device !== null

  // Nom d'établissement et délai de verrouillage peuvent changer (Gestion) : relus après chaque synchro.
  useEffect(() => {
    if (!enrolled) return
    let alive = true
    const off = core.onSyncStatusChange(() => {
      Promise.all([core.getEstablishment(), core.getSettings()]).then(([e, s]) => {
        if (!alive) return
        setEstablishment(e)
        setSettings(s)
      }, () => {})
    })
    return () => {
      alive = false
      off()
    }
  }, [core, enrolled])
  useEffect(() => {
    if (!enrolled) return
    core.requestPersistentStorage().then(setPersistent, () => setPersistent(false))
  }, [core, enrolled])

  const lock = useCallback(() => core.lock(), [core])
  useAutoLock(settings?.auto_lock_minutes ?? DEFAULT_AUTO_LOCK_MINUTES, lock, enrolled && staff !== null)

  const tz = establishment?.timezone

  let content
  if (boot.state === 'loading') {
    content = (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <p className="text-lg text-fg-muted">Chargement…</p>
      </main>
    )
  } else if (boot.state === 'error') {
    content = (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-xl font-semibold text-danger">
          Démarrage impossible : {boot.message}
        </p>
      </main>
    )
  } else if (!boot.device) {
    content = <SetupFlow onEnrolled={loadDevice} />
  } else if (!staff) {
    content = <LockScreen establishmentName={establishment?.name} timeZone={tz} />
  } else {
    content = (
      <>
        <AppHeader establishmentName={establishment?.name} timeZone={tz} staff={staff} onLock={lock} persistentStorage={persistent} />
        <DeadlineWatcher />
        {view === 'system_test' ? (
          <SystemTestPanel onBack={() => setView('today')} timeZone={tz} />
        ) : view === 'temperatures' ? (
          <TemperaturesScreen onBack={() => setView('today')} />
        ) : view === 'cooling' || view === 'reheating' ? (
          <TimedProcessScreen key={view} kind={view} onBack={() => setView('today')} />
        ) : view === 'cooking' ? (
          <CookingScreen onBack={() => setView('today')} />
        ) : view === 'reception' ? (
          <ReceptionScreen onBack={() => setView('today')} canAddSupplier={staff.role === 'manager'} />
        ) : view === 'thawing' ? (
          <ThawingScreen onBack={() => setView('today')} />
        ) : view === 'cleaning' ? (
          <CleaningScreen key={checklistToOpen ?? 'home'} onBack={() => setView('today')} openChecklistId={checklistToOpen} />
        ) : view === 'oil' ? (
          <OilScreen onBack={() => setView('today')} />
        ) : view === 'waste' ? (
          <WasteScreen onBack={() => setView('today')} />
        ) : view === 'labels' ? (
          <LabelsScreen onBack={() => setView('today')} onOpenAllergens={() => openAllergens('labels')} />
        ) : view === 'allergens' ? (
          <AllergenTableScreen
            onBack={() => setView(allergensFrom === 'management' && staff.role !== 'manager' ? 'today' : allergensFrom)}
            backLabel={allergensFrom === 'labels' ? 'Étiquettes' : allergensFrom === 'management' ? 'Gestion' : 'Accueil'}
          />
        ) : view === 'documents' && staff.role === 'manager' ? (
          <DocumentsScreen onBack={() => setView('today')} />
        ) : view === 'management' && staff.role === 'manager' ? (
          <ManagementScreen onBack={() => setView('today')} meId={staff.id} onOpenAllergens={() => openAllergens('management')} />
        ) : (
          <TodayScreen
            onOpenSystemTest={() => setView('system_test')}
            onOpenTemperatures={() => setView('temperatures')}
            onOpenReception={() => setView('reception')}
            onOpenLabels={() => setView('labels')}
            onOpenCleaning={(checklistId) => {
              setChecklistToOpen(checklistId)
              setView('cleaning')
            }}
            onOpenOil={() => setView('oil')}
            onOpenWaste={() => setView('waste')}
            onOpenAllergens={() => openAllergens('today')}
            onOpenProcess={setView}
            onOpenManagement={staff.role === 'manager' ? () => setView('management') : undefined}
            onOpenDocuments={staff.role === 'manager' ? () => setView('documents') : undefined}
          />
        )}
      </>
    )
  }

  return (
    <div className="safe-px safe-pt safe-pb flex min-h-dvh flex-col bg-canvas text-fg">
      <OfflineBanner />
      <InstallBanner />
      {content}
    </div>
  )
}
