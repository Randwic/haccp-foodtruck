import { useState } from 'react'
import { Button } from '../components/index.ts'
import { IconShare } from '../icons.tsx'
import { InstallGuide } from './InstallGuide.tsx'
import { dismissInstallBanner, isInstallBannerDismissed, isStandalone } from './installState.ts'

/** Bannière « Installer l'application », visible tant que l'app n'est pas ouverte depuis l'écran d'accueil. */
export function InstallBanner() {
  const [standalone] = useState(isStandalone)
  const [hidden, setHidden] = useState(isInstallBannerDismissed)
  const [guideOpen, setGuideOpen] = useState(false)

  if (standalone) return null
  return (
    <>
      {!hidden && (
        <aside aria-label="Installation" className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <IconShare size={20} />
          </span>
          <p className="min-w-0 flex-1 text-[15px] leading-snug text-fg-muted">
            <strong className="font-semibold text-fg">Installez l’application</strong> sur l’écran d’accueil pour ne pas perdre vos saisies et recevoir les alertes.
          </p>
          <div className="flex w-full gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button variant="secondary" onClick={() => setGuideOpen(true)}>Comment faire ?</Button>
            <Button
              variant="ghost"
              onClick={() => {
                dismissInstallBanner()
                setHidden(true)
              }}
            >
              Plus tard
            </Button>
          </div>
        </aside>
      )}
      <InstallGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  )
}
