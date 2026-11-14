/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../components/index.ts'

const CHECK_EVERY_MS = 60 * 60 * 1000

/** Invite « Nouvelle version disponible » (vite-plugin-pwa, registerType: 'prompt'). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Vérifie régulièrement les mises à jour (l'app reste ouverte toute la journée sur l'iPad).
      if (registration) setInterval(() => registration.update().catch(() => {}), CHECK_EVERY_MS)
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="alertdialog"
      aria-label="Mise à jour"
      className="safe-pb fixed inset-x-0 bottom-0 z-[55] flex flex-wrap items-center justify-center gap-3 border-t border-line bg-elevated px-4 py-3 text-fg shadow-pop"
    >
      <span className="text-[17px] font-semibold">Nouvelle version disponible</span>
      <Button onClick={() => updateServiceWorker(true)}>Mettre à jour</Button>
      <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
        Plus tard
      </Button>
    </div>
  )
}
