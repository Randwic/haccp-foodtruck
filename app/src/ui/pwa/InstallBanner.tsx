import { useState } from 'react'
import { Button } from '../components/index.ts'
import { InstallGuide, ShareIcon } from './InstallGuide.tsx'
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
        <aside aria-label="Installation" className="flex flex-wrap items-center gap-3 bg-sky-950 px-4 py-3 text-sky-50 ring-1 ring-sky-800 sm:px-6">
          <ShareIcon className="h-8 w-8 shrink-0 text-sky-200" />
          <p className="min-w-0 flex-1 text-lg">
            <strong>Installez l’application</strong> sur l’écran d’accueil pour ne pas perdre vos saisies et recevoir les alertes.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setGuideOpen(true)}>Comment faire ?</Button>
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
