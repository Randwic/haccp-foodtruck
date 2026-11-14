import type { StaffMember } from '../../../shared/types.ts'
import { Button } from './components/index.ts'
import { useNow } from './hooks/useNow.ts'
import { formatLongDate, formatTime, initials } from './format.ts'
import { SyncIndicator } from './SyncIndicator.tsx'

export interface AppHeaderProps {
  establishmentName?: string
  timeZone?: string
  staff: StaffMember
  onLock: () => void
  persistentStorage: boolean | null
}

/** En-tête de l'app déverrouillée : établissement, date/heure, équipier, synchro, Verrouiller. */
export function AppHeader({ establishmentName, timeZone, staff, onLock, persistentStorage }: AppHeaderProps) {
  const now = useNow(15_000)
  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <div className="truncate text-xl font-bold text-white">{establishmentName ?? 'HACCP'}</div>
          <div className="text-base text-slate-300">
            {formatLongDate(now, timeZone)} · <span className="tabular-nums font-semibold text-white">{formatTime(now, timeZone)}</span>
          </div>
        </div>
        <SyncIndicator timeZone={timeZone} persistentStorage={persistentStorage} />
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-2" aria-label={`Connecté : ${staff.display_name}`}>
            <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-lg font-black text-white">
              {initials(staff.display_name)}
            </span>
            <span className="hidden text-lg font-semibold text-white sm:inline">{staff.display_name}</span>
          </span>
          <Button variant="secondary" onClick={onLock} icon={<span aria-hidden="true">🔒</span>}>
            Verrouiller
          </Button>
        </div>
      </div>
    </header>
  )
}
