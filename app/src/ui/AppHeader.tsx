import type { StaffMember } from '../../../shared/types.ts'
import { BrandLogo, BrandStripe } from './brand.tsx'
import { Button } from './components/index.ts'
import { useNow } from './hooks/useNow.ts'
import { formatLongDate, formatTime, initials } from './format.ts'
import { IconHelp, IconLock } from './icons.tsx'
import { SyncIndicator } from './SyncIndicator.tsx'

export interface AppHeaderProps {
  establishmentName?: string
  timeZone?: string
  staff: StaffMember
  onLock: () => void
  /** Ouvre l'écran Aide (timeline + guide PDF). */
  onHelp?: () => void
  persistentStorage: boolean | null
}

/** En-tête de l'app déverrouillée : établissement, date/heure, équipier, synchro, Aide, Verrouiller. */
export function AppHeader({ establishmentName, timeZone, staff, onLock, onHelp, persistentStorage }: AppHeaderProps) {
  const now = useNow(15_000)
  return (
    <header className="bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:px-6">
        <div className="order-1 flex w-[calc(100%-9rem)] min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
          <BrandLogo size={44} glow title={null} className="shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-fg">{establishmentName ?? 'HACCP'}</div>
            <div className="mt-0.5 flex min-w-0 text-[14px] text-fg-muted">
              <span className="block min-w-0 truncate first-letter:uppercase">{formatLongDate(now, timeZone)}</span>
              <span className="shrink-0 whitespace-pre">
                {' · '}
                <span className="font-medium tabular-nums text-fg">{formatTime(now, timeZone)}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="order-3 sm:order-2">
          <SyncIndicator timeZone={timeZone} persistentStorage={persistentStorage} />
        </div>
        <span className="order-4 ml-auto flex items-center gap-2.5 sm:order-3 sm:ml-0" aria-label={`Connecté : ${staff.display_name}`}>
          <span className="text-[15px] font-medium text-fg sm:hidden lg:inline">{staff.display_name}</span>
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-sunken text-[14px] font-semibold text-fg-muted">
            {initials(staff.display_name)}
          </span>
        </span>
        {onHelp && (
          <Button variant="secondary" onClick={onHelp} icon={<IconHelp size={20} />} aria-label="Aide" className="order-2 px-4 sm:order-4 sm:px-5">
            <span className="hidden sm:inline">Aide</span>
          </Button>
        )}
        <Button variant="secondary" onClick={onLock} icon={<IconLock size={20} />} aria-label="Verrouiller" className="order-2 px-4 sm:order-4 sm:px-5">
          <span className="hidden sm:inline">Verrouiller</span>
        </Button>
      </div>
      <BrandStripe />
    </header>
  )
}
