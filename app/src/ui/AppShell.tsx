import { useCallback, useEffect, useState } from 'react'
import type { Establishment, Settings, StaffMember } from '../../../shared/types.ts'
import type { DeviceInfo } from '../core/api.ts'
import { EnrollScreen } from '../features/enrollment/EnrollScreen.tsx'
import { LockScreen } from '../features/lock/LockScreen.tsx'
import { SystemTestPanel } from '../features/system-test/SystemTestPanel.tsx'
import { TodayScreen } from '../features/today/TodayScreen.tsx'
import { AppHeader } from './AppHeader.tsx'
import { useCore } from './CoreContext.tsx'
import { useAutoLock } from './hooks/useAutoLock.ts'
import { InstallBanner } from './pwa/InstallBanner.tsx'
import { OfflineBanner } from './pwa/OfflineBanner.tsx'

export const DEFAULT_AUTO_LOCK_MINUTES = 5

type Boot = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; device: DeviceInfo | null }
type View = 'today' | 'system_test'

/** Enchaînement des écrans : enrôlement → verrouillage (PIN) → accueil. */
export function AppShell() {
  const core = useCore()
  const [boot, setBoot] = useState<Boot>({ state: 'loading' })
  const [staff, setStaff] = useState<StaffMember | null>(() => core.currentStaff())
  const [establishment, setEstablishment] = useState<Establishment | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [view, setView] = useState<View>('today')

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
        <p className="text-2xl text-slate-300">Chargement…</p>
      </main>
    )
  } else if (boot.state === 'error') {
    content = (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-2xl font-bold text-red-300">
          Démarrage impossible : {boot.message}
        </p>
      </main>
    )
  } else if (!boot.device) {
    content = <EnrollScreen onEnrolled={loadDevice} />
  } else if (!staff) {
    content = <LockScreen establishmentName={establishment?.name} timeZone={tz} />
  } else {
    content = (
      <>
        <AppHeader establishmentName={establishment?.name} timeZone={tz} staff={staff} onLock={lock} persistentStorage={persistent} />
        {view === 'system_test' ? (
          <SystemTestPanel onBack={() => setView('today')} timeZone={tz} />
        ) : (
          <TodayScreen onOpenSystemTest={() => setView('system_test')} />
        )}
      </>
    )
  }

  return (
    <div className="safe-px safe-pt safe-pb flex min-h-dvh flex-col bg-slate-950 text-slate-50">
      <OfflineBanner />
      <InstallBanner />
      {content}
    </div>
  )
}
