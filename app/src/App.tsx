import type { CoreApi } from './core/api.ts'
import { AppShell } from './ui/AppShell.tsx'
import { ToastProvider } from './ui/components/index.ts'
import { CoreProvider } from './ui/CoreContext.tsx'
import { UpdatePrompt } from './ui/pwa/UpdatePrompt.tsx'

/** Racine de l'interface : reçoit l'implémentation du core (voir main.tsx). */
export default function App({ core }: { core: CoreApi }) {
  return (
    <CoreProvider core={core}>
      <ToastProvider>
        <AppShell />
        <UpdatePrompt />
      </ToastProvider>
    </CoreProvider>
  )
}
